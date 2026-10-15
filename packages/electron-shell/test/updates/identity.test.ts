import { describe, expect, it } from "vitest";
import { readUpdateIdentity, UPDATE_ORIGIN_OVERRIDE_ENV } from "../../src/main/updates/identity";

// WP12b (D9, EDP-30) — the origin is the frozen identity's; a fixture origin is honored ONLY on a dev-keyed build.

const KEYS = [
  "MCowBQYDK2VwAyEAkSkaxKWbbOoYqEfdhbaWChcEarYvgwOGUq21jcoRhTo=",
  "MCowBQYDK2VwAyEAIexJRbX1Ow+IkYPVTDdg0dUo2VJNbh+qLrpHlfoqbFY=",
];
const identity = (keyClass: "release" | "dev") =>
  JSON.stringify({
    schemaVersion: 1,
    keyClass,
    identityRevision: 6,
    trustRootKeys: KEYS,
    appId: "com.jamesyong.vibefield",
    productName: "VibeField",
    updateChannel: "beta",
    updateOrigin: "https://github.com/vibefield/vibefield/releases",
  });
const resources = {
  packaged: true,
  identity: { identityPath: "/id.json", trustRootPath: "/tr.json" },
};

describe("readUpdateIdentity (D9)", () => {
  it("reads the frozen origin, the build's channel and the embedded root keys", () => {
    const read = readUpdateIdentity(resources, {}, () => identity("release"));
    expect(read).toEqual({
      origin: "https://github.com/vibefield/vibefield/releases",
      channel: "beta",
      rootKeys: KEYS,
      keyClass: "release",
      originOverridden: false,
      floors: {
        trustRoot: null,
        channels: null,
        policy: { nightly: null, beta: null, stable: null },
      },
    });
  });

  it("ignores the fixture origin on a release-keyed build", () => {
    const read = readUpdateIdentity(
      resources,
      { [UPDATE_ORIGIN_OVERRIDE_ENV]: "http://127.0.0.1:9/fixture/releases" },
      () => identity("release"),
    );
    expect(read?.origin).toBe("https://github.com/vibefield/vibefield/releases");
    expect(read?.originOverridden).toBe(false);
  });

  it("honors the fixture origin on a dev-keyed build", () => {
    const read = readUpdateIdentity(
      resources,
      { [UPDATE_ORIGIN_OVERRIDE_ENV]: "http://127.0.0.1:9/fixture/releases" },
      () => identity("dev"),
    );
    expect(read?.origin).toBe("http://127.0.0.1:9/fixture/releases");
    expect(read?.originOverridden).toBe(true);
  });

  it("reads the build-time floor, and none from a stage cut before WP12", () => {
    const floored = JSON.stringify({
      ...JSON.parse(identity("release")),
      updateFloors: {
        trustRoot: 3,
        channels: null,
        policy: { nightly: 2, beta: null, stable: null },
      },
    });
    expect(readUpdateIdentity(resources, {}, () => floored)?.floors).toEqual({
      trustRoot: 3,
      channels: null,
      policy: { nightly: 2, beta: null, stable: null },
    });
    expect(readUpdateIdentity(resources, {}, () => identity("release"))?.floors).toEqual({
      trustRoot: null,
      channels: null,
      policy: { nightly: null, beta: null, stable: null },
    });
  });

  it("has no updater in the development layout, or without a readable identity", () => {
    expect(
      readUpdateIdentity({ packaged: false, identity: null }, {}, () => identity("dev")),
    ).toBeNull();
    expect(readUpdateIdentity(resources, {}, () => null)).toBeNull();
    expect(readUpdateIdentity(resources, {}, () => "{ broken")).toBeNull();
  });
});
