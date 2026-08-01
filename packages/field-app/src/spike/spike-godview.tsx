import {
  createGhostteaTerminalRuntime,
  GhostteaProvider,
  waitForGhostteaRendererPorts,
} from "@vibecook/ghosttea-react";
import TerminalRenderWorker from "@vibecook/ghosttea-react/terminal-render.worker.js?worker";
import {
  GhostteaWorkspace,
  type GhostteaWorkspaceContext,
  type GhostteaWorkspacePlatform,
} from "@vibecook/ghosttea-react/workspace";
import { type JSX, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@vibecook/ghosttea-react/styles.css";
import "@vibecook/ghosttea-react/workspace.css";

// GT-0 spike (renderer side): prove the deck renders in THIS runtime — the
// sandboxed Electron renderer, prod build, served over vibefield-app://shell —
// against the REAL pair. Main has already minted a free shell through fieldd
// and dialed field-native's sockets in external mode; this page answers two
// questions main cannot:
//   1. does GhostteaWorkspace ADOPT that shell (claimExistingSessions), or
//      does it ignore the floor's inventory and spawn its own?
//   2. can the workspace's OWN split affordance mint a second session over the
//      same ticketed connection?
// Result is one JSON line on the console — main captures it and exits.

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

const params = new URLSearchParams(window.location.search);
/** The session fieldd created before this page existed. Its arrival in a pane
 * is the whole claim half of the spike, so an absent id is a failed run rather
 * than a defaulted one. */
const SPIKE_SESSION = params.get("spikeSession") ?? "";
const DEFAULT_SHELL = params.get("shell") ?? "/bin/sh";

let reported = false;
function report(result: SpikeGodviewResult): void {
  if (reported) return;
  reported = true;
  const out = document.getElementById("out");
  if (out !== null) out.textContent = JSON.stringify(result, null, 2);
  console.log(`SPIKE_GODVIEW ${JSON.stringify(result)}`);
}

const fail = (reason: string): void =>
  report({ ok: false, claimed: false, splitCreated: false, sessions: 0, panes: 0, reason });

// A thrown error anywhere in the workspace would otherwise leave the harness
// waiting out its full timeout for a verdict that is never coming.
window.addEventListener("error", (event) => fail(`uncaught: ${event.message}`));
window.addEventListener("unhandledrejection", (event) =>
  fail(`unhandled rejection: ${String(event.reason)}`),
);

const runtime = createGhostteaTerminalRuntime({
  ports: waitForGhostteaRendererPorts(),
  clientBuild: "vibefield-spike-godview",
  // Bundled explicitly: the runtime's default resolves its worker relative to
  // its own module URL, which under Vite means an asset inside node_modules.
  workerFactory: () => new TerminalRenderWorker(),
  platform: {
    writeClipboard: () => undefined,
    forceCanvasFallback: () => false,
    setForceCanvasFallback: () => undefined,
    reload: () => window.location.reload(),
  },
});

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
 * one). Bounded and non-fatal: the deck's two sessions are the pass condition,
 * and the backend is evidence about HOW it drew, not whether it exists. */
async function settledBackend(timeoutMs: number): Promise<void> {
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

function SpikeGodview(): JSX.Element {
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
        if (SPIKE_SESSION === "") throw new Error("no spikeSession in the page URL");
        const claimed = await until(
          read,
          (w) => w.sessions.some((session) => session.id === SPIKE_SESSION),
          "the fieldd-created shell to be claimed into a pane",
          30_000,
        );
        if (cancelled) return;
        // The split affordance the user would reach for, driven through the
        // same context the workspace hands its sidebar.
        const split = await claimed.splitActive();
        if (split === undefined) throw new Error("splitActive() minted no session");
        const both = await until(
          read,
          (w) => w.sessions.some((session) => session.id === split.id) && w.panes.length >= 2,
          "the split session to land in a second pane",
          20_000,
        );
        if (cancelled) return;
        // The render worker only names its backend once it has actually stood
        // a renderer up against a mounted surface, so this is the difference
        // between "React mounted a workspace" and "the deck draws".
        await settledBackend(15_000);
        if (cancelled) return;
        report({
          ok: true,
          claimed: true,
          splitCreated: true,
          sessions: both.sessions.length,
          panes: both.panes.length,
          claimedSessionId: SPIKE_SESSION,
          splitSessionId: split.id,
          rendererBackend: runtime.rendererBackend,
        });
      } catch (error) {
        if (cancelled) return;
        const current = read();
        report({
          ok: false,
          claimed: current?.sessions.some((session) => session.id === SPIKE_SESSION) ?? false,
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
  }, []);

  return (
    <GhostteaWorkspace
      platform={platform}
      // Unique per run: localStorage outlives a spike run (it belongs to the
      // Electron profile, not the throwaway data root), and a workspace saved
      // by a previous run suppresses claiming outright.
      storageKey={`vf-spike-godview:${SPIKE_SESSION}`}
      sidebar={ContextProbe}
      claimExistingSessions
      enableRemoteSessions={false}
      showTitlebar={false}
    />
  );
}

// No StrictMode, deliberately: its double-invoked effects would drive the
// verdict sequence twice and split the deck twice for one run.
createRoot(document.getElementById("root")!).render(
  <GhostteaProvider runtime={runtime}>
    <SpikeGodview />
  </GhostteaProvider>,
);
