import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rootAboveUserRoot, userRootFor } from "../src/users-file";

// AR-2 — the machine scope hangs off the VibeField root, and a fieldd handed
// only its USER root must find that root by the layout alone.
describe("rootAboveUserRoot", () => {
  it("inverts userRootFor", () => {
    const root = join(tmpdir(), "vf-root-above");
    expect(rootAboveUserRoot(userRootFor(root, { fuid: 1 }))).toBe(root);
    expect(rootAboveUserRoot(userRootFor(root, { fuid: 42 }))).toBe(root);
  });

  it("answers undefined for a root with no users/ above it — no machine scope, never a guess", () => {
    expect(rootAboveUserRoot(join(tmpdir(), "vf-embedded-daemon"))).toBeUndefined();
    expect(rootAboveUserRoot(join(tmpdir(), "users"))).toBeUndefined();
  });
});
