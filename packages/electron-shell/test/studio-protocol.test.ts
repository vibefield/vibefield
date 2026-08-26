import { describe, expect, it } from "vitest";
import {
  MAX_APPEARANCE_BYTES,
  parseHostToProduct,
  parseProductToHost,
  parseStudioToHost,
  StudioProtocolError,
  serializedAppearanceBytes,
} from "../src/studio/protocol";

describe("Studio protocol", () => {
  it("accepts only the closed v1 message shapes", () => {
    expect(parseStudioToHost({ type: "studio.ready", protocol: 2 })).toEqual({
      type: "studio.ready",
      protocol: 2,
    });
    expect(parseStudioToHost({ type: "product.focus", requestId: "focus-1" })).toEqual({
      type: "product.focus",
      requestId: "focus-1",
    });
    expect(
      parseProductToHost({
        type: "appearance.rejected",
        revision: 4,
        code: "invalid-document",
        instanceId: "p-1",
      }),
    ).toEqual({
      type: "appearance.rejected",
      revision: 4,
      code: "invalid-document",
      instanceId: "p-1",
    });
    expect(
      parseHostToProduct({ type: "appearance.clear", revision: 5, reason: "studio-closed" }),
    ).toEqual({ type: "appearance.clear", revision: 5, reason: "studio-closed" });

    expect(() => parseStudioToHost({ type: "publish-anything", value: {} })).toThrow(
      StudioProtocolError,
    );
    expect(() =>
      parseProductToHost({ type: "product.ready", protocol: 1, instanceId: "p-1" }),
    ).toThrowError(/version-mismatch/);
  });

  it("enforces the 64 KiB bound in UTF-8 bytes", () => {
    const within = "a".repeat(MAX_APPEARANCE_BYTES);
    expect(serializedAppearanceBytes(within)).toBe(MAX_APPEARANCE_BYTES);
    expect(
      parseStudioToHost({ type: "appearance.publish", requestId: "r-1", serialized: within }),
    ).toMatchObject({ type: "appearance.publish", requestId: "r-1" });

    const oversized = `${"a".repeat(MAX_APPEARANCE_BYTES - 1)}🙂`;
    expect(serializedAppearanceBytes(oversized)).toBeGreaterThan(MAX_APPEARANCE_BYTES);
    expect(() =>
      parseStudioToHost({
        type: "appearance.publish",
        requestId: "r-2",
        serialized: oversized,
      }),
    ).toThrowError(/oversized/);
  });

  it("bounds product context and Studio lifecycle messages", () => {
    expect(parseProductToHost({ type: "product.context", theme: "dark", zoom: 1.25 })).toEqual({
      type: "product.context",
      theme: "dark",
      zoom: 1.25,
    });
    expect(() =>
      parseProductToHost({ type: "product.context", theme: "sepia", zoom: 1 }),
    ).toThrowError(/malformed/);
    expect(() =>
      parseProductToHost({ type: "product.context", theme: "light", zoom: Number.NaN }),
    ).toThrowError(/malformed/);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid revision: %s",
    (revision) => {
      expect(() =>
        parseProductToHost({ type: "appearance.applied", revision, instanceId: "p-1" }),
      ).toThrowError(/malformed/);
    },
  );
});
