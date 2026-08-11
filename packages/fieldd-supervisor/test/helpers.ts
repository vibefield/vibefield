import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACTS_VERSION, type Scope } from "@vibefield/contracts";
import { ProductApi } from "@vibefield/fieldd";
import type { FielddSupervisor } from "../src/index";

// Shared test harness for the supervisor suite. Every resource it hands out is
// tracked and torn down by `cleanup()` in afterEach: temp roots removed,
// ProductApis closed, supervisors disposed, and any leaked fixture child
// SIGKILLed. All temp roots are SHORT (`mkdtempSync(tmpdir()/vfsup-)`) so they
// stay well under the sun_path guard — the one over-long root is minted
// deliberately by `mkLongRoot()`.

const DEFAULT_TOKEN = "shell-token-0123456789abcdefghij";

/** The token-service slice ProductApi needs; the grant's scopes are irrelevant
 * to adoption (hello only), so an empty grant suffices for a live listener.
 * WIN-D5 tests grant `native.admin` to exercise the stop verb's happy path. */
function acceptOnly(token: string, scopes: readonly Scope[] = []) {
  return (t: string) =>
    t === token ? { tokenId: "tk-shell", scopes: [...scopes], label: "shell" } : null;
}

export interface Harness {
  /** A short temp data root, tracked for removal. */
  mkRoot(): string;
  /** A data root nested deeply enough that native/run/mgmt.sock overflows the
   * sun_path safety margin (for the data-root-too-long guard). */
  mkLongRoot(): string;
  /** Boot a real product server on an ephemeral port. `verify` defaults to
   * accepting exactly `token`; pass `verify: () => null` for a foreign listener. */
  startProduct(opts?: {
    token?: string;
    scopes?: readonly Scope[];
    verify?: (t: string) => { tokenId: string; scopes: Scope[]; label: string } | null;
  }): Promise<{ api: ProductApi; port: number; token: string }>;
  /** Write the shell bootstrap run files (product.json + shell.token) that
   * fieldd would write — the adoption contract from daemon.ts:361. */
  writeRunFiles(
    root: string,
    o: {
      port: number;
      pid: number;
      token?: string;
      bootId?: string;
      nativePid?: number | null;
      buildId?: string | null;
      extra?: Record<string, unknown>;
    },
  ): void;
  /** Write a fixture .mjs into `dir` and return its absolute path. */
  writeFixture(dir: string, name: string, body: string): string;
  /** Track a supervisor for disposal in cleanup. */
  track(s: FielddSupervisor): FielddSupervisor;
  /** Track a pid to SIGKILL in cleanup (leaked fixtures under leave-running). */
  trackPid(pid: number | undefined): void;
  cleanup(): Promise<void>;
}

export function createHarness(): Harness {
  const roots: string[] = [];
  const apis: ProductApi[] = [];
  const supervisors: FielddSupervisor[] = [];
  const pids = new Set<number>();

  return {
    mkRoot() {
      const root = mkdtempSync(join(tmpdir(), "vfsup-"));
      roots.push(root);
      return root;
    },

    mkLongRoot() {
      const base = mkdtempSync(join(tmpdir(), "vfsup-"));
      roots.push(base);
      let root = base;
      // grow the path until the derived native socket path passes 100 bytes
      while (Buffer.byteLength(join(root, "native", "run", "mgmt.sock"), "utf8") <= 100) {
        root = join(root, "nested-segment-padding");
      }
      mkdirSync(root, { recursive: true });
      return root;
    },

    async startProduct(opts) {
      const token = opts?.token ?? DEFAULT_TOKEN;
      const api = new ProductApi({
        port: 0,
        tokens: { verify: opts?.verify ?? acceptOnly(token, opts?.scopes) },
      });
      // a scope-null product method, so a hello'd client can request with no grant
      api.register("system.health", () => ({ ok: true, state: "READY" }));
      const port = await api.listen();
      apis.push(api);
      return { api, port, token };
    },

    writeRunFiles(root, o) {
      const dir = join(root, "fieldd", "run");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "shell.token"), o.token ?? DEFAULT_TOKEN);
      writeFileSync(
        join(dir, "product.json"),
        JSON.stringify({
          port: o.port,
          pid: o.pid,
          bootId: o.bootId ?? "boot-test",
          contractsVersion: CONTRACTS_VERSION,
          startedAt: Date.now(),
          nativePid: o.nativePid ?? null,
          buildId: o.buildId ?? null,
          ...(o.extra ?? {}),
        }),
      );
    },

    writeFixture(dir, name, body) {
      mkdirSync(dir, { recursive: true });
      const p = join(dir, name);
      writeFileSync(p, body);
      return p;
    },

    track(s) {
      supervisors.push(s);
      return s;
    },

    trackPid(pid) {
      if (pid !== undefined) pids.add(pid);
    },

    async cleanup() {
      for (const s of supervisors) {
        try {
          await s.dispose();
        } catch {
          /* dispose is idempotent; a test may have disposed already */
        }
      }
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      for (const a of apis) {
        try {
          a.close();
        } catch {
          /* already closed */
        }
      }
      for (const r of roots) {
        try {
          rmSync(r, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

/** Poll (bounded) until `pid` is gone — signal delivery is asynchronous. */
export async function waitDead(pid: number, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 30));
  }
  return false;
}

// ---- fixture bodies (run by process.execPath as ESM) --------------------
//
// Each reads FIELDD_DATA_DIR (the supervisor injects it) and behaves as a
// fieldd stand-in. TEST_PRODUCT_PORT points them at the in-test ProductApi;
// SHELL_TOKEN is written to shell.token so the supervisor's adoption probe
// authenticates against that server. CV carries the contracts version for a
// schema-valid product.json.

/** Writes run files then idles — the ordinary "fieldd came up" fixture.
 * PID_OVERRIDE forces a product.json pid other than our own (the lost-race →
 * "adopted" branch). SPAWN_MARKER, if set, gets one appended line per process
 * start (proves single-spawn under concurrent ensure). PRINT_SECRET, if set,
 * is written to stdout before the files (redaction-through-spawn). */
export const FIXTURE_READY = `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.FIELDD_DATA_DIR;
const port = Number(process.env.TEST_PRODUCT_PORT);
const token = process.env.SHELL_TOKEN ?? "shell-token";
const pid = process.env.PID_OVERRIDE ? Number(process.env.PID_OVERRIDE) : process.pid;
if (process.env.SPAWN_MARKER) appendFileSync(process.env.SPAWN_MARKER, process.pid + "\\n");
if (process.env.PRINT_SECRET) process.stdout.write(process.env.PRINT_SECRET + "\\n");
const dir = join(root, "fieldd", "run");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "shell.token"), token);
writeFileSync(join(dir, "product.json"), JSON.stringify({
  port, pid, bootId: "boot-fixture",
  contractsVersion: process.env.CV, startedAt: Date.now(), nativePid: null,
  buildId: process.env.FIELDD_BUILD_ID ?? null,
}));
process.stdout.write(JSON.stringify({ ready: true, port, bootId: "boot-fixture" }) + "\\n");
setInterval(() => {}, 1e6);
`;

/** Prints a stderr line, then exits non-zero before writing any run files. */
export const FIXTURE_EXIT_1 = `
process.stderr.write("boom: fieldd refused to start\\n");
setTimeout(() => process.exit(1), 40);
`;

/** Never writes run files; idles forever (readiness-timeout / abort fodder). */
export const FIXTURE_IDLE = `
setInterval(() => {}, 1e6);
`;
