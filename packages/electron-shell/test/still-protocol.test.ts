import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STILL_BYTES_CAP } from "../src/main/screenshot-still-bytes";

// The still scheme (SNAP-3) — pure resolution driven with hostile URLs, then
// the serve path with injected filesystem seams. `electron` is stubbed the
// way app-protocol.test.ts stubs it: `installStillProtocol` must register
// exactly one handler for exactly this scheme.
type Handler = (request: { url: string }) => Response | Promise<Response>;
const stub = { handlers: new Map<string, Handler>() };
vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: () => {},
    handle: (scheme: string, handler: Handler) => {
      stub.handlers.set(scheme, handler);
    },
  },
}));

const {
  STILL_ORIGIN,
  STILL_SCHEME,
  STILL_SCHEME_PRIVILEGES,
  installStillProtocol,
  resolveStill,
  resolveStillFile,
  serveStillRequest,
  stillUrl,
} = await import("../src/main/still-protocol");

const hostPath = (posix: string): string =>
  process.platform === "win32" ? `C:${posix.replaceAll("/", "\\")}` : posix;

const RETAINED = [
  hostPath("/var/folders/ab/T/vibefield-still-0001.png"),
  hostPath("/var/folders/ab/T/vibefield-still-0002.png"),
];

describe("resolveStill — the request names a still by its basename", () => {
  it("answers the retained path that carries the name", () => {
    expect(resolveStill(`${STILL_ORIGIN}/vibefield-still-0002.png`, RETAINED)).toEqual({
      ok: true,
      path: RETAINED[1],
      name: "vibefield-still-0002.png",
    });
  });

  it("is what `stillUrl` spells, round-tripped, under either slash convention", () => {
    for (const path of [RETAINED[0] as string, "C:\\Users\\j\\AppData\\Local\\Temp\\shot 1.png"]) {
      const resolved = resolveStill(stillUrl(path), [path]);
      expect(resolved).toEqual({ ok: true, path, name: path.split(/[\\/]/).at(-1) });
    }
  });

  it("refuses a name the tool does not retain — including one it no longer does", () => {
    expect(resolveStill(`${STILL_ORIGIN}/vibefield-still-0003.png`, RETAINED)).toEqual({
      ok: false,
      reason: "not-retained",
    });
    expect(resolveStill(`${STILL_ORIGIN}/vibefield-still-0001.png`, [])).toEqual({
      ok: false,
      reason: "not-retained",
    });
  });

  it.each([
    ["another scheme", `vibefield-app://stills/vibefield-still-0001.png`],
    ["another host", `${STILL_SCHEME}://disk/vibefield-still-0001.png`],
    ["a query", `${STILL_ORIGIN}/vibefield-still-0001.png?x=1`],
    ["no name", `${STILL_ORIGIN}/`],
    ["a second segment", `${STILL_ORIGIN}/vibefield-still-0001.png/more`],
    ["a traversal", `${STILL_ORIGIN}/..%2Fvibefield-still-0001.png`],
    ["an encoded backslash", `${STILL_ORIGIN}/..%5Cvibefield-still-0001.png`],
    ["a dot name", `${STILL_ORIGIN}/..`],
    ["a NUL", `${STILL_ORIGIN}/vibefield-still-0001.png%00`],
    ["not a PNG", `${STILL_ORIGIN}/id_ed25519`],
    ["a bad percent-escape", `${STILL_ORIGIN}/%E0%A4%A.png`],
    ["not a URL", "vibefield-still-0001.png"],
  ])("refuses %s as a bad url, never consulting the list", (_label, url) => {
    const retained = { find: vi.fn() } as unknown as readonly string[];
    expect(resolveStill(url, retained)).toEqual({ ok: false, reason: "bad-url" });
    expect((retained as unknown as { find: ReturnType<typeof vi.fn> }).find).not.toHaveBeenCalled();
  });
});

describe("serveStillRequest — the answer, over a seam", () => {
  const stream = (): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        controller.close();
      },
    });
  const opened = async () => ({ ok: true as const, stream: stream() });

  it("serves a retained still as image/png, no-store, embeddable by the app origin", async () => {
    const refusals: string[] = [];
    const response = await serveStillRequest(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      openStill: opened,
      onRefusal: (reason) => refusals.push(reason),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(refusals).toEqual([]);
  });

  it("answers 404 for a name it does not retain, opens nothing, and says why to evidence", async () => {
    const refusals: [string, string][] = [];
    const openStill = vi.fn(opened);
    const url = `${STILL_ORIGIN}/vibefield-still-0009.png`;
    const response = await serveStillRequest(url, {
      retained: () => RETAINED,
      openStill,
      onRefusal: (reason, requestUrl) => refusals.push([reason, requestUrl]),
    });
    expect(response.status).toBe(404);
    expect(openStill).not.toHaveBeenCalled();
    expect(refusals).toEqual([["not-retained", url]]);
  });

  it("answers 404 with the opener's reason when the still does not open to a still", async () => {
    const refusals: string[] = [];
    const response = await serveStillRequest(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      openStill: async () => ({ ok: false, reason: "missing-file" }),
      onRefusal: (reason) => refusals.push(reason),
    });
    expect(response.status).toBe(404);
    expect(refusals).toEqual(["missing-file"]);
  });

  it("reads the retained list at request time — the ring moves", async () => {
    const retained: string[] = [];
    const options = { retained: () => retained, openStill: opened };
    const url = `${STILL_ORIGIN}/vibefield-still-0001.png`;
    expect((await serveStillRequest(url, options)).status).toBe(404);
    retained.push(RETAINED[0] as string);
    expect((await serveStillRequest(url, options)).status).toBe(200);
    retained.length = 0;
    expect((await serveStillRequest(url, options)).status).toBe(404);
  });
});

