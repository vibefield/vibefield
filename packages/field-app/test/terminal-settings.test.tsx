// @vitest-environment happy-dom
/**
 * GT-7 — Settings → Terminal, wired. The page owns no truth about the Mac: it
 * reads config.ghostty through fieldd, asks the loader about a draft that
 * rests (`terminal.config.validate`), and writes with the revision it read, so
 * a file that changed underneath it is a CONFLICT the user settles, never a
 * silent clobber. These cases drive the shipping controller against a fake
 * fieldd that answers with the catalog's fixture document.
 */
import type { TerminalConfigDocument } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_CONFIG_PATH,
  FIXTURE_SAVED_SNAPSHOT,
  FIXTURE_SAVED_TEXT,
} from "../src/design-system/terminal-settings-fixtures";
import type { SettingsSubpage } from "../src/panels/SettingsDialog";
import { MANAGED_BLOCK_START } from "../src/panels/terminal/config-text";
import { TerminalSettings } from "../src/panels/terminal/TerminalSettings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

const SAVED: TerminalConfigDocument = {
  path: FIXTURE_CONFIG_PATH,
  text: FIXTURE_SAVED_TEXT,
  revision: "rev-1",
  exists: true,
  config: FIXTURE_SAVED_SNAPSHOT,
};

let handlers: Record<string, Handler> = {};
const calls: { method: string; params: Record<string, unknown> }[] = [];

const fieldd = {
  request: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ method, params });
    const handler = handlers[method];
    return handler === undefined
      ? Promise.reject(new Error(`unexpected method ${method}`))
      : handler(params);
  },
};

vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => fieldd,
}));

let root: Root | null = null;
let host: HTMLElement | null = null;
const subpages: (SettingsSubpage | null)[] = [];

