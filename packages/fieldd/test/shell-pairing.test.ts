// OB custody (C2) — THE SHELL PAIRS, IT DOES NOT BEAR.
//
// At `files` the shell's whole authority is a bearer in `fieldd/run/shell.token`, which every process of the same
// user can read (EL7's adversary, T1). A fieldd handed custody mints no such bearer: a `shell-main` hello carries a
// MAC under the secret the spawner handed, over the port it dialled, the daemon's boot and user, a nonce and the
// clock, and the ack answers a MAC of its own. The secret is never sent, so a listener planted by rewriting
// `product.json` learns nothing and cannot answer, and a hello made for one port and boot is no hello for another.
//
// One sealed daemon per row, over the mock floor, booted in this process through `FielddConfig.custody` (the seam
// `bin.ts` fills from its stdin; custody-boot.test.ts runs that road). The shell's half is the harness's own
// spelling of the recipe (custody-harness.ts), not fieldd's.
//
// Every refusal row begins with a CONTROL: the honest hello pairs on that very daemon. A refusal alone proves
// nothing, because a daemon that pairs nobody refuses everything.
import { CUSTODY, SCOPES } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { TokenService } from "../src/token-service";
import {
  bootFiles,
  bootSealed,
  type Cleanup,
  HANDED,
  hello,
  helloErr,
  nowSecs,
  openDoor,
  type PairingCredential,
  pairingCredential,
  runCleanup,
  type SealedWorld,
  type ShellAck,
  shellAckMac,
} from "./custody-harness";
import { type RpcErrorShape, until, type WsRpc } from "./ws-rpc";

const cleanup: Cleanup = [];
afterEach(() => runCleanup(cleanup));

const participant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});

/** The control: on this daemon, the honest hello pairs. */
async function pairs(
  world: SealedWorld,
  userId = "",
): Promise<{ rpc: WsRpc; ack: ShellAck; credential: PairingCredential }> {
  const { controlPort: port, bootId } = world.daemon;
  const rpc = await openDoor(cleanup, port);
  const credential = pairingCredential({ port, bootId, userId });
  const ack = await hello(rpc, credential);
  return { rpc, ack, credential };
}

/** A hello the door refuses as it refuses a bad token: UNAUTHORIZED, and the socket closed. */
async function refused(
  world: SealedWorld,
  credential: unknown,
  clientKind = "shell-main",
): Promise<RpcErrorShape> {
  const rpc = await openDoor(cleanup, world.daemon.controlPort);
  const error = await helloErr(rpc, credential, clientKind);
  expect(error.data?.kind).toBe("UNAUTHORIZED");
  await until(() => rpc.closed, 4_000, "the refused connection closes");
  return error;
}

