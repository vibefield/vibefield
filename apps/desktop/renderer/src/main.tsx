import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

async function boot(): Promise<void> {
  const conn = await window.vibefield.getConnection();
  const client = new FielddClient({ url: `ws://127.0.0.1:${conn.port}`, token: conn.token });
  client.connect();
  createRoot(document.getElementById("root")!).render(
    <FielddProvider client={client}>
      <App />
    </FielddProvider>,
  );
}

void boot();

const dragRegion = document.createElement("div");
dragRegion.className = "app-drag";
dragRegion.setAttribute("aria-hidden", "true");
document.body.prepend(dragRegion);
