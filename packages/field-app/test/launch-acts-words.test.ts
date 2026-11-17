// Item 489 (2026-11-16) — New agent's picker reads (`launchActs`): a failed
// read's own words go to the renderer log, never the page. warn when a person
// opened "Another model…" and no picker stands; debug for a re-read failing
// behind an old picker, and for the read a project's recipe row asks.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentModelsResult } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryHostState } from "../src/history/host-inputs";
import type { LaunchPage } from "../src/history/launch";
import { launchActs } from "../src/history/launch-acts";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const STALE = AgentModelsResult.parse(
  JSON.parse(readFileSync(join(FIXTURES, "agent-models.stale.json"), "utf8")),
);
const NONE = AgentModelsResult.parse({
  provider: "claude",
  profileSet: "work",
  refreshing: false,
  failure: {
    status: "unavailable",
    code: "not-found",
    message: `The native agent could not be started. ${"x".repeat(2_000)}`,
    at: "2026-11-16T20:00:00.000Z",
  },
});
const MODELS_PAGE: LaunchPage = {
  kind: "models",
  project: "p1:vibe",
  folder: null,
  provider: "claude",
  profileSet: "work",
};

const before = getRendererLogger();
afterEach(() => setRendererLogger(before));

function heard(): Array<{ level: string; event: string; attrs: Record<string, unknown> }> {
  const lines: Array<{ level: string; event: string; attrs: Record<string, unknown> }> = [];
  const quiet = (): void => undefined;
  const logger: RendererLogger = {
    child: () => logger,
    trace: quiet,
    debug: (event, _message, attrs) => {
      lines.push({ level: "debug", event, attrs: { ...attrs } });
    },
    info: quiet,
    warn: (event, _message, attrs) => {
      lines.push({ level: "warn", event, attrs: { ...attrs } });
    },
    error: quiet,
    fatal: quiet,
    isLevelEnabled: () => true,
  };
  setRendererLogger(logger);
  return lines;
}

/** launchActs over a client answering `answer`, its state held here. */
function acts(answer: AgentModelsResult) {
  let state = { page: MODELS_PAGE, models: new Map() } as unknown as HistoryHostState;
  const client = { request: async () => answer };
  const made = launchActs(client as never, (update) => {
    state = update(state);
  });
  return { made, held: () => state.models };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("New agent's picker reads: the adapter's words to the log (item 489)", () => {
  it("opening Another model… onto a read that failed with no picker logs its words at warn, bounded", async () => {
    const lines = heard();
    const { made } = acts(NONE);
    made.page(MODELS_PAGE);
    await settle();
    const failed = lines.filter((line) => line.event === "renderer.history.models_read_failed");
    expect(failed.map((line) => line.level)).toEqual(["warn"]);
    expect(failed[0]?.attrs).toMatchObject({
      provider: "claude",
      profileSet: "work",
      status: "unavailable",
      code: "not-found",
    });
    expect(String(failed[0]?.attrs.reason)).toHaveLength(501);
    expect(String(failed[0]?.attrs.reason).startsWith("The native agent could not")).toBe(true);
  });

  it("a re-read failing behind an old picker, and the recipe row's read, log at debug", async () => {
    const lines = heard();
    acts(STALE).made.page(MODELS_PAGE);
    acts(NONE).made.recipeShown({ recipe: { provider: "claude", profileSet: "work" } } as never);
    await settle();
    const failed = lines.filter((line) => line.event === "renderer.history.models_read_failed");
    expect(failed.map((line) => [line.level, line.attrs.code])).toEqual([
      ["debug", "timeout"],
      ["debug", "not-found"],
    ]);
    expect(failed[0]?.attrs.reason).toBe("Model discovery timed out.");
  });
});