describe("the shell's pairing at a sealed fieldd (C2)", () => {
  it("a hello whose mac verifies is shell-main", async () => {
    const world = await bootSealed(cleanup);
    const { rpc, ack } = await pairs(world);
    // every scope, as the bearer's grant was
    expect([...ack.grantedScopes].sort()).toEqual([...SCOPES].sort());
    // and the kind itself: minting a window's token is the local shell's alone (`requireShellWindowTokenAuthority`)
    const minted = (await rpc.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-1",
      rendererParticipant: participant("1"),
    })) as { scopes: string[] };
    expect(minted.scopes).toEqual(["canvas.read"]);
    // no bearer stands behind any of it
    expect(world.daemon.shellToken).toBeUndefined();
  });

  it("a mac for another port is refused", async () => {
    const world = await bootSealed(cleanup);
    await pairs(world);
    const { controlPort: port, bootId } = world.daemon;
    // what a planted listener relays: the hello the shell made for the port IT dialled
    await refused(world, pairingCredential({ port, bootId, macOver: { port: port + 1 } }));
  });

  it("a mac for another boot is refused", async () => {
    const world = await bootSealed(cleanup);
    await pairs(world);
    const { controlPort: port, bootId } = world.daemon;
    const other = "fieldd-0000000000000000";
    // a hello that says another boot, its mac honest over what it says
    await refused(world, pairingCredential({ port, bootId: other }));
    // and one that says this boot over a mac made for another
    await refused(world, pairingCredential({ port, bootId, macOver: { bootId: other } }));
  });

  it("a nonce twice is refused", async () => {
    const world = await bootSealed(cleanup);
    const { credential } = await pairs(world);
    // the very hello again, on a new connection
    await refused(world, credential);
    // a nonce that is no nonce: not 32 lowercase hex characters, its mac honest over it
    const { controlPort: port, bootId } = world.daemon;
    await refused(world, pairingCredential({ port, bootId, nonce: "A".repeat(32) }));
    await refused(world, pairingCredential({ port, bootId, nonce: "ab".repeat(8) }));
    // and a fresh one pairs as before
    await pairs(world);
  });

  it("a stale ts is refused", async () => {
    const world = await bootSealed(cleanup);
    await pairs(world);
    const { controlPort: port, bootId } = world.daemon;
    const past = nowSecs() - CUSTODY.WINDOW_SECS - 60;
    const ahead = nowSecs() + CUSTODY.WINDOW_SECS + 60;
    // each mac is honest over the clock it says: only the window refuses it
    await refused(world, pairingCredential({ port, bootId, ts: past }));
    await refused(world, pairingCredential({ port, bootId, ts: ahead }));
  });

  it("a bearer shell-main hello is refused under sealed", async () => {
    const world = await bootSealed(cleanup);
    await pairs(world);
    expect(world.daemon.shellToken).toBeUndefined();
    // the bearer a `files` fieldd would have written: every scope, bound to the shell
    const bearer = world.daemon.tokens.mint([...SCOPES], "a-shell-bearer", { shellMain: true });
    await refused(world, bearer.token);
    // a claim with no credential at all, and one whose credential has no shape
    await refused(world, undefined);
    await refused(world, {});
  });

  it("every other client kind is as it was", async () => {
    const world = await bootSealed(cleanup);
    await pairs(world);
    const { controlPort: port, bootId } = world.daemon;
    // a window's bearer still opens the door for a window
    const grant = world.daemon.tokens.mint(["canvas.read"], "a-window");
    const win = await openDoor(cleanup, port);
    const ack = await hello(win, grant.token, "renderer");
    expect(ack.grantedScopes).toEqual(["canvas.read"]);
    expect(ack.serverMac).toBeUndefined();
    // and the pairing is the shell's alone: it is no credential for another kind
    const rpc = await openDoor(cleanup, port);
    const error = await helloErr(rpc, pairingCredential({ port, bootId }), "renderer");
    expect(error.data?.kind).toBe("UNAUTHORIZED");
  });

  it("the ack proves the server", async () => {
    const world = await bootSealed(cleanup);
    const { ack, credential } = await pairs(world);
    const { controlPort: port, bootId } = world.daemon;
    expect(ack.serverMac).toBe(
      shellAckMac(HANDED.shell, { nonce: credential.nonce, bootId, port }),
    );
  });

  it("the daemon's user is in the mac", async () => {
    const userId = "01JTESTUSER000000000000001";
    const world = await bootSealed(cleanup, { userId });
    const { ack } = await pairs(world, userId);
    expect(ack.userId).toBe(userId);
    const { controlPort: port, bootId } = world.daemon;
    // a hello made for a daemon with no user, and one made for another's
    await refused(world, pairingCredential({ port, bootId }));
    await refused(world, pairingCredential({ port, bootId, userId: "01JTESTUSER000000000000002" }));
  });

  it("every refusal says the same words, and they are a bad token's", async () => {
    const world = await bootSealed(cleanup);
    const { credential } = await pairs(world);
    const { controlPort: port, bootId } = world.daemon;
    const refusals = [
      await refused(world, pairingCredential({ port, bootId, macOver: { port: port + 1 } })),
      await refused(world, pairingCredential({ port, bootId: "fieldd-0000000000000000" })),
      await refused(world, pairingCredential({ port, bootId, ts: 1 })),
      await refused(world, credential),
      await refused(world, pairingCredential({ port, bootId, secretHex: "00".repeat(32) })),
      await refused(world, "tok_not-a-token"),
      await refused(world, {}),
      // what any kind is told for a token nothing minted
      await refused(world, "tok_not-a-token", "renderer"),
    ];
    const [first, ...rest] = refusals;
    expect(first?.message).toBe("invalid token");
    expect(first?.data?.details).toBeUndefined();
    for (const refusal of rest) expect(refusal).toEqual(first);
  });

  it("a window token minted over the paired connection still works, and objects.* still demand a window token", async () => {
    const world = await bootSealed(cleanup);
    const { rpc: shell } = await pairs(world);
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["objects.window", "canvas.read"],
      label: "window-1",
      rendererParticipant: participant("1"),
    })) as { token: string; tokenId: string };
    expect(world.daemon.tokens.verify(minted.token)?.rendererParticipant).toEqual(participant("1"));

    const win = await openDoor(cleanup, world.daemon.controlPort);
    const ack = await hello(win, minted.token, "renderer");
    expect([...ack.grantedScopes].sort()).toEqual(["canvas.read", "objects.window"]);
    // the window's door opens to the window's own token: the call gets as far as its params
    const asked = await win.callErr("objects.ref", {});
    expect(asked.data?.kind).toBe("PRECONDITION_FAILED");
    // and to no one else, the paired shell with every scope included: a scope is not the person's window
    const shellAsked = await shell.callErr("objects.ref", {});
    expect(shellAsked.data?.kind).toBe("FORBIDDEN_SCOPE");
    // the shell takes the window's token back over the same paired connection
    await expect(
      shell.call("system.revokeWindowToken", { tokenId: minted.tokenId }),
    ).resolves.toMatchObject({ revoked: true, droppedConnections: 1 });
    await until(() => win.closed, 4_000, "the revoked window's connection closes");
  });
});

