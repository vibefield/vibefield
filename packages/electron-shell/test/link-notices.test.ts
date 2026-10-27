import { emptySetupLedger } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  ARRIVAL_SETTLE_MS,
  CONNECTED_NOTICE,
  joinedNotice,
  LINK_NOTICE_QUIET_MS,
  type LinkNotice,
  LinkNotices,
  renewalNotice,
} from "../src/main/link-notices";

// TS-5 (TS-D9; TS-D18 = d) — the link's notices, decided in main: said once,
// outside the app, never in main's first minute or while VibeField is in front;
// what was said is retired in the setup ledger's moments.

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 27, 16, 0, 0);

function harness() {
  let now = T0;
  let focused = false;
  const said: LinkNotice[] = [];
  const retired: string[] = [];
  const notices = new LinkNotices({
    now: () => now,
    focused: () => focused,
    notify: (notice) => said.push(notice),
    retire: async (moment) => {
      retired.push(moment);
    },
  });
  return {
    notices,
    said,
    retired,
    advance: (ms: number) => {
      now += ms;
    },
    focus: (value: boolean) => {
      focused = value;
    },
    now: () => now,
  };
}

const ledger = (moments: Record<string, unknown> = {}) => ({ ...emptySetupLedger(), moments });
const status = (linkState: string, keyExpiresAt?: number | null) => ({
  linkState,
  ...(keyExpiresAt !== undefined ? { keyExpiresAt } : {}),
});
const device = (deviceId: string, name: string, self = false) => ({ deviceId, name, self });

describe("Connected (TS-5)", () => {
  it("says Connected when a sign-in this session started lands, with VibeField not in front", () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    h.notices.onLink(status("capturing"));
    h.notices.onLink(status("linked"));
    expect(h.said).toEqual([CONNECTED_NOTICE]);
  });

  it("says nothing for a link that was already there, in the first minute, or in front", () => {
    const cold = harness();
    cold.advance(LINK_NOTICE_QUIET_MS);
    cold.notices.onLink(status("linked")); // no capture seen: a launch, not a sign-in
    expect(cold.said).toEqual([]);

    const early = harness();
    early.notices.onLink(status("capturing"));
    early.notices.onLink(status("linked"));
    expect(early.said).toEqual([]);

    const front = harness();
    front.advance(LINK_NOTICE_QUIET_MS);
    front.focus(true);
    front.notices.onLink(status("awaiting_approval"));
    front.notices.onLink(status("linked"));
    expect(front.said).toEqual([]);
  });
});

describe("A device joined (TS-5)", () => {
  it("records the devices already here silently, and says a new one once", async () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    h.notices.onLedger(ledger());
    h.notices.onRoster([device("self", "Studio", true), device("air", "MacBook Air")]);
    expect(h.said).toEqual([]); // the session's first read: already here
    expect(h.retired).toEqual(["device-joined:air"]);

    h.notices.onRoster([
      device("self", "Studio", true),
      device("air", "MacBook Air"),
      device("pc", "Workshop PC"),
    ]);
    expect(h.said).toEqual([joinedNotice("Workshop PC")]);
    expect(h.retired).toEqual(["device-joined:air", "device-joined:pc"]);

    // the next delta repeats the roster: nothing is said twice
    h.notices.onRoster([device("air", "MacBook Air"), device("pc", "Workshop PC")]);
    expect(h.said).toHaveLength(1);
  });

  it("waits for the ledger, and says nothing the ledger already holds", () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    h.notices.onRoster([device("air", "MacBook Air")]);
    expect(h.retired).toEqual([]); // nothing decided before the ledger
    h.notices.onLedger(ledger({ "device-joined:air": { state: "retired", at: "2026-10-26" } }));
    expect(h.retired).toEqual([]);
    h.notices.onLedger(ledger({ "device-joined:air": { state: "retired", at: "2026-10-26" } }));
    h.notices.onRoster([device("air", "MacBook Air"), device("pc", "Workshop PC")]);
    expect(h.said).toEqual([joinedNotice("Workshop PC")]);
  });

  it("decides nothing against a ledger it cannot read", () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    h.notices.onLedger({ moments: {} }); // no format: not a ledger this build reads
    h.notices.onRoster([device("air", "MacBook Air")]);
    expect(h.retired).toEqual([]);
    h.notices.onLedger(ledger());
    expect(h.retired).toEqual(["device-joined:air"]);
    expect(h.said).toEqual([]);
  });

  it("records the account's devices arriving with the link without saying joined", () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    h.notices.onLedger(ledger());
    h.notices.onRoster([device("self", "Studio", true)]);
    h.notices.onLink(status("capturing"));
    h.notices.onLink(status("linked")); // Connected is said; the arrival settles
    h.advance(ARRIVAL_SETTLE_MS / 2);
    h.notices.onRoster([device("self", "Studio", true), device("air", "MacBook Air")]);
    expect(h.said).toEqual([CONNECTED_NOTICE]);
    expect(h.retired).toEqual(["device-joined:air"]);
  });
});

describe("Renewal (TS-5, TS-D9)", () => {
  it("says the renewal once per expiry date, within 3 days, out of the app", () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    const expires = h.now() + 2 * DAY + 3_600_000;
    h.notices.onLedger(ledger());
    h.notices.onLink(status("linked", expires));
    expect(h.said).toEqual([renewalNotice(3)]);
    const key = `renewal-notice:${new Date(expires).toISOString().slice(0, 10)}`;
    expect(h.retired).toEqual([key]);
    h.notices.tick();
    h.notices.onLink(status("linked", expires));
    expect(h.said).toHaveLength(1);
  });

  it("waits while VibeField is in front, and says it at the next look out of it", () => {
    const h = harness();
    h.advance(LINK_NOTICE_QUIET_MS);
    h.focus(true);
    h.notices.onLedger(ledger());
    h.notices.onLink(status("linked", h.now() + DAY));
    expect(h.said).toEqual([]);
    expect(h.retired).toEqual([]);
    h.focus(false);
    h.notices.tick();
    expect(h.said).toEqual([renewalNotice(1)]);
  });

  it("says nothing more than 3 days out, for a key that never expires, or one the ledger holds", () => {
    const far = harness();
    far.advance(LINK_NOTICE_QUIET_MS);
    far.notices.onLedger(ledger());
    far.notices.onLink(status("linked", far.now() + 5 * DAY));
    far.notices.onLink(status("linked", null));
    expect(far.said).toEqual([]);

    const held = harness();
    held.advance(LINK_NOTICE_QUIET_MS);
    const expires = held.now() + DAY;
    held.notices.onLedger(
      ledger({
        [`renewal-notice:${new Date(expires).toISOString().slice(0, 10)}`]: {
          state: "retired",
          at: "2026-10-27",
        },
      }),
    );
    held.notices.onLink(status("linked", expires));
    expect(held.said).toEqual([]);
  });
});
