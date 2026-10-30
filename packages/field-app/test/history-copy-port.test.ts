/**
 * HN-5 — HISTORY'S WORKSPACE COPY PORT (history/window-ports.ts; DESIGN.md §8 "The hand", where
 * cards come from): a path History's room copies through its workspace port is a copy like any
 * other — on the system clipboard through the one copy door, then a text card that rises into
 * its place (no button's box reaches the port) and says History; a refusal rejects with Copy's
 * whole sentence — the room shows it as the action's receipt, so never a bare clause and never a
 * bridge's error (DESIGN.md §8 "Copy") — and deals nothing. The window's ports hand the room that
 * port.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardsStore } from "../src/frame/cards/cards-store";
import { COPY_DOOR_WORDS } from "../src/frame/cards/cards-words";
import { type FieldHost, setHost } from "../src/host";

const made = vi.hoisted(() => ({ options: [] as Array<() => unknown> }));

// the room's ports themselves are History's own suite's; here only what the window hands them
vi.mock("../src/history/doors", () => ({
  historyPortsOver: (_client: unknown, options: Record<string, unknown>) => {
    made.options.push(() => options);
    return { dispose: () => undefined };
  },
}));
vi.mock("../src/terminal/pool", () => ({ terminalBootstrapHome: () => null }));

const { copyFromHistory, productHistoryPorts, resetWindowHistoryPortsForTest } = await import(
  "../src/history/window-ports"
);

/** A host whose copy door records what it was given, and takes it or not. */
function copyHost(takes = true): string[] {
  const copied: string[] = [];
  setHost({
    logger: {},
    diagnostics: {
      copyText: async (text: string) => {
        copied.push(text);
        if (!takes) throw new Error("clipboard text is invalid or too large");
      },
    },
  } as unknown as FieldHost);
  return copied;
}

afterEach(() => {
  for (const card of cardsStore.snapshot().cards) cardsStore.remove(card.id);
  resetWindowHistoryPortsForTest();
  made.options.length = 0;
});

describe("History's workspace copy port (HN-5)", () => {
  it("puts the path on the clipboard, then deals a text card that rises into place", async () => {
    const copied = copyHost();
    await copyFromHistory("/Users/ada/vibe-field/src/main.ts");
    expect(copied).toEqual(["/Users/ada/vibe-field/src/main.ts"]);
    const card = cardsStore.snapshot().cards.at(-1);
    expect(card).toMatchObject({
      kind: "text",
      paste: "/Users/ada/vibe-field/src/main.ts",
      origin: { view: "history", how: "copy" },
    });
    expect(card?.origin.place).toBeUndefined();
    expect(cardsStore.snapshot().arriving.get(card?.id ?? "")).toBeNull();
  });

  it("rejects a refused copy with Copy's whole sentence and deals nothing", async () => {
    copyHost(false);
    await expect(copyFromHistory("/Users/ada/secret.txt")).rejects.toThrow(
      /^Not copied — the clipboard did not take the words$/u,
    );
    expect(COPY_DOOR_WORDS.refused(COPY_DOOR_WORDS.words)).toBe(
      "Not copied — the clipboard did not take the words",
    );
    expect(cardsStore.snapshot().cards).toEqual([]);
  });

  it("is the port the window's History ports hand the room", () => {
    copyHost();
    productHistoryPorts({} as never);
    const options = made.options.at(-1)?.() as { workspace?: { copyText?: unknown } } | undefined;
    expect(options?.workspace?.copyText).toBe(copyFromHistory);
  });
});
