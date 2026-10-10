// @vitest-environment happy-dom
/**
 * PJ-4 — History BY PROJECT in the catalog (docs/UI_SYSTEM.md "Catalog
 * fidelity"): the SHIPPING view (`HistoryRoomView`) over the SHIPPING adapter
 * (`history/doors.ts`) with a fixture fieldd under it (`history-fixtures.ts`,
 * data only), handed the room's host inputs by the shipping builder. The room
 * lists fieldd's projects by their names — Home a row, an empty Temporary a
 * plain row (it folds at the foot only while it holds sessions), Live now
 * first — with the chosen session in its project, and the
 * project that also holds a checkout on the asleep laptop shows this
 * desktop's folder alone (the device guard, drawn) and says what the laptop
 * holds by its mark and name. H4's acts are drawn where they act — a `···`
 * at each project's row end, "Not part of this project" on ③'s folder rows,
 * rename on ②'s name — and a rename asks the fixture fieldd, whose refusal
 * the room says under the name.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryPreview } from "../src/design-system/HistoryPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));

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

const nameOf = (row: Element): string | null | undefined =>
  row.querySelector(".ah-project-list-item__header strong")?.textContent;

/** The plate, mounted, once the room has drawn fieldd's eight projects. */
async function plate(): Promise<Element[]> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<HistoryPreview state="projects" />));
  return until(() => {
    const found = [...(host?.querySelectorAll(".ah-project-list-item") ?? [])];
    return found.length >= 8 ? found : null;
  }, "the projects' rows");
}