describe("a fieldd handed nothing (files)", () => {
  // A GUARD, not a red row: it holds before custody and after it. `files` is today's door, byte for byte.
  it("the bearer is the shell, and a pairing is no credential", async () => {
    const { daemon } = await bootFiles(cleanup);
    const { controlPort: port, bootId } = daemon;
    const shell = await openDoor(cleanup, port);
    const ack = await hello(shell, daemon.shellToken);
    expect([...ack.grantedScopes].sort()).toEqual([...SCOPES].sort());
    expect(ack.serverMac).toBeUndefined();
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-1",
      rendererParticipant: participant("1"),
    })) as { scopes: string[] };
    expect(minted.scopes).toEqual(["canvas.read"]);

    const rpc = await openDoor(cleanup, port);
    const error = await helloErr(rpc, pairingCredential({ port, bootId }));
    expect(error.data?.kind).toBe("UNAUTHORIZED");
    expect(error.message).toBe("invalid token");
  });
});

describe("a paired connection's id (TokenService.holdId)", () => {
  it("is in the token id space, and no bearer stands behind it", () => {
    const tokens = new TokenService();
    const id = tokens.holdId();
    expect(id).toMatch(/^tk_[0-9a-f]{12}$/);
    // nothing is minted under an id a connection holds
    expect(() => tokens.mint(["canvas.read"], "under-a-held-id", { tokenId: id })).toThrow();
    // and there is no grant by it to revoke
    expect(tokens.revoke(id)).toBe(false);
    // let go, it is an id like any other
    tokens.releaseId(id);
    expect(tokens.mint(["canvas.read"], "after-release", { tokenId: id }).tokenId).toBe(id);
  });

  it("two connections never hold one id", () => {
    const tokens = new TokenService();
    const held = new Set(Array.from({ length: 64 }, () => tokens.holdId()));
    expect(held.size).toBe(64);
  });
});
