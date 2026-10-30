import { CONNECT_ASK, emptySetupLedger } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { awayNotice, ConnectAsks, offersConnectFor, workingAgents } from "../src/main/connect-asks";
import { LINK_NOTICE_QUIET_MS } from "../src/main/link-notices";

// TS-4 (TS-D7, TS-L6) — after Not now, main offers the link again in two places:
// the status item's row while this Mac is not connected, and the away notice
// when the last window closes with agents running — once per 30 days, never two
// places in a day, only for someone who put Devices off, never once the switch
// is off. Each saying is written `asked` in the setup ledger.

const T0 = Date.UTC(2026, 10, 2, 16, 0, 0);

function harness() {
  let now = T0;
  const asked: string[] = [];
  const asks = new ConnectAsks({
    now: () => now,
    ask: async (moment) => {
      asked.push(moment);
    },
  });
  return {
    asks,
    asked,
    advance: (ms: number) => {
      now += ms;
    },
    iso: (ago: number) => new Date(now - ago).toISOString(),
  };
}

const putOff = (moments: Record<string, unknown> = {}) => ({
  ...emptySetupLedger(),
  steps: { devices: { state: "later", at: "2026-10-28T09:00:00.000Z" } },
  moments,
});
const preferences = (connectAsks: boolean) => ({
  showTray: true,
  backgroundShell: true,
  screenshotHotkey: true,
  syncPosture: "automatic",
  confirmQuit: true,
  connectAsks,
});

/** A session past its first minute, not connected, Devices put off, the switch on. */
function ready() {
  const h = harness();
  h.advance(LINK_NOTICE_QUIET_MS);
  h.asks.onLink({ linkState: "offline" });
  h.asks.onLedger(putOff());
  h.asks.onPreferences(preferences(true));
  return h;
}

describe("the status item's row (TS-4)", () => {
  it("is offered only in the ordinary unconnected state, and says when that changes", () => {
    const h = harness();
    const changes: boolean[] = [];
    h.asks.onChange(() => changes.push(h.asks.offersConnect()));
    expect(h.asks.offersConnect()).toBe(false);
    h.asks.onLink({ linkState: "offline" });
    h.asks.onLink({ linkState: "offline" });
    h.asks.onLink({ linkState: "capturing" });
    h.asks.onLink({ linkState: "awaiting_approval" });
    h.asks.onLink({ linkState: "linked" });
    expect(changes).toEqual([true, false]);
    // a refusal or a lapse says its own words in the app
    for (const state of ["expired", "removed", "login_unavailable", "logs_required"]) {
      h.asks.onLink({ linkState: state });
      expect(h.asks.offersConnect()).toBe(false);
    }
  });

  it("reads the unconnected state as the link face does: the record is the account", () => {
    const record = { login: "james@example.com" };
    // a word over no record reads as what it can prove: unlinked
    for (const linkState of ["linked", "expired", "removed"]) {
      expect(offersConnectFor({ linkState, link: null, authUrl: null })).toBe(true);
      expect(offersConnectFor({ linkState, link: record, authUrl: null })).toBe(false);
    }
    // a word this build does not know: no record and no capture is unconnected
    expect(offersConnectFor({ link: null, authUrl: null })).toBe(true);
    expect(offersConnectFor({ linkState: "paused", link: null, authUrl: null })).toBe(true);
    expect(offersConnectFor({ link: null, authUrl: "https://login.example/a/1" })).toBe(false);
    expect(offersConnectFor({ link: record, authUrl: null })).toBe(false);
    // never a guess over fields it cannot read
    expect(offersConnectFor({ linkState: "linked" })).toBe(false);
    expect(offersConnectFor({ linkState: "link_corrupt", link: null, authUrl: null })).toBe(false);
    expect(offersConnectFor(null)).toBe(false);
  });
});

describe("the away notice (TS-4)", () => {
  it("says it once when the window closes with agents working, and writes the saying", () => {
    const h = ready();
    expect(h.asks.away(2)).toEqual(awayNotice(2));
    expect(h.asked).toEqual(["connect-ask:away"]);
    // said: quiet for the rest of the month, before the ledger's echo arrives
    expect(h.asks.away(2)).toBeNull();
    expect(h.asked).toHaveLength(1);
  });

  it("says the agents in their number", () => {
    expect(awayNotice(1)).toEqual({
      title: "VibeField keeps running",
      body: "1 agent is still working. Connect your phone to check on them from there.",
    });
    expect(awayNotice(3).body).toBe(
      "3 agents are still working. Connect your phone to check on them from there.",
    );
  });

  it("says nothing with no agent working, in main's first minute, or before it can read", () => {
    expect(ready().asks.away(0)).toBeNull();
    const early = harness();
    early.asks.onLink({ linkState: "offline" });
    early.asks.onLedger(putOff());
    early.asks.onPreferences(preferences(true));
    expect(early.asks.away(2)).toBeNull();
    // never a guess: no ledger, no preferences
    const blind = harness();
    blind.advance(LINK_NOTICE_QUIET_MS);
    blind.asks.onLink({ linkState: "offline" });
    expect(blind.asks.away(2)).toBeNull();
    blind.asks.onLedger(putOff());
    expect(blind.asks.away(2)).toBeNull();
    expect(blind.asked).toEqual([]);
  });

  it("says nothing once connected or connecting, with the switch off, or to someone who never put Devices off", () => {
    const linked = ready();
    linked.asks.onLink({ linkState: "linked" });
    expect(linked.asks.away(2)).toBeNull();
    const off = ready();
    off.asks.onPreferences(preferences(false));
    expect(off.asks.away(2)).toBeNull();
    const never = ready();
    never.asks.onLedger(emptySetupLedger());
    expect(never.asks.away(2)).toBeNull();
    expect([...linked.asked, ...off.asked, ...never.asked]).toEqual([]);
  });

  it("keeps the ledger's month and day across restarts", () => {
    const month = ready();
    month.asks.onLedger(
      putOff({
        "connect-ask:away": { state: "asked", at: month.iso(CONNECT_ASK.PLACE_QUIET_MS - 1) },
      }),
    );
    expect(month.asks.away(2)).toBeNull();
    month.advance(1);
    expect(month.asks.away(2)).toEqual(awayNotice(2));
    // another place said today spends the day
    const day = ready();
    day.asks.onLedger(
      putOff({ "connect-ask:approval-wait": { state: "asked", at: day.iso(1_000) } }),
    );
    expect(day.asks.away(2)).toBeNull();
  });

  it("keeps the quiet in this session when the ledger refuses the write", async () => {
    let tries = 0;
    let now = T0;
    const asks = new ConnectAsks({
      now: () => now,
      ask: () => {
        tries += 1;
        return Promise.reject(new Error("PRECONDITION_FAILED"));
      },
    });
    now += LINK_NOTICE_QUIET_MS;
    asks.onLink({ linkState: "offline" });
    asks.onLedger(putOff());
    asks.onPreferences(preferences(true));
    expect(asks.away(1)).toEqual(awayNotice(1));
    await Promise.resolve();
    expect(asks.away(1)).toBeNull();
    expect(tries).toBe(1);
  });
});

describe("counting the agents still working", () => {
  it("counts the rows that say working, read tolerantly", () => {
    expect(
      workingAgents({
        sessions: [{ status: "working" }, { status: "idle" }, { status: "blocked" }, {}, null],
      }),
    ).toBe(1);
    expect(workingAgents({ sessions: "nope" })).toBe(0);
    expect(workingAgents(null)).toBe(0);
  });
});