describe("History by project — the catalog's plate (PJ-4)", () => {
  it("lists fieldd's projects by name through the shipping adapter, the chosen session in its project, and never a remote folder", async () => {
    const rows = await plate();
    const names = rows.map(nameOf);
    // Home is a row (J11); the demo's Temporary holds no session here, so it
    // is a plain row too — a fold never says "0" (H5)
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
    expect(host?.querySelector('.ah-fold[data-section="temporary"]')).toBeNull();
    // R3 — Live now heads ① with the project one of whose sessions runs here
    const live = host?.querySelector('.ah-section[data-section="live"]');
    expect(live?.textContent).toBe("Live now");
    // R2 — the project's other desktop, by its mark and name, asleep
    const vibe = rows.find((row) => nameOf(row) === "vibe-field");
    expect(vibe?.textContent).toContain("4 sessions on Laptop (asleep)");
    expect(vibe?.querySelector(".vf-history-mark[data-asleep]")).not.toBeNull();
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
    // R4/R5/R6/R7 — the room draws what the shipping builder handed it: a
    // live session's row says Jump to, ②'s head holds New agent, ③ its
    // folder, ① and ② their chips
    expect(
      host?.querySelector('[data-host-act] .ah-hostact[data-place="row"][data-act="jump"]'),
    ).not.toBeNull();
    expect(
      host?.querySelector('.ah-hostact[data-place="head"][data-act="new-agent"]'),
    ).not.toBeNull();
    expect(host?.querySelector("button.ah-folderpick")?.getAttribute("title")).toBe(
      "/Users/demo/Projects/vibe-field",
    );
    expect(
      [...(host?.querySelectorAll("button.ah-chipselect.ah-chip") ?? [])].map((chip) =>
        chip.getAttribute("data-filter"),
      ),
    ).toEqual(["desktop", "agent"]);
  }, 30_000);

  it("H4 on the plate — the acts where they act: a `···` at each project's row end but Temporary's, ②'s head New agent alone, a split on ③'s folder rows, and a rename refused under ②'s name in the fixture fieldd's words", async () => {
    const rows = await plate();
    // (a) pin and hide at ①'s row end: every project, never Temporary (not a project)
    const acted = rows.filter(
      (row) => row.querySelector('.ah-hostact[data-place="row"][data-act="project-acts"]') !== null,
    );
    expect(new Set(acted.map(nameOf))).toEqual(
      new Set([
        "vibe-field",
        "rosetta",
        "puppeteer",
        "infinite-canvas-engine",
        "ghosttea",
        "truffle",
        "Home",
      ]),
    );
    const more = acted
      .find((row) => nameOf(row) === "vibe-field")
      ?.querySelector<HTMLElement>('.ah-hostact[data-place="row"][data-act="project-acts"]');
    expect(more?.getAttribute("aria-label")).toBe("Pin or hide vibe-field");
    act(() => more?.click());
    const menuRows = (): string[] =>
      [...(host?.querySelectorAll(".ah-frame > .ah-menu[data-layer] .ah-menu__item") ?? [])].map(
        (row) => row.getAttribute("data-key") ?? "",
      );
    expect(menuRows()).toEqual(["pin", "hide"]);
    act(() =>
      host
        ?.querySelector<HTMLElement>(
          '.ah-frame > .ah-menu[data-layer] .ah-menu__item[data-key="pin"]',
        )
        ?.click(),
    );
    expect(host?.querySelector(".ah-menu")).toBeNull();
    // ②'s head keeps New agent alone, and its card slot is empty without a
    // suggestion: the rename card is gone
    await until(
      () => host?.querySelector(".ah-project-list-item.is-selected"),
      "the chosen project",
    );
    expect(
      [...(host?.querySelectorAll('.ah-hostact[data-place="head"]') ?? [])].map((node) =>
        node.getAttribute("data-act"),
      ),
    ).toEqual(["new-agent"]);
    expect(host?.querySelector(".ah-hostcard, .vf-history-card")).toBeNull();
    // (b) "Not part of this project" beside each of vibe-field's two folders
    act(() => host?.querySelector<HTMLElement>("button.ah-folderpick")?.click());
    expect(
      [...(host?.querySelectorAll(".ah-frame > .ah-menu[data-layer] .ah-menu__row") ?? [])].map(
        (row) => row.querySelector(".ah-menu__act")?.getAttribute("aria-label"),
      ),
    ).toEqual(["Not part of this project", "Not part of this project"]);
    act(() =>
      host?.querySelector<HTMLElement>(".ah-frame > .ah-menu[data-layer] .ah-menu__act")?.click(),
    );
    expect(host?.querySelector(".ah-menu")).toBeNull();
    // (c) rename on ②'s name: the fixture fieldd refuses through the shipping
    // intent, and the room says its words under the field
    const name = await until(
      () => host?.querySelector<HTMLButtonElement>(".ah-meta__head .ah-colhead > button.ah-rename"),
      "②'s name",
    );
    expect(name.textContent).toBe("vibe-field");
    expect(name.getAttribute("aria-label")).toBe("Rename the project: vibe-field");
    act(() => name.click());
    const field = (): HTMLInputElement | null =>
      host?.querySelector<HTMLInputElement>("input.ah-rename__field") ?? null;
    act(() => {
      const input = field();
      if (input === null) throw new Error("no rename field");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "vibe-field app",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      field()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    const failure = await until(() => host?.querySelector(".ah-rename__failure"), "the refusal");
    expect(failure.textContent).toBe(
      "Could not rename — a catalog changes no project; these are fixtures",
    );
    expect(field()?.getAttribute("aria-invalid")).toBe("true");
    act(() =>
      field()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(field()).toBeNull();
    expect(host?.querySelector(".ah-meta__head button.ah-rename")?.textContent).toBe("vibe-field");
  }, 30_000);

  it("the catalog's own sheets never style the room's classes — After Hours' shared `ah-` names are scoped to its surface", () => {
    // Electron's photographs (PJ-4) found Live now's head 146px tall in the
    // catalog: the After Hours sheet's bare `.ah-section` (padding 66px 0) is
    // also the room's section head. A class both sheets name is scoped with
    // `:where(.ah)` in the illustration sheet, so the plates draw the room's own.
    const classes = (css: string): Set<string> =>
      new Set([...css.matchAll(/\.(ah-[A-Za-z0-9_-]+)/gu)].map((match) => match[1] ?? ""));
    const roomStyles = join(HERE, "..", "node_modules", "@rosetta", "room", "src", "styles");
    const room = new Set(
      readdirSync(roomStyles)
        .filter((name) => name.endsWith(".css"))
        .flatMap((name) => [...classes(readFileSync(join(roomStyles, name), "utf8"))]),
    );
    const sheet = readFileSync(
      join(HERE, "..", "src", "design-system", "styles", "fieldmarks.css"),
      "utf8",
    );
    const bare = sheet
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/:where\(\.ah\) \.ah-[A-Za-z0-9_-]+/gu, "");
    expect([...classes(bare)].filter((name) => room.has(name))).toEqual([]);
    expect(room.has("ah-section")).toBe(true);
  });
});
