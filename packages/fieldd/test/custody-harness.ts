// OB custody — what the custody rows share (test-local, not shipped): a daemon over the mock floor at either level,
// and a shell that pairs by CUSTODY-SPEC §2.3's recipe.
//
// The recipe is spelled HERE, on its own, from the spec's words, and never through `src/shell-pairing.ts`: the door
// is held to the spec, not to its own copy of it. `shell-pairing.vector.json` pins the same recipe across packages
// (shell-pairing-vector.test.ts reads it), and its outputs say TO-BE-COMPUTED until the first admitted row, so until
// then this spelling is the only independent one the door meets.
import type { ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION, CUSTODY, LAYOUT, SOCKETS } from "@vibefield/contracts";
import WebSocket from "ws";
import {
  bootstrap,
  type FielddConfig,
  type FielddCustody,
  type FielddDaemon,
  type SealedFielddDaemon,
} from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";
import { type RpcErrorShape, WsRpc } from "./ws-rpc";

/** What a spawner hands. Every secret is a repeated byte, as the contract fixtures spell theirs; the floor's is the
 * mock floor's own default (`MockMgmtServer.pairingSecretHex`), so a row that is not about the floor says nothing
 * of it. */
export const HANDED: FielddCustody = {
  level: "sealed",
  shell: "a3".repeat(32),
  pairing: "ab".repeat(32),
  records: "c5".repeat(32),
};

export type Cleanup = Array<() => void | Promise<void>>;

/** Run a file's cleanups, newest first; an already-stopped daemon or a dead socket is no failure. */
export async function runCleanup(cleanup: Cleanup): Promise<void> {
  for (const fn of cleanup.splice(0).reverse()) {
    try {
      await fn();
    } catch {
      // already gone
    }
  }
}

export interface BootOptions {
  /** the user this daemon serves (`FielddConfig.userId`); none by default */
  userId?: string;
  /** write the file a `files` floor keeps its pairing in. On by default: the floor's pairing is C3's, and the rows
   * that are not about the floor hold before it and after it. */
  floorFile?: boolean;
  /** `FielddConfig.logRoot`: the daemon's own log, for the rows that read what it said */
  logRoot?: string;
  /** runs on the data root before the daemon boots */
  before?: (dataDir: string) => void;
  /** the mock floor, before it starts */
  floor?: (mock: MockMgmtServer) => void;
}

async function floorFor(
  cleanup: Cleanup,
  pairing: string,
  opts: BootOptions,
): Promise<{ dataDir: string; mock: MockMgmtServer }> {
  // short: the mock floor's socket sits under it, inside macOS's 104-byte sun_path
  const dataDir = shortTmpRoot("vf-cust-");
  cleanup.push(() => removeTempRoot(dataDir));
  mkdirSync(join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
  if (opts.floorFile !== false) writeFileSync(join(dataDir, ...LAYOUT.PAIRING_FILE), pairing);
  opts.before?.(dataDir);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.pairingSecretHex = pairing;
  opts.floor?.(mock);
  await mock.start();
  cleanup.push(() => mock.stop());
  return { dataDir, mock };
}

export interface SealedWorld {
  dataDir: string;
  mock: MockMgmtServer;
  daemon: SealedFielddDaemon;
}

/** A daemon handed custody, in this process: `FielddConfig.custody` is the seam a pipe fills in `bin.ts`. */
export async function bootSealed(
  cleanup: Cleanup,
  opts: BootOptions & { custody?: FielddCustody } = {},
): Promise<SealedWorld> {
  const custody = opts.custody ?? HANDED;
  const { dataDir, mock } = await floorFor(cleanup, custody.pairing, opts);
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    custody,
    ...(opts.userId !== undefined ? { userId: opts.userId } : {}),
    ...(opts.logRoot !== undefined ? { logRoot: opts.logRoot } : {}),
  });
  cleanup.push(() => daemon.stop());
  return { dataDir, mock, daemon };
}

export interface FilesWorld {
  dataDir: string;
  mock: MockMgmtServer;
  daemon: FielddDaemon;
}

/** Today's daemon: handed nothing, its secrets in files. */
export async function bootFiles(cleanup: Cleanup, opts: BootOptions = {}): Promise<FilesWorld> {
  const { dataDir, mock } = await floorFor(cleanup, "ab".repeat(32), opts);
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    ...(opts.userId !== undefined ? { userId: opts.userId } : {}),
    ...(opts.logRoot !== undefined ? { logRoot: opts.logRoot } : {}),
  });
  cleanup.push(() => daemon.stop());
  return { dataDir, mock, daemon };
}

// ── a REAL floor at `sealed`, for the harnesses that spawn field-native (agent-session.test.ts,
// agent-gateway-floor.ts) ──

/** What a sealed floor is spawned with beside its own environment: the flag. It is the spawner's word and no secret;
 * the secret is the one line (`handFloorPairing`). */
