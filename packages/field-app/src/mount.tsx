import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { createRoot } from "react-dom/client";
import { DocManager } from "./doc-manager";
import { FieldView } from "./field";
import { type FieldHost, setHost } from "./host";
import "./styles.css";

// The window IS the field (2026-07-21, James): no app bar, no tabs — chrome
// floats over the canvas (DESIGN.md §1); diagnostics live inside the Settings
// panel. The provider stays app-wide so any surface can read fieldd.
// B4: the app renders IMMEDIATELY under the loading veil; the DocManager runs
// the launch pipeline (last doc → most recent → the seeded default "Field")
// and FieldView applies sessions to the engine. A failed launch degrades to
// an in-memory board with persistence honestly detached.
//
// ESR 3a: the host seam replaces window.vibefield — same await-then-render
// flow as before, mechanically. Slice 4 makes the mount synchronous behind the
// splash (design-03 §4.3 v0.3); until then this preserves today's boot exactly.

export function mountFieldApp(opts: { container: HTMLElement; host: FieldHost }): void {
  setHost(opts.host);
  let manager: DocManager | null = null;
  let client: FielddClient | null = null;

  opts.host.onPrepareClose((requestId) => {
    void (async () => {
      try {
        await manager?.shutdown();
        client?.close();
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

  const boot = async (): Promise<void> => {
    const conn = await opts.host.getConnection();
    client = new FielddClient({ url: `ws://127.0.0.1:${conn.port}`, token: conn.token });
    client.connect();
    manager = new DocManager(client);
    createRoot(opts.container).render(
      <FielddProvider client={client}>
        <FieldView manager={manager} />
      </FielddProvider>,
    );
  };
  void boot();

  const dragRegion = document.createElement("div");
  dragRegion.className = "app-drag";
  dragRegion.setAttribute("aria-hidden", "true");
  document.body.prepend(dragRegion);
}
