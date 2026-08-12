import { dirname, join, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The application scheme (electron-security-packaging.md §8.2). The resolver is
// pure, so the whole traversal suite runs against it directly — no disk, no
// browser, no packaged app. That is the point: every hostile URL a compromised
// renderer could form is cheap to ask here, and the answers are the evidence
// that `GrantFileProtocolExtraPrivileges` can close at F2 (§8.3).
//
// `electron` is mocked rather than launched, the house way (see
// security.test.ts); a real Electron harness is ESP §13.2's job.

const stub = vi.hoisted(() => ({
  privileged: [] as { scheme: string; privileges?: Record<string, boolean> }[],
  handlers: new Map<string, (request: { url: string }) => Response | Promise<Response>>(),
}));

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: (schemes: (typeof stub.privileged)[number][]) => {
      stub.privileged.push(...schemes);
    },
    handle: (scheme: string, handler: (request: { url: string }) => Response) => {
      stub.handlers.set(scheme, handler);
    },
  },
}));

const {
  APP_ENTRY_URL,
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  APP_SCHEME_PRIVILEGES,
  installAppProtocol,
  isStrictlyBeneath,
  mimeForPath,
  registerAppScheme,
  resolveAppAsset,
  serveAppRequest,
} = await import("../src/main/app-protocol");

/** A fixture path spelled for this host. The resolver answers with `resolve`d,
 * `sep`-separated paths, so on win32 a POSIX literal is missing both the volume
 * prefix (`/Applications/…` resolves onto whichever drive the suite runs from)
 * and the `\` separators — an expectation written in `/` would compare a mac
 * string against a Windows answer, and the `fakeFs` below would key its map on
 * paths the resolver never produces. The URLs stay POSIX: a URL path is `/`
 * everywhere, and that asymmetry is exactly what this resolver mediates. */
const hostPath = (posix: string): string =>
  process.platform === "win32" ? `C:${posix.replaceAll("/", "\\")}` : posix;

/** A packaged renderer root — the only directory this scheme may ever read. */
const ROOT = hostPath("/Applications/VibeField.app/Contents/Resources/app/renderer");

/** An admitted path, built with the same primitive the resolver uses. */
const under = (...segments: string[]): string => join(ROOT, ...segments);

/** What the resolver said, flattened for assertion. A refusal reports its class;
 * an admitted request reports the path, so a case that was MEANT to be refused
 * fails loudly with the file it would have served. */
function ask(url: string): string {
  const result = resolveAppAsset(ROOT, url);
  return result.ok ? result.path : result.reason;
}

const at = (path: string): string => ask(`${APP_ORIGIN}${path}`);
const mimeOf = (path: string): string => {
  const result = resolveAppAsset(ROOT, `${APP_ORIGIN}${path}`);
  return result.ok ? result.mime : `refused:${result.reason}`;
};

describe("scheme identity", () => {
  it("names one scheme and one host, and builds the entry URL from them", () => {
    // Every call site takes these constants instead of writing the URL out: a
    // typo in a hand-built origin is not a 404, it is a different origin, and
    // CSP 'self' would quietly stop describing the document.
    expect(APP_SCHEME).toBe("vibefield-app");
    expect(APP_HOST).toBe("shell");
    expect(APP_ORIGIN).toBe("vibefield-app://shell");
    expect(APP_ENTRY_URL).toBe("vibefield-app://shell/index.html");
  });

  it("resolves its own entry URL — the shell cannot load a URL the handler refuses", () => {
    expect(ask(APP_ENTRY_URL)).toBe(under("index.html"));
  });
});

