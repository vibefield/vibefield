// THE NOTICE (PT-5a ruling 3) — what a pane's FILM says when its page failed: a headline and a line of detail in a person's
// words, and — where trying again can help — a "Try again" capsule that takes a press in hand. Pure: the words by the host's
// word for the failure (`LIVE_BROWSER_FAILURES`, the SDK's — VibeField's contract for a failed browser face's reason), where
// each line and the capsule lie in the page's CSS px (the raster draws them there — notice-canvas.ts — and the hit test reads
// the capsule back), and the texels a notice is drawn at.
//
// The film is the pane's own dark film in both schemes (theme.ts `panelOff`), so the words are one light ink over it
// (`notice`), added as light: by day and by night they read as a page's light does.

import { type LiveBrowserFailure, liveBrowserFailure } from "@vibefield/plugin-sdk/desk";
import { PAGE_TEXELS_MAX } from "./sample-page";

/** What a failed page's film says. */
export interface NoticeWords {
  readonly headline: string;
  readonly detail: string;
}

/** The capsule's word. */
export const RETRY_LABEL = "Try again";

/** Each failure in a person's words (the SDK's word → what the film says). */
export const NOTICE_WORDS: Readonly<Record<LiveBrowserFailure, NoticeWords>> = {
  "name-not-resolved": {
    headline: "This site can’t be found",
    detail: "Check the address for a typing mistake.",
  },
  offline: {
    headline: "You’re offline",
    detail: "Check the connection, then try again.",
  },
  "connection-refused": {
    headline: "This site refused to connect",
    detail: "It may be down, or the address may be wrong.",
  },
  "connection-failed": {
    headline: "The connection was lost",
    detail: "The site may be down, or the network changed.",
  },
  "timed-out": {
    headline: "This site took too long to respond",
    detail: "It may be busy. Try again in a moment.",
  },
  certificate: {
    headline: "This connection isn’t private",
    detail: "The site’s certificate can’t be trusted, so the page was not opened.",
  },
  blocked: {
    headline: "This address can’t be opened here",
    detail: "A pane opens web pages: http and https addresses.",
  },
  "load-failed": {
    headline: "This page couldn’t be loaded",
    detail: "Something went wrong on the way.",
  },
  stopped: {
    headline: "This page stopped",
    detail: "It ran into a problem and was closed. Anything typed into it is gone.",
  },
  unresponsive: {
    headline: "This page stopped responding",
    detail: "It was closed. Try again to load it afresh.",
  },
  lost: {
    headline: "The page was lost",
    detail: "The desk lost its hold of it.",
  },
  "may-not": {
    headline: "Pages can’t be opened here",
    detail: "This desk isn’t allowed to open web pages for this pane.",
  },
  failed: {
    headline: "This page couldn’t be shown",
    detail: "Something went wrong.",
  },
};

/** What the film says for a failed face's reason (the host's word leads it; its own detail after is a diagnostic's). */
export const failureWords = (reason: string): NoticeWords =>
  NOTICE_WORDS[liveBrowserFailure(reason)];

/** A notice's lines and its capsule in the page's CSS px. */
export interface NoticeLayout {
  /** The headline's size, and the smaller words' (the detail, the capsule's label). */
  readonly unit: number;
  readonly small: number;
  /** The lines' centre x, and the widest a line may be. */
  readonly cx: number;
  readonly width: number;
  /** The headline's baseline; the detail's first baseline and its line height (two lines at most). */
  readonly headline: number;
  readonly detail: number;
  readonly line: number;
  /** The capsule: its centre x, y and half extents. */
  readonly retry: readonly [number, number, number, number];
}

/**
 * Where a notice lies on a page `viewport` CSS px: a block — the headline, two lines of detail, the capsule — centred a little
 * above the page's middle and held on the page, its type a 24th of the page's width (never under 14 px nor over 26: a phone's
 * page and a desktop's both read).
 */
export function noticeLayout(viewport: readonly [number, number]): NoticeLayout {
  const [W, H] = viewport;
  const unit = Math.min(Math.max(W / 24, 14), 26);
  const small = Math.round(unit * 0.76);
  const line = small * 1.45;
  const hh = small * 1.3;
  const tall = unit + small * 1.9 + line + small * 2.5 + hh;
  const top = Math.max(H * 0.42 - tall / 2, small);
  const headline = top + unit;
  const detail = headline + small * 1.9;
  return {
    unit,
    small,
    cx: W / 2,
    width: Math.max(W - 2 * unit, 1),
    headline,
    detail,
    line,
    retry: [W / 2, detail + line + small * 2.5, small * 4.4, hh],
  };
}

/** Is a page point (CSS px) on the notice's capsule? (A hair's slop round it: a press is a finger's.) */
export function retryAt(viewport: readonly [number, number], x: number, y: number): boolean {
  const L = noticeLayout(viewport);
  const [cx, cy, hx, hy] = L.retry;
  const slop = L.small * 0.3;
  return Math.abs(x - cx) <= hx + slop && Math.abs(y - cy) <= hy + slop;
}

/** The texels a notice is drawn at: two a CSS px (words, read in hand at the reading size), under the still's cap. */
export function noticeTexels(viewport: readonly [number, number]): readonly [number, number] {
  const s = Math.min(2, PAGE_TEXELS_MAX / Math.max(viewport[0], viewport[1], 1));
  return [Math.max(1, Math.round(viewport[0] * s)), Math.max(1, Math.round(viewport[1] * s))];
}

/** What a notice's raster is drawn from — a new key is a new raster. */
export interface NoticeSpec {
  readonly viewport: readonly [number, number];
  readonly texels: readonly [number, number];
  readonly words: NoticeWords;
  /** The capsule's label, or null: nothing to try again. */
  readonly retry: string | null;
  /** The words' ink, a CSS colour. */
  readonly ink: string;
}

export const noticeKey = (n: NoticeSpec): string =>
  [
    "notice",
    n.viewport.join("x"),
    n.texels.join("x"),
    n.words.headline,
    n.words.detail,
    n.retry ?? "",
    n.ink,
  ].join("|");
