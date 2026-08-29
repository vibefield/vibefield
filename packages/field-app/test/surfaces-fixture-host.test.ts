// @vitest-environment happy-dom

// DT-2b-2 — the catalog's fixture host, headless.
//
// The fixture's whole claim is that the catalog mounts the SHIPPING view over a
// REAL transport and a REAL pool, inventing only the source. That claim is
// checkable without a browser: the handshake, the mint, the attach, the demand
// the pool actually put on the wire, the refusal path, and the teardown all run
// here. What does NOT run is frame production — `VideoFrame` and
// `OffscreenCanvas` are WebCodecs, which happy-dom has not got, so
// `fixtureSurfacesSupported()` is false and the producer never starts. The
// pixels are the one half only a real browser can witness, and the section
// renders its honest unavailable face here for exactly that reason.

import { describe, expect, it } from "vitest";
import {
  createFixtureSurfaceHost,
  fixtureSurfacesSupported,
} from "../src/surfaces/fixture/fixture-surface-host";
import type { SurfaceHandle, SurfaceHandleStatus } from "../src/surfaces/pool";

const DEMAND = { mode: "live", targetFps: 15, priority: 50, interactive: false } as const;

/** Let the attach round trip finish. It is all microtasks and one in-memory
 * port hop, so a few macrotask turns is generous rather than a race. */
async function settle(
  handle: SurfaceHandle<never> | { readonly status: SurfaceHandleStatus },
  until: SurfaceHandleStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 20 && handle.status !== until; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("the catalog's fixture surface host", () => {
  it("attaches through the real transport and records the pool's wire demand", async () => {
    const host = createFixtureSurfaceHost();
    const handle = host.pool.acquire("catalog:live-surface", {
      tickets: host.tickets,
      initialDemand: DEMAND,
    });

    expect(handle.status).toBe("attaching");
    await settle(handle, "live");
    expect(handle.status).toBe("live");

    // The demand on the wire is the POOL's fold at the pool's revision — the
    // holder never names one (surfaces/pool/demand.ts).
    expect(host.demands.length).toBeGreaterThan(0);
    const demand = host.demands[0];
    expect(demand?.mode).toBe("live");
    expect(demand?.targetFps).toBe(15);
    expect(demand?.revision).toBe(0);

    // A second holder shares the ONE attachment: no second mint, no second
    // producer. (The pool's own suite proves the mechanism; this proves the
    // fixture is wired into it rather than around it.)
    const second = host.pool.acquire("catalog:live-surface", {
      tickets: host.tickets,
      initialDemand: DEMAND,
    });
    await settle(second, "live");
    expect(host.pool.snapshot().mints).toBe(1);
    expect(host.pool.snapshot().entries[0]?.holders).toBe(2);

    handle.release();
    second.release();
    host.dispose();
  });

  it("refuses the attach when the fixture host is set to withhold the grant", async () => {
    const host = createFixtureSurfaceHost({ grant: false });
    const handle = host.pool.acquire("catalog:live-surface", {
      tickets: host.tickets,
      initialDemand: DEMAND,
    });

    await settle(handle, "lost");
    expect(handle.status).toBe("lost");
    // The refusal is the HOST's own words, carried honestly to the face.
    expect(handle.error?.message).toContain("permission-denied");
    expect(handle.error?.message).toContain("the fixture host refuses this source");

    // And `retry()` is live: it mints again against the same refusing host.
    handle.retry();
    await settle(handle, "lost");
    expect(handle.status).toBe("lost");
    expect(host.pool.snapshot().mints).toBe(2);

    handle.release();
    host.dispose();
  });

  it("tears everything down on dispose", async () => {
    const host = createFixtureSurfaceHost();
    const handle = host.pool.acquire("catalog:live-surface", {
      tickets: host.tickets,
      initialDemand: DEMAND,
    });
    await settle(handle, "live");

    host.dispose();

    expect(host.pool.disposed).toBe(true);
    // Disposing the pool releases every holder — a section unmounting cannot
    // leave a claim behind.
    expect(handle.status).toBe("released");
    // Idempotent: the catalog's cleanup runs release() and dispose() both.
    expect(() => host.dispose()).not.toThrow();
  });

  it("declares WebCodecs honestly rather than pretending", () => {
    // happy-dom has no VideoFrame, so the catalog shows its unavailable face
    // here — the same answer a browser without WebCodecs would get.
    expect(fixtureSurfacesSupported()).toBe(typeof VideoFrame !== "undefined");
  });
});
