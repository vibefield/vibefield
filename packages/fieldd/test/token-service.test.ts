import { describe, expect, it } from "vitest";
import { TokenService } from "../src/token-service";

describe("TokenService", () => {
  it("mints, verifies, revokes", () => {
    const svc = new TokenService();
    const grant = svc.mint(["canvas.read", "terminal.attach"], "test-window");
    expect(grant.token).toMatch(/^tok_[0-9a-f]{48}$/);

    const verified = svc.verify(grant.token);
    expect(verified?.scopes).toEqual(["canvas.read", "terminal.attach"]);
    expect(verified?.tokenId).toBe(grant.tokenId);

    expect(svc.revoke(grant.tokenId)).toBe(true);
    expect(svc.verify(grant.token)).toBeNull();
    expect(svc.revoke(grant.tokenId)).toBe(false);
  });

  it("rejects unknown scopes at mint (registry is the law)", () => {
    const svc = new TokenService();
    expect(() => svc.mint(["not.a.scope" as never], "x")).toThrow(/unknown scope/);
  });

  it("rejects garbage tokens", () => {
    const svc = new TokenService();
    expect(svc.verify("tok_deadbeef")).toBeNull();
  });
});
