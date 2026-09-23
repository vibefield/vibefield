import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The users door as the PAGE sees it (UA-3/UA-5/UA-7). The sibling preload
// bridges are plain classes with their own tests; these four verbs live directly
// on the exposed object, so the only way to test them is to capture what
// `exposeInMainWorld` was handed. `electron` is mocked the way security.test.ts
// and close.test.ts mock it — this package's existing pattern, not a new
// harness.
//
// What is worth pinning here is the boundary, both ways: a malformed
// renderer→main payload throws at its call site instead of crossing, and a
// malformed main→renderer answer never reaches the page.

const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, value: Record<string, unknown>) => {
      stub.exposed = value;
    },
  },
  ipcRenderer: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    invoke: stub.invoke,
  },
  sharedTexture: {
    setSharedTextureReceiver: vi.fn(),
  },
}));
vi.mock("@vibecook/ghosttea-electron/preload", () => ({
  forwardGhostteaRendererPorts: vi.fn(),
}));

await import("../src/preload/index");

const bridge = (): Record<string, unknown> => {
  if (stub.exposed === undefined) throw new Error("preload exposed nothing");
  return stub.exposed;
};

const usersUpdate = (): ((params: unknown) => Promise<unknown>) =>
  bridge().usersUpdate as (params: unknown) => Promise<unknown>;
const usersList = (): (() => Promise<unknown>) => bridge().usersList as () => Promise<unknown>;
const usersCreate = (): ((params: unknown) => Promise<unknown>) =>
  bridge().usersCreate as (params: unknown) => Promise<unknown>;
const usersSwitch = (): ((params: unknown) => Promise<unknown>) =>
  bridge().usersSwitch as (params: unknown) => Promise<unknown>;

const RECORD = {
  userId: "01J8ZQ7W9K3M5N7P9R1T3V5X7Z",
  fuid: 2,
  name: "Work",
  face: { emoji: "🐙", frame: "coin" },
  resident: true,
  onboarded: false,
  createdAt: "2026-08-05T09:00:00.000Z",
};

describe("preload users door", () => {
  beforeEach(() => {
    stub.invoke.mockReset();
  });

  it("exposes the whole door and no channel strings with it", () => {
    expect(typeof bridge().claimLiveSurfacePortBridge).toBe("function");
    expect(typeof bridge().usersUpdate).toBe("function");
    expect(typeof bridge().usersList).toBe("function");
    expect(typeof bridge().usersCreate).toBe("function");
    expect(typeof bridge().usersSwitch).toBe("function");
    // Nothing electron-shaped escapes into the page.
    expect(Object.values(bridge()).some((value) => value === stub.invoke)).toBe(false);
  });

  it("lets renderer-host claim the Live Surfaces bridge nonce exactly once", () => {
    const claim = bridge().claimLiveSurfacePortBridge as () => string;
    expect(claim()).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => claim()).toThrow(/already claimed/u);
  });

  it("asks for the roster with an empty payload and parses the answer", async () => {
    const snapshot = { attachedUserId: RECORD.userId, users: [RECORD] };
    stub.invoke.mockResolvedValueOnce(snapshot);

    await expect(usersList()()).resolves.toEqual(snapshot);
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.usersList, {});
  });

  it("carries a passthrough field the page needs but the schema never named", async () => {
    // `setupVariant` is how the reloaded window learns it is the second user —
    // a tolerant-reader field. A strict parse here would silently strip it.
    stub.invoke.mockResolvedValueOnce({
      attachedUserId: null,
      users: [{ ...RECORD, setupVariant: "second-user" }],
    });

    const snapshot = (await usersList()()) as { users: { setupVariant?: string }[] };
    expect(snapshot.users[0]?.setupVariant).toBe("second-user");
  });

  it("refuses a malformed roster rather than handing the page a shape it cannot read", async () => {
    stub.invoke.mockResolvedValueOnce({ users: [RECORD] });
    await expect(usersList()()).rejects.toThrow();
  });

  it("mints with the params it was given and answers with the whole record", async () => {
    stub.invoke.mockResolvedValueOnce(RECORD);

    await expect(usersCreate()({})).resolves.toEqual(RECORD);
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.usersCreate, {});
  });

  it("switches by userId and validates both directions", async () => {
    stub.invoke.mockResolvedValueOnce(RECORD);

    await expect(usersSwitch()({ userId: RECORD.userId })).resolves.toEqual(RECORD);
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.usersSwitch, {
      userId: RECORD.userId,
    });

    // A malformed ANSWER is refused too: main is not trusted to be in step.
    stub.invoke.mockResolvedValueOnce({ userId: RECORD.userId });
    await expect(usersSwitch()({ userId: RECORD.userId })).rejects.toThrow();
  });

  it("throws at the call site instead of crossing the boundary with a bad switch", async () => {
    await expect(usersSwitch()({ userId: "" })).rejects.toThrow();
    await expect(usersSwitch()({})).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
  });
});

