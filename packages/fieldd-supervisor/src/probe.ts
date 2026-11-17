import { readFile } from "node:fs/promises";
import { ProductInfo } from "@vibefield/contracts";
import { FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { afterIoTurn } from "./io-turn";
import { type PairedDaemon, shellPairing } from "./pairing";
import { productPath, tokenPath } from "./paths";
import type { ProbeFailure } from "./types";

// One bounded adoption probe (spec §5.3): a live fieldd answers a shell-main
// hello on the port recorded in product.json with the token from shell.token —
// anything else is a diagnosed non-adoption, never an exception. The token is
// read for the hello only and never logged (EL7).
//
// OB custody (C2): under `sealed` there is no token. The probe is handed the shell's pairing secret
// (`{kind: "pairing"}`), reads product.json alone, and proves itself with a MAC over the recorded port and boot; what
// answers must prove the same secret back, or it is a foreign listener that was told nothing. The secret is never
// sent and never logged.
//
// WHICH of the two a probe proves itself with is the caller's to name, every time (C2b). There is no
// default: the token file is the weaker road (any process of the same user reads it), and a caller that named
// nothing used to be put on it in silence. The one thing `tryAdopt` throws is that mistake of its caller's.

/** A live fieldd of ANOTHER build that answered our token (WP12 D10): kept open only when the caller asked, so the
 * supervisor can ask it to stop over the authenticated channel before it spawns this build's. */
export interface StaleDaemon {
  readonly client: FielddClient;
  readonly info: ProductInfo;
}

/** What an adoption probe proves itself with: the bearer in `shell.token` (custody's `files` level), or the shell's
 * pairing secret (`sealed`: `CustodyHandoff.shell`, 64 lowercase hex characters). Neither is a default. */
export type AdoptCredential =
  | { readonly kind: "token-file" }
  | { readonly kind: "pairing"; readonly secret: string };

/** `tryAdopt`'s last argument. */
export interface AdoptOptions {
  /** REQUIRED: what this probe proves itself with. A `files` caller says `{ kind: "token-file" }` in so many words. */
  readonly credential: AdoptCredential;
  /** WP12 D10 — keep a live daemon of ANOTHER build open, as `stale`, for the replace path to ask it to stop */
  readonly keepStaleClient?: boolean;
}

export type ProbeResult =
  | { ok: true; client: FielddClient; info: ProductInfo }
  | {
      ok: false;
      failure: ProbeFailure;
      stale?: StaleDaemon;
      /** Item 212 (RV #30) — the record the probe read, on every failure reached after product.json parsed: the
       * supervisor waits on a busy fieldd by its pid and bootId, and never reads the one it supersedes as the race's
       * winner. */
      recorded?: ProductInfo;
      /** OB custody — beside `incompatible-build` under a pairing probe: this is a fieldd from BEFORE custody. It
       * refused the pairing and its own `shell.token` answered, so it is asked to stop by that bearer and replaced,
       * whatever the build ids say. */
      preCustody?: true;
    };

/** The run file's recorded daemon, or null when absent or unreadable (the replace path's "is it gone yet", and the
 * floor a stop reads fresh). */
export async function readRecordedProduct(dataRoot: string): Promise<ProductInfo | null> {
  try {
    return ProductInfo.parse(JSON.parse(await readFile(productPath(dataRoot), "utf8")));
  } catch {
    return null;
  }
}

/** AL-3 / WP12 D10 — wait, bounded, until the daemon recorded as `bootId` has left `dataRoot`: its run files gone, or
 * another boot's in their place. True when it left; false when the bound (or `signal`) came first. */
export async function awaitDeparture(
  dataRoot: string,
  bootId: string,
  boundMs: number,
  options: { readonly pollMs?: number; readonly signal?: AbortSignal } = {},
): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  while (Date.now() < deadline && options.signal?.aborted !== true) {
    const current = await readRecordedProduct(dataRoot);
    if (current === null || current.bootId !== bootId) return true;
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
  }
  return false;
}

