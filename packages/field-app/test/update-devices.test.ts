import type { DeviceInfo } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { updateDeviceRows } from "../src/panels/update-devices";

// AU-3 (AU-D13 A; LC-20, LC-21) — Settings → Updates' "Your devices", the pure half: the account's desktops and the
// VibeField each runs, read from the roster's `appVersion`. Older and newer only within one channel; a version that
// keeps a desktop from connecting says which side updates, by contracts major (unreachable today: one major, so the
// fixtures drive it); a phone is not a desktop.

const CURRENT = "0.1.0-nightly.20261028";

const desktop = (over: Partial<DeviceInfo> & { deviceId: string }): DeviceInfo => ({
  name: over.deviceId,
  platform: "darwin",
  contractsVersion: "1.0.0",
  capabilities: { terminalHost: true, docHost: true, push: false },
  self: false,
  online: true,
  lastSeenAt: 1,
  ...over,
});

const rowOf = (rows: ReturnType<typeof updateDeviceRows>, id: string) =>
  rows.find((row) => row.id === id);

describe("Your devices — each desktop and the VibeField it runs", () => {
  it("says this Mac, then each desktop by name, in friendly words with the exact version kept", () => {
    const rows = updateDeviceRows(
      [
        desktop({ deviceId: "studio", appVersion: CURRENT }),
        desktop({ deviceId: "mbp", self: true, appVersion: "0.1.0-nightly.20261027" }),
        desktop({ deviceId: "air", appVersion: CURRENT }),
      ],
      CURRENT,
    );
    expect(rows.map((row) => row.id)).toEqual(["mbp", "air", "studio"]);
    // this Mac's version is the updater's, not its row's (the row may trail a restart)
    expect(rows[0]).toMatchObject({
      self: true,
      version: CURRENT,
      versionName: "The Oct 28 nightly",
      relation: "This Mac",
      os: "macos",
    });
    expect(rowOf(rows, "air")?.relation).toBe("Same as this Mac");
  });

  it("orders versions as main does — 0.10.0 is newer than 0.9.0, never by the string", () => {
    const rows = updateDeviceRows(
      [
        desktop({ deviceId: "self", self: true }),
        desktop({ deviceId: "behind", appVersion: "0.9.0" }),
        desktop({ deviceId: "ahead", appVersion: "0.11.0" }),
      ],
      "0.10.0",
    );
    expect(rowOf(rows, "behind")?.relation).toBe("Older than this Mac");
    expect(rowOf(rows, "ahead")?.relation).toBe("Newer than this Mac");
    expect(rowOf(rows, "behind")?.versionName).toBe("VibeField 0.9.0");
  });

  it("says no older or newer across channels: the name stands alone (LC-20)", () => {
    const rows = updateDeviceRows(
      [
        desktop({ deviceId: "self", self: true }),
        desktop({ deviceId: "beta", appVersion: "0.1.0-beta.2" }),
        desktop({ deviceId: "stable", appVersion: "0.1.0" }),
      ],
      CURRENT,
    );
    expect(rowOf(rows, "beta")).toMatchObject({
      versionName: "VibeField 0.1.0 beta 2",
      relation: null,
    });
    expect(rowOf(rows, "stable")?.relation).toBeNull();
  });

  it("says a desktop that doesn't share its version so", () => {
    const rows = updateDeviceRows(
      [desktop({ deviceId: "self", self: true }), desktop({ deviceId: "old-build" })],
      CURRENT,
    );
    expect(rowOf(rows, "old-build")).toMatchObject({
      version: null,
      versionName: null,
      relation: "Version not shared",
    });
  });

  it("says which side updates when a version keeps a desktop from connecting (LC-21)", () => {
    const rows = updateDeviceRows(
      [
        desktop({ deviceId: "self", self: true, contractsVersion: "2.0.0" }),
        desktop({ deviceId: "behind", contractsVersion: "1.4.0", state: "incompatible" }),
        desktop({ deviceId: "ahead", contractsVersion: "3.0.0", link: "incompatible" }),
        desktop({ deviceId: "unsaid", contractsVersion: undefined, state: "incompatible" }),
      ],
      CURRENT,
    );
    expect(rowOf(rows, "behind")).toMatchObject({
      relation: "Update VibeField there to connect",
      tone: "attention",
    });
    expect(rowOf(rows, "ahead")).toMatchObject({
      relation: "Update this Mac to connect",
      tone: "attention",
    });
    expect(rowOf(rows, "unsaid")).toMatchObject({
      relation: "Can't connect: another version",
      tone: "attention",
    });
    expect(rowOf(rows, "self")?.tone).toBeUndefined();
  });

  it("leaves out what is not a desktop — a phone publishes no doc host", () => {
    const rows = updateDeviceRows(
      [
        desktop({ deviceId: "self", self: true, appVersion: CURRENT }),
        desktop({
          deviceId: "phone",
          platform: "ios",
          capabilities: { terminalHost: false, docHost: false, push: true },
        }),
        desktop({ deviceId: "box", platform: "linux", appVersion: CURRENT }),
      ],
      undefined,
    );
    expect(rows.map((row) => row.id)).toEqual(["self", "box"]);
    // with no updater (a development build), this Mac's own row says its version
    expect(rows[0]?.version).toBe(CURRENT);
    expect(rows[1]).toMatchObject({ os: "linux", relation: "Same as this Mac" });
  });

  it("reads an unread roster as no desktops", () => {
    expect(updateDeviceRows(null, CURRENT)).toEqual([]);
  });
});