// LC-17 (1): the scheme is the third reader of the retained stills, and it goes through B1's one
// opener (screenshot-still-bytes.ts `openStill`): what is OPENED is judged (its handle fstat'ed, a
// regular file within the cap) and streamed, never a path checked and then opened again. Real
// files: the directory, the FIFO and the file past the cap answered 200 when the scheme
// realpath-checked a path and then streamed it by name; the planted symlink and the plain still
// hold what the realpath check already held.
describe("serveStillRequest — the still judged by the handle it opened (LC-17)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const roots: string[] = [];
  const posix = process.platform !== "win32";

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A retained still on the real disk, and a request for it. */
  function still(): { path: string; url: string; serve: () => Promise<[number, string[]]> } {
    const root = mkdtempSync(join(tmpdir(), "vf-still-scheme-"));
    roots.push(root);
    const path = join(root, "vibefield-still-0001.png");
    writeFileSync(path, PNG);
    const url = `${STILL_ORIGIN}/vibefield-still-0001.png`;
    const serve = async (): Promise<[number, string[]]> => {
      const refusals: string[] = [];
      const response = await serveStillRequest(url, {
        retained: () => [path],
        onRefusal: (reason) => refusals.push(reason),
      });
      return [response.status, refusals];
    };
    return { path, url, serve };
  }

  it("streams a retained still's bytes, whole", async () => {
    const s = still();
    const response = await serveStillRequest(s.url, { retained: () => [s.path] });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("refuses a symlink planted at the still's path — even to a file it could read", async () => {
    const s = still();
    const decoy = join(s.path, "..", "decoy.png");
    writeFileSync(decoy, PNG);
    rmSync(s.path);
    symlinkSync(decoy, s.path);
    expect(await s.serve()).toEqual([404, ["not-a-file"]]);
  });

  it("refuses a directory at the still's path", async () => {
    const s = still();
    rmSync(s.path);
    mkdirSync(s.path);
    expect(await s.serve()).toEqual([404, ["not-a-file"]]);
  });

  it.skipIf(!posix)(
    "refuses a FIFO at the still's path at once, never waiting on a writer",
    async () => {
      const s = still();
      rmSync(s.path);
      execFileSync("mkfifo", [s.path]);
      expect(await s.serve()).toEqual([404, ["not-a-file"]]);
    },
  );

  it("refuses a file past the still's cap, never streaming it", async () => {
    const s = still();
    truncateSync(s.path, STILL_BYTES_CAP + 1);
    expect(await s.serve()).toEqual([404, ["too-large"]]);
  });

  it("answers 404 when the ring unlinked the still under us", async () => {
    const s = still();
    rmSync(s.path);
    expect(await s.serve()).toEqual([404, ["missing-file"]]);
  });
});

// Quick Look (SNAP-3b) still resolves a path, since it opens by path itself: the realpath check.
describe("resolveStillFile — the path Quick Look is handed", () => {
  it("refuses a still gone from the disk", () => {
    const resolved = resolveStillFile(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      realpath: () => {
        throw new Error("ENOENT");
      },
    });
    expect(resolved).toEqual({ ok: false, reason: "missing-file" });
  });

  it("refuses when the final component now resolves elsewhere (a planted symlink)", () => {
    const resolved = resolveStillFile(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      realpath: (path) => (path.endsWith(".png") ? hostPath("/Users/j/.ssh/id_ed25519") : path),
    });
    expect(resolved).toEqual({ ok: false, reason: "not-a-file" });
  });
});

describe("the scheme's registration", () => {
  it("declares standard and secure, streams, and grants nothing else", () => {
    expect(STILL_SCHEME_PRIVILEGES.standard).toBe(true);
    expect(STILL_SCHEME_PRIVILEGES.secure).toBe(true);
    expect(STILL_SCHEME_PRIVILEGES.stream).toBe(true);
    // A tile is an <img>; a page that could fetch() a still could read its bytes into script.
    expect(STILL_SCHEME_PRIVILEGES.supportFetchAPI).toBe(false);
    expect(STILL_SCHEME_PRIVILEGES.codeCache).toBe(false);
    expect(STILL_SCHEME_PRIVILEGES.corsEnabled).toBe(false);
    expect(STILL_SCHEME_PRIVILEGES.bypassCSP).toBe(false);
    expect(STILL_SCHEME_PRIVILEGES.allowServiceWorkers).toBe(false);
    expect(STILL_SCHEME_PRIVILEGES.allowExtensions).toBe(false);
  });

  it("installs one handler for exactly this scheme", async () => {
    installStillProtocol({ retained: () => [] });
    expect([...stub.handlers.keys()]).toEqual([STILL_SCHEME]);
    const handler = stub.handlers.get(STILL_SCHEME);
    expect((await handler?.({ url: `${STILL_ORIGIN}/nothing.png` }))?.status).toBe(404);
  });
});
