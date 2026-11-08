// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG, type AgentProviderSummary, type SparkSummary } from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFirstJob } from "../src/chat/first-job";
import { NewSparkSheet } from "../src/chat/NewSparkSheet";
import type { NewSparkPort } from "../src/chat/new-spark";
import { takeFirstJob } from "../src/chat/sparks-feed";
import { STARTERS, type Starter } from "../src/chat/thread-items";
import { NewSparkPreview } from "../src/design-system/NewSparkPreview";
import { FIXTURE_NATIVE } from "../src/design-system/profiles-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";

// THE SHEET'S FIRST JOB (track ES, ES-2; ES-D2 A, ruled by James on the ES page, 2026-11-08 04:27:25Z; DESIGN.md §8
// "The New spark sheet", Its first job, and its ES-2 delta c2381cfab). A starter on Chat's empty night opens the sheet
// carrying itself: under the agent, "Its first job", then the starter, still, with its × "Remove its first job". Create
// hatches the spark and hands Chat its job, once and only after the hatch; Chat sends it as Send sends
// (`chat-thread-items.test.tsx`). The job is the opening's alone: the frame holds it while the sheet stands.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(HERE, path), "utf8");
const THINKER = AGENT_CATALOG[0];

const PROVIDERS: AgentProviderSummary[] = [
  {
    id: THINKER.id,
    label: THINKER.label,
    available: true,
    resumable: true,
    personas: [],
    offers: { spawn: true, spark: true },
  },
];

function sparkOf(params: Parameters<NewSparkPort["hatch"]>[0]): SparkSummary {
  return {
    id: `sp-${params.name.toLowerCase()}`,
    name: params.name,
    face: { seed: params.face.seed },
    agent: params.agent,
    profiles: [...params.profiles],
    thinksUnder: params.thinksUnder,
    folder: `/fixture/sparks/${params.name.toLowerCase()}`,
    createdAt: "2026-11-08T07:00:00.000Z",
    updatedAt: "2026-11-08T07:00:00.000Z",
  };
}

function portOf() {
  return {
    providers: vi.fn(async () => PROVIDERS),
    profileSets: vi.fn(async () => [FIXTURE_NATIVE]),
    models: vi.fn(async () => {
      throw new Error("no picker here");
    }),
    hatch: vi.fn(async (params: Parameters<NewSparkPort["hatch"]>[0]) => sparkOf(params)),
  } satisfies NewSparkPort;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const row of document.querySelectorAll(".vf-chat-row")) row.remove();
  // a job no test took must never reach the next one
  takeFirstJob("sp-polaris");
  vi.restoreAllMocks();
});

const settle = (ms = 0) => act(async () => new Promise((done) => setTimeout(done, ms)));
const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  host?.querySelector<T>(selector) ?? null;
const named = (name: string): HTMLElement | null =>
  [...(host?.querySelectorAll<HTMLElement>("button") ?? [])].find(
    (element) =>
      element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  ) ?? null;
const press = (element: Element | null) =>
  act(async () => (element as HTMLElement | null)?.click());
/** The words an element shows, each text a word apart, as a person reads them. */
function words(element: Element | null): string {
  if (element === null) return "";
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/gu, " ").trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

async function open(port: NewSparkPort, job: Starter | null): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <NewSparkSheet open port={port} onClose={() => undefined} container={host} job={job} />,
    ),
  );
  await settle();
}

/** The new spark's row in Chat's list, so Create's flight lands at once (the sheet's own suite does the same). */
function standRow(spark: string): void {
  const row = document.createElement("div");
  row.className = "vf-chat-row";
  row.dataset.spark = spark;
  row.innerHTML = '<span class="vf-spark-face"></span>';
  document.body.appendChild(row);
}