describe("preload profile door: the face (UA-7)", () => {
  beforeEach(() => {
    stub.invoke.mockReset();
  });

  it("writes a face and answers with the whole record", async () => {
    stub.invoke.mockResolvedValueOnce(RECORD);

    await expect(usersUpdate()({ face: { emoji: "🐙", frame: "coin" } })).resolves.toEqual(RECORD);
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.usersUpdate, {
      face: { emoji: "🐙", frame: "coin" },
    });
  });

  it("throws at the call site on a face with no emoji or an unknown frame", async () => {
    await expect(usersUpdate()({ face: { emoji: "" } })).rejects.toThrow();
    await expect(usersUpdate()({ face: { emoji: "🐙", frame: "halo" } })).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
  });

  it("hands the page main's refusal in main's own words", async () => {
    // Electron 43's exact wrapping: main replies with the error's toString(),
    // and invoke rethrows it under a channel prefix.
    stub.invoke.mockRejectedValueOnce(
      new Error(
        `Error invoking remote method '${IPC_CHANNELS.usersUpdate}': Error: Work already wears 🐙 on this machine.`,
      ),
    );

    await expect(usersUpdate()({ face: { emoji: "🐙" } })).rejects.toThrow(
      /^Work already wears 🐙 on this machine\.$/u,
    );
  });

  it("unwraps every users verb, whatever Error class main threw", async () => {
    // The §3.3 lock refuses with a UsersError, whose name rides the wrapper.
    const locked =
      "another VibeField process is using this data folder (pid 42, mutate). Quit it and try again.";
    const wrapped = (channel: string, inner: string): Error =>
      new Error(`Error invoking remote method '${channel}': ${inner}`);

    stub.invoke.mockRejectedValueOnce(wrapped(IPC_CHANNELS.usersCreate, `UsersError: ${locked}`));
    await expect(usersCreate()({})).rejects.toMatchObject({ message: locked });

    stub.invoke.mockRejectedValueOnce(
      wrapped(IPC_CHANNELS.usersSwitch, "Error: a user switch is already in flight"),
    );
    await expect(usersSwitch()({ userId: RECORD.userId })).rejects.toMatchObject({
      message: "a user switch is already in flight",
    });

    stub.invoke.mockRejectedValueOnce(wrapped(IPC_CHANNELS.usersList, `UsersError: ${locked}`));
    await expect(usersList()()).rejects.toMatchObject({ message: locked });

    stub.invoke.mockRejectedValueOnce(wrapped(IPC_CHANNELS.usersUpdate, `UsersError: ${locked}`));
    await expect(usersUpdate()({ name: "Work" })).rejects.toMatchObject({ message: locked });
  });

  it("leaves a rejection it does not recognise exactly as it came", async () => {
    stub.invoke.mockRejectedValueOnce(new Error("the renderer went away"));
    await expect(usersUpdate()({ name: "Work" })).rejects.toThrow(/^the renderer went away$/u);
  });

  it("tolerates a legacy colour in the answer and never needs one", async () => {
    const { face: _face, ...legacy } = RECORD;
    stub.invoke.mockResolvedValueOnce({ ...legacy, color: "accent-5" });

    await expect(usersUpdate()({})).resolves.toMatchObject({ name: "Work", color: "accent-5" });
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.usersUpdate, {});
  });
});
