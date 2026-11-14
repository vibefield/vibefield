// Item 406 (track WI's Desktop slice; WI-W5b A; VF-PM's rulings of 2026-11-14 04:49Z) — Remove for
// a phone: the ask, the act and the sweep (`device-removal.ts`), every seam scripted so the ORDER
// is what is read. The sweep is `revokeWindowToken`'s (daemon.ts): the audit first, then the phone's
// transcript tickets and readers under both of its client keys, then its live product connections
// by node id, then its freeway client by its exact id; and revocation preserves safety, so the
// effect runs even when the audit cannot be written. Every desktop of the account sweeps a refusal
// it did not write as the merged list reaches it, once per durable id and once per node id. The
// booted daemon's rows are freeway-daemon.test.ts's; the door's, tailnet-door.test.ts's.
import type { CallerContext, DeviceInfo, KnownPhone } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { AuditMutation, AuditMutationOutcome } from "../src/audit-service";
import {
  DeviceRemoval,
  type RemovalAudit,
  type RemovalDoc,
  type RemovalRoster,
} from "../src/device-removal";
import { RpcCallError } from "../src/native-link";

const LOGIN = "person@example.com";
const PHONE_NAME = "pocket-7q";

/** A window of this desktop: the caller the act's audit names. */
const WINDOW: CallerContext = {
  principal: { kind: "local-token", tokenId: "tk_0123456789ab", scopes: ["settings.manage"] },
  transport: "ws-loopback",
  receivedAt: 0,
  clientKind: "renderer",
};

/** This desktop, its other desktop (the phone's home), the phone KNOWN to be one, and a device
 * never seen to be one, as the roster lists them. */
const ROWS: Record<string, DeviceInfo> = {
  "dev-self": { deviceId: "dev-self", name: "Mac", self: true, online: true, lastSeenAt: 0 },
  "dev-home": {
    deviceId: "dev-home",
    name: "desk",
    self: false,
    online: true,
    lastSeenAt: 0,
    tailscaleId: "node-home",
  },
  "dev-phone": {
    deviceId: "dev-phone",
    name: PHONE_NAME,
    self: false,
    online: true,
    lastSeenAt: 0,
    tailscaleId: "node-1",
    phone: { via: "product", at: 1 },
  },
  "dev-quiet": {
    deviceId: "dev-quiet",
    name: "quiet",
    self: false,
    online: true,
    lastSeenAt: 0,
    tailscaleId: "node-q",
  },
};

/** Every seam, scripted: what each was asked, in one line, in order. `refused` is the account's
 * refusals by durable id (the settings document's `refusedDevices`), `known` its known phones. */
