import {
  createGhostteaTerminalRuntime,
  GhostteaProvider,
  type GhostteaTerminalRuntime,
  waitForGhostteaRendererPorts,
} from "@vibecook/ghosttea-react";
import TerminalRenderWorker from "@vibecook/ghosttea-react/terminal-render.worker.js?worker";
import {
  GhostteaWorkspace,
  type GhostteaWorkspaceContext,
  type GhostteaWorkspacePlatform,
} from "@vibecook/ghosttea-react/workspace";
import {
  type TerminalBridgeStatus,
  TerminalCreateResult,
  TerminalTicket,
} from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import { type JSX, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@vibecook/ghosttea-react/styles.css";
import "@vibecook/ghosttea-react/workspace.css";

// GT-1 spike (renderer side): the PRODUCT terminal path, driven from the page
// that would drive it for real. Main mints nothing on this page's behalf any
// more — the renderer bootstraps fieldd, redeems its own ticket, hands the
// connection to main over the product IPC, and receives the bridge's ports
// through the product preload. Two passes, one page:
//
//   1. create → the ticket rides the create result (GT-1's contract, and the
//      reason no retry loop remains anywhere), attach, claim, split.
//   2. main SIGKILLs the bridge and its ladder rebuilds it. Ports are per
//      TRANSFER and the runtime's are dead, so the page builds a NEW runtime
//      and re-attaches through openTicket — the attach-to-existing path —
//      proving the sessions outlived the transport that was showing them.
//
// Pass 2 is deliberately NOT a reload: the shell's navigation policy denies
// every renderer-initiated navigation (security.ts applyContentsPolicy), so the
// reference app's reload-the-window recovery is unavailable to a VibeField
// renderer by design — and rebuilding in place is what the real deck wants
// anyway, since a reload would take the whole canvas down with it.
//
// A spike page is not product code, so it reads window.vibefield directly
// (host.ts's adapter is for the product mount, which this page does not use).

interface SpikeGodviewResult {
  ok: boolean;
  claimed: boolean;
  splitCreated: boolean;
  sessions: number;
  panes: number;
  claimedSessionId?: string;
  splitSessionId?: string;
  rendererBackend?: string;
  reason?: string;
}

/** The preload bridge this page uses. Narrow by hand rather than imported:
 * field-app must not depend on the Electron host package (wall R1). */
interface SpikeShellBridge {
  getConnection(): Promise<{ port: number; token: string }>;
  terminal: {
    connect(ticket: unknown): Promise<{ attached: boolean }>;
    onStatus(handler: (status: TerminalBridgeStatus) => void): () => void;
  };
}

const shell = (window as unknown as { vibefield: SpikeShellBridge }).vibefield;

const params = new URLSearchParams(window.location.search);
const DEFAULT_SHELL = params.get("shell") ?? "/bin/sh";
/** Unique per run: the workspace's layout lives in localStorage, which belongs
 * to the Electron profile and outlives the throwaway data root — and a saved
 * layout suppresses claiming outright. */
const RUN_ID = Math.random().toString(36).slice(2);

let verdictPrefix = "SPIKE_GODVIEW";
let reportedPass = -1;
function report(pass: number, result: SpikeGodviewResult): void {
  if (reportedPass === pass) return;
  reportedPass = pass;
  const out = document.getElementById("out");
  if (out !== null) out.textContent = JSON.stringify(result, null, 2);
  console.log(`${verdictPrefix} ${JSON.stringify(result)}`);
}

const fail = (reason: string): void =>
  report(reportedPass + 1, {
    ok: false,
    claimed: false,
    splitCreated: false,
    sessions: 0,
    panes: 0,
    reason,
  });

// A thrown error anywhere in the workspace would otherwise leave the harness
// waiting out its full timeout for a verdict that is never coming.
window.addEventListener("error", (event) => fail(`uncaught: ${event.message}`));
window.addEventListener("unhandledrejection", (event) =>
  fail(`unhandled rejection: ${String(event.reason)}`),
);

/** Ports are transferred per ATTACH and the wait is one-shot, so a runtime is
 * born with its own fresh wait, armed before the connect that causes the
 * transfer. The timeout is generous because a redeem talks to two daemons. */
function makeRuntime(): GhostteaTerminalRuntime {
  return createGhostteaTerminalRuntime({
    ports: waitForGhostteaRendererPorts(45_000),
    clientBuild: "vibefield-spike-godview",
    // Bundled explicitly: the runtime's default resolves its worker relative to
    // its own module URL, which under Vite means an asset inside node_modules.
    workerFactory: () => new TerminalRenderWorker(),
    platform: {
      writeClipboard: () => undefined,
      forceCanvasFallback: () => false,
      setForceCanvasFallback: () => undefined,
      reload: () => undefined,
    },
  });
}

// Only what the workspace requires. `platform` is left unset rather than
// guessed: it selects a keybinding table, and this page presses no keys.
const platform: GhostteaWorkspacePlatform = {
  defaultShell: DEFAULT_SHELL,
  readClipboard: () => "",
  showContextMenu: () => undefined,
  toggleFullscreen: () => undefined,
  closeWindow: () => undefined,
  onMenuAction: () => () => undefined,
};

let publishWorkspace: ((workspace: GhostteaWorkspaceContext) => void) | null = null;

/** The workspace publishes its context to its sidebar and nowhere else, so the
 * sidebar slot is how an embedder observes panes and sessions. */
function ContextProbe({ workspace }: { workspace: GhostteaWorkspaceContext }): null {
  useEffect(() => publishWorkspace?.(workspace), [workspace]);
  return null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the render worker to name its backend ("starting" until it has
 * one). Bounded and non-fatal: the deck's sessions are the pass condition,
 * and the backend is evidence about HOW it drew, not whether it exists. */
async function settledBackend(runtime: GhostteaTerminalRuntime, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline && runtime.rendererBackend === "starting") {
    await sleep(100);
  }
}

/** Poll the live context until `predicate` holds. The context is replaced on
 * every workspace state change, so waiting on a snapshot would wait forever. */
async function until(
  read: () => GhostteaWorkspaceContext | undefined,
  predicate: (workspace: GhostteaWorkspaceContext) => boolean,
  what: string,
  timeoutMs: number,
): Promise<GhostteaWorkspaceContext> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const workspace = read();
    if (workspace !== undefined && predicate(workspace)) return workspace;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

let fieldd: FielddClient | null = null;
let claimedSessionId: string | null = null;

/** Redeem a ticket and hand it to main, which builds (or re-attaches) the
 * Backend and posts the ports this pass's runtime is already waiting for.
 * Pass 1 CREATES — and the ticket rides the create result, so there is no
 * observe wait and no retry. Pass 2 attaches to the session pass 1 made, which
 * is exactly what `openTicket` is for. */
async function attachSession(): Promise<string> {
  if (fieldd === null) {
    const connection = await shell.getConnection();
    fieldd = new FielddClient({
      url: `ws://127.0.0.1:${connection.port}`,
      token: connection.token,
    });
    fieldd.connect();
  }
  if (claimedSessionId !== null) {
    const ticket = TerminalTicket.parse(
      await fieldd.request("terminal.openTicket", { sessionId: claimedSessionId }),
    );
    await shell.terminal.connect(ticket);
    return claimedSessionId;
  }
  // Parsed, not cast: a create result without a ticket must fail loudly here —
  // that failure IS the red on pre-GT-1 code.
  const created = TerminalCreateResult.parse(await fieldd.request("terminal.create", {}));
  claimedSessionId = created.sessionId;
  await shell.terminal.connect(created.ticket);
  return created.sessionId;
}

function SpikeGodview({
  pass,
  runtime,
}: {
  pass: number;
  runtime: GhostteaTerminalRuntime;
}): JSX.Element {
  const [workspace, setWorkspace] = useState<GhostteaWorkspaceContext>();
  const latest = useRef<GhostteaWorkspaceContext | undefined>(undefined);
  // Both assignments happen in render, not in an effect, and must: child
  // effects run before parent ones, so the probe would publish into a null
  // sink on the first pass and then — the workspace context being stable once
  // settled — never publish again. Both writes are idempotent.
  latest.current = workspace;
  publishWorkspace = setWorkspace;

  useEffect(() => {
    let cancelled = false;
    const read = (): GhostteaWorkspaceContext | undefined => latest.current;
    void (async () => {
      try {
        const sessionId = await attachSession();
        if (cancelled) return;
        const claimed = await until(
          read,
          (w) => w.sessions.some((session) => session.id === sessionId),
          "the fieldd-created shell to be claimed into a pane",
          30_000,
        );
        if (cancelled) return;
        // Pass 2 proves the session survived its transport; splitting again
        // would only prove the workspace can spawn, which pass 1 already did.
        const split = pass === 0 ? await claimed.splitActive() : undefined;
        if (pass === 0 && split === undefined) throw new Error("splitActive() minted no session");
        const settled =
          split === undefined
            ? claimed
            : await until(
                read,
                (w) => w.sessions.some((session) => session.id === split.id) && w.panes.length >= 2,
                "the split session to land in a second pane",
                20_000,
              );
        if (cancelled) return;
        // The render worker only names its backend once it has actually stood
        // a renderer up against a mounted surface, so this is the difference
        // between "React mounted a workspace" and "the deck draws".
        await settledBackend(runtime, 15_000);
        if (cancelled) return;
        report(pass, {
          ok: true,
          claimed: true,
          splitCreated: split !== undefined,
          sessions: settled.sessions.length,
          panes: settled.panes.length,
          claimedSessionId: sessionId,
          ...(split !== undefined ? { splitSessionId: split.id } : {}),
          rendererBackend: runtime.rendererBackend,
        });
      } catch (error) {
        if (cancelled) return;
        const current = read();
        report(pass, {
          ok: false,
          claimed: false,
          splitCreated: false,
          sessions: current?.sessions.length ?? 0,
          panes: current?.panes.length ?? 0,
          rendererBackend: runtime.rendererBackend,
          reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pass, runtime]);

  return (
    <GhostteaWorkspace
      platform={platform}
      // Per PASS as well as per run: the recovery deck re-claims from the floor
      // rather than rehydrating pass 1's saved layout — layout rehydration is
      // GT-2's question, not this spike's.
      storageKey={`vf-spike-godview:${RUN_ID}:${pass}`}
      sidebar={ContextProbe}
      claimExistingSessions
      enableRemoteSessions={false}
      showTitlebar={false}
    />
  );
}

function SpikeRoot(): JSX.Element {
  const [pass, setPass] = useState(0);
  const [runtime, setRuntime] = useState(makeRuntime);

  useEffect(
    () =>
      shell.terminal.onStatus((status) => {
        // bridge-down is the honest moment of death; the rebuild is what this
        // page can act on. A runtime holds its ports for life, so recovery
        // means a new runtime — and the whole deck remounts onto it.
        if (status.state !== "bridge-up") return;
        verdictPrefix = "SPIKE_GODVIEW_RECOVERY";
        setRuntime((previous) => {
          previous.dispose();
          return makeRuntime();
        });
        setPass((previous) => previous + 1);
      }),
    [],
  );

  // `key` forces a full remount: the workspace reads its runtime from context
  // at mount, so swapping the value alone would leave live panes bound to a
  // dead transport.
  return (
    <GhostteaProvider key={pass} runtime={runtime}>
      <SpikeGodview pass={pass} runtime={runtime} />
    </GhostteaProvider>
  );
}

// No StrictMode, deliberately: its double-invoked effects would drive the
// verdict sequence twice and split the deck twice for one run.
createRoot(document.getElementById("root")!).render(<SpikeRoot />);