export async function tryAdopt(
  dataRoot: string,
  probeMs: number,
  signal: AbortSignal | undefined,
  expectedBuildId: string | undefined,
  expectedUserId: string | undefined,
  options: AdoptOptions,
): Promise<ProbeResult> {
  // The one throw of a probe, and it is its caller's mistake: no credential named (a caller the compiler did not
  // hold), or one of a kind this build does not know. Said before anything is read or dialled, and never answered by
  // the token file, which is where an unnamed probe and an unknown kind both used to go.
  const credential = options?.credential;
  if (credential?.kind !== "token-file" && credential?.kind !== "pairing") {
    throw new TypeError("tryAdopt needs its credential named: token-file or pairing");
  }
  let rawProduct: string;
  let token = "";
  try {
    if (credential.kind === "pairing") {
      // a sealed fieldd writes no shell.token: its record alone says where it is
      rawProduct = await readFile(productPath(dataRoot), "utf8");
    } else {
      [rawProduct, token] = await Promise.all([
        readFile(productPath(dataRoot), "utf8"),
        readFile(tokenPath(dataRoot), "utf8").then((t) => t.trim()),
      ]);
    }
  } catch {
    return { ok: false, failure: "no-run-files" };
  }

  let info: ProductInfo;
  try {
    info = ProductInfo.parse(JSON.parse(rawProduct)); // tolerant reader (.passthrough)
  } catch {
    return { ok: false, failure: "malformed-product" };
  }

  let client: FielddClient;
  if (credential.kind === "pairing") {
    // the MAC names the user the RECORD says the daemon serves: a daemon of ours proves it, and the identity checks
    // below then read as they always have (`user-mismatch` stays a diagnosis, never a bare refusal)
    const daemon = { port: info.port, bootId: info.bootId, userId: info.userId ?? "" };
    client = new FielddClient({
      url: `ws://127.0.0.1:${info.port}`,
      token: "",
      clientKind: "shell-main",
      pairing: shellPairing(credential.secret, daemon),
    });
  } else {
    client = new FielddClient({
      url: `ws://127.0.0.1:${info.port}`,
      token,
      clientKind: "shell-main",
    });
  }
  const outcome = await helloOnce(client, probeMs, signal);

  if (outcome === "ready") {
    // UA-2 — identity is stricter than build, and it is checked FIRST (WP12 D10): an absent userId is a daemon from
    // before the partition (or another user's), and adopting it — or asking it to stop for a replacement — would
    // cross the wall. Exact match or nothing.
    if (expectedUserId !== undefined && info.userId !== expectedUserId) {
      client.close();
      return { ok: false, failure: "user-mismatch", recorded: info };
    }
    if (expectedBuildId !== undefined && info.buildId !== expectedBuildId) {
      // our token answered: this is our user's daemon, of another build (or a pre-WP12 one, which records none)
      if (options.keepStaleClient === true) {
        return {
          ok: false,
          failure: "incompatible-build",
          stale: { client, info },
          recorded: info,
        };
      }
      client.close();
      return { ok: false, failure: "incompatible-build", recorded: info };
    }
    return { ok: true, client, info };
  }

  client.close(); // kill the auto-reconnect — a probe never lingers
  if (outcome === "dial-failed") return { ok: false, failure: "stale-files", recorded: info };
  if (outcome === "timeout" || outcome === "aborted") {
    return { ok: false, failure: "probe-timeout", recorded: info };
  }
  const failure = classifyHelloError(outcome);
  if (credential.kind === "pairing" && failure === "foreign-listener") {
    const keep = options.keepStaleClient === true;
    const before = await probeBeforeCustody(dataRoot, info, probeMs, signal, expectedUserId, keep);
    if (before !== null) return before;
  }
  return { ok: false, failure, recorded: info };
}

/** OB custody — the ONE pairing probe of a sealed spawn: the port and the boot are the ones the child's own ready
 * line stated, and the user is the one it was spawned to serve, so no file is read. A daemon that proves the pairing
 * answers a ready client; anything else is diagnosed as an adoption probe's failure is. */
export async function probeSealedBoot(
  daemon: PairedDaemon,
  secret: string,
  probeMs: number,
  signal?: AbortSignal,
): Promise<{ ok: true; client: FielddClient } | { ok: false; failure: ProbeFailure }> {
  const client = new FielddClient({
    url: `ws://127.0.0.1:${daemon.port}`,
    token: "",
    clientKind: "shell-main",
    pairing: shellPairing(secret, daemon),
  });
  const outcome = await helloOnce(client, probeMs, signal);
  if (outcome === "ready") return { ok: true, client };
  client.close();
  if (outcome === "dial-failed") return { ok: false, failure: "stale-files" };
  if (outcome === "timeout" || outcome === "aborted") {
    return { ok: false, failure: "probe-timeout" };
  }
  return { ok: false, failure: classifyHelloError(outcome) };
}

