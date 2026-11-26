import { describe, expect, it } from "vitest";
import {
  type BrowserSurfacePopups,
  installGuardedBrowserSurfaceContents,
} from "../src/main/live-surfaces/browser-security";

// EY-1 (1f, 2026-11-19): a page's pop-up never gets a window of its own (measured: a pop-up's own
// window does not paint), so Electron is always answered deny. Under its run's policy a pop-up is
// the run's or nothing: an allowed one's address is handed to the run, which opens it as a new pane,
// and a refused one is dropped. With no policy it keeps today's answer: its address told, so the
// pane goes there itself if the address allows it.

type OpenHandler = (details: { url: string }) => { action: "deny" };

/** A page's contents as the guards see them, keeping the window-open handler they install. */
function page(popups: () => BrowserSurfacePopups | null = () => null) {
  const told: [string, string | undefined][] = [];
  const belt = { refused: 0 };
  const hooks: { open: OpenHandler | null } = { open: null };
  const contents = {
    on: () => contents,
    setWindowOpenHandler: (handler: OpenHandler) => {
      hooks.open = handler;
    },
  };
  installGuardedBrowserSurfaceContents(
    contents,
    (what, url) => told.push([what, url]),
    popups,
    () => {
      belt.refused += 1;
    },
  );
  const open = (url: string) => {
    if (hooks.open === null) throw new Error("no window-open handler installed");
    return hooks.open({ url });
  };
  return { open, told, belt };
}

/** A run's policy that answers `verdict`, keeping what it was asked and handed, in order. */
function policy(verdict: "allow" | "deny") {
  const calls: string[] = [];
  const popups: BrowserSurfacePopups = {
    decide: (url) => {
      calls.push(`decide ${url}`);
      return verdict;
    },
    open: (url) => {
      calls.push(`open ${url}`);
    },
  };
  return { popups, calls };
}

const SIGNIN = "https://example.test/signin";
const DENY = { action: "deny" };

describe("a page's pop-ups (EY-1 1f)", () => {
  it("with no policy, a pop-up opens no window and its address is told, as today", () => {
    const { open, told } = page();
    expect(open(SIGNIN)).toEqual(DENY);
    expect(told).toEqual([["popup", SIGNIN]]);
  });

  it("under a policy that allows, opens no window: the run is handed the address once, after it decided, and nothing is told", () => {
    const run = policy("allow");
    const { open, told, belt } = page(() => run.popups);
    expect(open(SIGNIN)).toEqual(DENY);
    expect(run.calls).toEqual([`decide ${SIGNIN}`, `open ${SIGNIN}`]);
    expect(told).toEqual([]);
    expect(belt.refused).toBe(0);
  });

  it("under a policy that denies, drops the pop-up: nothing handed to the run, nothing told", () => {
    const run = policy("deny");
    const { open, told } = page(() => run.popups);
    expect(open(SIGNIN)).toEqual(DENY);
    expect(run.calls).toEqual([`decide ${SIGNIN}`]);
    expect(told).toEqual([]);
  });

  it("puts the address rule between the policy's allow and the run's pane: a refused address is never handed on, and the belt says it", () => {
    const run = policy("allow");
    const { open, told, belt } = page(() => run.popups);
    const refused = ["file:///etc/hosts", "javascript:alert(1)", "data:text/html,x", "vbscript:x"];
    for (const url of refused) expect(open(url), url).toEqual(DENY);
    // the policy is still asked of each, so its run can count what it refused
    expect(run.calls).toEqual(refused.map((url) => `decide ${url}`));
    expect(belt.refused).toBe(refused.length);
    expect(told).toEqual([]);
  });

  it("asks the policy that stands at each pop-up: one set or cleared later is the one asked", () => {
    const run = policy("allow");
    let current: BrowserSurfacePopups | null = null;
    const { open, told } = page(() => current);
    expect(open("https://example.test/one")).toEqual(DENY);
    current = run.popups;
    expect(open("https://example.test/two")).toEqual(DENY);
    current = null;
    expect(open("https://example.test/three")).toEqual(DENY);
    expect(run.calls).toEqual(["decide https://example.test/two", "open https://example.test/two"]);
    expect(told.map(([, url]) => url)).toEqual([
      "https://example.test/one",
      "https://example.test/three",
    ]);
  });
});
