// @vitest-environment node
/**
 * WHAT A RAIN COLUMN SAYS (GT-D17, GT-5c).
 *
 * `rainDataString` had no test at all, and the finding it is getting one for is
 * the reason: a remote row carries no agent facet, so it fell into the same
 * `<project> terminal` branch an unclaimed LOCAL terminal takes. On the canvas a
 * peer's shell was byte-identical to one of ours — the device name reachable
 * only by hovering or by reading the offscreen list — and clicking the wrong
 * one detaches the active pane onto another machine's session.
 *
 * Three rows, three readings, one function: local agent, local unclaimed
 * terminal, peer.
 */

import { describe, expect, it } from "vitest";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { rainDataString } from "../src/godview/views/rain/rain-streams";

function base(overrides: Partial<MonitorAgent>): MonitorAgent {
  return {
    id: "row",
    createdAtMs: 0,
    status: "idle",
    project: "vibe-field",
    detail: "",
    color: "#6366f1",
    active: false,
    ...overrides,
  };
}

function remoteRow(hostWritable: boolean): MonitorAgent {
  return base({
    id: "remote:studio-mini:s1",
    project: "vibe-field",
    detail: "studio-mini · /Users/peer/vibe-field",
    remote: {
      deviceId: "studio-mini",
      deviceName: "studio-mini",
      remoteSessionId: "s1",
      attachable: true,
      hostWritable,
      cwdLabel: "/Users/peer/vibe-field",
    },
  });
}

describe("rainDataString", () => {
  it("reads an agent row as its project, branch, model and context", () => {
    const text = rainDataString(
      base({
        agent: {
          kind: "claude",
          provider: "Claude",
          model: "Opus",
          branch: "main",
          contextWindow: { usedPercent: 42 } as never,
          info: {} as never,
        },
      }),
    );
    expect(text).toContain("vibe field");
    expect(text).toContain("main");
    expect(text).toContain("Opus");
    expect(text).toContain("CTX 42%");
  });

  it("reads a local unclaimed terminal as its project and the word terminal", () => {
    // Hyphens flatten to spaces with every other symbol — one grid-width glyph
    // per cell is what keeps a stream a column rather than a ragged edge, and
    // it has applied to folder names since the view was ported.
    expect(rainDataString(base({}))).toBe(" vibe field terminal ");
  });

  it("NAMES THE PEER on a remote row, first, so the canvas cannot be misread", () => {
    // The whole finding. Same project name, same absent agent facet — and now
    // two visibly different columns.
    const peer = rainDataString(remoteRow(true));
    expect(peer).toContain("studio mini");
    expect(peer).not.toBe(rainDataString(base({})));
    // The host leads, as it does in the list row's accessible name: the machine
    // is the fact that changes what the column means.
    expect(peer.trimStart().startsWith("studio mini")).toBe(true);
  });

  it("says a read-only host in the stream, and claims nothing when the host permits writes", () => {
    // The mark is a HOST property (`hostWritable`), so it appears only where it
    // is universally true. A permitting host says nothing here because whether
    // THIS viewer gets writes is not decided until the attach.
    expect(rainDataString(remoteRow(false))).toContain("read only host");
    expect(rainDataString(remoteRow(true))).not.toContain("read only");
  });

  it("flattens every symbol to a space so each cell holds one grid glyph", () => {
    const text = rainDataString(remoteRow(false));
    expect(text).toMatch(/^[a-zA-Z0-9\s%.]+$/);
    // …including the separator the detail line uses, which never reaches here.
    expect(text).not.toContain("·");
  });
});
