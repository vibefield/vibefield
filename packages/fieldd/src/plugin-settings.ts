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
}

/** Runs one call of the keychain tool and answers its stdout; a call that fails rejects. */
export type SecretToolRunner = (call: SecretToolCall) => Promise<{ stdout: string }>;

/** The most a call's answer may be: past it the call is stopped and refused. */
const SECRET_TOOL_ANSWER_MAX = 1024 * 1024;

/** The runner fieldd uses: the tool as a child process with three pipes of its own. Its stdin is closed once what the
 * call hands it is written, or at once when it hands nothing, so no call can wait on it. Its stdout is the answer; its
 * stderr is read and dropped. A call that fails rejects with an error that says how it ended and nothing of the call. */
export const runSecretTool: SecretToolRunner = (call) =>
  new Promise((resolve, reject) => {
    const child = spawn(call.executable, [...call.args], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(call.env !== undefined ? { env: call.env } : {}),
    });
    let answer = "";
    let over = false;
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
    child.on("error", () => reject(new Error("the keychain tool could not be started")));
    child.on("close", (code, signal) => {
      if (code === 0 && !over) {
        resolve({ stdout: answer });
        return;
      }
      const ended = over ? "past its answer's limit" : (code ?? signal);
      reject(new Error(`the keychain tool ended ${ended}`));
    });
    child.stdin?.end(call.input ?? "");
  });

/** Test seam (item 542, 2026-11-18): the tool, how a call runs and the platform, so a row points the store at a stub
 * of its own and never at the real tool. */
export interface DarwinSecretStoreOptions {
  /** the keychain tool (default `security`) */
  executable?: string;
  /** how one call runs (default `runSecretTool`) */
  run?: SecretToolRunner;
  /** the platform the store is on (default `process.platform`) */
  platform?: NodeJS.Platform;
}

/** macOS keychain via the security(1) CLI — no native deps, headless-safe.
 * Non-darwin platforms refuse honestly until a portable backend lands. */
export function createDarwinSecretStore(options: DarwinSecretStoreOptions = {}): SecretStore {
  const executable = options.executable ?? "security";
  const run = options.run ?? runSecretTool;
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
        });
        return stdout.replace(/\n$/, "");
      } catch {
        return null; // absent (or locked) — absent-shaped, never a throw on read
      }
    },
    async set(service, account, value) {
      if (!darwin) refuse();
      await run({
        executable,
        args: ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value],
      });
    },
    async delete(service, account) {
      if (!darwin) refuse();
      await run({
        executable,
        args: ["delete-generic-password", "-s", service, "-a", account],
      }).catch(() => undefined); // deleting an absent secret is a no-op
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
