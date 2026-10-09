// @vitest-environment happy-dom
/**
 * H1 (docket v9, ruled (a) 2026-10-09: "we map, the room draws") — rosetta's
 * room grows OPTIONAL host inputs (s-pj4 A5's R1–R9, rosetta
 * `vf/room-host-slots`), and stays device-unaware (A-D9): opaque host keys and
 * render slots it draws and never interprets. Each input here twice, over the
 * room's demo ports: given, the room draws it; absent, the room draws what it
 * drew before (rosetta's app, the reference host, passes none). Lane pj4 codes
 * the adapter against these shapes.
 */
import { HistoryRoom, type HistoryRoomHandle, type HistoryRoomProps } from "@rosetta/room";
import { createDemoPorts, createRoomDemo } from "@rosetta/room/fixtures";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await import("@rosetta/room");
}, 60_000);

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function until<T>(
  read: () => T | null | undefined | false,
  label: string,
  ms = 5_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

type Inputs = Omit<HistoryRoomProps, "catalog" | "sessions" | "assets" | "host">;

/** The room over its demo ports, with these inputs; settled once its rows are drawn. */
async function room(inputs: Inputs = {}) {
  const demo = createRoomDemo();
  const ports = createDemoPorts(demo);
  const handle = createRef<HistoryRoomHandle>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const el = host;
  const render = (next: Inputs) =>
    act(() => root?.render(<HistoryRoom ref={handle} {...ports} storage={null} {...next} />));
  render(inputs);
  await until(
    () => el.querySelector('.ah-project-list-item[data-motion-key="p0"]'),
    "the ledger's rows",
  );
  return { el, demo, handle, render };
}

const projectRow = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`.ah-project-list-item[data-motion-key="${id}"]`);

describe("R1 — a host colour per project", () => {
  it("given, a project's tint is the host's; a project it leaves out keeps the dealt one", async () => {
    const { el, handle } = await room({
      projectTint: (id) => (id === "p0" ? "rgb(1, 2, 3)" : null),
    });
    expect(projectRow(el, "p0")?.style.getPropertyValue("--project-color")).toBe("rgb(1, 2, 3)");
    expect(projectRow(el, "p1")?.style.getPropertyValue("--project-color")).toMatch(
      /^oklch\(var\(--tint-l\)/,
    );
    // the colour follows the project across the room: ②'s panel wears it too
    act(() => handle.current?.openAt({ sessionId: "s0" }));
    const panel = await until(
      () => el.querySelector<HTMLElement>(".ah-col .ah-meta[style]"),
      "②'s panel",
    );
    expect(panel.style.getPropertyValue("--tint")).toBe("rgb(1, 2, 3)");
  });

  it("absent, every project wears the room's dealt tint", async () => {
    const { el } = await room();
    for (const row of el.querySelectorAll<HTMLElement>(".ah-project-list-item")) {
      expect(row.style.getPropertyValue("--project-color")).toMatch(/^oklch\(var\(--tint-l\)/);
    }
  });
});
