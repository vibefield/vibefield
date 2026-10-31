import { peekHost } from "../host";

// Item 102 — what a paste into a terminal reads. ghosttea takes `readClipboard`
// and, given it, performs the paste chord itself (it prevents the keydown's
// default), so this reader is the paste. In the desktop app the web's own read is
// denied by law: the shell session grants no Chromium permission (ESP §7.4), and
// main's door (`FieldHost.clipboard`, design-03 §5.1's `shell.clipboard.*`) reads
// the system clipboard for the focused product window instead. Where no host door
// exists (the browser catalog) the web's own read stands. The deck and the sign-in
// terminal hand ghosttea this one reader.

/** The clipboard's text for a terminal's paste: the host's door, else the web's
 * read. A refusal rejects, and ghosttea pastes nothing rather than part. */
export function readClipboardText(): string | Promise<string> {
  const door = peekHost()?.clipboard;
  if (door !== undefined) return door.readText();
  return navigator.clipboard?.readText() ?? "";
}
