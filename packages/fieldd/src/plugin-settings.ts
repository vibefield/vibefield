import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SettingsSnapshot } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { Ajv, type ValidateFunction } from "ajv";
import { RpcCallError } from "./native-link";
import type { PluginRegistryService } from "./plugin-registry";
import { SettingsDocService } from "./settings-doc";

// SettingsService (plugin spec §16.2, P5): declared keys only, ajv-validated
// values, three backends routed by the DECLARED scope:
//   user   → <dataDir>/fieldd/plugins/settings-user.json (per-plugin sections;
//            becomes a slice of the D29 system settings doc when replication
//            lands — recorded delta, thinking-p5)
//   device → <dataDir>/plugins/<id>/config.json (atomic file, never synced)
//   secret → the SecretStore (OS keychain on darwin; injectable for tests) —
//            values never touch any file under dataDir, any snapshot, or any
//            log line; the wire returns them ONLY to the owning plugin.
// Defaults come from the schema and are never eagerly persisted (§16.2).

export interface SecretStore {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

/** One call of the keychain tool: the program, its arguments, what it is handed on its stdin, and the environment it
 * runs under (fieldd's own when absent). */
export interface SecretToolCall {
  executable: string;
  args: readonly string[];
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** how long the call may take before it is stopped (default `SECRET_TOOL_TIMEOUT_MS`) */
  timeoutMs?: number;
}

/** A call of the keychain tool that did not succeed: its exit code (null when it did not exit by itself) and whether
 * its time limit stopped it. It holds nothing of the call's arguments, stdin or output, so it may be logged whole. */
export class SecretToolError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly timedOut: boolean,
  ) {
    super(
      timedOut
        ? "the keychain tool did not finish in time"
        : `the keychain tool ended ${exitCode ?? "without an exit code"}`,
    );
    this.name = "SecretToolError";
  }
}

/** Runs one call of the keychain tool and answers its stdout; a call that fails rejects. */
export type SecretToolRunner = (call: SecretToolCall) => Promise<{ stdout: string }>;

/** The most a call's answer may be: past it the call is stopped and refused. */
const SECRET_TOOL_ANSWER_MAX = 1024 * 1024;

/** The keychain tool, by its absolute path: never a name a PATH resolves (item 542, 2026-11-18). */
export const SECURITY_TOOL = "/usr/bin/security";

/** How long one call of the tool may take before it is stopped: a call that waits on anything is a refusal. */
export const SECRET_TOOL_TIMEOUT_MS = 10_000;

/** The tool's exit for an item the keychain does not hold: the one failure a read answers as "no secret". */
const SECRET_TOOL_NOT_FOUND = 44;

/** The longest stdin line the tool was seen to keep whole, in bytes and its line break included (item 542's probes,
 * 2026-11-18). One byte past it the tool was seen to end 0 and keep another value, so its exit proves nothing there:
 * a set refuses, before any call, a value whose line would be longer. */
export const SECRET_TOOL_LINE_MAX = 4096;

/** The bytes of a value the refusal for its length names, and the call's own limit must reach to name it: for a
 * profile's server values every line fieldd writes leaves at least 1,989 (the longest profile id's). */
const SECRET_TOO_LONG_NAMED = 1900;

/** What a person reads when a value is refused for its length (item 542). It names a limit only when this call's own
 * limit reaches it, so a long name never makes it promise more than the tool would keep. */
function secretTooLong(most: number): string {
  const said = "Couldn't save to your keychain: these values are too long to keep together";
  return most >= SECRET_TOO_LONG_NAMED
    ? `${said} (about 1,900 characters at most). Nothing was changed.`
    : `${said}. Nothing was changed.`;
}

/** A name a set admits: printable ASCII without the two characters the tool's line would need escaped, a double quote
 * and a backslash. The probes' names held letters, digits, spaces and hyphens; other printable ASCII is admitted
 * unprobed. (Corrected 2026-11-18, item 548: this said "a quote". The character is the double quote, U+0022; a single
 * quote is admitted.) */
