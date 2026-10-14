// PJ-7 — A TAILNET WITHOUT A SIDECAR, FOR A REAL FLOOR. The phone's witnesses
// need two things no other world in this suite has at once: a REAL floor (an
// agent's birth needs a terminal cell — the mock mgmt server has none), and the
// tailnet's half of the product (a mesh identity, the product serve whose
// route secret the sidecar would add, the terminal serve a self phone's ticket
// names). A real floor serves the mesh only through truffle's sidecar on a
// signed-in tailnet, which no test host has.
//
// So this stands between fieldd and the floor on the management socket, the
// way `terminal-remote-door.e2e.test.ts`'s stand-in sidecar stands between a
// caller and a cell: the floor binds its socket, the file is moved aside (a
// bound unix socket keeps listening under its new name), and this listens
// where fieldd dials. Every line passes through UNCHANGED, except:
//   · `native.mesh.*` is answered by `MockMgmtServer`'s own mesh (never
//     listening; fed the lines here), whose subscription ids are renamed so
//     they cannot collide with the floor's (both count `s1`, `s2`, …);
//   · the floor's word that its terminal doors are on the tailnet
//     (`terminalMesh`, on the hello ack and the routes stream) reads `true` —
//     the sidecar's half, which a real floor learns from its node.
// What is a stand-in, stated plainly: the sidecar and its tailnet. The floor,
// its cells, fieldd's mesh client, its serve declarations, the product door's
// secret path and the ticket mint are all real. Unix sockets only (a named
// pipe cannot be moved aside).
import { renameSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

type Line = Record<string, unknown>;

/** Newline-delimited JSON off a socket, one parsed line at a time. */
function onLines(sock: Socket, take: (line: Line, raw: string) => void): void {
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (raw.trim() === "") continue;
      try {
        take(JSON.parse(raw) as Line, raw);
      } catch {
        take({}, raw);
      }
    }
  });
}

const objectAt = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export class MeshStandIn {
  /** the mesh fieldd is answered from: identity, serves, peers, stores */
  readonly mesh: MockMgmtServer;
  readonly #endpoint: string;
  readonly #floorEndpoint: string;
  #server: Server | null = null;
  readonly #sockets = new Set<Socket>();

  /** `endpoint` is the floor's management socket, already bound by it. */
  constructor(endpoint: string) {
    this.#endpoint = endpoint;
    this.#floorEndpoint = `${endpoint}.floor`;
    this.mesh = new MockMgmtServer(endpoint);
  }

  async start(): Promise<void> {
    renameSync(this.#endpoint, this.#floorEndpoint);
    this.#server = createServer((sock) => this.#bridge(sock));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(this.#endpoint, resolve);
    });
  }

  async stop(): Promise<void> {
    for (const sock of this.#sockets) sock.destroy();
    await new Promise<void>((resolve) =>
      this.#server ? this.#server.close(() => resolve()) : resolve(),
    );
    this.#server = null;
  }

  #bridge(down: Socket): void {
    const up = createConnection(this.#floorEndpoint);
    this.#sockets.add(down);
    this.#sockets.add(up);
    /** request ids whose answers carry the floor's `terminalMesh` */
    const hellos = new Set<unknown>();
    const routes = new Set<unknown>();
    // the mock's answers reach fieldd through this: its subscription ids renamed
    const meshSide = {
      write: (text: string) => {
        for (const raw of text.split("\n")) {
          if (raw.trim() === "") continue;
          const line = JSON.parse(raw) as Line;
          const result = objectAt(line["result"]);
          const params = objectAt(line["params"]);
          for (const holder of [result, params])
            if (holder !== undefined && typeof holder["subId"] === "string")
              holder["subId"] = `mesh-${holder["subId"]}`;
          if (!down.destroyed) down.write(`${JSON.stringify(line)}\n`);
        }
        return true;
      },
      get destroyed() {
        return down.destroyed;
      },
    };
    const mesh = this.mesh as unknown as {
      onLine(sock: unknown, msg: { id: number; method: string; params?: Line }): void;
    };
    onLines(down, (line, raw) => {
      const method = typeof line["method"] === "string" ? line["method"] : "";
      if (method.startsWith("native.mesh.")) {
        mesh.onLine(meshSide, line as { id: number; method: string; params?: Line });
        return;
      }
      if (method === "native.lifecycle.hello") hellos.add(line["id"]);
      if (method === "native.lifecycle.terminal.routes.subscribe") routes.add(line["id"]);
      up.write(`${raw}\n`);
    });
    onLines(up, (line, raw) => {
      const result = objectAt(line["result"]);
      const method = typeof line["method"] === "string" ? line["method"] : "";
      let patched = false;
      if (result !== undefined && hellos.delete(line["id"])) {
        result["terminalMesh"] = true;
        patched = true;
      } else if (result !== undefined && routes.delete(line["id"])) {
        const snapshot = objectAt(result["snapshot"]);
        if (snapshot !== undefined) snapshot["terminalMesh"] = true;
        patched = true;
      } else if (method.startsWith("native.lifecycle.terminal.routes.")) {
        const payload = objectAt(objectAt(line["params"])?.["payload"]);
        if (payload !== undefined) payload["terminalMesh"] = true;
        patched = true;
      }
      if (!down.destroyed) down.write(patched ? `${JSON.stringify(line)}\n` : `${raw}\n`);
    });
    const close = () => {
      down.destroy();
      up.destroy();
      this.#sockets.delete(down);
      this.#sockets.delete(up);
    };
    down.on("close", close);
    up.on("close", close);
    down.on("error", () => undefined);
    up.on("error", () => undefined);
  }
}
