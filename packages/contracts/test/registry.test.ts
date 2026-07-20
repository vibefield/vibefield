import { describe, expect, it } from "vitest";
import { METHODS, LOCALITIES, SURFACES } from "../src/methods";
import { SCOPES } from "../src/registries";
import { PORTS } from "../src/registries";

describe("method registry lint (design-01 §9.2 + D36)", () => {
  it("every method is fully declared", () => {
    for (const m of METHODS) {
      expect(SURFACES).toContain(m.surface);
      expect(LOCALITIES, `${m.method} missing locality`).toContain(m.locality);
      if (m.scope !== null) expect(SCOPES).toContain(m.scope);
      expect(m.method).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
      expect(typeof m.idempotent).toBe("boolean");
    }
  });
  it("method names are unique", () => {
    const names = METHODS.map((m) => m.method);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("port registry", () => {
  it("no port is assigned twice", () => {
    const values = Object.values(PORTS);
    expect(new Set(values).size).toBe(values.length);
  });
});