const SECRET_NAME = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/u;

/** The environment the keychain tool runs under (item 542): HOME, where it finds the user's keychain domain, and a
 * fixed PATH, the two it was probed under. Nothing else of fieldd's own, so no FIELD_ or FIELDD_ name. */
export function secretToolEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  if (parent.HOME !== undefined) env.HOME = parent.HOME;
  return env;
}

/** What a caller sees when the keychain does not answer a call in time, or refuses it: a refusal with its state,
 * never an empty answer. */
function keychainUnavailable(error: unknown): RpcCallError {
  const noAnswer = error instanceof SecretToolError && error.timedOut;
  return new RpcCallError(
    "UNAVAILABLE",
    noAnswer ? "the keychain did not answer in time" : "the keychain refused",
    true,
    { service: "keychain", state: noAnswer ? "no-answer" : "refused" },
  );
}

const notFound = (error: unknown): boolean =>
  error instanceof SecretToolError && error.exitCode === SECRET_TOOL_NOT_FOUND;

/** The runner fieldd uses: the tool as a child process with three pipes of its own, detached (setsid) so it has no
 * terminal to ask on, and stopped past its time limit. Its stdin is closed once what the call hands it is written, or at
 * once when it hands nothing, so no call can wait on it. Its stdout is the answer; its stderr is read and dropped. A
 * call that fails rejects with a `SecretToolError`, which says how it ended and nothing of the call. */
export const runSecretTool: SecretToolRunner = (call) =>
  new Promise((resolve, reject) => {
    const child = spawn(call.executable, [...call.args], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(call.env !== undefined ? { env: call.env } : {}),
    });
    let answer = "";
    let over = false;
    let timedOut = false;
    const limit = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, call.timeoutMs ?? SECRET_TOOL_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      answer += chunk;
      if (answer.length > SECRET_TOOL_ANSWER_MAX && !over) {
        over = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr?.resume();
    // a tool that ends before it reads its stdin must not end fieldd: the write's error is the close's to say
    child.stdin?.on("error", () => undefined);
    child.on("error", () => {
      clearTimeout(limit);
      reject(new SecretToolError(null, false));
    });
    child.on("close", (code) => {
      clearTimeout(limit);
      if (code === 0 && !over && !timedOut) resolve({ stdout: answer });
      else reject(new SecretToolError(timedOut || over ? null : code, timedOut));
    });
    child.stdin?.end(call.input ?? "");
  });

/** Test seam (item 542, 2026-11-18): the tool, how a call runs and the platform, so a row points the store at a stub
 * of its own and never at the real tool. */
export interface DarwinSecretStoreOptions {
  /** the keychain tool (default `SECURITY_TOOL`) */
  executable?: string;
  /** how one call runs (default `runSecretTool`) */
  run?: SecretToolRunner;
  /** the platform the store is on (default `process.platform`) */
  platform?: NodeJS.Platform;
  /** how long one call may take (default `SECRET_TOOL_TIMEOUT_MS`) */
  timeoutMs?: number;
}

/** macOS keychain via the security(1) CLI — no native deps, headless-safe.
 * Non-darwin platforms refuse honestly until a portable backend lands. */
