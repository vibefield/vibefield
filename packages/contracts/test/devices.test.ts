import { describe, expect, it } from "vitest";
import { DeviceInfo, DeviceSlice } from "../src/devices";
import { PORTS } from "../src/registries";

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
