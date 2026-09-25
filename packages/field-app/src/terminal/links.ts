import { FielddRpcError } from "@vibefield/fieldd-client";
import { getRendererLogger } from "../logging";

// GT-8 — a terminal link, from the window's one runtime to fieldd (GT-D22).
// ghosttea 0.12.0 finds links in a session's output and, on ⌘-click, hands the
// runtime platform's `openExternal` the URL its own validator accepted
// (`terminalLinkUrl`); `terminalLinkOpener` is that `openExternal`. What a click
// may DO is fieldd's to decide (`terminal.link.open`: a web link to the browser,
// a file shown in Finder, anything else refused) — this only asks, and it asks
// only for WEB links.
//
// Why not files (ruled 2026-09-25, GT-8b): the hook hands over a URL and
// nothing else — no session, no pane — so a file link cannot be told apart from
// a PEER's pane showing a path that lives on that peer (a relative path even
// resolves against the peer's cwd), and revealing this Mac's file of the same
// name would show the wrong file. Until ghosttea says which session a link came
// from — a recorded ghosttea gap — a file link is not asked for at all.

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
      .child({ component: "terminal.links" })
      .warn("renderer.terminal.link_not_opened", "A terminal link was not opened", {
        scheme: linkScheme(url),
        kind: error instanceof FielddRpcError ? error.kind : "unknown",
      });
  }
}

/** GT-8b — the runtime platform's `openExternal`: a web link goes to fieldd;
 * any other link ghosttea surfaces, a file path above all, is not asked for
 * (see above), and the not-asking is logged quietly by its scheme. */
export function terminalLinkOpener(client: TerminalLinkClient): (url: string) => Promise<void> {
  return async (url) => {
    const scheme = linkScheme(url);
    if (scheme === "http" || scheme === "https") {
      await openTerminalLink(client, url);
      return;
    }
    getRendererLogger()
      .child({ component: "terminal.links" })
      .info("renderer.terminal.link_not_asked", "Only web links open from a terminal", {
        scheme,
      });
  };
}

/** The scheme a link names, when it names a plausible one — for the log line
 * only, so an unreadable link is "unknown" rather than any of its text. */
function linkScheme(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]{0,31}):/iu.exec(url)?.[1];
  return scheme === undefined ? "unknown" : scheme.toLowerCase();
}
