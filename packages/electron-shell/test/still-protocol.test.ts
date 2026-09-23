import { describe, expect, it, vi } from "vitest";

// The still scheme (SNAP-3) — pure resolution driven with hostile URLs, then
// the serve path with injected filesystem seams. `electron` is stubbed the
// way app-protocol.test.ts stubs it: `installStillProtocol` must register
// exactly one handler for exactly this scheme.
const stub = { handlers: new Map<string, (request: { url: string }) => Response>() };
vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: () => {},
    handle: (scheme: string, handler: (request: { url: string }) => Response) => {
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

describe("serveStillRequest — the disk's part", () => {
  const stream = (): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        controller.close();
      },
    });

  it("serves a retained still as image/png, no-store, embeddable by the app origin", async () => {
    const refusals: string[] = [];
    const response = serveStillRequest(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      // The directory chain may resolve elsewhere (macOS: /var → /private/var);
      // the final component must resolve to itself.
      realpath: (path) => path.replace(hostPath("/var/"), hostPath("/private/var/")),
      openStream: stream,
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

  it("answers 404 for a name it does not retain, and says why to evidence", () => {
    const refusals: [string, string][] = [];
    const url = `${STILL_ORIGIN}/vibefield-still-0009.png`;
    const response = serveStillRequest(url, {
      retained: () => RETAINED,
      realpath: (path) => path,
      openStream: stream,
      onRefusal: (reason, requestUrl) => refusals.push([reason, requestUrl]),
    });
    expect(response.status).toBe(404);
    expect(refusals).toEqual([["not-retained", url]]);
  });

  it("answers 404 when the ring unlinked the still under us", () => {
    const refusals: string[] = [];
    const response = serveStillRequest(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      realpath: () => {
        throw new Error("ENOENT");
      },
      openStream: stream,
      onRefusal: (reason) => refusals.push(reason),
    });
    expect(response.status).toBe(404);
    expect(refusals).toEqual(["missing-file"]);
  });

  it("answers 404 when the final component now resolves elsewhere (a planted symlink)", () => {
    const refusals: string[] = [];
    const response = serveStillRequest(`${STILL_ORIGIN}/vibefield-still-0001.png`, {
      retained: () => RETAINED,
      realpath: (path) => (path.endsWith(".png") ? hostPath("/Users/j/.ssh/id_ed25519") : path),
      openStream: stream,
      onRefusal: (reason) => refusals.push(reason),
    });
    expect(response.status).toBe(404);
    expect(refusals).toEqual(["not-a-file"]);
  });

  it("reads the retained list at request time — the ring moves", () => {
    const retained: string[] = [];
    const options = { retained: () => retained, realpath: (p: string) => p, openStream: stream };
    const url = `${STILL_ORIGIN}/vibefield-still-0001.png`;
    expect(serveStillRequest(url, options).status).toBe(404);
    retained.push(RETAINED[0] as string);
    expect(serveStillRequest(url, options).status).toBe(200);
    retained.length = 0;
    expect(serveStillRequest(url, options).status).toBe(404);
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

  it("installs one handler for exactly this scheme", () => {
    installStillProtocol({ retained: () => [] });
    expect([...stub.handlers.keys()]).toEqual([STILL_SCHEME]);
    const handler = stub.handlers.get(STILL_SCHEME);
    expect(handler?.({ url: `${STILL_ORIGIN}/nothing.png` }).status).toBe(404);
  });
});
