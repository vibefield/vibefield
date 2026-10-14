// PJ-7 — the simulator witness's desktop (build-pj7.md slice 5): real fieldd,
// its files worker and the native floor, one git place with an identity
// remote, the scripted agent — and a bridge that serves the product door AS A
// SELF TAILNET PHONE: it plays the sidecar, adding the linked login's
// `Tailscale-User-Login` on the door's secret path, so the kit's hello is a
// phone's (no credential; fieldd mints the tailnet principal). It is NOT
// ios-workspace.ts's minted renderer participant: `project.*` answers this
// caller with the tailnet cut, and a launch is ticketed for a self phone.
// The sidecar's mesh is stood in (test/mesh-stand-in.ts); no real tailnet,
// WhoIs or phone is claimed. The world is test/phone-world.ts's.
//
// Each birth is filed in the scripted index as rosetta would file the agent's
// transcript, so the kit reads the session back in `project.sessions`.
//
// Run from this repo's root, then the kit's test; SIGTERM (or ^C) stops it:
//   node --import ./packages/contracts/node_modules/tsx/dist/loader.mjs \
//     packages/fieldd/test/fixtures/ios-phone-place.ts
// It prints PJ7_PHONE_READY and writes the handshake (mode 0600) to
// `/private/tmp/vibefield-pj7-phone.json`, or to `$PJ7_PHONE_HANDSHAKE`.
import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { bootPhoneWorld, PHONE_AGENT, type PhoneWorld, PLACE_REMOTE } from "../phone-world";

export const PHONE_HANDSHAKE = "/private/tmp/vibefield-pj7-phone.json";

/** What the kit test reads to find the door and know what to expect behind it. */
export interface PhoneHandshake {
  /** the bridge: dial it with a plain WebSocket and hello `clientKind: "ios"`,
   * no credential — the bridge says who the phone is, as the sidecar does */
  url: string;
  /** the answering desktop: its roster id (every PlaceRef's `device`) */
  device: string;
  /** the login the bridge presents: the desktop's own, so the phone is `self` */
  login: string;
  /** the agent to launch (its catalog id) and the Agent Profile to launch it under */
  provider: string;
  profileSet: string;
  /** the one place the kit should find: its folder's name and path (a self
   * phone is answered paths, P1 (a)), and its identity remote */
  place: { name: string; path: string; remote: string };
  /** GET: what the fixture saw — the methods the phone called, each birth */
  proof: string;
}

export interface PhoneFixture {
  handshake: PhoneHandshake;
  world: PhoneWorld;
  stop(): Promise<void>;
}

export async function startPhoneFixture(
  handshakePath: string = PHONE_HANDSHAKE,
): Promise<PhoneFixture> {
  let booted: PhoneWorld | null = null;
  const world = await bootPhoneWorld({
    // rosetta reads the agent's transcript; here, the index is told at birth
    onBirth: (birth) => booted?.fileConversation(birth.sessionId, birth.cwd),
  });
  booted = world;
  const methods: string[] = [];
  const sockets = new WebSocketServer({ noServer: true });
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/proof"
          ? {
              methods,
              births: world.births,
              native: "real",
              worker: "real",
              agent: "scripted (/bin/sh holding cat)",
              authentication:
                "a self tailnet phone: the product door's secret path + Tailscale-User-Login (stood-in sidecar)",
            }
          : {},
      ),
    );
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/door") {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (downstream) => {
      // the sidecar's half: the verified login, on the door's secret path
      const upstream = new WebSocket(world.doorUrl, {
        headers: { "Tailscale-User-Login": world.login },
      });
      const queue: string[] = [];
      downstream.on("message", (data) => {
        const text = data.toString();
        try {
          const method = (JSON.parse(text) as { method?: unknown }).method;
          if (typeof method === "string") methods.push(method);
        } catch {
          /* fieldd answers a malformed line itself */
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
        else if (queue.length < 16) queue.push(text);
        else downstream.close();
      });
      upstream.on("open", () => {
        for (const text of queue) upstream.send(text);
        queue.length = 0;
      });
      upstream.on("message", (data) => {
        if (downstream.readyState === WebSocket.OPEN) downstream.send(data.toString());
      });
      upstream.on("error", () => downstream.close());
      downstream.on("error", () => upstream.close());
      upstream.on("close", () => downstream.close());
      downstream.on("close", () => upstream.close());
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  const handshake: PhoneHandshake = {
    url: `ws://127.0.0.1:${port}/door`,
    device: world.daemon.devices.currentDeviceId(),
    login: world.login,
    provider: PHONE_AGENT.id,
    profileSet: "native",
    place: { name: basename(world.placePath), path: world.placePath, remote: PLACE_REMOTE },
    proof: `http://127.0.0.1:${port}/proof`,
  };
  writeFileSync(handshakePath, `${JSON.stringify(handshake, null, 2)}\n`, { mode: 0o600 });
  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= (async () => {
      rmSync(handshakePath, { force: true });
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      await new Promise<void>((done) => server.close(() => done()));
      await world.stop();
    })();
    return stopping;
  };
  return { handshake, world: world, stop };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const handshakePath = process.env["PJ7_PHONE_HANDSHAKE"] ?? PHONE_HANDSHAKE;
  const fixture = await startPhoneFixture(handshakePath);
  console.log(`PJ7_PHONE_READY ${handshakePath}`);
  const leave = () => void fixture.stop().then(() => process.exit(0));
  process.on("SIGINT", leave);
  process.on("SIGTERM", leave);
  process.on("exit", () => rmSync(handshakePath, { force: true }));
}
