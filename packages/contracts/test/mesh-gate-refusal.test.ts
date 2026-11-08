// NR S0 (items 237's root, 238 and 262; `draft/thinking-native-replay-rearm.md` §4) — the node gate's answer to a
// mesh SUBSCRIBE, the one refusal fieldd's owners of a native subscription re-arm on. The event that hands it to an
// owner is in-process (NativeLink to its owner, inside one fieldd) and owes no schema. The shape the owner reads is
// this one: ErrorData's UNAVAILABLE, retryable, with MeshNotUpDetails naming the `mesh-gateway` unit. A desktop's
// fresh pair start meets it every time (8 of 8 starts read on 2026-11-08), so it is held here and, for the floor's
// half, in field-native's `tests/mesh_bridge.rs` (its answer to `native.mesh.store.subscribe` and
// `native.mesh.peers.subscribe` with no node) and `tests/fixture_parity.rs`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ErrorData, RPC_ERROR_CODES } from "../src/errors";
import { MeshNotUpDetails } from "../src/mgmt";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("NR S0 — the node gate's answer to a mesh subscribe", () => {
  it("is UNAVAILABLE on -32006, retryable: a state that ends, never a verdict", () => {
    const refusal = ErrorData.parse(fixture("error-data.mesh-not-up.json"));
    expect(refusal).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(RPC_ERROR_CODES[refusal.kind]).toBe(-32006);
  });

  it("names the mesh unit in MeshNotUpDetails: how an owner tells it from another refusal", () => {
    const refusal = ErrorData.parse(fixture("error-data.mesh-not-up.json"));
    const details = MeshNotUpDetails.parse(refusal.details);
    expect(details.service).toBe("mesh-gateway");
    expect(details.state).toBe("starting");
  });
});
