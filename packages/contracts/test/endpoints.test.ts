import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CELL_INSTANCE_MAX,
  canonicalDataRootForScope,
  cellSocketFile,
  isPipeEndpoint,
  longestSocketFile,
  nativeRunDirFor,
  PIPE_SOCKET_NAMES,
  pipeEndpointFor,
  pipeScope,
  SUN_PATH_MAX_BYTES,
  socketAliasFor,
  socketPathBytes,
  unixAliasScope,
  unixEndpointFor,
  unixSocketDir,
  worstUnixEndpoint,
} from "../src/endpoints";
import { LAYOUT, SOCKETS } from "../src/registries";

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

// Item 345 — the unix arm (PLAN-345-r2). The same vector file pins the Rust twin (tests/endpoint_vector.rs).
describe("unix endpoint law (item 345)", () => {
  const { unixVectors } = JSON.parse(
    readFileSync(join(here, "..", "fixtures", "endpoint.vector.json"), "utf8"),
  ) as {
    unixVectors: {
      tag: string;
      uid: number;
      dataRoot: string;
      worstRealBytes: number;
      branch: "real" | "alias";
      scope: string;
      endpoints: Record<string, string>;
    }[];
  };

  it("pins edge103, edge104, macFits, devShape, mac24 and mac255", () => {
    expect(unixVectors.map((v) => v.tag)).toEqual([
      "macFits",
      "edge103",
      "edge104",
      "devShape",
      "mac24",
      "mac255",
    ]);
  });

  for (const vector of unixVectors) {
    it(`derives ${vector.tag} exactly (${vector.branch}, worst real ${vector.worstRealBytes} B)`, () => {
      const real = nativeRunDirFor(vector.dataRoot);
      expect(socketPathBytes(`${real}/${longestSocketFile()}`)).toBe(vector.worstRealBytes);
      expect(unixAliasScope(vector.dataRoot)).toBe(vector.scope);
      expect(unixSocketDir(vector.uid, vector.dataRoot)).toBe(
        vector.branch === "real" ? real : socketAliasFor(vector.uid, vector.dataRoot),
      );
      for (const [socketFile, endpoint] of Object.entries(vector.endpoints)) {
        expect(unixEndpointFor(vector.uid, vector.dataRoot, socketFile)).toBe(endpoint);
      }
      expect(socketPathBytes(worstUnixEndpoint(vector.uid, vector.dataRoot))).toBeLessThanOrEqual(
        SUN_PATH_MAX_BYTES,
      );
    });
  }

  it("takes the real path at exactly 103 bytes and the alias at 104", () => {
    const at = (tag: string) => unixVectors.find((v) => v.tag === tag);
    expect(at("edge103")?.worstRealBytes).toBe(103);
    expect(at("edge103")?.branch).toBe("real");
    expect(at("edge104")?.worstRealBytes).toBe(104);
    expect(at("edge104")?.branch).toBe("alias");
    // the law itself at the edge, not only the fixture's fields: the RED the note names for the 104 half
    expect(unixSocketDir(501, at("edge103")?.dataRoot ?? "")).toBe(
      nativeRunDirFor(at("edge103")?.dataRoot ?? ""),
    );
    expect(unixSocketDir(501, at("edge104")?.dataRoot ?? "")).toBe(
      socketAliasFor(501, at("edge104")?.dataRoot ?? ""),
    );
  });

  it("puts James's dev shape (.vibefield/dev, 112 B worst) through the alias — the daily wear is stated", () => {
    const dev = unixVectors.find((v) => v.tag === "devShape");
    expect(dev?.dataRoot.endsWith("/.vibefield/dev/data/users/1")).toBe(true);
    expect(dev?.worstRealBytes).toBe(112);
    expect(unixSocketDir(501, dev?.dataRoot ?? "")).toBe(socketAliasFor(501, dev?.dataRoot ?? ""));
  });

  it("never mixes: every socket of one root takes the same directory", () => {
    const files = Object.values(LAYOUT)
      .map((segments): unknown => segments[segments.length - 1])
      .filter((last): last is string => typeof last === "string" && last.endsWith(".sock"));
    for (const vector of unixVectors) {
      const dirs = new Set(
        [...files, longestSocketFile()].map((file) =>
          unixEndpointFor(vector.uid, vector.dataRoot, file).slice(0, -`/${file}`.length),
        ),
      );
      expect([...dirs]).toEqual([unixSocketDir(vector.uid, vector.dataRoot)]);
      // and that one directory is the branch's: the RED the note names for the alias roots
      expect([...dirs]).toEqual([
        vector.branch === "real"
          ? nativeRunDirFor(vector.dataRoot)
          : socketAliasFor(vector.uid, vector.dataRoot),
      ]);
    }
  });

  it("derives the longest file from the LAYOUT (never typed): termframe at the largest cell ordinal", () => {
    expect(CELL_INSTANCE_MAX).toBe(2 ** 32 - 1);
    expect(longestSocketFile()).toBe("termframe.4294967295.sock");
  });

  it("finds every LAYOUT socket row under the run dir the law joins", () => {
    for (const segments of Object.values(LAYOUT)) {
      const last = segments[segments.length - 1];
      if (typeof last !== "string" || !last.endsWith(".sock")) continue;
      expect(segments.slice(0, -1)).toEqual([...LAYOUT.NATIVE_RUN_DIR]);
    }
  });
});
