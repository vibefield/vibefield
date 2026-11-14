// ITEM 378 — the preview capture's WebRTC fence, measured on a real Electron (docs/desk-gates.md row 38).
//
// vibefield-capture-webrtc-probe-only
//
// A captured page's ICE never passes webRequest, so the capture fences it per capture: its contents refuse unproxied
// UDP, and its own session sends WebRTC's TCP to a dead proxy (artifact-preview-capture.ts, item 378). This probe runs
// the REAL capture class on main's own Electron adapter (`electronArtifactPreviewNative`) twice over one fixture page:
//   · CONTROL: the same capture with the fence's two calls left unmade by this probe. It MUST reach a listener, or the
//     probe cannot see what it measures and says so (exit 2, blind).
//   · FENCED: the capture as it ships. It must reach neither listener (exit 1, red, naming the half that leaked).
// The page is served to each capture's own session by `protocol.handle("https")` for a syntactic ts.net URL, so it has
// the form ShellArtifactPreviewUrl takes, with no DNS, TLS or tailnet. Its iceServers are a STUN listener (UDP) and a
// TURN listener (TCP) that this probe binds on the host's first non-loopback IPv4 (Chromium need not gather over
// loopback). Each leg binds its own pair and closes it before the next; nothing is answered on either, since an
// arrival is the measure. The page reports the candidates it gathered, by type, to its own origin. Whether the capture
// itself completes (it needs a window server that paints) is recorded, never the verdict.
// THE TCP HALF, honestly: if Chromium's P2P TCP does not take the capture session's proxy, the FENCED leg shows a
// connection at the TURN listener and the probe is RED. Then the plan changes; the probe is never adjusted to pass.
// ITEM 415, two more legs: a bypass entry with no port matched every port of its host, so the page's OWN name was
// a way around the dead proxy. Each same-host leg puts its TURN server at the page's own name on the listener's
// port (main maps the two names to the listeners' address with `host-resolver-rules`, in this mode alone):
//   · SAME-HOST CONTROL: the fence's two calls left unmade. It MUST connect there, or the probe cannot see this half
//     (exit 2, blind: the name did not resolve, or Chromium's P2P TCP did not dial it).
//   · SAME HOST: the capture as it ships. It must not connect (exit 1, red: the bypass is wider than its origin's
//     port). Read on 378's rule (a bare host), this leg is the reading of item 415's leak; if it does not arrive
//     there, Chromium's P2P TCP did not take the bypass on this Electron, and that is reported, never adjusted.

import { createSocket } from "node:dgram";
import { type AddressInfo, createServer, type Socket } from "node:net";
import {
  ArtifactPreviewCapture,
  type ArtifactPreviewCaptureNative,
} from "../main/artifact-preview-capture";
import { CAPTURE_PROBE_SAME_HOSTS } from "../main/modes";

export interface CaptureWebRtcProbeOptions {
  /** where the capture writes its thumbnails: the run's own fresh profile */
  dataDir: string;
  /** main's own Electron adapter (`electronArtifactPreviewNative`) */
  native: ArtifactPreviewCaptureNative;
  /** the address main read before ready (`firstHostAddress`): the listeners bind on it, and its host rules map the
   * same-host legs' names to it. Absent: the host has no non-loopback IPv4, and the probe is blind. */
  host: string | undefined;
}

type Leg = "control" | "fenced" | "same-control" | "same";

/** The legs that run the capture as it ships; the others leave the fence's two calls unmade. */
const SHIPPING: ReadonlySet<Leg> = new Set<Leg>(["fenced", "same"]);
/** The legs whose TURN and STUN servers are the page's own name (item 415). */
const SAME_HOST: ReadonlySet<Leg> = new Set<Leg>(["same-control", "same"]);
const [SAME_CONTROL_NAME, SAME_NAME] = CAPTURE_PROBE_SAME_HOSTS;

interface LegResult {
  leg: Leg;
  datagrams: number;
  connections: number;
  candidates: string;
  capture: string;
}

