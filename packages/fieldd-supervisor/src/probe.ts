import { readFile } from "node:fs/promises";
import { ProductInfo } from "@vibefield/contracts";
import { FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { productPath, tokenPath } from "./paths";
import type { ProbeFailure } from "./types";

// One bounded adoption probe (spec §5.3): a live fieldd answers a shell-main
// hello on the port recorded in product.json with the token from shell.token —
// anything else is a diagnosed non-adoption, never an exception. The token is
// read for the hello only and never logged (EL7).

/** A live fieldd of ANOTHER build that answered our token (WP12 D10): kept open only when the caller asked, so the
 * supervisor can ask it to stop over the authenticated channel before it spawns this build's. */
export interface StaleDaemon {
  readonly client: FielddClient;
  readonly info: ProductInfo;
}

export type ProbeResult =
  | { ok: true; client: FielddClient; info: ProductInfo }
  | { ok: false; failure: ProbeFailure; stale?: StaleDaemon };

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
  signal?: AbortSignal,
  expectedBuildId?: string,
  expectedUserId?: string,
  options: { readonly keepStaleClient?: boolean } = {},
): Promise<ProbeResult> {
  let rawProduct: string;
  let token: string;
  try {
    [rawProduct, token] = await Promise.all([
      readFile(productPath(dataRoot), "utf8"),
      readFile(tokenPath(dataRoot), "utf8").then((t) => t.trim()),
    ]);
  } catch {
    return { ok: false, failure: "no-run-files" };
  }

  let info: ProductInfo;
  try {
    info = ProductInfo.parse(JSON.parse(rawProduct)); // tolerant reader (.passthrough)
  } catch {
    return { ok: false, failure: "malformed-product" };
  }

  const client = new FielddClient({
    url: `ws://127.0.0.1:${info.port}`,
    token,
    clientKind: "shell-main",
  });
  client.connect();

  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  const outcome = await new Promise<"ready" | "timeout" | "aborted" | "dial-failed" | unknown>(
    (resolve) => {
      timer = setTimeout(() => resolve("timeout"), probeMs);
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
    },
  ).finally(() => {
    clearTimeout(timer);
    unsubscribe?.();
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  });

  if (outcome === "ready") {
    // UA-2 — identity is stricter than build, and it is checked FIRST (WP12 D10): an absent userId is a daemon from
    // before the partition (or another user's), and adopting it — or asking it to stop for a replacement — would
    // cross the wall. Exact match or nothing.
    if (expectedUserId !== undefined && info.userId !== expectedUserId) {
      client.close();
      return { ok: false, failure: "user-mismatch" };
    }
    if (expectedBuildId !== undefined && info.buildId !== expectedBuildId) {
      // our token answered: this is our user's daemon, of another build (or a pre-WP12 one, which records none)
      if (options.keepStaleClient === true) {
        return { ok: false, failure: "incompatible-build", stale: { client, info } };
      }
      client.close();
      return { ok: false, failure: "incompatible-build" };
    }
    return { ok: true, client, info };
  }

  client.close(); // kill the auto-reconnect — a probe never lingers
  if (outcome === "dial-failed") return { ok: false, failure: "stale-files" };
  if (outcome === "timeout" || outcome === "aborted") {
    return { ok: false, failure: "probe-timeout" };
  }
  return { ok: false, failure: classifyHelloError(outcome) };
}

/** Map a terminal hello/dial error onto the diagnosis taxonomy. */
function classifyHelloError(e: unknown): ProbeFailure {
  if (e instanceof FielddRpcError) {
    if (e.kind === "INCOMPATIBLE") return "incompatible-contracts";
    // a listener that speaks the protocol but refuses our shell token is not
    // our daemon — same-uid adversaries included (EL7)
    if (e.kind === "UNAUTHORIZED" || e.kind === "FORBIDDEN_SCOPE") return "foreign-listener";
  }
  // dial-level failures: nothing listening, or something that isn't a fieldd
  return "stale-files";
}
