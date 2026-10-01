import { Agent, type ClientRequestArgs } from "node:http";
import { connect, isIPv4, isIPv6, type Socket } from "node:net";
import type { Duplex } from "node:stream";

// DS-1 — a SOCKS5 client (RFC 1928, with RFC 1929's username/password
// sub-negotiation), written here rather than taken as a dependency: it is
// ~200 lines of a frozen protocol, and the one proxy it talks to is the
// node's own (tsnet's loopback SOCKS5, handed over by `native.mesh.egress.proxy`).
//
// FAIL CLOSED is the whole posture. The greeting offers ONLY method 0x02
// (username/password): a proxy that answers "no authentication" (0x00) is not
// the node's proxy, or is one that would let any same-uid process through
// (EL7's adversary), and either way nothing is sent past the greeting. Every
// refusal is a typed `Socks5Error` naming the stage it happened at; nothing
// here ever falls back to a direct connection — that decision belongs to the
// caller, and only for a floor that has no egress at all.

export type Socks5Stage = "connect" | "greeting" | "auth" | "request" | "timeout";

export class Socks5Error extends Error {
  constructor(
    public readonly stage: Socks5Stage,
    message: string,
    /** RFC 1928 §6's REP field, when the proxy refused the request itself */
    public readonly reply?: number,
  ) {
    super(message);
    this.name = "Socks5Error";
  }
}

/** RFC 1928 §6 — the reply codes, in the RFC's own words. */
const REPLY_MESSAGES: Record<number, string> = {
  1: "general SOCKS server failure",
  2: "connection not allowed by ruleset",
  3: "network unreachable",
  4: "host unreachable",
  5: "connection refused",
  6: "TTL expired",
  7: "command not supported",
  8: "address type not supported",
};

export interface Socks5Proxy {
  /** `host:port` of the proxy — the contract guarantees a literal loopback
   * (`127.0.0.1:<p>` or `[::1]:<p>`), so no resolver is ever asked */
  proxy: string;
  username: string;
  password: string;
  /** the whole handshake's budget, connect to reply (default 10 s) */
  timeoutMs?: number;
}

export interface Socks5Target {
  /** a DNS name (sent as a DOMAINNAME, so the PROXY resolves it — MagicDNS is
   * the node's, not the OS's), a dotted IPv4, or an IPv6 literal */
  host: string;
  port: number;
}

/** `host:port` or `[v6]:port` → its parts. */
export function splitHostPort(address: string): { host: string; port: number } {
  const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/.exec(address);
  const plain = bracketed ?? /^([^:]+):(\d{1,5})$/.exec(address);
  const port = Number(plain?.[2]);
  if (!plain?.[1] || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Socks5Error("connect", `not a host:port address: ${address}`);
  }
  return { host: plain[1], port };
}

/** Open a TCP stream to `target` THROUGH the proxy. Resolves with the socket
 * positioned just past the proxy's reply, so its next byte is the target's. */
