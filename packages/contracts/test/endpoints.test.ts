import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalDataRootForScope,
  cellSocketFile,
  isPipeEndpoint,
  PIPE_SOCKET_NAMES,
  pipeEndpointFor,
  pipeScope,
} from "../src/endpoints";
import { SOCKETS } from "../src/registries";

const here = dirname(fileURLToPath(import.meta.url));

// WIN-D1 — the endpoint-resolution law is one derivation in two languages.
// The vector is the deliberate-change tripwire: a law change edits the fixture
// in the same commit, and the Rust twin (tests/endpoint_vector.rs) pins the
// hand-written side against the same file.
describe("endpoint resolution (golden vector)", () => {
  const fixture = JSON.parse(
    readFileSync(join(here, "..", "fixtures", "endpoint.vector.json"), "utf8"),
  ) as {
    vectors: {
      tag: string;
      dataRoot: string;
      scope: string;
      endpoints: Record<string, string>;
    }[];
  };

  for (const vector of fixture.vectors) {
    it(`derives ${vector.tag} exactly`, () => {
      expect(pipeScope(vector.dataRoot)).toBe(vector.scope);
      for (const [socketFile, endpoint] of Object.entries(vector.endpoints)) {
        expect(pipeEndpointFor(vector.dataRoot, socketFile)).toBe(endpoint);
        expect(isPipeEndpoint(endpoint)).toBe(true);
      }
    });
  }

  it("collapses spellings of one Windows directory to one scope", () => {
    const winA = fixture.vectors.find((v) => v.tag === "winA");
    const alt = fixture.vectors.find((v) => v.tag === "winA-alt");
    expect(winA && alt && winA.scope).toBe(alt?.scope);
    expect(canonicalDataRootForScope("C:\\A\\B\\")).toBe(canonicalDataRootForScope("c:/a/b"));
  });

  it("refuses a non-socket name — the law covers SOCKETS, nothing else", () => {
    expect(() => pipeEndpointFor("/data", "product.json")).toThrow(/\*\.sock/);
    expect(PIPE_SOCKET_NAMES).toEqual(Object.values(SOCKETS));
  });

  it("unix paths are not pipe endpoints", () => {
    expect(isPipeEndpoint("/data/native/run/mgmt.sock")).toBe(false);
  });

  it("derives a cell's per-instance name and refuses non-socket or zero ordinals (TC-S2)", () => {
    expect(cellSocketFile("termctl.sock", 2)).toBe("termctl.2.sock");
    expect(cellSocketFile("termframe.sock", 1)).toBe("termframe.1.sock");
    expect(() => cellSocketFile("termctl", 1)).toThrow(/SOCKETS name/);
    expect(() => cellSocketFile("termctl.sock", 0)).toThrow(/1-based/);
  });
});
