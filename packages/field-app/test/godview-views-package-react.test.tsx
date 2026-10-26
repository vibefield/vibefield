import {
  agentViewFixture,
  countingCommands,
  fixtureInput,
  fixtureTheme,
  parameterDefaults,
} from "@vibefield/puppeteer-view-sdk/testing";
import { listMonitorView, readMonitorPalette } from "@vibefield/puppeteer-views";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// THE ONE-REACT WITNESS (AR-5a). The views package arrives as a sibling
// `link:` row, and by Node's rules it would resolve its own `react` — a second
// physical copy. Vite's `dedupe` (the renderer bundle, and vitest here) is what
// makes one React load; this test is the proof that the dedupe holds where the
// bundle is actually built and the tests actually run: a package component
// that calls hooks is rendered under THIS tree's React. Two copies throw
// "Invalid hook call" the moment `useMemo` runs.
//
// The list view is the one chosen because it is pure DOM and hooks: no
// canvas, no worker, no physics — the smallest thing that would break. Since
// MV-4 it is an SDK view (`reactMonitorView`): its component takes the view's
// input and the three commands, and reads the model's `AgentView` alone.

describe("the views package under this tree's React", () => {
  it("renders a package component that calls hooks, so there is one React (dedupe holds)", () => {
    const AgentList = listMonitorView.Component;
    const markup = renderToStaticMarkup(
      <AgentList
        input={fixtureInput({
          agents: [agentViewFixture({ id: "row-1", project: { name: "vibe-field" } })],
          parameters: parameterDefaults(listMonitorView.manifest),
          theme: fixtureTheme("light", { tokens: readMonitorPalette() }),
        })}
        commands={countingCommands().commands}
      />,
    );
    expect(markup).toContain("vibe-field");
  });
});