describe("registerAppScheme", () => {
  registerAppScheme();
  const registered = stub.privileged.find((entry) => entry.scheme === APP_SCHEME);

  it("registers exactly one scheme", () => {
    expect(stub.privileged).toHaveLength(1);
    expect(registered).toBeDefined();
  });

  it("declares standard and secure — §8.2's two required privileges", () => {
    // Without `standard` the origin is opaque and Vite's module graph cannot
    // load at all; without `secure` Chromium treats our own assets as insecure
    // content and withholds the secure-context APIs the renderer uses.
    expect(APP_SCHEME_PRIVILEGES.standard).toBe(true);
    expect(APP_SCHEME_PRIVILEGES.secure).toBe(true);
  });

  it("supports fetch and streaming — the module Worker's load path", () => {
    expect(APP_SCHEME_PRIVILEGES.supportFetchAPI).toBe(true);
    expect(APP_SCHEME_PRIVILEGES.stream).toBe(true);
  });

  it("grants no CORS, no CSP bypass, no service workers, no extensions", () => {
    // The privilege list is the widest thing about a custom scheme, so the
    // refusals are asserted rather than left implicit: each of these would hand
    // out a capability §8.2 declines — a cross-origin reader, an exemption from
    // the production CSP, or state that outlives the document.
    expect(APP_SCHEME_PRIVILEGES.corsEnabled).toBe(false);
    expect(APP_SCHEME_PRIVILEGES.bypassCSP).toBe(false);
    expect(APP_SCHEME_PRIVILEGES.allowServiceWorkers).toBe(false);
    expect(APP_SCHEME_PRIVILEGES.allowExtensions).toBe(false);
  });

  it("passes those privileges to Electron, not a different set", () => {
    expect(registered?.privileges).toEqual({ ...APP_SCHEME_PRIVILEGES });
  });
});

describe("resolveAppAsset — what the renderer legitimately asks for", () => {
  it("serves the entry document", () => {
    expect(at("/index.html")).toBe(under("index.html"));
    expect(mimeOf("/index.html")).toBe("text/html; charset=utf-8");
  });

  it("serves a hashed asset chunk", () => {
    expect(at("/assets/main-CXh9HwVS.js")).toBe(under("assets", "main-CXh9HwVS.js"));
    expect(mimeOf("/assets/main-CXh9HwVS.js")).toBe("text/javascript; charset=utf-8");
  });

  it("serves the doc-thumbnail worker chunk as script", () => {
    // The Worker is constructed from `new URL(..., import.meta.url)`, so it
    // arrives as an ordinary same-origin asset request — and Chromium refuses to
    // start a worker whose script is not a JavaScript MIME type.
    expect(at("/assets/doc-thumbnail-worker-7oAO7Sth.js")).toBe(
      under("assets", "doc-thumbnail-worker-7oAO7Sth.js"),
    );
    expect(mimeOf("/assets/doc-thumbnail-worker-7oAO7Sth.js")).toBe(
      "text/javascript; charset=utf-8",
    );
  });

  it("serves the rest of the built bundle with explicit types", () => {
    expect(mimeOf("/assets/main-Crg0cr6k.css")).toBe("text/css; charset=utf-8");
    expect(mimeOf("/assets/inter-latin.woff2")).toBe("font/woff2");
    expect(mimeOf("/assets/glyph.svg")).toBe("image/svg+xml");
    expect(mimeOf("/assets/loro_wasm_bg.wasm")).toBe("application/wasm");
    expect(mimeOf("/assets/main-CXh9HwVS.js.map")).toBe("application/json; charset=utf-8");
  });

  it("maps the bare origin and / to the index, like any static server", () => {
    expect(ask(APP_ORIGIN)).toBe(under("index.html"));
    expect(at("/")).toBe(under("index.html"));
  });

  it("maps a trailing-slash directory to that directory's index", () => {
    expect(at("/assets/")).toBe(under("assets", "index.html"));
  });

  it("ignores the query and fragment — they name nothing on disk", () => {
    expect(at("/assets/main-CXh9HwVS.js?v=1#top")).toBe(under("assets", "main-CXh9HwVS.js"));
  });

  it("accepts the host in any case, exactly as Chromium normalizes it", () => {
    // Chromium lower-cases the host of a registered standard scheme before the
    // handler sees it. The resolver must agree: being stricter here would refuse
    // a request the browser already considers same-origin.
    expect(ask("VIBEFIELD-APP://SHELL/index.html")).toBe(under("index.html"));
  });

  it("resolves a dot segment away rather than refusing it", () => {
    // `/./index.html` is what the URL parser already normalized; there is no
    // traversal in it and nothing to report.
    expect(at("/./index.html")).toBe(under("index.html"));
  });
});

