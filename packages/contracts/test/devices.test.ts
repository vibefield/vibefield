import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEVICE_LIMITS,
  DEVICE_REFUSALS,
  DeviceInfo,
  DeviceRemovedDetails,
  DeviceRemoveParams,
  DeviceRemoveResult,
  DeviceSlice,
  KnownPhone,
  RefusedDevice,
} from "../src/devices";
import { ErrorData, RPC_ERROR_CODES } from "../src/errors";
import { PORTS } from "../src/registries";
import { appVersionOfBuildId, commitOfBuildId } from "../src/release-identity";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

// UA-P-0e (D2) — the roster row has TWO honest shapes now, and the difference
// between them is the whole of what the ruling changed.
//
// A roster row used to BE a published slice fused with liveness: `DeviceInfo`
// extended `DeviceSlice`, so every field a peer published was a field the row
// required. James ruled the store scoped to the login identity, truffle cannot
// do that, and so nothing content-bearing rides the bus — which means a peer
// publishes nothing and a peer row is built from the tailnet's own facts.

describe("DeviceInfo — the two shapes of a roster row (UA-P-0e)", () => {
  const selfRow = {
    deviceId: "dev-self",
    name: "James MacBook Pro",
    platform: "darwin",
    headless: false,
    fielddVersion: "0.1.0",
    contractsVersion: "0.1.0",
    capabilities: { terminalHost: true, terminalMesh: true, docHost: true, push: false },
    productEndpoint: { serve: "product", url: "https://mac.tail1234.ts.net:9423" },
    bootId: "fieldd-a1b2c3d4e5f60718",
    publishedAt: 1_757_894_400_000,
    self: true,
    online: true,
    lastSeenAt: 1_757_894_400_000,
  };

  it("SELF still carries everything — it is this process, and nothing crosses a wire", () => {
    const parsed = DeviceInfo.parse(selfRow);
    expect(parsed.capabilities?.terminalMesh).toBe(true);
    expect(parsed.bootId).toBe("fieldd-a1b2c3d4e5f60718");
    // and the self shape is still a valid slice, which is what UA-P-4 will
    // publish again once a store can be scoped to a login
    expect(DeviceSlice.safeParse(selfRow).success).toBe(true);
  });

  it("a PEER row carries identity, liveness and a locator — and says nothing else", () => {
    const peer = DeviceInfo.parse({
      deviceId: "01JAMESPEERULID0000000000",
      name: "studio",
      productEndpoint: {
        serve: "product",
        url: `https://studio.tail1234.ts.net:${PORTS.FIELDD_PRODUCT_SERVE}`,
      },
      self: false,
      online: true,
      lastSeenAt: 1_757_894_400_000,
      tailscaleId: "nQRJl4CNTRL",
      tailnetDnsName: "studio.tail1234.ts.net",
    });
    // the facts the tailnet's own control plane supplies
    expect(peer.tailscaleId).toBe("nQRJl4CNTRL");
    expect(peer.tailnetDnsName).toBe("studio.tail1234.ts.net");
    expect(peer.productEndpoint?.url).toContain(String(PORTS.FIELDD_PRODUCT_SERVE));
    // UA-P-0d — a locator carries no key; the route secret is the sidecar's
    // target path and never leaves the desktop that minted it
    expect(peer.productEndpoint?.url).not.toContain("/t/");
    // the honest absences: claims a device makes about ITSELF, which it has not
    // made through a door that checked who it is
    expect(peer.platform).toBeUndefined();
    expect(peer.capabilities).toBeUndefined();
    expect(peer.fielddVersion).toBeUndefined();
    expect(peer.bootId).toBeUndefined();
    expect(peer.publishedAt).toBeUndefined();
  });

  it("identity and liveness are NOT optional — a row that cannot say who or whether is not a row", () => {
    for (const drop of ["deviceId", "name", "self", "online", "lastSeenAt"] as const) {
      const { [drop]: _gone, ...rest } = selfRow;
      expect(DeviceInfo.safeParse(rest).success, `${drop} must be required`).toBe(false);
    }
  });

  it("DeviceSlice itself is unchanged — a published slice still promises everything", () => {
    // the slice is what UA-P-4 brings back, and relaxing IT would have been a
    // different (and wrong) change: a peer that publishes must publish fully
    for (const drop of ["platform", "capabilities", "bootId", "publishedAt"] as const) {
      const { [drop]: _gone, ...rest } = selfRow;
      expect(DeviceSlice.safeParse(rest).success, `${drop} is required on a slice`).toBe(false);
    }
  });
});

