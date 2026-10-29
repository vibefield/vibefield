import { utf8ByteLength } from "@vibefield/contracts";
import { type CopyHost, writeClipboard } from "../frame/cards/copy-door";
import { peekHost } from "../host";
import { getRendererLogger } from "../logging";

// Item 102 — what a paste into a terminal reads. ghosttea takes `readClipboard`
// and, given it, performs the paste chord itself (it prevents the keydown's
// default), so this reader is the paste. In the desktop app the web's own read is
// denied by law: the shell session grants no Chromium permission (ESP §7.4), and
// main's door (`FieldHost.clipboard`, design-03 §5.1's `shell.clipboard.*`) reads
// the system clipboard for the focused product window instead. Where no host door
// exists (the browser catalog) the web's own read stands. The deck and the sign-in
// terminal hand ghosttea this one reader.
//
// HN-5 — and what a program in a terminal writes: a terminal's OSC 52, which
// ghosttea hands its runtime platform's `writeClipboard`. The web's own write is
// denied in the app as its read is, so the words go through the copy door's write
// (the host's copy door; the web's own where there is none) — and NO card is
// dealt: a program's write is not the person's copy (LC-14; DESIGN.md §8 "The
// hand"). ghosttea's writer cannot tell ⌘C or copy-on-select from a program's
// write (petition G30), and those deal a terminal card once it can.

/** The clipboard's text for a terminal's paste: the host's door, else the web's
 * read. A refusal rejects, and ghosttea pastes nothing rather than part. */
export function readClipboardText(): string | Promise<string> {
  const door = peekHost()?.clipboard;
  if (door !== undefined) return door.readText();
  return navigator.clipboard?.readText() ?? "";
}

/** A runtime's `writeClipboard`: a program's words onto the system clipboard, and no
 * card. ghosttea's hook returns nothing, so a refusal (past the copy door's 64 KiB, a
 * door that did not answer) never throws into it: it is logged once for a run of
 * refusals, by its size and what the door was told, never its words, which may carry a
 * token; a write that lands lets the next refusal speak. `host` is for a test: the
 * window's by default. */
export function programClipboardWriter(host?: CopyHost | null): (text: string) => void {
  let refusing = false;
  return (text) => {
    void writeClipboard({ text }, host === undefined ? {} : { host }).then((written) => {
      if (written.ok) {
        refusing = false;
        return;
      }
      if (refusing) return;
      refusing = true;
      getRendererLogger()
        .child({ component: "terminal.clipboard" })
        .warn(
          "renderer.terminal.clipboard_write_refused",
          "A program's clipboard write did not reach the clipboard",
          { bytes: utf8ByteLength(text), reason: written.reason, error: written.error },
        );
    });
  };
}