describe('the sheet carrying its first job (DESIGN.md §8 "The New spark sheet", Its first job; ES-D2 A)', () => {
  it('stands the job under the agent: "Its first job", then the starter, still, with its × "Remove its first job"', async () => {
    await open(portOf(), STARTERS[1] ?? null);
    const row = $(".vf-new-spark-job");
    if (row === null) throw new Error("no job under the agent");
    expect(row.previousElementSibling?.classList.contains("vf-new-spark-agent")).toBe(true);
    expect(words(row)).toBe(`Its first job ${STARTERS[1]?.words}`);
    const starter = row.querySelector<HTMLElement>(".vf-chat-starter");
    // the hello's own starter, drawn still: the sheet's starter is not a press, its × is
    expect(starter?.tagName).not.toBe("BUTTON");
    expect(starter?.dataset.still).toBe("true");
    const remove = row.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove its first job"]',
    );
    expect(remove).not.toBeNull();
    expect(starter?.contains(remove)).toBe(true);
  });

  it("drops the job with its ×: the row settles away over its 240ms, and Create then hatches with none", async () => {
    const port = portOf();
    await open(port, STARTERS[0] ?? null);
    await press(named("Remove its first job"));
    // it leaves as the sheet settles to its height (240ms, island)
    expect($(".vf-new-spark-job")?.dataset.leaving).toBe("true");
    await settle(300);
    expect($(".vf-new-spark-job")).toBeNull();
    standRow("sp-polaris");
    await press(named("Create Polaris"));
    await settle();
    expect(port.hatch).toHaveBeenCalledTimes(1);
    expect(takeFirstJob("sp-polaris")).toBeNull();
  });

  it("hands Chat the hatched spark's job once, and only after the hatch", async () => {
    const port = portOf();
    let release: () => void = () => undefined;
    const hatching = new Promise<void>((done) => {
      release = done;
    });
    port.hatch.mockImplementationOnce(async (params) => {
      await hatching;
      return sparkOf(params);
    });
    await open(port, STARTERS[2] ?? null);
    standRow("sp-polaris");
    await press(named("Create Polaris"));
    // the hatch is under way: nothing is handed yet
    expect(takeFirstJob("sp-polaris")).toBeNull();
    await act(async () => release());
    await settle();
    expect(takeFirstJob("sp-polaris")).toBe(STARTERS[2]?.words);
    // taken once: the one send is Chat's
    expect(takeFirstJob("sp-polaris")).toBeNull();
  });

  it("opens with no job from New spark, ⌘N or the line's ✦: nothing stands under the agent, and its hatch hands none", async () => {
    await open(portOf(), null);
    expect($(".vf-new-spark-job")).toBeNull();
    expect(named("Remove its first job")).toBeNull();
    standRow("sp-polaris");
    await press(named("Create Polaris"));
    await settle();
    expect(takeFirstJob("sp-polaris")).toBeNull();
  });

  it("draws it by DESIGN.md's numbers: 14 under the agent, the label 6 over the still starter, its × 24 round, the settle 240ms on the island curve", () => {
    const sheet = read("../src/chat/new-spark-sheet.css");
    const row = sheet.match(/^\.vf-new-spark-job \{([^}]*)\}/mu)?.[1] ?? "";
    expect(row).toMatch(/margin-block-start: 14px;/u);
    expect(row).toMatch(/gap: 6px;/u);
    expect(row).toMatch(/240ms var\(--vf-ease-island\)/u);
    const label = sheet.match(/^\.vf-new-spark-job-label \{([^}]*)\}/mu)?.[1] ?? "";
    expect(label).toMatch(/font-size: 12px;/u);
    expect(label).toMatch(/font-weight: 500;/u);
    expect(label).toMatch(/color: var\(--vf-text-tertiary\);/u);
    const starter = read("../src/chat/chat-starter.css");
    const still = starter.match(/^\.vf-chat-starter\[data-still\] \{([^}]*)\}/mu)?.[1] ?? "";
    expect(still).toMatch(/padding-right: 5px;/u);
    expect(still).toMatch(/cursor: default;/u);
    const remove = starter.match(/^\.vf-chat-starter-remove \{([^}]*)\}/mu)?.[1] ?? "";
    expect(remove).toMatch(/width: 24px;/u);
    expect(remove).toMatch(/height: 24px;/u);
    expect(remove).toMatch(/margin-left: 2px;/u);
    expect(remove).toMatch(/color: var\(--vf-text-tertiary\);/u);
    for (const css of [sheet, starter]) {
      expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu);
      expect(css).not.toMatch(/rgba?\(/u);
    }
  });

  it("says the words DESIGN.md records (§8, §9)", () => {
    const design = read("../../../DESIGN.md").replace(/\s+/gu, " ");
    for (const said of [
      '"Its first job"',
      '"Remove its first job"',
      "the night's New spark, ⌘N and the line's ✦ open the sheet with no job",
    ])
      expect(design, said).toContain(said);
  });
});

describe("the frame holds the job for the opening alone (`useFirstJob`; DESIGN.md §8, the opening's alone)", () => {
  it("holds the job the night hands it while the sheet stands, and lets it go whenever the sheet folds", async () => {
    const seen: (Starter | null)[] = [];
    function Frame(): ReactElement {
      const [surface, setSurface] = useState<FrameSurface | null>(null);
      const first = useFirstJob(surface);
      seen.push(first.job);
      return (
        <>
          <button
            type="button"
            data-act="job"
            onClick={() => {
              first.carry(STARTERS[0] ?? null);
              setSurface("new-spark");
            }}
          />
          <button type="button" data-act="fold" onClick={() => setSurface(null)} />
          <button type="button" data-act="search" onClick={() => setSurface("search")} />
          <button type="button" data-act="plain" onClick={() => setSurface("new-spark")} />
        </>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Frame />));
    const act$ = (name: string) => press($(`[data-act="${name}"]`));
    await act$("job");
    expect(seen.at(-1)).toBe(STARTERS[0]);
    // Cancel, Esc or the scrim fold it: the job leaves with the sheet
    await act$("fold");
    expect(seen.at(-1)).toBeNull();
    // opened again by New spark, ⌘N or the line's ✦: no job
    await act$("plain");
    expect(seen.at(-1)).toBeNull();
    // another surface folds it too
    await act$("job");
    expect(seen.at(-1)).toBe(STARTERS[0]);
    await act$("search");
    await act$("plain");
    expect(seen.at(-1)).toBeNull();
  });
});

describe("the catalog's sheet carrying a job (docs/UI_SYSTEM.md: the plate mounts the shipping view)", () => {
  it('draws the still "Its first job" plate on the shipping sheet view, over the shipping night', () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<NewSparkPreview state="job" />));
    expect(words($(".vf-new-spark-job"))).toBe(`Its first job ${STARTERS[0]?.words}`);
    expect($(".vf-chat-empty")).not.toBeNull();
  });
});
