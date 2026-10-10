// @vitest-environment happy-dom
/**
 * PJ-4 — History BY PROJECT in the catalog (docs/UI_SYSTEM.md "Catalog
 * fidelity"): the SHIPPING view (`HistoryRoomView`) over the SHIPPING adapter
 * (`history/doors.ts`) with a fixture fieldd under it (`history-fixtures.ts`,
 * data only). The room lists fieldd's projects by their names — Home and the
 * Temporary bucket among them — with the chosen session in its project, and
 * the project that also holds a checkout on the asleep laptop shows this
 * desktop's folder alone: the device guard, drawn.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryPreview } from "../src/design-system/HistoryPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function until<T>(read: () => T | null | undefined, label: string, ms = 8_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("History by project — the catalog's plate (PJ-4)", () => {
  it("lists fieldd's projects by name through the shipping adapter, the chosen session in its project, and never a remote folder", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<HistoryPreview state="projects" />));
    const rows = await until(() => {
      const found = [...(host?.querySelectorAll(".ah-project-list-item") ?? [])];
      return found.length >= 8 ? found : null;
    }, "the projects' rows");
    const names = rows.map(
      (row) => row.querySelector(".ah-project-list-item__header strong")?.textContent,
    );
    expect(new Set(names)).toEqual(
      new Set([
        "vibe-field",
        "rosetta",
        "puppeteer",
        "infinite-canvas-engine",
        "ghosttea",
        "truffle",
        "Home",
        "Temporary",
      ]),
    );
    // the plate opens at the demo's first session: its project is chosen
    const chosen = await until(
      () =>
        host?.querySelector(
          ".ah-project-list-item.is-selected .ah-project-list-item__header strong",
        ),
      "the chosen project",
    );
    expect(chosen.textContent).toBe("vibe-field");
    // the device guard: the laptop's checkout of vibe-field is never a root
    const paths = rows.map(
      (row) => row.querySelector(".ah-project-list-item__path small")?.textContent,
    );
    expect(paths).not.toContain("/Users/demo/code/vibe-field");
    // this desktop's folder, as the room writes it (in full, or under ~ when
    // the host names a home)
    expect(paths.some((path) => path?.endsWith("Projects/vibe-field"))).toBe(true);
  }, 30_000);
});
