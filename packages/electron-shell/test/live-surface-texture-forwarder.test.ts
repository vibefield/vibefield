import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type LiveSurfaceProducerTextureFrame,
  LiveSurfaceTextureForwarder,
  type LiveSurfaceTextureTransferApi,
} from "../src/main/live-surfaces/texture-forwarder";

function metadata(sequence: string): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch: 1,
    sequence,
    geometry: {
      revision: 1,
      codedSize: { width: 64, height: 48 },
      visibleRect: { x: 0, y: 0, width: 64, height: 48 },
      logicalSize: { width: 64, height: 48 },
      orientation: 0,
    },
    hostReceivedAtUs: sequence,
    pixelFormat: "bgra",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport: "shared-texture",
  };
}

function producerFrame(sequence: string, override = {}) {
  const releaseSource = vi.fn();
  const allReferencesReleased = vi.fn();
  const frame: LiveSurfaceProducerTextureFrame = {
    metadata: { ...metadata(sequence), ...override },
    textureInfo: {
      codedSize: { width: 64, height: 48 },
      handle: {},
      pixelFormat: "bgra",
    },
    releaseSource,
    allReferencesReleased,
  };
  return { frame, releaseSource, allReferencesReleased };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function fakeApi() {
  const allReleased: Array<() => void> = [];
  const imported = Array.from({ length: 4 }, () => ({ release: vi.fn() }));
  const sends = Array.from({ length: 4 }, () => deferred<void>());
  let importIndex = 0;
  let sendIndex = 0;
  const api: LiveSurfaceTextureTransferApi = {
    importTexture: vi.fn((_textureInfo, callback) => {
      allReleased.push(callback);
      const result = imported[importIndex++];
      if (result === undefined) throw new Error("fixture import exhausted");
      return result;
    }),
    sendTexture: vi.fn(() => {
      const result = sends[sendIndex++];
      if (result === undefined) throw new Error("fixture send exhausted");
      return result.promise;
    }),
  };
  return { api, allReleased, imported, sends };
}

describe("LiveSurfaceTextureForwarder", () => {
  it("releases the source after import, main ref after send, and producer lease after all refs", async () => {
    const fake = fakeApi();
    const forwarder = new LiveSurfaceTextureForwarder(
      "surface_0123456789abcdef",
      "attachment_0123456789abcdef",
      fake.api,
    );
    const producer = producerFrame("1");
    const offered = forwarder.offer(producer.frame);
    expect(offered.kind).toBe("accepted");
    expect(producer.releaseSource).toHaveBeenCalledWith("imported");
    expect(producer.allReferencesReleased).not.toHaveBeenCalled();
    expect(forwarder.stats.outstanding).toBe(1);

    await Promise.resolve();
    fake.sends[0]?.resolve();
    if (offered.kind === "accepted") await offered.transfer;
    expect(fake.imported[0]?.release).toHaveBeenCalledTimes(1);
    expect(forwarder.stats.outstanding).toBe(1);
    fake.allReleased[0]?.();
    fake.allReleased[0]?.();
    await forwarder.whenDrained();
    expect(producer.allReferencesReleased).toHaveBeenCalledTimes(1);
    expect(producer.allReferencesReleased).toHaveBeenCalledWith("released");
    expect(forwarder.stats).toMatchObject({ outstanding: 0, completed: 1 });
  });

  it("caps outstanding references at two even after sends resolve", async () => {
    const fake = fakeApi();
    const forwarder = new LiveSurfaceTextureForwarder(
      "surface_0123456789abcdef",
      "attachment_0123456789abcdef",
      fake.api,
    );
    const first = producerFrame("1");
    const second = producerFrame("2");
    const third = producerFrame("3");
    const firstOffer = forwarder.offer(first.frame);
    const secondOffer = forwarder.offer(second.frame);
    await Promise.resolve();
    fake.sends[0]?.resolve();
    fake.sends[1]?.resolve();
    if (firstOffer.kind === "accepted") await firstOffer.transfer;
    if (secondOffer.kind === "accepted") await secondOffer.transfer;
    expect(forwarder.offer(third.frame)).toEqual({ kind: "dropped", reason: "transfer-cap" });
    expect(third.releaseSource).toHaveBeenCalledWith("transfer-cap");
    expect(third.allReferencesReleased).toHaveBeenCalledWith("transfer-cap");
    expect(forwarder.stats).toMatchObject({ accepted: 2, dropped: 1, outstanding: 2 });
    fake.allReleased[0]?.();
    fake.allReleased[1]?.();
    await forwarder.whenDrained();
  });

  it("releases the imported main ref after send rejection and waits for renderer refs", async () => {
    const fake = fakeApi();
    const forwarder = new LiveSurfaceTextureForwarder(
      "surface_0123456789abcdef",
      "attachment_0123456789abcdef",
      fake.api,
    );
    const producer = producerFrame("1");
    const offered = forwarder.offer(producer.frame);
    await Promise.resolve();
    fake.sends[0]?.reject(new Error("renderer gone"));
    if (offered.kind === "accepted")
      await expect(offered.transfer).rejects.toThrow(/renderer gone/);
    expect(fake.imported[0]?.release).toHaveBeenCalledTimes(1);
    expect(forwarder.stats).toMatchObject({ sendFailures: 1, outstanding: 1 });
    fake.allReleased[0]?.();
    await forwarder.whenDrained();
  });

  it("drops malformed/cross-surface frames and refuses new work after close", () => {
    const fake = fakeApi();
    const forwarder = new LiveSurfaceTextureForwarder(
      "surface_0123456789abcdef",
      "attachment_0123456789abcdef",
      fake.api,
    );
    const wrong = producerFrame("1", { surfaceId: "surface_9999999999999999" });
    expect(forwarder.offer(wrong.frame)).toEqual({
      kind: "dropped",
      reason: "protocol-violation",
    });
    forwarder.close();
    const closed = producerFrame("2");
    expect(forwarder.offer(closed.frame)).toEqual({ kind: "dropped", reason: "closed" });
    expect(fake.api.importTexture).not.toHaveBeenCalled();
    expect(forwarder.stats).toMatchObject({ offered: 2, accepted: 0, dropped: 2 });
  });
});
