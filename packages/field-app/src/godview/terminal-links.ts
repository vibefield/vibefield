import { FielddRpcError } from "@vibefield/fieldd-client";
import { getRendererLogger } from "../logging";

// GT-8a — the deck's half of a terminal link (GT-D22). ghosttea's runtime
// finds links in a pane's output and, on ⌘-click, hands the host the URL its
// own validator accepted (`terminalLinkUrl`). What that click may DO is
// fieldd's to decide (`terminal.link.open`: a web link to the browser, a file
// shown in Finder, anything else refused); this only asks. It becomes the
// runtime platform's `openExternal` when the ghosttea pin carries that seam
// (GT-8 phase 2) — 0.11.1's platform has none, so nothing calls it yet.

/** The one call this needs: the window's fieldd client. */
export interface TerminalLinkClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Ask fieldd to open one terminal link. Never throws: ghosttea awaits this
 * from a pointer handler, and a refused link is an ordinary answer — a
 * `mailto:` some program printed — so the click does nothing and the refusal
 * is logged quietly, by the link's scheme and the refusal's kind. Never the
 * URL itself: a link can carry a token. */
export async function openTerminalLink(client: TerminalLinkClient, url: string): Promise<void> {
  try {
    await client.request("terminal.link.open", { url });
  } catch (error) {
    getRendererLogger()
      .child({ component: "godview.links" })
      .warn("renderer.terminal.link_not_opened", "A terminal link was not opened", {
        scheme: linkScheme(url),
        kind: error instanceof FielddRpcError ? error.kind : "unknown",
      });
  }
}

/** The scheme a link names, when it names a plausible one — for the log line
 * only, so an unreadable link is "unknown" rather than any of its text. */
function linkScheme(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]{0,31}):/iu.exec(url)?.[1];
  return scheme === undefined ? "unknown" : scheme.toLowerCase();
}