/** How long the page holds its load event, so the capture keeps it alive while ICE runs. */
const HOLD_MS = 3_500;
/** When the page reports what it gathered: inside the hold. */
const REPORT_MS = 2_500;
/** Stragglers after a capture ends, before a leg's listeners are read and closed. */
const SETTLE_MS = 1_000;
/** A capture still running by now is aborted (a window server that never paints). */
const CAPTURE_TIMEOUT_MS = 30_000;

/** One 1×1 PNG, the held subresource. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const LEGS: Record<Leg, { artifactId: string; url: string }> = {
  control: {
    artifactId: "01JD3780000000000000000001",
    url: "https://fixture-control.ts.net:41378/",
  },
  fenced: { artifactId: "01JD3780000000000000000002", url: "https://fixture-fenced.ts.net:41379/" },
  "same-control": {
    artifactId: "01JD4150000000000000000001",
    url: `https://${SAME_CONTROL_NAME}:41380/`,
  },
  same: { artifactId: "01JD4150000000000000000002", url: `https://${SAME_NAME}:41381/` },
};

export async function runCaptureWebRtcProbe(options: CaptureWebRtcProbeOptions): Promise<number> {
  const host = options.host;
  if (host === undefined) {
    emit({ kind: "blind", why: "no non-loopback IPv4 address to bind the listeners on" });
    return 2;
  }
  const control = await runLeg(options, "control", host);
  emit({ kind: "leg", ...control });
  const fenced = await runLeg(options, "fenced", host);
  emit({ kind: "leg", ...fenced });
  const sameControl = await runLeg(options, "same-control", host);
  emit({ kind: "leg", ...sameControl });
  const same = await runLeg(options, "same", host);
  emit({ kind: "leg", ...same });
  if (control.datagrams + control.connections === 0) {
    emit({
      kind: "blind",
      why: "the CONTROL capture reached neither listener: this probe cannot see what it measures",
    });
    return 2;
  }
  if (sameControl.connections === 0) {
    emit({
      kind: "blind",
      why: "the SAME-HOST CONTROL never connected at its own name: this probe cannot see item 415",
    });
    return 2;
  }
  const leaked = [
    ...(fenced.datagrams > 0 ? ["UDP: the contents' WebRTC IP handling policy did not hold"] : []),
    ...(fenced.connections > 0
      ? ["TCP: WebRTC's TCP did not take the capture session's proxy; the plan changes"]
      : []),
    ...(same.datagrams > 0
      ? ["UDP (same host): the contents' WebRTC IP handling policy did not hold"]
      : []),
    ...(same.connections > 0
      ? ["TCP (same host): the page's own name on another port went direct (item 415)"]
      : []),
  ];
  if (leaked.length > 0) {
    emit({ kind: "red", leaked });
    return 1;
  }
  emit({
    kind: "wanted",
    why: "both controls reached their listeners; neither shipping capture reached one",
  });
  return 0;
}

async function runLeg(
  options: CaptureWebRtcProbeOptions,
  leg: Leg,
  host: string,
): Promise<LegResult> {
  const listeners = await listen(host);
  try {
    const reports: string[] = [];
    const iceHost = SAME_HOST.has(leg) ? new URL(LEGS[leg].url).hostname : host;
    const page = fixturePage(iceHost, listeners.udpPort, listeners.tcpPort);
    const answer = async (url: string): Promise<Response> => {
      const { pathname, searchParams } = new URL(url);
      if (pathname === "/") {
        return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/hold.png") {
        await delay(HOLD_MS);
        return new Response(new Uint8Array(PIXEL), { headers: { "content-type": "image/png" } });
      }
      if (pathname === "/report") {
        reports.push(searchParams.get("c") ?? "");
        return new Response("ok");
      }
      return new Response("missing", { status: 404 });
    };
    const capture = new ArtifactPreviewCapture({
      dataDir: options.dataDir,
      native: probeNative(options.native, leg, answer),
    });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CAPTURE_TIMEOUT_MS);
    let outcome = "captured";
    try {
      await capture.capture({ artifactId: LEGS[leg].artifactId, url: LEGS[leg].url }, abort.signal);
    } catch (error) {
      outcome = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } finally {
      clearTimeout(timer);
    }
    await delay(SETTLE_MS);
    const { datagrams, connections } = listeners.counts();
    return {
      leg,
      datagrams,
      connections,
      candidates: reports.at(-1) ?? "(no report)",
      capture: outcome,
    };
  } finally {
    await listeners.close();
  }
}

/** The capture's adapter for one leg: the fixture answered on every capture session, and the
 * fence's two calls left unmade on each CONTROL leg (a session whose `setProxy` does nothing, contents whose policy
 * call does nothing).
 * The capture's own code runs unchanged on both legs. */
