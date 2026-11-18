// The ADDRESS — as the head prints it and as it is typed (the prototype's lab/web-feed.ts `displayOf` and
// `resolveAddress`, moved; BROWSER.md §6). Pure. The lab's sample web was served by its bridge under `/__web/site/` and
// printed by the names its pages would have; the product has no bridge, and the one sample a pane shows in PT-1 lives
// under a reserved name (`SAMPLE_URL`, RFC 2606's `.example`), so the table that mapped bridge paths to names is gone
// and the sample prints by its host like any site.

import { SAMPLE_URL } from "./ids";

/** The prompt the capsule carries when there is no address — the start page's (Safari's words). */
export const PROMPT = "Search or enter website name";

/** A URL as the head prints it: the host (without its `www.`), as Safari does; nothing for a blank page; a file by its name. */
export function displayOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "about:") return "";
    if (u.protocol === "file:") return decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return u.host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Is the address a secure one (the head's lock)? */
export const isSecure = (url: string): boolean => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** What an address typed into the head means: a URL, a host — or a search. Nothing typed opens the sample. */
export function resolveAddress(typed: string): string {
  // Browsers discard pasted line breaks in an omnibox; ordinary spaces remain search terms.
  const t = typed.replace(/[\r\n\t]/g, "").trim();
  if (!t) return SAMPLE_URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^about:/i.test(t)) return t;
  if (!/\s/.test(t)) {
    try {
      const url = new URL(`https://${t}`);
      const host = url.hostname;
      const local =
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "[::1]" ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
      // Ports, IPv4/IPv6, Unicode hosts, query strings and fragments are all parsed as URLs.
      if (!url.username && !url.password && (local || host.includes(".") || host.startsWith("[")))
        return `${local ? "http" : "https"}://${t}`;
    } catch {
      /* A phrase or malformed host is searched. */
    }
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
