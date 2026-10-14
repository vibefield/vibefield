// PJ-7 — the simulator fixture, proven from node first (build-pj7.md slice 5):
// fixtures/ios-phone-place.ts is started, its handshake file read, and its
// door dialled exactly as the kit will — a plain WebSocket to the handshake's
// URL, a hello with `clientKind: "ios"` and no credential — then the slice-4
// launch: project.list → project.get → agent.spawn {provider, place,
// profileSet} → the session read back in `project.sessions` at that PlaceRef
// on that desktop. Its handshake goes to a file of this test's own, never the
// path the kit reads.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSpawnResult,
  CONTRACTS_VERSION,
  ProjectGetResult,
  ProjectListResult,
  ProjectSessionsResult,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { born } from "./agent-birth";
import {
  PHONE_HANDSHAKE,
  type PhoneFixture,
  type PhoneHandshake,
  startPhoneFixture,
} from "./fixtures/ios-phone-place";
import { WsRpc } from "./ws-rpc";

async function eventually(fn: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error(`not met within ${ms} ms: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(process.platform === "win32")(
  "PJ-7 — the simulator fixture: a self tailnet phone's door over a real fieldd",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-pj7-handshake-"));
    const handshakePath = join(dir, "handshake.json");
    let fixture: PhoneFixture;
    let ws: WebSocket | undefined;

    beforeAll(async () => {
      fixture = await startPhoneFixture(handshakePath);
    }, 180_000);

    afterAll(async () => {
      ws?.close();
      await fixture?.stop();
      rmSync(dir, { recursive: true, force: true });
    }, 60_000);

    it("writes its handshake beside the FS-2 one, never in it, and only for its owner", () => {
      expect(PHONE_HANDSHAKE).toBe("/private/tmp/vibefield-pj7-phone.json");
      const handshake = JSON.parse(readFileSync(handshakePath, "utf8")) as PhoneHandshake;
      expect(handshake).toEqual(fixture.handshake);
      expect(Object.keys(handshake).sort()).toEqual(
        ["device", "login", "place", "profileSet", "proof", "provider", "url"].sort(),
      );
      expect(handshake.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/door$/);
    });

    it("the kit's launch: dialled as a phone, it lists the place's project, opens it, launches by ref, and reads the session back at that PlaceRef on that desktop", async () => {
      const handshake = JSON.parse(readFileSync(handshakePath, "utf8")) as PhoneHandshake;
      ws = new WebSocket(handshake.url);
      await new Promise<void>((resolve, reject) => {
        ws!.once("open", () => resolve());
        ws!.once("error", reject);
      });
      const phone = new WsRpc(ws);
      const ack = (await phone.call("system.hello", {
        contractsVersion: CONTRACTS_VERSION,
        minCompatible: CONTRACTS_VERSION,
        clientKind: "ios",
      })) as { grantedScopes: string[] };
      // the self phone's preset: the bridge said who it is, as the sidecar does
      expect(ack.grantedScopes).toEqual([...TAILNET_SCOPES]);

      const listed = async () => {
        const page = ProjectListResult.parse(await phone.call("project.list", {}));
        const row = page.rows.find((r) => r.places.some((p) => p.path === handshake.place.path));
        if (row === undefined) throw new Error("no project at the handshake's place");
        return row;
      };
      const row = await listed();
      expect(row).toMatchObject({ kind: "repo", bucket: null, devices: [handshake.device] });
      const got = ProjectGetResult.parse(await phone.call("project.get", { key: row.key }));
      const place = got.project.places.find((p) => p.path === handshake.place.path);
      expect(place).toMatchObject({ name: handshake.place.name, class: "repo" });
      const ref = { device: place!.ref.device, placeId: place!.ref.placeId };
      expect(ref.device).toBe(handshake.device);

      const spawned = AgentSpawnResult.parse(
        await born(phone, "agent.spawn", {
          provider: handshake.provider,
          place: ref,
          profileSet: handshake.profileSet,
        }),
      );
      expect(fixture.world.births.at(-1)?.cwd).toBe(handshake.place.path);

      // the session, read back where the phone reads it
      const conversation = spawned.session.sessionId;
      let session: ProjectSessionsResult["rows"][number] | undefined;
      await eventually(
        async () => {
          const page = ProjectSessionsResult.parse(
            await phone.call("project.sessions", { key: (await listed()).key }),
          );
          session = page.rows.find((r) => r.nativeSessionId === conversation);
          return session !== undefined;
        },
        20_000,
        "project.sessions holds the launched session",
      );
      expect(session).toMatchObject({ device: handshake.device, place: ref });

      // what the fixture saw: the phone's own calls, through the bridge
      const proof = (await (await fetch(handshake.proof)).json()) as { methods: string[] };
      expect(proof.methods).toEqual(
        expect.arrayContaining([
          "system.hello",
          "project.list",
          "project.get",
          "agent.spawn",
          "project.sessions",
        ]),
      );
    }, 90_000);
  },
);