// AU-3a (AU-D13 A; LC-20) — a desktop says which VibeField it runs. `fielddVersion`
// is the daemon package's own literal and never moves between builds, so the
// app's version rides beside it: optional (an older peer does not say it) and
// tolerant (a malformed one drops ALONE — a slice that fails `DeviceSlice` is
// dropped at intake, and the device's capabilities with it).
describe("AU-3a — the app version on the slice and the row", () => {
  const CUR = "0.1.0-nightly.20261027";

  it("parses the app version a slice and its row say", () => {
    expect(DeviceSlice.parse(golden("device-slice.app-version.json")).appVersion).toBe(CUR);
    expect(DeviceInfo.parse(golden("device-info.app-version.json")).appVersion).toBe(CUR);
  });

  it("reads an older peer's slice, and its row, as saying none", () => {
    expect(DeviceSlice.parse(golden("device-slice.valid.json")).appVersion).toBeUndefined();
    expect(DeviceInfo.parse(golden("device-info.valid.json")).appVersion).toBeUndefined();
  });

  it("drops a malformed app version ALONE, never the slice or the row", () => {
    const slice = golden("device-slice.app-version.json");
    const row = golden("device-info.app-version.json");
    const tooLong = "9".repeat(DEVICE_LIMITS.VERSION_CHARS + 1);
    for (const appVersion of [7, "", tooLong, null, { version: CUR }]) {
      const parsedSlice = DeviceSlice.safeParse({ ...slice, appVersion });
      expect(parsedSlice.success, JSON.stringify(appVersion)).toBe(true);
      expect(parsedSlice.data?.appVersion).toBeUndefined();
      // the claims beside it survive: this is what a refused slice would have lost
      expect(parsedSlice.data?.capabilities.docHost).toBe(true);
      const parsedRow = DeviceInfo.safeParse({ ...row, appVersion });
      expect(parsedRow.success, JSON.stringify(appVersion)).toBe(true);
      expect(parsedRow.data?.appVersion).toBeUndefined();
    }
    // the bound is the other versions' own
    const longest = "9".repeat(DEVICE_LIMITS.VERSION_CHARS);
    expect(DeviceSlice.parse({ ...slice, appVersion: longest }).appVersion).toBe(longest);
  });
});

describe("AU-3a — appVersionOfBuildId: the version a build id carries", () => {
  it("reads the app version from WP12 D10's `<appVersion>+<commit7>`", () => {
    expect(appVersionOfBuildId("0.1.0-nightly.20261027+84509d6")).toBe("0.1.0-nightly.20261027");
    expect(appVersionOfBuildId("0.2.0-beta.3+84509d6a1")).toBe("0.2.0-beta.3");
    expect(appVersionOfBuildId("0.2.0+84509d6")).toBe("0.2.0");
  });

  it("says none for any other shape: a dev build, a short commit, no id at all", () => {
    const others = [
      "dev-daemon-current",
      // the dev runner's own shape (`tooling/dev-runner/src/build-id.mjs`)
      "dev-4f3a91c07b2e5d68a1c40b93",
      "0.1.0+84509d",
      "0.1.0+ZZZZZZZ",
      "0.1.0",
      "",
      null,
      undefined,
    ];
    for (const id of others) expect(appVersionOfBuildId(id), String(id)).toBeUndefined();
  });
});

