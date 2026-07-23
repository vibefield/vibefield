import { FielddClient } from "@vibefield/fieldd-client";
import { createRoot } from "react-dom/client";
import { BootRoot } from "./boot/BootRoot";
import { createBootMachine } from "./boot/machine";
import { type FieldHost, setHost } from "./host";
import { setRendererLogger } from "./logging";
import "./tw.css";

// The window IS the field (2026-07-21, James): no app bar, no tabs — chrome
// floats over the canvas (DESIGN.md §1); diagnostics live inside the Settings
// panel. ESR slice 4 (design-03 §4.3 v0.3): the mount is SYNCHRONOUS — the
// splash paints before any await — and the boot machine runs bootstrap, the
// eager workspace import, the document warm-up, and the stability gate behind
// it. The reveal fires once, fully warm. Everything heavy lives in the
// workspace chunk; this module stays splash-bundle small.

export function mountFieldApp(opts: { container: HTMLElement; host: FieldHost }): void {
  setHost(opts.host);
  setRendererLogger(opts.host.logger);
  performance.mark("vf:renderer:entry");

  const machine = createBootMachine({
    host: opts.host,
    importWorkspace: () => import("./workspace"),
    makeClient: (conn) => {
      const client = new FielddClient({
        url: `ws://127.0.0.1:${conn.port}`,
        token: conn.token,
      });
      client.connect();
      return client;
    },
  });

  opts.host.onPrepareClose((requestId) => {
    void (async () => {
      try {
        await machine.ready?.manager.shutdown();
        machine.client?.close();
        opts.host.completeClose({ requestId, ok: true });
      } catch (error) {
        opts.host.completeClose({
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  // synchronous first paint (ESR §5.4.2) — no await before this render
  createRoot(opts.container).render(<BootRoot machine={machine} />);
  requestAnimationFrame(() => {
    performance.mark("vf:renderer:first-frame");
    machine.start();
  });

  const dragRegion = document.createElement("div");
  dragRegion.className = "app-drag";
  dragRegion.setAttribute("aria-hidden", "true");
  document.body.prepend(dragRegion);
}
