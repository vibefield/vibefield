import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The users door as the PAGE sees it (UA-3/UA-5). The sibling preload bridges
// are plain classes with their own tests; these three verbs live directly on
// the exposed object, so the only way to test them is to capture what
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

const usersList = (): (() => Promise<unknown>) => bridge().usersList as () => Promise<unknown>;
const usersCreate = (): ((params: unknown) => Promise<unknown>) =>
  bridge().usersCreate as (params: unknown) => Promise<unknown>;
const usersSwitch = (): ((params: unknown) => Promise<unknown>) =>
  bridge().usersSwitch as (params: unknown) => Promise<unknown>;

const RECORD = {
  userId: "01J8ZQ7W9K3M5N7P9R1T3V5X7Z",
  fuid: 2,
  name: "Work",
  color: "accent-5",
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
