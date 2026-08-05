import { readFile } from "node:fs/promises";
import { ProductInfo } from "@vibefield/contracts";
import { FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { productPath, tokenPath } from "./paths";
import type { ProbeFailure } from "./types";

// One bounded adoption probe (spec §5.3): a live fieldd answers a shell-main
// hello on the port recorded in product.json with the token from shell.token —
// anything else is a diagnosed non-adoption, never an exception. The token is
// read for the hello only and never logged (EL7).

export type ProbeResult =
  | { ok: true; client: FielddClient; info: ProductInfo }
  | { ok: false; failure: ProbeFailure };

export async function tryAdopt(
  dataRoot: string,
  probeMs: number,
  signal?: AbortSignal,
  expectedBuildId?: string,
  expectedUserId?: string,
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
    if (expectedBuildId !== undefined && info.buildId !== expectedBuildId) {
      client.close();
      return { ok: false, failure: "incompatible-build" };
    }
    // UA-2 — identity is stricter than build: an absent userId is a daemon
    // from before the partition (or another user's), and adopting it would
    // cross the wall. Exact match or nothing.
    if (expectedUserId !== undefined && info.userId !== expectedUserId) {
      client.close();
      return { ok: false, failure: "user-mismatch" };
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