export function createDarwinSecretStore(options: DarwinSecretStoreOptions = {}): SecretStore {
  const executable = options.executable ?? SECURITY_TOOL;
  const run = options.run ?? runSecretTool;
  const env = secretToolEnv();
  const timeoutMs = options.timeoutMs ?? SECRET_TOOL_TIMEOUT_MS;
  const refuse = (): never => {
    throw new RpcCallError(
      "UNAVAILABLE",
      "secret settings need the OS keychain (darwin-only until a portable backend lands)",
      false,
      { service: "plugin-settings", state: "no-keychain" },
    );
  };
  const darwin = (options.platform ?? process.platform) === "darwin";
  return {
    async get(service, account) {
      if (!darwin) refuse();
      try {
        const { stdout } = await run({
          executable,
          args: ["find-generic-password", "-s", service, "-a", account, "-w"],
          env,
          timeoutMs,
        });
        return stdout.replace(/\n$/, "");
      } catch (error) {
        // item 542: only "not found" is no secret; a keychain that does not answer, or refuses, is said so
        if (notFound(error)) return null;
        throw keychainUnavailable(error);
      }
    },
    async set(service, account, value) {
      if (!darwin) refuse();
      // item 542: the value is handed on stdin, never as an argument: one command line read by the tool's own
      // interactive mode, the value as hex so it needs no quoting. A name `SECRET_NAME` does not admit, an empty
      // value, or a line past `SECRET_TOOL_LINE_MAX` is refused here, before any call, so the item the keychain
      // holds stays as it was.
      if (!SECRET_NAME.test(service) || !SECRET_NAME.test(account)) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "a secret's names are printable ASCII, without a double quote or a backslash",
          false,
        );
      }
      if (value === "") {
        throw new RpcCallError("PRECONDITION_FAILED", "an empty secret is not kept", false);
      }
      const hex = Buffer.from(value, "utf8").toString("hex");
      const line = `add-generic-password -U -s "${service}" -a "${account}" -X ${hex}\n`;
      if (Buffer.byteLength(line) > SECRET_TOOL_LINE_MAX) {
        // the line's fixed part is all of it but the hex: what that leaves of the limit, halved, is the
        // value's bytes
        const most = Math.floor(
          (SECRET_TOOL_LINE_MAX - (Buffer.byteLength(line) - hex.length)) / 2,
        );
        throw new RpcCallError("PRECONDITION_FAILED", secretTooLong(most), false);
      }
      await run({ executable, args: ["-i"], input: line, env, timeoutMs }).catch(
        (error: unknown) => {
          throw keychainUnavailable(error);
        },
      );
    },
    async delete(service, account) {
      if (!darwin) refuse();
      await run({
        executable,
        args: ["delete-generic-password", "-s", service, "-a", account],
        env,
        timeoutMs,
      }).catch((error: unknown) => {
        if (notFound(error)) return; // deleting an absent secret is a no-op
        throw keychainUnavailable(error);
      });
    },
  };
}

export interface PluginSettingsConfig {
  dataDir: string;
  plugins: PluginRegistryService;
  secretStore?: SecretStore;
  /** P7/D29′ — the user-scope backend IS the system settings doc; when the
   * daemon doesn't supply one (unit tests), the service constructs its own
   * over the same dataDir (migration from P5's settings-user.json included). */
  settingsDoc?: SettingsDocService;
  logger?: Logger;
}

export class PluginSettingsService extends EventEmitter {
  private readonly ajv = new Ajv({ allErrors: false, strict: false, useDefaults: false });
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly secretStore: SecretStore;
  private readonly logger: Logger;
  private readonly userDoc: SettingsDocService;
  private readonly deviceCache = new Map<string, Record<string, unknown>>();
  /** which secret keys are set, per plugin — names only, never values */
  private readonly secretsSet = new Map<string, Set<string>>();

  constructor(private readonly cfg: PluginSettingsConfig) {
    super();
    this.secretStore = cfg.secretStore ?? createDarwinSecretStore();
    this.logger = cfg.logger ?? createNoopLogger();
    this.userDoc =
      cfg.settingsDoc ?? new SettingsDocService({ dataDir: cfg.dataDir, logger: this.logger });
    this.ownsDoc = cfg.settingsDoc === undefined;
    // doc-driven changes (an undo, a future remote sync) re-publish snapshots
    this.userDoc.on("changed", (ev: { section: string; pluginId?: string }) => {
      if (ev.section !== "settings" && ev.section !== "app") return;
      if (ev.pluginId !== undefined) this.publish(ev.pluginId);
      else this.publishAllUserSections();
    });
  }

  private readonly ownsDoc: boolean;

