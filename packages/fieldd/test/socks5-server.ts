// DS-1 test helper — a SOCKS5 server (RFC 1928 + RFC 1929) that plays the
// node's loopback proxy: it checks the credential, records every CONNECT it
// is asked, and splices to wherever the test maps the requested host. It can
// be scripted to misbehave the ways a client must survive. Test-local only.
import { createServer, connect as netConnect, type Server, type Socket } from "node:net";

export interface Socks5Request {
  atyp: number;
  host: string;
  port: number;
  /** the raw DST.ADDR bytes, for the address-encoding rows */
  address: Buffer;
}

export interface FakeSocks5Options {
  username: string;
  password: string;
  /** requested host → where to splice (default: refuse with REP 0x04) */
  route: (host: string, port: number) => { host: string; port: number } | undefined;
  /** script a misbehaviour */
  quirk?: "no-auth-method" | "refuse-ruleset" | "silent" | "hang-up-mid-reply";
}

export interface FakeSocks5 {
  address: string;
  requests: Socks5Request[];
  /** connections that reached the proxy at all */
  connections: () => number;
  /** credentials refused */
  refusedAuth: () => number;
  close: () => Promise<void>;
}

export async function startFakeSocks5(opts: FakeSocks5Options): Promise<FakeSocks5> {
  const requests: Socks5Request[] = [];
  let connections = 0;
  let refusedAuth = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    connections += 1;
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => {});
    void serve(client).catch(() => client.destroy());
  });

  async function serve(client: Socket): Promise<void> {
    const read = reader(client);
    const [version, count] = await read(2);
    if (version !== 0x05) return void client.destroy();
    const methods = [...(await read(count ?? 0))];
    if (opts.quirk === "silent") return; // accepts, never answers
    if (opts.quirk === "no-auth-method") {
      client.write(Buffer.from([0x05, 0x00])); // "no authentication" — a stranger's proxy
      return;
    }
    if (!methods.includes(0x02)) return void client.end(Buffer.from([0x05, 0xff]));
    client.write(Buffer.from([0x05, 0x02]));
    const [authVersion, ulen] = await read(2);
    const user = (await read(ulen ?? 0)).toString("utf8");
    const [plen] = await read(1);
    const pass = (await read(plen ?? 0)).toString("utf8");
    if (authVersion !== 0x01 || user !== opts.username || pass !== opts.password) {
      refusedAuth += 1;
      return void client.end(Buffer.from([0x01, 0x01]));
    }
    client.write(Buffer.from([0x01, 0x00]));
    const [, cmd, , atyp] = await read(4);
    let address: Buffer;
    let host: string;
    if (atyp === 0x01) {
      address = await read(4);
      host = [...address].join(".");
    } else if (atyp === 0x04) {
      address = await read(16);
      host = address.toString("hex");
    } else {
      const [len] = await read(1);
      address = await read(len ?? 0);
      host = address.toString("utf8");
    }
    const portBytes = await read(2);
    const port = ((portBytes[0] ?? 0) << 8) | (portBytes[1] ?? 0);
    requests.push({ atyp: atyp ?? 0, host, port, address });
    const reply = (rep: number) =>
      Buffer.from([0x05, rep, 0x00, 0x01, 127, 0, 0, 1, port >> 8, port & 0xff]);
    if (opts.quirk === "hang-up-mid-reply") return void client.end(Buffer.from([0x05, 0x00]));
    if (opts.quirk === "refuse-ruleset") return void client.end(reply(0x02));
    const to = cmd === 0x01 ? opts.route(host, port) : undefined;
    if (to === undefined) return void client.end(reply(0x04));
    const upstream = netConnect(to);
    sockets.add(upstream);
    upstream.on("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    upstream.once("connect", () => {
      client.write(reply(0x00));
      const leftover = read.rest();
      if (leftover.length > 0) upstream.write(leftover);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    address: `127.0.0.1:${port}`,
    requests,
    connections: () => connections,
    refusedAuth: () => refusedAuth,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Exact reads over a flowing socket; `rest()` hands back what is buffered. */
function reader(socket: Socket): ((n: number) => Promise<Buffer>) & { rest(): Buffer } {
  let buffered = Buffer.alloc(0);
  let waiter: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  let ended = false;
  const pump = () => {
    if (waiter === null) return;
    if (buffered.length >= waiter.n) {
      const out = buffered.subarray(0, waiter.n);
      buffered = buffered.subarray(waiter.n);
      const w = waiter;
      waiter = null;
      w.resolve(out);
    } else if (ended) {
      const w = waiter;
      waiter = null;
      w.reject(new Error("closed"));
    }
  };
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    pump();
  };
  socket.on("data", onData);
  socket.on("end", () => {
    ended = true;
    pump();
  });
  const read = (n: number) =>
    new Promise<Buffer>((resolve, reject) => {
      waiter = { n, resolve, reject };
      pump();
    });
  return Object.assign(read, {
    rest() {
      socket.off("data", onData);
      const out = buffered;
      buffered = Buffer.alloc(0);
      return out;
    },
  });
}