function probeNative(
  base: ArtifactPreviewCaptureNative,
  leg: Leg,
  answer: (url: string) => Promise<Response>,
): ArtifactPreviewCaptureNative {
  return {
    createSession: (partition) => {
      const session = base.createSession(partition);
      (session as unknown as ProtocolSession).protocol.handle("https", (request) =>
        answer(request.url),
      );
      return SHIPPING.has(leg) ? session : replacing(session, "setProxy", async () => undefined);
    },
    createWindow: (options) => {
      const window = base.createWindow(options);
      if (SHIPPING.has(leg)) return window;
      const contents = replacing(window.webContents, "setWebRTCIPHandlingPolicy", () => undefined);
      return replacing(window, "webContents", contents);
    },
    decodeImage: (bytes) => base.decodeImage(bytes),
  };
}

interface ProtocolSession {
  protocol: {
    handle(scheme: string, handler: (request: Request) => Promise<Response>): void;
  };
}

/** `target`, with one member replaced and every other member its own (a method bound to it). */
function replacing<T extends object>(target: T, key: PropertyKey, value: unknown): T {
  return new Proxy(target, {
    get(object, property) {
      if (property === key) return value;
      const member: unknown = Reflect.get(object, property, object);
      return typeof member === "function" ? member.bind(object) : member;
    },
  });
}

/** The fixture page; `iceHost` is the listeners' address, or on a same-host leg the page's own name. */
function fixturePage(iceHost: string, udpPort: number, tcpPort: number): string {
  const servers = JSON.stringify([
    { urls: `stun:${iceHost}:${udpPort}` },
    { urls: `turn:${iceHost}:${tcpPort}?transport=tcp`, username: "probe", credential: "probe" },
  ]);
  const report = 'fetch("/report?c=" + encodeURIComponent(JSON.stringify(seen)))';
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>capture webrtc probe</title></head>',
    '<body><p>capture webrtc probe</p><img src="/hold.png" alt="">',
    "<script>",
    "(() => {",
    "  const seen = {};",
    "  const count = (type) => { seen[type] = (seen[type] || 0) + 1; };",
    "  try {",
    `    const pc = new RTCPeerConnection({ iceServers: ${servers} });`,
    '    pc.createDataChannel("probe");',
    '    pc.onicecandidate = (e) => { if (e.candidate) count(e.candidate.type || "unknown"); };',
    "    pc.createOffer()",
    "      .then((offer) => pc.setLocalDescription(offer))",
    '      .catch(() => count("offer-failed"));',
    "  } catch {",
    '    count("no-peer-connection");',
    "  }",
    `  setTimeout(() => { ${report}.catch(() => undefined); }, ${REPORT_MS});`,
    "})();",
    "</script></body></html>",
  ].join("\n");
}

interface Listeners {
  udpPort: number;
  tcpPort: number;
  counts(): { datagrams: number; connections: number };
  close(): Promise<void>;
}

async function listen(host: string): Promise<Listeners> {
  let datagrams = 0;
  let connections = 0;
  const udp = createSocket("udp4");
  udp.on("message", () => {
    datagrams += 1;
  });
  await new Promise<void>((resolve, reject) => {
    udp.once("error", reject);
    udp.bind(0, host, () => resolve());
  });
  const sockets = new Set<Socket>();
  const tcp = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    tcp.once("error", reject);
    tcp.listen(0, host, () => resolve());
  });
  return {
    udpPort: udp.address().port,
    tcpPort: (tcp.address() as AddressInfo).port,
    counts: () => ({ datagrams, connections }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
      await new Promise<void>((resolve) => udp.close(() => resolve()));
    },
  };
}

function emit(record: Record<string, unknown>): void {
  process.stdout.write(`CAPTURE_WEBRTC_PROBE ${JSON.stringify(record)}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
