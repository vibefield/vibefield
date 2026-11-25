// @vitest-environment node
/**
 * IK, V5b — THE WORDS BAR'S MORE (field/desk/bar/bar-words-more.ts, bar-acts.ts `runWordsCommand`; DESIGN.md §8 "The words
 * bar" — More, Keys; ICE I60's `DeskEditor.command`). Pure rows: Cut · Copy · Paste | Select all, nearest first, each with
 * the platform field's key spelt for the platform; Paste reads through the shell's clipboard door (round two) and WAITS only
 * where there is none (the browser catalog),
 * saying the key that pastes; a row's id names its command and nothing else does. The one run: the editor's command, its
 * answer, and the status line's words when it did nothing — never a silent nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWordsCommand } from "../src/field/desk/bar/bar-acts";
import {
  commandOfRow,
  pasteWaits,
  WORDS_EYEBROW,
  wordsMenuGroups,
  wordsMissed,
  wordsPasteOf,
} from "../src/field/desk/bar/bar-words-more";
import type { FieldHost } from "../src/host";
import { getRendererLogger } from "../src/logging";

afterEach(() => {
  vi.restoreAllMocks();
});

const said = (groups: ReturnType<typeof wordsMenuGroups>): string[][] =>
  groups.map((group) =>
    group.map(
      (row) => `${row.id} ${row.label} ${row.key}${row.waits === undefined ? "" : " waits"}`,
    ),
  );

describe("the words' menu (§8 'The words bar' — More)", () => {
  it("nearest first: Cut · Copy · Paste | Select all, the field's keys on a Mac", () => {
    expect(said(wordsMenuGroups("mac", "door"))).toEqual([
      ["words:cut Cut ⌘X", "words:copy Copy ⌘C", "words:paste Paste ⌘V"],
      ["words:selectAll Select all ⌘A"],
    ]);
    expect(WORDS_EYEBROW).toBe("WORDS");
  });

  it("the keys spelt for the platform elsewhere", () => {
    expect(said(wordsMenuGroups("other", "door"))).toEqual([
      ["words:cut Cut Ctrl+X", "words:copy Copy Ctrl+C", "words:paste Paste Ctrl+V"],
      ["words:selectAll Select all Ctrl+A"],
    ]);
  });

  it("where the host has no clipboard door (the browser catalog) Paste waits, saying the key that pastes; the rest stand", () => {
    const groups = wordsMenuGroups("mac", "none");
    expect(said(groups)).toEqual([
      ["words:cut Cut ⌘X", "words:copy Copy ⌘C", "words:paste Paste ⌘V waits"],
      ["words:selectAll Select all ⌘A"],
    ]);
    expect(groups[0]?.[2]?.waits).toBe(pasteWaits("mac"));
    expect(pasteWaits("mac")).toBe("the bar can't read the clipboard here; ⌘V pastes");
    expect(pasteWaits("other")).toBe("the bar can't read the clipboard here; Ctrl+V pastes");
  });

  it("the road by the host: one with the clipboard door (main's read) is the door; none, or one without it, no road", () => {
    const clipboard = { readText: async () => "", writeImage: async () => undefined };
    expect(wordsPasteOf({ clipboard } as Pick<FieldHost, "clipboard">)).toBe("door");
    expect(wordsPasteOf({} as Pick<FieldHost, "clipboard">)).toBe("none");
    expect(wordsPasteOf(null)).toBe("none");
  });

  it("a row's id names its command; no other row does (the objects' Copy is Make a card's)", () => {
    expect(["words:cut", "words:copy", "words:paste", "words:selectAll"].map(commandOfRow)).toEqual(
      ["cut", "copy", "paste", "selectAll"],
    );
    for (const id of [
      "copy",
      "act:ink.clear",
      "words:",
      "words:delete",
      "words:toString",
      "delete",
    ])
      expect(commandOfRow(id), id).toBeUndefined();
  });

  it("what is said when a command did nothing: the words and the key that does it; Select all nothing", () => {
    expect(wordsMissed("cut", "mac")).toBe("Couldn't cut these words. ⌘X cuts them.");
    expect(wordsMissed("copy", "other")).toBe("Couldn't copy these words. Ctrl+C copies them.");
    expect(wordsMissed("paste", "mac")).toBe(
      "Nothing to paste here. ⌘V pastes from the clipboard.",
    );
    expect(wordsMissed("selectAll", "mac")).toBeUndefined();
  });
});

describe("the one run of the editor's items (runWordsCommand)", () => {
  const editorAnswering = (answer: boolean | Error) => {
    const command = vi.fn(async (_name: string, _opts?: { readonly text?: string }) => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    return { command };
  };

  it("asks the editor once, at once, and says nothing when it did the command", async () => {
    const editor = editorAnswering(true);
    const say = vi.fn();
    const done = runWordsCommand(editor, "copy", "mac", say);
    // asked inside the call — the press's own event — never after a tick
    expect(editor.command).toHaveBeenCalledTimes(1);
    expect(editor.command).toHaveBeenCalledWith("copy");
    await expect(done).resolves.toBe(true);
    expect(say).not.toHaveBeenCalled();
  });

  it("an answer of nothing done is said once, with the key", async () => {
    const say = vi.fn();
    await expect(runWordsCommand(editorAnswering(false), "paste", "mac", say)).resolves.toBe(false);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("Nothing to paste here. ⌘V pastes from the clipboard.");
    const quiet = vi.fn();
    await runWordsCommand(editorAnswering(false), "selectAll", "mac", quiet);
    expect(quiet).not.toHaveBeenCalled();
  });

  it("a refusal is logged and said; with no editor it is said", async () => {
    const warn = vi.fn();
    vi.spyOn(getRendererLogger(), "child").mockReturnValue({ warn } as never);
    const say = vi.fn();
    await expect(
      runWordsCommand(editorAnswering(new Error("denied")), "cut", "mac", say),
    ).resolves.toBe(false);
    expect(say).toHaveBeenCalledWith("Couldn't cut these words. ⌘X cuts them.");
    expect(warn).toHaveBeenCalledWith(
      "renderer.desk.words-command-failed",
      "The editor's command failed",
      { command: "cut", error: "denied" },
    );
    const none = vi.fn();
    await expect(runWordsCommand(null, "copy", "mac", none)).resolves.toBe(false);
    expect(none).toHaveBeenCalledWith("Couldn't copy these words. ⌘C copies them.");
  });

  it('PASTE through the door (round two): the words read FIRST, then handed in — `command("paste", { text })`, the editor reading no clipboard', async () => {
    const order: string[] = [];
    const editor = {
      command: vi.fn(async (name: string, opts?: { readonly text?: string }) => {
        order.push(`command ${name} ${JSON.stringify(opts)}`);
        return true;
      }),
    };
    const read = vi.fn(async () => {
      order.push("read");
      return "one two";
    });
    const say = vi.fn();
    await expect(runWordsCommand(editor, "paste", "mac", say, read)).resolves.toBe(true);
    expect(order).toEqual(["read", 'command paste {"text":"one two"}']);
    expect(say).not.toHaveBeenCalled();
    // the other three never read: the door is Paste's alone
    const others = vi.fn(async () => "x");
    await runWordsCommand(editor, "copy", "mac", say, others);
    expect(others).not.toHaveBeenCalled();
    expect(editor.command).toHaveBeenLastCalledWith("copy");
    // without a door the editor's own paste (no words handed)
    await runWordsCommand(editor, "paste", "mac", say);
    expect(editor.command).toHaveBeenLastCalledWith("paste");
  });

  it("a read the door refused is said and logged, and the editor is not asked; an empty clipboard is the editor's to answer", async () => {
    const warn = vi.fn();
    vi.spyOn(getRendererLogger(), "child").mockReturnValue({ warn } as never);
    const editor = editorAnswering(true);
    const say = vi.fn();
    const refused = vi.fn(async (): Promise<string> => {
      throw new Error("not the focused window");
    });
    await expect(runWordsCommand(editor, "paste", "mac", say, refused)).resolves.toBe(false);
    expect(editor.command).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith("Couldn't read the clipboard. ⌘V pastes from it.");
    expect(warn).toHaveBeenCalledWith(
      "renderer.desk.words-paste-unread",
      "The clipboard door refused its read",
      { command: "paste", error: "not the focused window" },
    );
    // a read that throws at once is the same refusal
    const thrown = (): Promise<string> => {
      throw new Error("no bridge");
    };
    await expect(runWordsCommand(editor, "paste", "other", say, thrown)).resolves.toBe(false);
    expect(say).toHaveBeenLastCalledWith("Couldn't read the clipboard. Ctrl+V pastes from it.");
    // nothing on the clipboard: the editor answers false, and the bar says so
    const empty = editorAnswering(false);
    await runWordsCommand(empty, "paste", "mac", say, async () => "");
    expect(empty.command).toHaveBeenCalledWith("paste", { text: "" });
    expect(say).toHaveBeenLastCalledWith("Nothing to paste here. ⌘V pastes from the clipboard.");
  });
});