describe("resolveAppAsset — the origin boundary", () => {
  it("refuses a URL it cannot parse", () => {
    expect(ask("not a url at all")).toBe("malformed-url");
    expect(ask("")).toBe("malformed-url");
  });

  it("refuses another scheme, including one that merely starts like ours", () => {
    // `vibefield-app-evil:` shares our prefix. A `startsWith` scheme check would
    // admit it; the comparison is against the exact `scheme:` token.
    expect(ask("file:///etc/passwd")).toBe("unsupported-scheme");
    expect(ask("http://shell/index.html")).toBe("unsupported-scheme");
    expect(ask("vibefield-app-evil://shell/index.html")).toBe("unsupported-scheme");
  });

  it("refuses an unknown host — a second host would be a second origin", () => {
    expect(ask("vibefield-app://plugin/index.html")).toBe("unknown-host");
    expect(ask("vibefield-app://shell.evil/index.html")).toBe("unknown-host");
  });

  it("refuses a port, which makes a different authority", () => {
    expect(ask("vibefield-app://shell:8080/index.html")).toBe("unknown-host");
  });

  it("refuses a URL with no authority at all", () => {
    // `vibefield-app:index.html` has an opaque path and no host; treating its
    // path as ours would serve assets to a URL with no origin.
    expect(ask("vibefield-app:index.html")).toBe("unknown-host");
  });

  it("refuses embedded credentials — a host-spoofing shape, never an asset", () => {
    expect(ask("vibefield-app://user:pass@shell/index.html")).toBe("credentials-in-url");
  });
});