  /** an undo doesn't know which plugin's key it reverted — republish every
   * plugin that declares settings (a handful; snapshots are cheap) */
  private publishAllUserSections(): void {
    for (const record of this.cfg.plugins.list())
      if (record.contributions.settings !== undefined) this.publish(record.id);
  }

  /** the §8.5 declaration for key, or a refusal — undeclared keys never route */
  private declared(pluginId: string, key: string) {
    const record = this.cfg.plugins.get(pluginId);
    if (record === undefined)
      throw new RpcCallError("NOT_FOUND", `no such plugin: ${pluginId}`, false);
    const prop = record.contributions.settings?.properties[key];
    if (prop === undefined)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${pluginId} does not declare setting ${key}`,
        false,
      );
    return { record, prop };
  }

  private validator(pluginId: string, key: string, schema: object): ValidateFunction {
    const id = `${pluginId}\u0000${key}`;
    let v = this.validators.get(id);
    if (v === undefined) {
      try {
        v = this.ajv.compile(schema);
      } catch (e) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${pluginId}.${key}: declared schema does not compile (${e instanceof Error ? e.message : String(e)})`,
          false,
        );
      }
      this.validators.set(id, v);
    }
    return v;
  }

  async get(
    pluginId: string,
    key: string,
    caller: { ownerPlugin: boolean },
  ): Promise<{ value?: unknown; isSet: boolean; secret?: boolean }> {
    const { prop } = this.declared(pluginId, key);
    if (prop.scope === "secret") {
      if (!caller.ownerPlugin) {
        const isSet = this.secretsSet.get(pluginId)?.has(key) ?? false;
        return { isSet, secret: true };
      }
      const value = await this.secretStore.get(secretService(pluginId), key);
      if (value === null) return { isSet: false, secret: true };
      this.markSecret(pluginId, key, true);
      return { value, isSet: true, secret: true };
    }
    const store =
      prop.scope === "user" ? await this.userValues(pluginId) : await this.deviceValues(pluginId);
    if (key in store) {
      const stored = store[key];
      const valid = this.validator(pluginId, key, prop.schema)(stored);
      if (valid) return { value: stored, isSet: true };
      // corrupted at rest: fall back to the default, honestly un-set
      this.logger.warn(
        "fieldd.plugins.settings_stored_value_invalid",
        "A stored plugin setting failed its declared schema; the default was used",
        { pluginId, key },
      );
    }
    const fallback = (prop.schema as { default?: unknown }).default;
    return { ...(fallback !== undefined ? { value: fallback } : {}), isSet: false };
  }

  async set(pluginId: string, key: string, value: unknown, by = "unknown"): Promise<void> {
    const { record, prop } = this.declared(pluginId, key);
    if (!record.enabled)
      throw new RpcCallError("PRECONDITION_FAILED", `${pluginId} is disabled`, false, {
        pluginKind: "PLUGIN_DISABLED",
      });
    const validate = this.validator(pluginId, key, prop.schema);
    if (!validate(value))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${pluginId}.${key}: value fails its declared schema`,
        false,
        {
          issues: (validate.errors ?? []).map((e) => `${e.instancePath || "<root>"} ${e.message}`),
        },
      );
    if (prop.scope === "secret") {
      if (typeof value !== "string")
        throw new RpcCallError("PRECONDITION_FAILED", "secret values are strings", false);
      await this.secretStore.set(secretService(pluginId), key, value);
      this.markSecret(pluginId, key, true);
      this.publish(pluginId);
      return;
    }
    if (prop.scope === "user") {
      // D29′ — user scope IS the settings doc (provenance-stamped, undoable)
      await this.userDoc.setUserValue(pluginId, key, value, by);
    } else {
      const values = { ...(await this.deviceValues(pluginId)), [key]: value };
      await this.saveDeviceValues(pluginId, values);
    }
    this.publish(pluginId);
  }

  async reset(pluginId: string, key: string, by = "unknown"): Promise<void> {
    const { prop } = this.declared(pluginId, key);
    if (prop.scope === "secret") {
      await this.secretStore.delete(secretService(pluginId), key);
      this.markSecret(pluginId, key, false);
      this.publish(pluginId);
      return;
    }
    if (prop.scope === "user") {
      await this.userDoc.resetUserValue(pluginId, key, by);
    } else {
      const values = await this.deviceValues(pluginId);
      if (key in values) {
        delete values[key];
        await this.saveDeviceValues(pluginId, values);
      }
    }
    this.publish(pluginId);
  }

  /** persisted non-secret values + set-secret NAMES (§16.2 — never values) */
  async snapshot(pluginId: string): Promise<SettingsSnapshot> {
    const record = this.cfg.plugins.get(pluginId);
    if (record === undefined)
      throw new RpcCallError("NOT_FOUND", `no such plugin: ${pluginId}`, false);
    const props = record.contributions.settings?.properties ?? {};
    const user = await this.userValues(pluginId);
    const device = await this.deviceValues(pluginId);
    const values: Record<string, unknown> = {};
    const secretsSet: string[] = [];
    for (const [key, prop] of Object.entries(props)) {
      if (prop.scope === "secret") {
        const known = this.secretsSet.get(pluginId)?.has(key);
        const isSet = known ?? (await this.secretStore.get(secretService(pluginId), key)) !== null;
        this.markSecret(pluginId, key, isSet);
        if (isSet) secretsSet.push(key);
        continue;
      }
      const store = prop.scope === "user" ? user : device;
      if (key in store) values[key] = store[key];
    }
    return { pluginId, values, secretsSet: secretsSet.sort() };
  }

  private publish(pluginId: string): void {
    void this.snapshot(pluginId)
      .then((snap) => this.emit("changed", snap))
      .catch(() => undefined);
  }

  private markSecret(pluginId: string, key: string, isSet: boolean): void {
    let set = this.secretsSet.get(pluginId);
    if (set === undefined) {
      set = new Set();
      this.secretsSet.set(pluginId, set);
    }
    if (isSet) set.add(key);
    else set.delete(key);
  }

  private async userValues(pluginId: string): Promise<Record<string, unknown>> {
    return this.userDoc.userValues(pluginId);
  }

  /** D29′ — the pane-facing undo surface; the doc enforces the no-re-escalate
   * carve-out (install-set/grants are outside the stack by origin). */
  undoUser(): Promise<{ applied: boolean; reason?: "empty-stack" }> {
    return this.userDoc.undo();
  }

  redoUser(): Promise<{ applied: boolean; reason?: "empty-stack" }> {
    return this.userDoc.redo();
  }

  private devicePath(pluginId: string): string {
    return join(this.cfg.dataDir, "plugins", pluginId, "config.json");
  }

  private async deviceValues(pluginId: string): Promise<Record<string, unknown>> {
    const cached = this.deviceCache.get(pluginId);
    if (cached !== undefined) return cached;
    try {
      const parsed = JSON.parse(await readFile(this.devicePath(pluginId), "utf8"));
      if (parsed !== null && typeof parsed === "object") {
        this.deviceCache.set(pluginId, parsed as Record<string, unknown>);
        return parsed as Record<string, unknown>;
      }
    } catch {
      // absent
    }
    this.deviceCache.set(pluginId, {});
    return this.deviceCache.get(pluginId) as Record<string, unknown>;
  }

  private async saveDeviceValues(pluginId: string, values: Record<string, unknown>): Promise<void> {
    this.deviceCache.set(pluginId, values);
    const path = this.devicePath(pluginId);
    await mkdir(join(this.cfg.dataDir, "plugins", pluginId), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  }

  dispose(): void {
    if (this.ownsDoc) void this.userDoc.dispose();
    this.removeAllListeners();
  }
}

/** keychain service name — the plugin id rides the ACCOUNT-side lookup key */
function secretService(pluginId: string): string {
  return `vibefield.plugin.${pluginId}`;
}
