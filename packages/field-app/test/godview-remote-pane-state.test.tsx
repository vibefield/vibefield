// @vitest-environment happy-dom
/**
 * DS-4e — THE REMOTE PANE'S HONEST STATE, in pieces (the deck row in
 * `godview-deck.test.tsx` holds them together against the real pool).
 *
 *   1. the words: the desktop by its NAME, never its id; the refusing plane's
 *      own sentence beneath; the next step only when there is one
 *   2. the flip: what a change of a roster row's STANDING is, read off the
 *      monitor's one subscription (the tee), never a second one
 *   3. the view: a status region, mounted by the shipping component itself
 */
import type { DeviceInfo } from "@vibefield/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { RosterFlips, rosterStanding, teeDevicesPort } from "../src/godview/monitor/devices";
import { describeRemoteRefusal } from "../src/godview/pane-faces";
import { RemotePaneStateView } from "../src/godview/RemotePaneState";
import type { RemoteRefusal } from "../src/terminal/pool";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STUDIO = "dev-studio";
const SAID = "this desktop has no egress route to that desktop's terminal cells yet";

function refusal(state: RemoteRefusal["state"], waits: boolean): RemoteRefusal {
  return { device: STUDIO, state, reason: SAID, waits };
}

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    deviceId: STUDIO,
    name: "studio",
    self: false,
    online: true,
    lastSeenAt: 0,
    ...overrides,
  };
}

describe("the words a remote pane says (DESIGN.md §9)", () => {
  it("names each state by the desktop's NAME, the plane's own words beneath, the next step when there is one", () => {
    expect(describeRemoteRefusal(refusal("no-road", true), "studio")).toEqual({
      state: "no-road",
      message: "no road to studio yet",
      detail: SAID,
      next: "asks again when studio's status changes",
    });
    expect(describeRemoteRefusal(refusal("asleep", true), "studio")).toEqual({
      state: "asleep",
      message: "studio is asleep",
      detail: SAID,
      next: "asks again when studio wakes",
    });
    expect(describeRemoteRefusal(refusal("not-answering", true), "studio")).toMatchObject({
      message: "studio is not answering",
      next: "asks again when studio's status changes",
    });
    // final: said, and nothing promised after it
    expect(describeRemoteRefusal(refusal("gone", false), "studio")).toEqual({
      state: "gone",
      message: "gone from studio",
      detail: SAID,
    });
    expect(describeRemoteRefusal(refusal("refused", false), "studio")).toEqual({
      state: "refused",
      message: "cannot open on studio",
      detail: SAID,
    });
  });

  it("never promises an ask the host will not make", () => {
    // a reachability state that, for once, does not wait says no next step
    expect(describeRemoteRefusal(refusal("no-road", false), "studio").next).toBeUndefined();
  });

  it("says 'that desktop' for one the roster has not named — never its id", () => {
    expect(describeRemoteRefusal(refusal("no-road", true), undefined).message).toBe(
      "no road to that desktop yet",
    );
    expect(describeRemoteRefusal(refusal("asleep", true), "").message).toBe(
      "that desktop is asleep",
    );
    const face = describeRemoteRefusal(refusal("no-road", true), undefined);
    expect(JSON.stringify(face)).not.toContain(STUDIO);
  });
});

describe("a roster row's flip — the one signal a waiting pane asks again on", () => {
  it("is a change of STANDING: first sight is a baseline, the same list twice is nothing", () => {
    const flips = new RosterFlips();
    expect(flips.observe([device({ state: "awake", link: "dialing" })])).toEqual([]);
    // a name, a clock, a version are not standing
    expect(
      flips.observe([device({ state: "awake", link: "dialing", name: "renamed", lastSeenAt: 9 })]),
    ).toEqual([]);
    expect(flips.observe([device({ state: "awake", link: "connected" })])).toEqual([STUDIO]);
    expect(flips.observe([device({ state: "awake", link: "connected" })])).toEqual([]);
    // a daemon that restarted is a new boot answering: a flip
    expect(
      flips.observe([device({ state: "awake", link: "connected", bootId: "boot-2" })]),
    ).toEqual([STUDIO]);
  });

  it("keeps a departed desktop's standing, so its return is compared rather than re-baselined", () => {
    const flips = new RosterFlips();
    flips.observe([device({ state: "awake", link: "connected" })]);
    expect(flips.observe([])).toEqual([]);
    expect(flips.observe([device({ state: "asleep", online: false })])).toEqual([STUDIO]);
  });

  it("reads an older peer's row, which says no `state`, by the tailnet's `online`", () => {
    expect(rosterStanding(device({ online: true }))).not.toBe(
      rosterStanding(device({ online: false })),
    );
    expect(rosterStanding(device({ online: true }))).toBe(
      rosterStanding(device({ online: true, state: "awake" })),
    );
  });

  it("tees the monitor's ONE subscription: every list to both readers, no second subscribe", () => {
    let subscriptions = 0;
    let deliver: ((devices: readonly DeviceInfo[]) => void) | null = null;
    const observed: Array<readonly DeviceInfo[]> = [];
    const tee = teeDevicesPort(
      {
        subscribe: (listener) => {
          subscriptions += 1;
          deliver = listener;
          return () => {
            deliver = null;
          };
        },
      },
      (devices) => observed.push(devices),
    );
    const delivered: Array<readonly DeviceInfo[]> = [];
    const dispose = tee.subscribe((devices) => delivered.push(devices));
    const list = [device()];
    (deliver as ((devices: readonly DeviceInfo[]) => void) | null)?.(list);
    expect(delivered).toEqual([list]);
    expect(observed).toEqual([list]);
    expect(subscriptions).toBe(1);
    dispose();
    expect(deliver).toBeNull();
  });
});

describe("the face itself (the shipping view, no controller)", () => {
  it("is a status region: the state, the plane's words, the next step", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RemotePaneStateView face={describeRemoteRefusal(refusal("no-road", true), "studio")} />,
      );
    });
    const face = host.querySelector(".vf-godview-remote-state");
    expect(face?.getAttribute("role")).toBe("status");
    expect(face?.getAttribute("data-remote-state")).toBe("no-road");
    expect(host.querySelector(".vf-godview-remote-state-message")?.textContent).toBe(
      "no road to studio yet",
    );
    expect(host.querySelector(".vf-godview-remote-state-detail small")?.textContent).toBe(
      "asks again when studio's status changes",
    );
    await act(async () => root.unmount());
    host.remove();
  });
});