/** OB custody — THE ONE LEGACY READ. A pairing probe that was refused while a `shell.token` sits in the run dir may
 * have met a fieldd from before custody, still running at the first sealed launch: it knows no pairing and bears a
 * token. That token was never ours to protect (any same-uid process reads the file), so it is tried once, on the
 * recorded port. If it answers, the daemon is `incompatible-build`, marked `preCustody`, whatever build ids say, and
 * its client is kept when the caller asked: the supervisor's replace path stops it with `system.shutdown`. Another
 * user's daemon is `user-mismatch` first, as ever. null: no token, or the token did not answer; the first verdict
 * stands. The shell's pairing secret is not part of this and is sent to nobody. */
async function probeBeforeCustody(
  dataRoot: string,
  info: ProductInfo,
  probeMs: number,
  signal: AbortSignal | undefined,
  expectedUserId: string | undefined,
  keepStaleClient: boolean,
): Promise<ProbeResult | null> {
  let token: string;
  try {
    token = (await readFile(tokenPath(dataRoot), "utf8")).trim();
  } catch {
    return null;
  }
  if (token === "") return null;
  const client = new FielddClient({
    url: `ws://127.0.0.1:${info.port}`,
    token,
    clientKind: "shell-main",
  });
  const outcome = await helloOnce(client, probeMs, signal);
  if (outcome !== "ready") {
    client.close();
    return null;
  }
  if (expectedUserId !== undefined && info.userId !== expectedUserId) {
    client.close();
    return { ok: false, failure: "user-mismatch", recorded: info };
  }
  if (keepStaleClient) {
    return {
      ok: false,
      failure: "incompatible-build",
      stale: { client, info },
      recorded: info,
      preCustody: true,
    };
  }
  client.close();
  return { ok: false, failure: "incompatible-build", recorded: info, preCustody: true };
}

/** What one bounded hello came to: "ready", why it did not come ("timeout", "aborted", "dial-failed"), or the
 * terminal error it ended on (which is why the whole is `unknown`). */
type HelloOutcome = "ready" | "timeout" | "aborted" | "dial-failed" | unknown;

/** One hello on `client`, bounded by `probeMs`. The caller closes a client that is not ready. */
async function helloOnce(
  client: FielddClient,
  probeMs: number,
  signal?: AbortSignal,
): Promise<HelloOutcome> {
  client.connect();

  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  return await new Promise<HelloOutcome>((resolve) => {
    // WG-E1 — the timer fires in the timers phase, before the poll phase reads a hello ack already buffered in
    // this same turn: the verdict waits one turn of I/O, so an ack that came in time wins (item 212, RV #30)
    timer = setTimeout(() => afterIoTurn(() => resolve("timeout")), probeMs);
    if (signal) {
      onAbort = () => resolve("aborted");
      signal.addEventListener("abort", onAbort, { once: true });
    }
    // FielddClient reconnects forever on dial failure and ready() rejects
    // only on TERMINAL hello errors — so for a one-shot probe, the first
    // "reconnecting" transition IS the verdict: the recorded port answered
    // nothing adoptable (stale run files). Without this, a dead port would
    // ride the timer and misreport as probe-timeout.
    unsubscribe = client.onStatusChange(() => {
      if (client.status === "reconnecting") resolve("dial-failed");
    });
    client.ready().then(
      () => resolve("ready"),
      (e: unknown) => resolve(e),
    );
  }).finally(() => {
    clearTimeout(timer);
    unsubscribe?.();
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  });
}

/** Map a terminal hello/dial error onto the diagnosis taxonomy. */
function classifyHelloError(e: unknown): ProbeFailure {
  if (e instanceof FielddRpcError) {
    if (e.kind === "INCOMPATIBLE") return "incompatible-contracts";
    // a listener that speaks the protocol but refuses our shell token is not
    // our daemon — same-uid adversaries included (EL7). So is one that takes
    // a pairing hello and does not prove the secret back (OB custody).
    if (e.kind === "UNAUTHORIZED" || e.kind === "FORBIDDEN_SCOPE") return "foreign-listener";
  }
  // dial-level failures: nothing listening, or something that isn't a fieldd
  return "stale-files";
}