export async function socks5Connect(proxy: Socks5Proxy, target: Socks5Target): Promise<Socket> {
  const { host: proxyHost, port: proxyPort } = splitHostPort(proxy.proxy);
  const request = connectRequest(target);
  const auth = authRequest(proxy.username, proxy.password);
  const socket = connect({ host: proxyHost, port: proxyPort });
  socket.setNoDelay(true);
  const timeoutMs = proxy.timeoutMs ?? 10_000;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Socks5Error("timeout", `SOCKS5 handshake exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
  });
  try {
    await Promise.race([handshake(socket, auth, request), deadline]);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error instanceof Socks5Error
      ? error
      : new Socks5Error("connect", error instanceof Error ? error.message : String(error));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function handshake(socket: Socket, auth: Buffer, request: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(new Socks5Error("connect", error.message));
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve();
    });
  });
  // PAUSED MODE for the whole handshake ('readable' + exact reads): nothing is
  // read past the proxy's reply, and once the last listener is gone the
  // stream's flow state resets, so whatever the caller attaches next — the
  // HTTP client, for a WebSocket upgrade — sees every byte after it.
  const reader = exactReader(socket);
  try {
    // greeting: version 5, ONE method offered, 0x02 username/password
    socket.write(Buffer.from([0x05, 0x01, 0x02]));
    const [version, method] = await reader.read(2);
    if (version !== 0x05) throw new Socks5Error("greeting", "the proxy does not speak SOCKS5");
    if (method === 0xff)
      throw new Socks5Error("greeting", "the proxy accepted none of the offered methods");
    if (method !== 0x02)
      throw new Socks5Error(
        "greeting",
        `the proxy chose method 0x${(method ?? 0).toString(16)}; only username/password is offered`,
      );
    socket.write(auth);
    const [authVersion, status] = await reader.read(2);
    if (authVersion !== 0x01 || status !== 0x00)
      throw new Socks5Error("auth", "the proxy refused the credential");
    socket.write(request);
    const [replyVersion, reply, , addressType] = await reader.read(4);
    if (replyVersion !== 0x05) throw new Socks5Error("request", "malformed SOCKS5 reply");
    if (reply !== 0x00) {
      throw new Socks5Error(
        "request",
        `the proxy refused the connection: ${REPLY_MESSAGES[reply ?? 0x01] ?? `reply 0x${(reply ?? 0).toString(16)}`}`,
        reply,
      );
    }
    // BND.ADDR + BND.PORT — read and discarded (a CONNECT's bound address says
    // nothing the caller needs), but READ, so the target's first byte is next.
    if (addressType === 0x01) await reader.read(4 + 2);
    else if (addressType === 0x04) await reader.read(16 + 2);
    else if (addressType === 0x03) {
      const [length] = await reader.read(1);
      await reader.read((length ?? 0) + 2);
    } else throw new Socks5Error("request", "malformed SOCKS5 reply address");
  } finally {
    reader.release();
  }
}

/** Exact-length reads in paused mode. */
function exactReader(socket: Socket): { read(n: number): Promise<Buffer>; release(): void } {
  let wake: (() => void) | null = null;
  let closed: Error | null = null;
  const onReadable = () => wake?.();
  const onEnd = () => {
    closed ??= new Socks5Error("connect", "the proxy closed the connection mid-handshake");
    wake?.();
  };
  const onError = (error: Error) => {
    closed ??= new Socks5Error("connect", error.message);
    wake?.();
  };
  socket.on("readable", onReadable);
  socket.on("end", onEnd);
  socket.on("close", onEnd);
  socket.on("error", onError);
  return {
    async read(n: number): Promise<Buffer> {
      for (;;) {
        const chunk = socket.read(n) as Buffer | null;
        if (chunk !== null) {
          if (chunk.length === n) return chunk;
          // `read(n)` hands back fewer than n bytes only at end-of-stream: the
          // proxy hung up inside a reply. Said now, not at the deadline.
          throw new Socks5Error("connect", "the proxy closed the connection mid-reply");
        }
        if (closed) throw closed;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    },
    release() {
      socket.off("readable", onReadable);
      socket.off("end", onEnd);
      socket.off("close", onEnd);
      socket.off("error", onError);
    },
  };
}

/** RFC 1929 — version 1, then the length-prefixed username and password. */
function authRequest(username: string, password: string): Buffer {
  const user = Buffer.from(username, "utf8");
  const pass = Buffer.from(password, "utf8");
  if (user.length < 1 || user.length > 255 || pass.length < 1 || pass.length > 255) {
    throw new Socks5Error("auth", "a SOCKS5 username and password are each 1-255 bytes");
  }
  return Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]);
}

/** RFC 1928 §4 — CONNECT to an IPv4, an IPv6 or a DOMAINNAME. */
function connectRequest(target: Socks5Target): Buffer {
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new Socks5Error("request", `not a port: ${target.port}`);
  }
  const port = Buffer.from([target.port >> 8, target.port & 0xff]);
  const head = Buffer.from([0x05, 0x01, 0x00]);
  if (isIPv4(target.host)) {
    const octets = target.host.split(".").map(Number);
    return Buffer.concat([head, Buffer.from([0x01, ...octets]), port]);
  }
  if (isIPv6(target.host)) {
    return Buffer.concat([head, Buffer.from([0x04]), ipv6Bytes(target.host), port]);
  }
  const name = Buffer.from(target.host, "utf8");
  if (name.length < 1 || name.length > 255) {
    throw new Socks5Error("request", "a SOCKS5 domain name is 1-255 bytes");
  }
  return Buffer.concat([head, Buffer.from([0x03, name.length]), name, port]);
}

/** An IPv6 literal (as `isIPv6` admits it, an embedded IPv4 tail included)
 * → its 16 network-order bytes. A zone id has no meaning past a proxy and is
 * refused. */
export function ipv6Bytes(address: string): Buffer {
  const refuse = () => new Socks5Error("request", `not an IPv6 address: ${address}`);
  let text = address;
  const fromV4: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    if (!isIPv4(last)) throw refuse();
    const [a, b, c, d] = last.split(".").map(Number) as [number, number, number, number];
    fromV4.push((a << 8) | b, (c << 8) | d);
    // keep a `::` the dotted tail hung off; drop a lone separator colon
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) throw refuse();
  const groupsOf = (part: string): number[] =>
    part === ""
      ? []
      : part.split(":").map((h) => (/^[0-9a-fA-F]{1,4}$/.test(h) ? Number.parseInt(h, 16) : NaN));
  const head = groupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length - fromV4.length;
    if (fill < 1) throw refuse(); // `::` stands for at least one group
    groups = [...head, ...new Array<number>(fill).fill(0), ...tail, ...fromV4];
  } else {
    groups = [...head, ...fromV4];
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) throw refuse();
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => {
    out.writeUInt16BE(g, i * 2);
  });
  return out;
}

/** An `http.Agent` whose every connection is a SOCKS5 CONNECT through
 * `proxy` — what `ws` (and any Node HTTP client) takes as `agent` to reach a
 * peer through the node. Plain `http:`/`ws:` only: the product door is plain
 * HTTP inside WireGuard (`tls: false`), and a TLS hop would need an
 * https.Agent, which nothing on this seam asks for yet. */
export class Socks5Agent extends Agent {
  constructor(private readonly socks: Socks5Proxy) {
    super({ keepAlive: false });
  }

  override createConnection(
    options: ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const host = options.hostname ?? options.host ?? "";
    const port = Number(options.port ?? 80);
    socks5Connect(this.socks, { host: host.replace(/^\[(.*)\]$/, "$1"), port }).then(
      (socket) => callback?.(null, socket),
      (error: unknown) =>
        callback?.(error instanceof Error ? error : new Error(String(error)), undefined as never),
    );
    return undefined;
  }
}