function rig(over: { refused?: Record<string, string[]>; known?: Record<string, string[]> } = {}) {
  const calls: string[] = [];
  const state = { auditDown: false };
  const refused = new Map(
    Object.entries(over.refused ?? {}).map(([deviceId, nodes]): [string, Set<string>] => [
      deviceId,
      new Set(nodes),
    ]),
  );
  const known = new Map(
    Object.entries(over.known ?? {}).map(([deviceId, tailscaleIds]): [string, KnownPhone] => [
      deviceId,
      { tailscaleIds, phone: { via: "freeway", at: 1 } },
    ]),
  );
  const audited = async <T>(
    actor: string,
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describeOutcome: (value: T) => AuditMutationOutcome,
  ): Promise<T> => {
    if (state.auditDown) throw new Error("the ledger is full");
    const attrs = JSON.stringify(mutation.attrs ?? {});
    calls.push(`audit ${actor} ${mutation.action} ${mutation.target.id} ${attrs}`);
    const value = await effect();
    calls.push(`outcome ${JSON.stringify(describeOutcome(value))}`);
    return value;
  };
  const audit: RemovalAudit = {
    required: (_ctx, mutation, effect, describeOutcome) =>
      audited("caller", mutation, effect, describeOutcome),
    requiredSystem: (mutation, effect, describeOutcome) =>
      audited("system", mutation, effect, describeOutcome),
  };
  const roster: RemovalRoster = {
    currentDeviceId: () => "dev-self",
    get: (deviceId) => ROWS[deviceId],
    isDocHost: (deviceId) => deviceId === "dev-home",
    selfPeerDeviceIds: () => ["dev-home", "dev-phone", "dev-quiet"],
    sync: async () => {
      calls.push("sync");
    },
  };
  const doc: RemovalDoc = {
    refusedDevices: async () => refused,
    knownPhones: async () => known,
  };
  const removal = new DeviceRemoval({
    roster,
    doc,
    audit,
    revokeTranscripts: async (clientId) => {
      calls.push(`transcripts ${clientId}`);
    },
    dropConnections: (nodeIds) => {
      calls.push(`connections ${nodeIds.join(",")}`);
      return nodeIds.length;
    },
    revokeFreeway: async (minted) => {
      calls.push(`freeway ${minted}`);
      return 1;
    },
    linkedLogin: () => LOGIN,
  });
  /** The handler's write, as THE writer answers it: true only while the refusal did not stand. */
  const write = (deviceId: string, nodes: string[]) => async () => {
    calls.push(`write ${deviceId} ${nodes.join(",")}`);
    const wrote = !refused.has(deviceId);
    if (wrote) refused.set(deviceId, new Set(nodes));
    return { wrote };
  };
  return { removal, calls, state, refused, write };
}

/** What an ask answers: the ask, null, or the refusal's kind. */
async function asked(removal: DeviceRemoval, params: unknown): Promise<unknown> {
  try {
    return await removal.ask(params);
  } catch (error) {
    if (error instanceof RpcCallError) return error.kind;
    throw error;
  }
}