beforeEach(() => {
  calls.length = 0;
  subpages.length = 0;
  handlers = {
    "terminal.config.read": () => Promise.resolve(SAVED),
    "terminal.config.validate": () =>
      Promise.resolve({
        documentRevision: "doc-2",
        includesAllowed: true,
        blocking: [],
        config: FIXTURE_SAVED_SNAPSHOT,
      }),
  };
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function mount(): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  const node = host;
  act(() => {
    root = createRoot(node);
    root.render(<TerminalSettings onSubpage={(subpage) => subpages.push(subpage)} />);
  });
  await settle();
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (found === undefined) throw new Error(`no button "${label}"`);
  return found;
}

function click(label: string): void {
  act(() => button(label).click());
}

function bar(): string {
  return host?.querySelector(".vf-ts-savebar")?.textContent ?? "";
}

/** Edit through a control, and let the loader answer about the draft. */
async function raiseScrollback(): Promise<void> {
  click("Behavior");
  click("More scrollback");
  await settle(400);
}

describe("Settings → Terminal against fieldd (GT-7)", () => {
  it("reads the document, and shows this Mac's value where it came from", async () => {
    await mount();
    expect(calls[0]?.method).toBe("terminal.config.read");
    click("Behavior");
    expect(host?.textContent).toContain("Set in config.ghostty.");
    expect(host?.querySelector(".vf-ts-stepper output")?.textContent).toBe("25 MB");
    expect(bar()).toBe("");
  });

  it("checks a draft that rests, then saves it with the revision it read", async () => {
    await mount();
    click("Behavior");
    click("More scrollback");
    expect(bar()).toContain("1 change to config.ghostty");
    expect(bar()).toContain("checking…");
    expect(button("Save").disabled).toBe(true);

    await settle(400);
    const draft = FIXTURE_SAVED_TEXT.replace("25000000", "50000000");
    expect(calls.filter((call) => call.method === "terminal.config.validate")).toEqual([
      { method: "terminal.config.validate", params: { text: draft } },
    ]);
    expect(bar()).toContain("every terminal on this Mac reloads when you save");
    expect(button("Save").disabled).toBe(false);

    handlers["terminal.config.write"] = (params) =>
      Promise.resolve({
        ok: true,
        document: { ...SAVED, text: String(params.text), revision: "rev-2" },
        effectiveChanged: true,
        diagnostics: [],
        config: { ...FIXTURE_SAVED_SNAPSHOT, scrollbackBytes: 50_000_000 },
      });
    click("Save");
    await settle();
    expect(calls.find((call) => call.method === "terminal.config.write")?.params).toEqual({
      text: draft,
      revision: "rev-1",
    });
    expect(bar()).toContain("Saved. Every terminal on this Mac reloaded.");
    click("OK");
    expect(bar()).toBe("");
    expect(host?.querySelector(".vf-ts-stepper output")?.textContent).toBe("50 MB");
  });

  it("puts the file's newer version beside the draft on a conflict, and can take it", async () => {
    const theirs = `${FIXTURE_SAVED_TEXT}font-thicken = false\n`;
    handlers["terminal.config.write"] = () =>
      Promise.reject(
        new FielddRpcError("CONFLICT", "stale revision", false, {
          current: { ...SAVED, text: theirs, revision: "rev-9" },
        }),
      );
    await mount();
    await raiseScrollback();
    click("Save");
    await settle();
    expect(bar()).toContain("config.ghostty changed on disk since this page read it.");
    click("Use the file's version");
    expect(bar()).toBe("");
    click("Config file");
    expect(host?.querySelector("textarea")?.value).toBe(theirs);
  });

  it("can save the draft over the file's newer version, with that version's revision", async () => {
    let attempt = 0;
    handlers["terminal.config.write"] = (params) => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(
            new FielddRpcError("CONFLICT", "stale revision", false, {
              current: { ...SAVED, text: "theirs = 1\n", revision: "rev-9" },
            }),
          )
        : Promise.resolve({
            ok: true,
            document: { ...SAVED, text: String(params.text), revision: "rev-10" },
            effectiveChanged: true,
            diagnostics: [],
          });
    };
    await mount();
    await raiseScrollback();
    click("Save");
    await settle();
    click("Save mine over it");
    await settle();
    const writes = calls.filter((call) => call.method === "terminal.config.write");
    expect(writes.map((call) => call.params.revision)).toEqual(["rev-1", "rev-9"]);
    expect(bar()).toContain("Saved.");
  });

  it("says the service refused a save, in the service's own terms", async () => {
    handlers["terminal.config.write"] = () =>
      Promise.reject(
        new FielddRpcError("PRECONDITION_FAILED", "blocking errors", false, {
          reason: "blocking-errors",
          blocking: [{ severity: "error", code: "invalid-color", message: "bad" }],
        }),
      );
    await mount();
    await raiseScrollback();
    click("Save");
    await settle();
    expect(bar()).toContain("the service refused it (1 error)");
  });

  it("keeps Save reachable when the dry run itself can't run", async () => {
    handlers["terminal.config.validate"] = () => Promise.reject(new Error("socket closed"));
    await mount();
    await raiseScrollback();
    expect(bar()).toContain("Couldn't check the file: socket closed");
    expect(bar()).not.toContain("checking…");
    expect(button("Save").disabled).toBe(false);
  });

  it("holds Save while the loader reports an error in the draft", async () => {
    handlers["terminal.config.validate"] = () =>
      Promise.resolve({
        documentRevision: "doc-2",
        includesAllowed: true,
        blocking: [{ severity: "error", code: "invalid-value", message: "bad", line: 7 }],
      });
    await mount();
    await raiseScrollback();
    expect(bar()).toContain("1 error to fix first");
    expect(button("Save").disabled).toBe(true);
  });

  it("returns the saved text on Discard", async () => {
    await mount();
    await raiseScrollback();
    click("Discard");
    expect(bar()).toBe("");
    expect(host?.querySelector(".vf-ts-stepper output")?.textContent).toBe("25 MB");
  });

  it("names a floor with no config file honestly, and offers no retry that can't help", async () => {
    handlers["terminal.config.read"] = () =>
      Promise.reject(
        new FielddRpcError("UNAVAILABLE", "no overlay", false, {
          service: "terminal",
          state: "no-overlay",
        }),
      );
    await mount();
    expect(host?.textContent).toContain("This terminal service has no config file");
    expect(() => button("Try again")).toThrow();
  });

  it("retries a floor that isn't answering", async () => {
    let reads = 0;
    handlers["terminal.config.read"] = () => {
      reads += 1;
      return reads === 1
        ? Promise.reject(
            new FielddRpcError("UNAVAILABLE", "floor down", true, {
              service: "terminal",
              state: "down",
            }),
          )
        : Promise.resolve(SAVED);
    };
    await mount();
    expect(host?.textContent).toContain("The terminal service isn't answering");
    click("Try again");
    await settle();
    expect(reads).toBe(2);
    expect(host?.textContent).not.toContain("The terminal service isn't answering");
  });

  it("refuses to rewrite a block with broken markers, and says where to fix it", async () => {
    handlers["terminal.config.read"] = () =>
      Promise.resolve({ ...SAVED, text: `${MANAGED_BLOCK_START}\nscrollback-limit = 1\n` });
    await mount();
    click("Behavior");
    click("More scrollback");
    expect(bar()).toContain("The managed block's markers are broken");
    expect(calls.some((call) => call.method === "terminal.config.validate")).toBe(false);
  });

  it("never places the saved file's line numbers on a draft the loader hasn't read", async () => {
    // The saved snapshot warns about line 3 (`font-thicken`). The edit puts an
    // include on top, so the loader refuses to read it — and line 3 of the
    // DRAFT is now `cursor-style`, which the warning is not about.
    handlers["terminal.config.read"] = () =>
      Promise.resolve({
        ...SAVED,
        config: {
          ...FIXTURE_SAVED_SNAPSHOT,
          diagnostics: [
            {
              severity: "warning",
              code: "deprecated",
              message: "font-thicken is deprecated",
              source: FIXTURE_CONFIG_PATH,
              line: 3,
              key: "font-thicken",
            },
          ],
        },
      });
    handlers["terminal.config.validate"] = () =>
      Promise.resolve({ documentRevision: "doc-2", includesAllowed: false, blocking: [] });
    await mount();
    click("Config file");
    const gutter = (line: number): string | undefined =>
      host?.querySelectorAll<HTMLElement>(".vf-ts-editor-gutter span")[line - 1]?.dataset.mark;
    expect(gutter(3)).toBe("warning");
    const textarea = host?.querySelector("textarea");
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(textarea, `config-file = ~/elsewhere\n${FIXTURE_SAVED_TEXT}`);
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(400);
    expect(bar()).toContain("includes can't change here");
    expect(gutter(3)).not.toBe("warning");
    expect(gutter(4)).not.toBe("warning");
    expect(host?.textContent).toContain(
      "The loader hasn't read these edits; this is the saved file.",
    );
    expect(host?.textContent).toContain("saved line 3");
  });

  it("opens the theme browser as the dialog's subpage, with the way back", async () => {
    await mount();
    click("Match a theme…");
    const opened = subpages.at(-1);
    expect(opened?.backLabel).toBe("Back to Terminal");
    act(() => opened?.onBack());
    expect(subpages.at(-1)).toBeNull();
    expect(button("Match a theme…")).toBeDefined();
  });
});