describe("AU-4 — commitOfBuildId: the commit About names beside the version", () => {
  it("reads the commit from WP12 D10's `<appVersion>+<commit7>`, as the stager recorded it", () => {
    expect(commitOfBuildId("0.1.0-nightly.20261027+84509d6")).toBe("84509d6");
    expect(commitOfBuildId("0.2.0-beta.3+84509d6a1")).toBe("84509d6a1");
    expect(commitOfBuildId("0.2.0+84509d6")).toBe("84509d6");
  });

  it("says none for a shape that names no release build", () => {
    const others = ["dev-4f3a91c07b2e5d68a1c40b93", "0.1.0+84509d", "0.1.0", "", null, undefined];
    for (const id of others) expect(commitOfBuildId(id), String(id)).toBeUndefined();
  });
});

// Item 406 (track WI's Desktop slice; WI-W5b A; VF-PM's rulings 2026-11-14 04:49Z) — Remove for a
// phone, contracts first. The act names one roster device; the refusal is an entry of the settings
// document's grow-only `devices.refused` (Q-PM1); the account's known phones keep the positive
// fact Remove is offered on (Q-PM2); a refused phone's hello is answered UNAUTHORIZED with typed
// details (Q-PM5). fieldd's halves (the writer, the predicate, the door, the sweep) are S2 and S3.
describe("406 — Remove for a phone: the act, the refusal, the known phones, the word", () => {
  const phoneId = "01JAMESPHONEULID0000000000";
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `n${i}CNTRL`);

  it("device.remove names one roster device by its durable id, bounded, and nothing else", () => {
    expect(DeviceRemoveParams.parse(golden("device-remove-params.valid.json"))).toEqual({
      deviceId: phoneId,
    });
    expect(DeviceRemoveParams.safeParse({}).success).toBe(false);
    expect(DeviceRemoveParams.safeParse({ deviceId: "" }).success).toBe(false);
    expect(DeviceRemoveParams.safeParse({ deviceId: 7 }).success).toBe(false);
    const longest = "d".repeat(DEVICE_LIMITS.DEVICE_ID_CHARS);
    expect(DeviceRemoveParams.parse({ deviceId: longest }).deviceId).toBe(longest);
    expect(DeviceRemoveParams.safeParse({ deviceId: `${longest}d` }).success).toBe(false);
  });

  it("answers whether this call wrote the refusal, and how many connections this desktop closed", () => {
    expect(DeviceRemoveResult.parse(golden("device-remove-result.valid.json"))).toEqual({
      removed: true,
      closed: 3,
    });
    // a second Remove: the refusal already stood, so nothing new is written (declarative)
    expect(DeviceRemoveResult.parse({ removed: false, closed: 0 }).removed).toBe(false);
    for (const closed of [-1, 1.5, "2"])
      expect(DeviceRemoveResult.safeParse({ removed: true, closed }).success).toBe(false);
    expect(DeviceRemoveResult.safeParse({ closed: 0 }).success).toBe(false);
  });

  it("a refusal holds the phone's node ids, when, and which desktop: the golden names no phone", () => {
    const entry = RefusedDevice.parse(golden("refused-device.valid.json"));
    expect(entry.tailscaleIds).toEqual(["nPHONE1CNTRL"]);
    expect(entry.by).toBe("01JAMESMACULID000000000000");
    expect(Object.keys(entry).sort()).toEqual(["by", "removedAt", "tailscaleIds"]);
    // the durable id alone refuses: an entry written before any node id was seen still parses
    expect(RefusedDevice.parse({ ...entry, tailscaleIds: [] }).tailscaleIds).toEqual([]);
    const most = ids(DEVICE_LIMITS.NODE_IDS_PER_ENTRY);
    expect(RefusedDevice.parse({ ...entry, tailscaleIds: most }).tailscaleIds).toEqual(most);
    const past = ids(DEVICE_LIMITS.NODE_IDS_PER_ENTRY + 1);
    expect(RefusedDevice.safeParse({ ...entry, tailscaleIds: past }).success).toBe(false);
    const longNode = "n".repeat(DEVICE_LIMITS.NODE_ID_CHARS + 1);
    for (const bad of [[""], [longNode], [7]])
      expect(RefusedDevice.safeParse({ ...entry, tailscaleIds: bad }).success).toBe(false);
    expect(RefusedDevice.safeParse({ ...entry, by: "" }).success).toBe(false);
    expect(RefusedDevice.safeParse({ ...entry, removedAt: -1 }).success).toBe(false);
    expect(RefusedDevice.safeParse({ ...entry, removedAt: 1.5 }).success).toBe(false);
  });

  it("a known phone holds its node ids and the positive fact, and its name only as its row needs it", () => {
    const known = KnownPhone.parse(golden("known-phone.valid.json"));
    expect(known.tailscaleIds).toEqual(["nPHONE1CNTRL"]);
    expect(known.phone).toEqual({ via: "freeway", at: 1_794_600_000_000 });
    expect(known.name).toBe("iPhone");
    const { name: _name, ...nameless } = known;
    expect(KnownPhone.parse(nameless).name).toBeUndefined();
    // a phone speaks through a node, so a known one has at least one id
    expect(KnownPhone.safeParse({ ...known, tailscaleIds: [] }).success).toBe(false);
    const past = ids(DEVICE_LIMITS.NODE_IDS_PER_ENTRY + 1);
    expect(KnownPhone.safeParse({ ...known, tailscaleIds: past }).success).toBe(false);
    // the fact is what makes it a known PHONE: without it, or with a word this build does not
    // know, the record is not one (a reader errs toward offering no Remove)
    const { phone: _phone, ...factless } = known;
    expect(KnownPhone.safeParse(factless).success).toBe(false);
    for (const phone of [{ via: "slice", at: 1 }, { via: "freeway" }, { via: "product", at: -1 }])
      expect(KnownPhone.safeParse({ ...known, phone }).success, JSON.stringify(phone)).toBe(false);
    const longName = "x".repeat(DEVICE_LIMITS.NAME_CHARS + 1);
    for (const name of ["", longName])
      expect(KnownPhone.safeParse({ ...known, name }).success).toBe(false);
  });

  it("the row carries the positive phone fact, additive: absent says nothing; a bad one drops ALONE", () => {
    const row = golden("device-info.phone.json");
    expect(DeviceInfo.parse(row).phone).toEqual({ via: "product", at: 1_794_600_000_000 });
    // every row before 406, and every desktop's, says nothing — which is not "a desktop" either
    for (const name of ["device-info.valid.json", "device-info.self-peer.json"])
      expect(DeviceInfo.parse(golden(name)).phone, name).toBeUndefined();
    // never a truthy guess: a malformed fact drops alone and the row survives, so no reader
    // offers Remove on a word it cannot read
    const bad = [true, false, "yes", 1, null, {}, { via: "slice", at: 1 }, { via: "freeway" }];
    for (const phone of bad) {
      const parsed = DeviceInfo.safeParse({ ...row, phone });
      expect(parsed.success, JSON.stringify(phone)).toBe(true);
      expect(parsed.data?.phone, JSON.stringify(phone)).toBeUndefined();
      expect(parsed.data?.name).toBe(row["name"]);
    }
  });

  it("the door's word to a removed phone: UNAUTHORIZED, not retryable, {reason: device-removed}", () => {
    const data = ErrorData.parse(golden("error-data.device-removed.json"));
    expect(data.kind).toBe("UNAUTHORIZED");
    expect(RPC_ERROR_CODES[data.kind]).toBe(-32001);
    // asking again changes nothing: the refusal is never lifted
    expect(data.retryable).toBe(false);
    expect(DEVICE_REFUSALS.REASON_REMOVED).toBe("device-removed");
    expect(DeviceRemovedDetails.parse(data.details)).toEqual({
      reason: DEVICE_REFUSALS.REASON_REMOVED,
    });
    // the word is the reason itself: a bare UNAUTHORIZED (a bad token) says nothing of a removal
    for (const details of [undefined, {}, { reason: "invalid-token" }])
      expect(DeviceRemovedDetails.safeParse(details).success, JSON.stringify(details)).toBe(false);
  });
});