describe("resolveAppAsset — traversal", () => {
  it("refuses a plain dot-dot instead of silently serving the clamped path", () => {
    // Both the URL parser and Chromium resolve `/../secret` to `/secret` before
    // the handler sees it, so this can never reach outside the root — but our
    // renderer resolves every URL before it asks, so a `..` that survives to the
    // wire did not come from our renderer. It is reported, not quietly served.
    expect(at("/../secret")).toBe("path-traversal");
    expect(at("/assets/../../secret")).toBe("path-traversal");
  });

  it("refuses encoded dot-dot in either case", () => {
    expect(at("/%2e%2e/secret")).toBe("path-traversal");
    expect(at("/%2E%2E/secret")).toBe("path-traversal");
  });

  it("refuses a dot-dot smuggled past normalization by an encoded separator", () => {
    // The classic bypass: `..%2f..%2f` is ONE segment to the URL parser, so its
    // dot-segment removal leaves it intact, and only a decode reveals the climb.
    expect(at("/..%2f..%2fetc/passwd")).toBe("path-traversal");
  });

  it("refuses the wrapper form that defeats an exact-match dot-dot check", () => {
    // `....//` survives a naive "is the segment exactly `..`?" test and becomes
    // `../` once a single collapsing pass runs over it.
    expect(at("/....//secret")).toBe("path-traversal");
  });

  it("refuses double encoding, the vector that a second decode would complete", () => {
    // `%252e%252e` is the literal text `%2e%2e` after ONE decode. Nothing here
    // decodes twice, so it simply stops — and it stops as its own class, so the
    // evidence names what actually arrived.
    expect(at("/%252e%252e/secret")).toBe("double-encoded");
    expect(at("/%25%32%65")).toBe("double-encoded");
  });

  it("refuses a NUL byte, which truncates a path below the JavaScript layer", () => {
    // `index.html%00.png` looks like an image to an extension check and opens
    // `index.html` to anything that hands the string to a C API.
    expect(at("/index.html%00.png")).toBe("nul-byte");
  });

  it("refuses control characters, including the newline that forges log lines", () => {
    expect(at("/main%0a.js")).toBe("control-character");
    expect(at("/%7f")).toBe("control-character");
  });

  it("refuses backslashes — the separator a POSIX-shaped check does not see", () => {
    // On Windows `\` separates paths, so code reasoning in `/` alone reads
    // `assets\..\..\` as one innocent filename.
    expect(at("/assets%5cmain.js")).toBe("backslash");
  });

  it("refuses a UNC path written with backslashes — a remote host, not our root", () => {
    expect(at("/%5c%5cserver%5cshare")).toBe("backslash");
  });

  it("refuses a UNC path written with slashes", () => {
    expect(at("//server/share")).toBe("unc-path");
  });

  it("refuses an absolute path smuggled through an encoded separator", () => {
    // `%2F` decodes to a real separator. This is why the resolver splits the
    // path BEFORE decoding: had it decoded first, this would have arrived as a
    // legitimate-looking multi-segment path rooted at `/etc`.
    expect(at("/%2Fetc%2Fpasswd")).toBe("embedded-separator");
    expect(at("/assets%2Fmain.js")).toBe("embedded-separator");
  });

  it("refuses a Windows drive letter, plainly or encoded", () => {
    expect(at("/C:/Windows/win.ini")).toBe("drive-letter");
    expect(at("/%43%3a/Windows/win.ini")).toBe("drive-letter");
  });

  it("refuses an NTFS alternate data stream", () => {
    // `index.html:evil` names a hidden stream of a legitimate file on NTFS —
    // the same colon syntax, reading a different set of bytes.
    expect(at("/index.html:evil")).toBe("drive-letter");
  });

  it("refuses a malformed escape rather than guessing what was meant", () => {
    expect(at("/%zz")).toBe("bad-encoding");
    expect(at("/%2")).toBe("bad-encoding");
  });

  it("refuses a path that does not round-trip", () => {
    // An empty interior segment is where normalization bugs hide: two pieces of
    // code disagree about whether `/assets//main.js` has two segments or three.
    expect(at("/assets//main.js")).toBe("non-canonical-path");
  });

  it("never returns a path outside the root, whatever the vector", () => {
    // The blanket statement, over every case above: whether refused or admitted,
    // nothing the resolver hands back is somewhere else on the disk.
    const vectors = [
      "/../secret",
      "/%2e%2e/secret",
      "/..%2f..%2fetc/passwd",
      "/....//secret",
      "/%252e%252e/secret",
      "/%2Fetc%2Fpasswd",
      "/%5c%5cserver%5cshare",
      "//server/share",
      "/C:/Windows/win.ini",
      "/index.html%00.png",
    ];
    for (const vector of vectors) {
      const result = resolveAppAsset(ROOT, `${APP_ORIGIN}${vector}`);
      if (result.ok) expect(result.path.startsWith(`${ROOT}${sep}`)).toBe(true);
    }
  });
});

describe("isStrictlyBeneath", () => {
  it("admits a file under the root", () => {
    expect(isStrictlyBeneath(ROOT, under("assets", "main.js"))).toBe(true);
  });

  it("refuses a sibling directory that merely shares the root's name prefix", () => {
    // THE prefix bug: `startsWith("/a/app")` says yes to `/a/app-evil/x`. An
    // attacker who can create a directory beside the installation gets a read
    // primitive out of one missing separator.
    expect(isStrictlyBeneath("/a/app", "/a/app-evil/x")).toBe(false);
    expect(isStrictlyBeneath("/a/app", "/a/app/x")).toBe(true);
    expect(isStrictlyBeneath("/a/app", "/a/appended")).toBe(false);
  });

  it("refuses the root itself — a directory is not an asset", () => {
    expect(isStrictlyBeneath(ROOT, ROOT)).toBe(false);
  });

  it("gives the same answer whether or not the root carries a trailing separator", () => {
    expect(isStrictlyBeneath(`${ROOT}${sep}`, under("index.html"))).toBe(true);
    expect(isStrictlyBeneath(`${ROOT}${sep}`, "/a/app-evil/x")).toBe(false);
  });

  it("refuses a parent of the root", () => {
    // Taken FROM the root rather than written out, so it stays a genuine parent
    // on a host where the root carries a volume prefix.
    expect(isStrictlyBeneath(ROOT, dirname(ROOT))).toBe(false);
  });
});

