import {
  listMonitorView,
  monitorParameterDefaults,
  readMonitorPalette,
} from "@vibecook/puppeteer-views";
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
// canvas, no worker, no physics — the smallest thing that would break.

describe("the views package under this tree's React", () => {
  it("renders a package component that calls hooks, so there is one React (dedupe holds)", () => {
    const AgentList = listMonitorView.Component;
    const markup = renderToStaticMarkup(
      <AgentList
        agents={[
          {
            id: "row-1",
            createdAtMs: 1_000,
            status: "idle",
            project: "vibe-field",
            detail: "idle",
            color: "#123456",
            active: false,
          },
        ]}
        parameters={monitorParameterDefaults(listMonitorView.parameterGroups)}
        actions={{ select: () => undefined, createAt: () => undefined }}
        palette={readMonitorPalette()}
      />,
    );
    expect(markup).toContain("vibe-field");
  });
});
