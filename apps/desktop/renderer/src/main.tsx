import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { createRoot } from "react-dom/client";
import { loadBoard } from "./board-boot";
import { FieldView } from "./field";
import "./styles.css";

// The window IS the field (2026-07-21, James): no app bar, no tabs — chrome
// floats over the canvas (DESIGN.md §1); diagnostics live inside the Settings
// panel. The provider stays app-wide so any surface can read fieldd.
// B3: the board is fetched from fieldd BEFORE first render (open-or-seed —
// no flash of a seeded board over a restored one); a failed fetch degrades
// to an in-memory board with persistence honestly detached.

async function boot(): Promise<void> {
  const conn = await window.vibefield.getConnection();
  const client = new FielddClient({ url: `ws://127.0.0.1:${conn.port}`, token: conn.token });
  client.connect();
  const board = await loadBoard(client);
  createRoot(document.getElementById("root")!).render(
    <FielddProvider client={client}>
      <FieldView board={board} />
    </FielddProvider>,
  );
}

void boot();

const dragRegion = document.createElement("div");
dragRegion.className = "app-drag";
dragRegion.setAttribute("aria-hidden", "true");
document.body.prepend(dragRegion);