describe("mimeForPath", () => {
  it("chooses by extension and never by content", () => {
    // The resolver takes a root and a URL — there is no bytes parameter, so
    // there is nothing for it to sniff. The LAST extension decides, which is
    // also Chromium's rule: `evil.html.png` is an image, `evil.png.js` is script.
    expect(resolveAppAsset.length).toBe(2);
    expect(mimeForPath("/x/evil.html.png")).toBe("image/png");
    expect(mimeForPath("/x/evil.png.js")).toBe("text/javascript; charset=utf-8");
  });

  it("is case-insensitive about the extension", () => {
    expect(mimeForPath("/x/LOGO.PNG")).toBe("image/png");
  });

  it("defaults to an inert type when there is no extension", () => {
    // An unnamed type is served as bytes, never as something the renderer will
    // execute or parse as a document.
    expect(mimeForPath("/x/LICENSE")).toBe("application/octet-stream");
    expect(mimeOf("/LICENSE")).toBe("application/octet-stream");
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    // `join`ed, unlike its neighbours: `mimeForPath` splits on the HOST `sep`,
    // so a `/`-spelled path on win32 leaves the basename as the whole string and
    // the dot lands at index 3 — the `dot <= 0` guard never fires and the row
    // passes through the unknown-extension fallback instead, proving nothing.
    expect(mimeForPath(join("x", ".htaccess"))).toBe("application/octet-stream");
  });

  it("defaults for an extension it does not know", () => {
    expect(mimeForPath("/x/notes.docx")).toBe("application/octet-stream");
  });
});

/** A filesystem stand-in: `links` redirects a path the way a symlink would,
 * `missing` makes realpath throw the way ENOENT does.
 *
 * Its keys are the resolver's OWN output (built with `under`), not URL-shaped
 * strings: a fake keyed in `/` on win32 would answer "exists, not a link" to
 * every lookup — turning the symlink and missing-file refusals below into
 * silent 200s, which is the one failure mode a security fixture must not have. */
function fakeFs(links: Record<string, string> = {}, missing: readonly string[] = []) {
  const opened: string[] = [];
  return {
    opened,
    realpath: (path: string): string => {
      if (missing.includes(path)) throw new Error(`ENOENT: no such file or directory, ${path}`);
      return links[path] ?? path;
    },
    openStream: (path: string): ReadableStream<Uint8Array> => {
      opened.push(path);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`bytes of ${path}`));
          controller.close();
        },
      });
    },
  };
}