describe("406 — Remove for a phone: the ask, the act and the sweep", () => {
  it("asks only for a device KNOWN to be a phone, with every node id this desktop knows for it; a phone already refused is answered declaratively", async () => {
    const { removal } = rig({ known: { "dev-phone": ["node-0", "node-1"] } });
    // its row's node first, then the account's record of it, once each
    expect(await asked(removal, { deviceId: "dev-phone" })).toEqual({
      deviceId: "dev-phone",
      tailscaleIds: ["node-1", "node-0"],
    });
    expect(await asked(removal, {})).toBe("PRECONDITION_FAILED");
    // this desktop, a desktop, and a row never seen to be a phone: a refusal is never lifted, so
    // it is never written on a guess
    expect(await asked(removal, { deviceId: "dev-self" })).toBe("PRECONDITION_FAILED");
    expect(await asked(removal, { deviceId: "dev-home" })).toBe("PRECONDITION_FAILED");
    expect(await asked(removal, { deviceId: "dev-quiet" })).toBe("PRECONDITION_FAILED");
    expect(await asked(removal, { deviceId: "dev-nobody" })).toBe("NOT_FOUND");
    // refused already (its row is gone with it): nothing to ask, and nothing to write
    const again = rig({ refused: { "dev-phone": ["node-1"] } });
    expect(await asked(again.removal, { deviceId: "dev-phone" })).toBeNull();
  });

  it("the sweep's four steps, in revokeWindowToken's order: the audit, the transcripts by both client keys, the connections by node id, the freeway client by its exact id", async () => {
    const { removal, calls, write } = rig();
    const ask = { deviceId: "dev-phone", tailscaleIds: ["node-1", "node-0"] };
    const result = await removal.remove(WINDOW, ask, write("dev-phone", ask.tailscaleIds));
    expect(result).toEqual({ removed: true, closed: 4 });
    expect(calls).toEqual([
      'audit caller device.remove dev-phone {"via":"remove"}',
      // the act's own write, then the roster's pass, so the door refuses a phone that dials back
      "write dev-phone node-1,node-0",
      "sync",
      `transcripts tailnet:${LOGIN}#node-1`,
      `transcripts tailnet:${LOGIN}#node-0`,
      "transcripts peer-fieldd:dev-home#phone:dev-phone",
      "connections node-1,node-0",
      `freeway freeway:${LOGIN}#node-1`,
      `freeway freeway:${LOGIN}#node-0`,
      'outcome {"outcome":"succeeded","attrs":{"closed":4}}',
    ]);
    // the audit names the device by its id, never by its name
    expect(calls.join("\n")).not.toContain(PHONE_NAME);

    // the same Remove again (a second press racing the first): nothing new is written
    calls.length = 0;
    const second = await removal.remove(WINDOW, ask, write("dev-phone", ask.tailscaleIds));
    expect(second.removed).toBe(false);
    expect(calls.at(-1)).toContain('"outcome":"cancelled","reasonCode":"DEVICE_ALREADY_REMOVED"');
    // and the sweep its write set going finds nothing this desktop has not swept
    calls.length = 0;
    await removal.sweep();
    expect(calls).toEqual(["sync"]);
  });

  it("the effect still runs when the audit cannot be written: the phone is refused and closed all the same, the caller hears the failure, and a merged sweep's runs too", async () => {
    const { removal, calls, state, refused, write } = rig();
    state.auditDown = true;
    const ask = { deviceId: "dev-phone", tailscaleIds: ["node-1"] };
    await expect(removal.remove(WINDOW, ask, write("dev-phone", ["node-1"]))).rejects.toThrow(
      "the ledger is full",
    );
    expect(calls).toEqual([
      "write dev-phone node-1",
      "sync",
      `transcripts tailnet:${LOGIN}#node-1`,
      "transcripts peer-fieldd:dev-home#phone:dev-phone",
      "connections node-1",
      `freeway freeway:${LOGIN}#node-1`,
    ]);
    // another desktop's Remove, merged here while the ledger is still down: swept, and quiet
    refused.set("dev-other", new Set(["node-9"]));
    calls.length = 0;
    await removal.sweep();
    expect(calls).toEqual([
      "sync",
      `transcripts tailnet:${LOGIN}#node-9`,
      "transcripts peer-fieldd:dev-home#phone:dev-other",
      "connections node-9",
      `freeway freeway:${LOGIN}#node-9`,
    ]);
  });

  it("a refusal merged from another desktop is swept once, as this desktop's own act; a node id carried later is swept alone; what stood at boot is seeded, never swept", async () => {
    const { removal, calls, refused } = rig({ refused: { "dev-old": ["node-old"] } });
    // nothing of a phone lives in a daemon whose door has not opened yet
    await removal.seed();
    await removal.sweep();
    expect(calls).toEqual(["sync"]);

    refused.set("dev-phone", new Set(["node-1"]));
    calls.length = 0;
    await removal.sweep();
    expect(calls).toEqual([
      "sync",
      'audit system device.remove dev-phone {"via":"merge"}',
      `transcripts tailnet:${LOGIN}#node-1`,
      "transcripts peer-fieldd:dev-home#phone:dev-phone",
      "connections node-1",
      `freeway freeway:${LOGIN}#node-1`,
      'outcome {"outcome":"succeeded","attrs":{"closed":2}}',
    ]);
    calls.length = 0;
    await removal.sweep();
    expect(calls).toEqual(["sync"]);

    // the phone registered again, its new node carried into the refusals (on any desktop)
    refused.get("dev-phone")?.add("node-2");
    calls.length = 0;
    await removal.sweep();
    expect(calls).toEqual([
      "sync",
      'audit system device.remove dev-phone {"via":"append"}',
      `transcripts tailnet:${LOGIN}#node-2`,
      "transcripts peer-fieldd:dev-home#phone:dev-phone",
      "connections node-2",
      `freeway freeway:${LOGIN}#node-2`,
      'outcome {"outcome":"succeeded","attrs":{"closed":2}}',
    ]);
  });
});