export const SEALED_FLOOR_ENV = { [CUSTODY.NATIVE_ENV]: CUSTODY.STDIN } as const;

/** CUSTODY-SPEC §2.4 — hand a real floor its pairing: ONE line on its stdin, then the end of it. The line is spelled
 * here from the spec's words, never through `src/native-bootstrap.ts`: that module asks first whose code the child
 * is, and a test's floor is nobody's signed build. The child must have been spawned with a piped stdin. */
export function handFloorPairing(child: ChildProcess, custody: FielddCustody): void {
  const stdin = child.stdin;
  if (stdin === null) throw new Error("a sealed floor is spawned with a piped stdin");
  // a floor that left before its line is found by the caller's wait for its socket, never by an unhandled pipe error
  stdin.on("error", () => undefined);
  stdin.end(`${JSON.stringify({ v: 1, pairing: custody.pairing })}\n`);
}

/** Boot fieldd at the level a row asked for, answered as the one daemon type a harness's box holds. A SEALED daemon
 * has no shell token, whatever that type says of it: nothing may read one from it, and a sealed row's shell pairs
 * (`pairingCredential`). `custody` is `FielddConfig.custody`, the seam a pipe fills in `bin.ts`. */
export async function bootAt(
  base: FielddConfig,
  custody: FielddCustody | undefined,
): Promise<FielddDaemon> {
  if (custody === undefined) return await bootstrap(base);
  const sealed: SealedFielddDaemon = await bootstrap({ ...base, custody });
  return sealed as unknown as FielddDaemon;
}

/** One connection to a daemon's control port (`path`: the sidecar's secret route, for a tailnet caller). */
export async function openDoor(
  cleanup: Cleanup,
  port: number,
  path = "",
  headers?: Record<string, string>,
): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** What the shell's MAC is made over (§2.3): the port it dialled, the daemon's boot and user, its nonce and clock. */
export interface PairingFacts {
  port: number;
  bootId: string;
  userId: string;
  nonce: string;
  ts: number;
}

/** mac = hex(HMAC-SHA256(shell, "vf-shell" 0x00 port 0x00 bootId 0x00 userId 0x00 nonce 0x00 ts)) */
export function shellMac(secretHex: string, facts: PairingFacts): string {
  return createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(
      `vf-shell\0${facts.port}\0${facts.bootId}\0${facts.userId}\0${facts.nonce}\0${facts.ts}`,
      "utf8",
    )
    .digest("hex");
}

/** serverMac = hex(HMAC-SHA256(shell, "vf-shell-ack" 0x00 nonce 0x00 bootId 0x00 port)) */
export function shellAckMac(
  secretHex: string,
  facts: Pick<PairingFacts, "nonce" | "bootId" | "port">,
): string {
  return createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(`vf-shell-ack\0${facts.nonce}\0${facts.bootId}\0${facts.port}`, "utf8")
    .digest("hex");
}

/** 32 hex characters, fresh: one connection's nonce. */
export const freshNonce = (): string => randomBytes(16).toString("hex");
export const nowSecs = (): number => Math.floor(Date.now() / 1000);

export interface PairingHello {
  port: number;
  bootId: string;
  /** the shell's secret; what was handed, by default */
  secretHex?: string;
  /** the daemon's user as the MAC states it; none ("") by default */
  userId?: string;
  nonce?: string;
  ts?: number;
  /** what the MAC is made over, where a row wants it to differ from what the hello says */
  macOver?: Partial<PairingFacts>;
}

export interface PairingCredential {
  bootId: string;
  ts: number;
  mac: string;
  nonce: string;
}

/** The `PairingMac` a sealed shell puts in `Hello.credential`. */
export function pairingCredential(hello: PairingHello): PairingCredential {
  const nonce = hello.nonce ?? freshNonce();
  const ts = hello.ts ?? nowSecs();
  const said: PairingFacts = {
    port: hello.port,
    bootId: hello.bootId,
    userId: hello.userId ?? "",
    nonce,
    ts,
  };
  return {
    bootId: hello.bootId,
    ts,
    nonce,
    mac: shellMac(hello.secretHex ?? HANDED.shell, { ...said, ...hello.macOver }),
  };
}

export interface ShellAck {
  grantedScopes: string[];
  serverMac?: string;
  userId?: string | null;
}

function helloParams(credential: unknown, clientKind: string): Record<string, unknown> {
  return {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...(credential !== undefined ? { credential } : {}),
  };
}

/** `system.hello` with this credential, answered. */
export async function hello(
  rpc: WsRpc,
  credential: unknown,
  clientKind = "shell-main",
): Promise<ShellAck> {
  return (await rpc.call("system.hello", helloParams(credential, clientKind))) as ShellAck;
}

/** `system.hello` with this credential, refused: the refusal. */
export function helloErr(
  rpc: WsRpc,
  credential: unknown,
  clientKind = "shell-main",
): Promise<RpcErrorShape> {
  return rpc.callErr("system.hello", helloParams(credential, clientKind));
}