describe("serveAppRequest", () => {
  it("answers an asset with its declared type and the security headers", async () => {
    const fs = fakeFs();
    const response = serveAppRequest(`${APP_ORIGIN}/index.html`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    // nosniff is the response half of the extension-only MIME decision: without
    // it Chromium may still infer a type from the bytes we just declared about.
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // our bytes are for our own documents; no other origin may embed them
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await response.text()).toBe(`bytes of ${under("index.html")}`);
  });

  it("emits no CORS header — this origin answers no cross-origin caller", () => {
    const fs = fakeFs();
    const response = serveAppRequest(`${APP_ORIGIN}/index.html`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("carries the production CSP when the shell supplies one", () => {
    const fs = fakeFs();
    const response = serveAppRequest(`${APP_ORIGIN}/index.html`, {
      root: ROOT,
      csp: "default-src 'self'",
      realpath: fs.realpath,
      openStream: fs.openStream,
    });
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
  });

  it("refuses a symlink that points out of the root", async () => {
    // The one check the pure resolver cannot make. Every path it returns is
    // beneath the root by construction — but a link planted beneath the root by
    // a same-uid process (EL7's adversary) reads from anywhere on the disk.
    // The link target is a sibling on the SAME volume — a cross-volume target
    // would be refused by its prefix alone, which is not the property under test.
    const fs = fakeFs({ [under("notes.js")]: hostPath("/Users/dev/.ssh/id_ed25519") });
    const refusals: string[] = [];
    const response = serveAppRequest(`${APP_ORIGIN}/notes.js`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
      onRefusal: (reason) => refusals.push(reason),
    });

    expect(response.status).toBe(404);
    expect(refusals).toEqual(["symlink-escape"]);
    // and it never opened the file: the refusal precedes the read
    expect(fs.opened).toEqual([]);
  });

  it("admits a symlink that stays inside the root", async () => {
    const fs = fakeFs({ [under("assets", "main.js")]: under("assets", "real", "main.js") });
    const response = serveAppRequest(`${APP_ORIGIN}/assets/main.js`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });
    expect(response.status).toBe(200);
    // the REAL path is what gets read, not the link we were asked for
    expect(fs.opened).toEqual([under("assets", "real", "main.js")]);
  });

  it("refuses a root that itself resolves elsewhere", async () => {
    // Containment is judged between two real paths, so a root that is itself a
    // link is compared as its target rather than as the name we were given.
    const fs = fakeFs({ [ROOT]: hostPath("/private/real/renderer") });
    const response = serveAppRequest(`${APP_ORIGIN}/index.html`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });
    expect(response.status).toBe(404);
  });

  it("answers a missing file with the same 404 as a traversal", async () => {
    // Deliberately indistinguishable: a compromised renderer that could tell
    // "refused" from "absent" would have a directory oracle for the whole disk.
    const fs = fakeFs({}, [under("nope.js")]);
    const missing = serveAppRequest(`${APP_ORIGIN}/nope.js`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });
    const traversal = serveAppRequest(`${APP_ORIGIN}/..%2f..%2fetc/passwd`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });

    expect(missing.status).toBe(traversal.status);
    expect(await missing.text()).toBe(await traversal.text());
    expect(missing.headers.get("Content-Type")).toBe(traversal.headers.get("Content-Type"));
  });

  it("reports each refusal class so the evidence names what arrived", () => {
    const fs = fakeFs({}, [under("nope.js")]);
    const refusals: [string, string][] = [];
    const options = {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
      onRefusal: (reason: string, url: string): void => {
        refusals.push([reason, url]);
      },
    };
    serveAppRequest(`${APP_ORIGIN}/%2Fetc%2Fpasswd`, options);
    serveAppRequest(`${APP_ORIGIN}/nope.js`, options);

    expect(refusals.map(([reason]) => reason)).toEqual(["embedded-separator", "missing-file"]);
    expect(refusals[1]?.[1]).toBe(`${APP_ORIGIN}/nope.js`);
  });

  it("never opens a file for a request the resolver refused", () => {
    const fs = fakeFs();
    serveAppRequest(`${APP_ORIGIN}/..%2f..%2fetc/passwd`, {
      root: ROOT,
      realpath: fs.realpath,
      openStream: fs.openStream,
    });
    expect(fs.opened).toEqual([]);
  });
});

describe("installAppProtocol", () => {
  it("handles exactly the app scheme and routes the request URL through the resolver", async () => {
    const fs = fakeFs();
    installAppProtocol({ root: ROOT, realpath: fs.realpath, openStream: fs.openStream });

    const handler = stub.handlers.get(APP_SCHEME);
    expect(handler).toBeDefined();
    expect([...stub.handlers.keys()]).toEqual([APP_SCHEME]);

    const served = await handler?.({ url: `${APP_ORIGIN}/assets/main-CXh9HwVS.js` });
    expect(served?.status).toBe(200);
    expect(served?.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(fs.opened).toEqual([under("assets", "main-CXh9HwVS.js")]);
  });

  it("refuses a hostile request through the installed handler too", async () => {
    const fs = fakeFs();
    installAppProtocol({ root: ROOT, realpath: fs.realpath, openStream: fs.openStream });
    const handler = stub.handlers.get(APP_SCHEME);
    const served = await handler?.({ url: `${APP_ORIGIN}/%2e%2e/secret` });
    expect(served?.status).toBe(404);
    expect(fs.opened).toEqual([]);
  });
});
