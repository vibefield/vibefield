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
  const t = typed.trim();
  if (!t) return SAMPLE_URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("about:")) return t;
  if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(t) || /^localhost(:\d+)?(\/.*)?$/.test(t))
    return `${t.startsWith("localhost") ? "http" : "https"}://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
