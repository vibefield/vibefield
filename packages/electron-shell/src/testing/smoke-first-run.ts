// FG — THE FIRST RUN, WALKED (`pnpm smoke:first-run`, desk-gates row 32; track FG: FG-6's row, built as a lane of its
// own after FG-4b, VF-PM 2026-10-31 07:39Z). The one harness that answers the Setup Assistant (UA-3w as amended
// 2026-10-31: `answersSetup`, modes.ts): main mints this run's user NOT onboarded, so its boot holds at the wizard, and
// this walks it to the desk by the page's own controls. A press is `sendInputEvent` at a control the page hit-tests to,
// and a name is typed as characters into the focused field. Never OS input: the window is click-through and never
// focused (smoke-window.ts), and main's opener records every link instead of opening it (GT-8b).
//
// The person it answers as is `stageFirstRun`'s (typed-agent.ts): a throwaway HOME, the typed agent's one conversation
// (History's one row), and one stub named as every launchable row's active install. Which rows count it installed is
// each adapter's own rule (an executable the host was configured to launch), never a name of this repo's (AR-L1).
//
// Three walks, each its own launch on a fresh profile (`apps/desktop/packaging/run-first-run.mjs`): by DAY and by NIGHT
// on the live field, the preference pre-seeded in the profile's theme file before the boot (the app's own store,
// main/theme.ts), and with NO WEBGPU, the page given no `navigator.gpu`, so the glass stands over the field's still.
// Each keeps its stills in `VF_SMOKE_SHOT_DIR`, outside the run's own folders, so no teardown can take them.
//
// What it judges:
//   · THE LOGO (FG-4b, FG-D24), at the welcome's title card:
//     - the logo stands (`data-logo`), its box the field's mark at the window's centre (`FIRST_RUN_MARK`);
//     - on the live field the field draws it (`data-glass="field"`, the page's own logo hidden); over the still the
//       page's logo stands;
//     - in the pixels the mark stands at that centre: darker than its glass by day (inverted on milk), lighter by night.
//   · THE HOLDS (FG-L5, FG-D20; DESIGN.md §6): every load that began to show stood its floor from its fade in, with the
//     logo, and a line hold said one line.
//   · THE FRAME (FG-4a, FG-L3): on Agents with More open, the list outgrows its body and scrolls within itself under its
//     fade, while the head, the foot and Continue stand inside the frame, unmoved by the scroll. Profiles' login
//     terminal stands 190 tall, with Cancel in view above the fade.
//   · THE BAND (FG-D22 A): Setting up's segment advances with the boot's progress, then stands full.
//   · The walk's end: Setting up's welcome said, the durable `onboarded: true`, the wizard gone, no CSP refusal.
// Not this row's (desk-gates row 32): Agents with nine installed, History with six rows and Profiles' five cards
// (James's eye), and the ways out at 6s and Start now at 8s (their unit rows): Start now is said when it shows, and
// never pressed, so the welcome is always the walk's to see.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readUsersFile } from "@vibefield/users";
import type { BrowserWindow } from "electron";
import { loadRenderer } from "../main/windows";
import { WITHOUT_WEBGPU } from "./smoke-unavailable";
import { readTypedAgentCalls, type StagedTypedAgent } from "./typed-agent";

/** The walks, by their names on the launcher's list. */
export type FirstRunWalk = "day" | "night" | "no-webgpu";

/** Which walk this launch is (`run-first-run.mjs` sets it). */
export const WALK_ENV = "VF_FIRST_RUN_WALK";

/** What each walk expects of the page. */
export const FIRST_RUN_WALKS: Readonly<
  Record<FirstRunWalk, { readonly dark: boolean; readonly webgpu: boolean }>
> = {
  day: { dark: false, webgpu: true },
  night: { dark: true, webgpu: true },
  "no-webgpu": { dark: false, webgpu: false },
};

export function parseWalk(value: string | undefined): FirstRunWalk | null {
  return value !== undefined && Object.hasOwn(FIRST_RUN_WALKS, value)
    ? (value as FirstRunWalk)
    : null;
}

/** The row's numbers. */
export const FIRST_RUN = {
  /** a pane, or a load before it, standing */
  paneMs: 30_000,
  /** the wizard gone after Setting up's line stands (History's first pass, the welcome's beat, the leave) */
  revealMs: 90_000,
  /** DESIGN.md §6: a hold that began to show stands this long from its fade in */
  floorMs: 800,
  /** two frames of the page's own sampling, one at each end */
  floorSlackMs: 34,
  /** DESIGN.md §8: the frame every pane stands in, in the glass's own px */
  frame: { width: 560, height: 504 },
  /** DESIGN.md §4 `--vf-glass-signin-height`: a login's terminal on the glass */
  signInHeight: 190,
  /** DESIGN.md §4 `--vf-scroll-fade` */
  scrollFade: 20,
  /** how far a box may sit from where it is meant to, in CSS px */
  slackPx: 1,
  /** the mark's ink centre found in the pixels, in CSS px of the window */
  inkSlackPx: 3,
  /** the margin captured around the logo's box: clear of the card's words, 30 under it */
  logoMargin: 16,
  /** a pixel differs from its glass by this much luminance (0…255) to count as the mark's ink */
  inkStep: 36,
  /** the ink and its glass apart by at least this much, darker by day, lighter by night */
  inkContrast: 20,
} as const;

/** The field's mark (`boot/splash/field-mark.ts` FIELD_MARK) and the stills it is drawn on (FIELD_STILLS): the
 * harness's own copy of the spec, held equal to the product's by a unit row, so the row judges the box against the
 * numbers rather than reading them back from the page. */
export const FIRST_RUN_MARK = {
  mark: { width: 128, height: 77 },
  stills: {
    wide: { width: 1440, height: 900, density: 1 },
    tall: { width: 780, height: 1688, density: 2 },
  },
} as const;

/** The logo's box on a window of this size: the field's mark at its size on the screen, and over the still the
 * still's own mark, cover-fitted with the picture (the rule `logoBox` keeps). */
export function expectedLogoBox(
  width: number,
  height: number,
  still: boolean,
): { readonly width: number; readonly height: number } {
  const { mark, stills } = FIRST_RUN_MARK;
  if (!still || width <= 0 || height <= 0) return mark;
  const picture = width / height > 1 ? stills.wide : stills.tall;
  const scale = Math.max(width / picture.width, height / picture.height) * picture.density;
  return { width: mark.width * scale, height: mark.height * scale };
}

/** Why a folder may not keep a walk's stills, or null: under a smoke's own folder (its HOME, `vf-smoke-…`, or its
 * profile, `vf-smoke-profile-…`) a green run's teardown would take them with it. */
export function shotDirRefusal(shotDir: string): string | null {
  const under = resolve(shotDir)
    .split(sep)
    .find((part) => part.startsWith("vf-smoke-"));
  return under === undefined
    ? null
    : `${shotDir} lies under ${under}, a smoke's own folder, which a green run removes`;
}

/** One showing of a face as the page's recorder saw it, in the page's own clock (ms). */
export interface FaceSeen {
  readonly face: string;
  /** `line` or `card` for a hold; null for a pane */
  readonly hold: string | null;
  readonly shownAt?: number;
  readonly fullAt?: number;
  readonly leaveAt?: number;
  readonly goneAt?: number;
  /** at its first whole frame: the shell's `data-logo`, `data-glass`, and the standing words' lines */
  readonly logo?: string | null;
  readonly glass?: string | null;
  readonly lines?: readonly string[];
}

/** What the recorder hands back at the walk's end. */
export interface FirstRunRecord {
  readonly faces: readonly FaceSeen[];
  /** `[ms, progress]` at each change of Setting up's segment */
  readonly progress: readonly (readonly [number, number])[];
  readonly now: number;
}

/** The faces every walk stands on (Connect's is one of two, by what the link said). */
export const WALKED_FACES = [
  "welcome",
  "field",
  "agents",
  "profiles",
  "history",
  "setting-up:line",
] as const;

/** The recorder kept the whole walk. A page that reloaded under it would hand back a recorder that saw none of it,
 * and a hold never recorded could never be found standing short. */
export function judgeRecorded(record: FirstRunRecord): string[] {
  const seen = new Set(record.faces.filter((f) => f.shownAt !== undefined).map((f) => f.face));
  const lost = WALKED_FACES.filter((face) => !seen.has(face));
  return lost.length === 0
    ? []
    : [`the page's recorder never saw ${lost.join(", ")} show: it lost the walk`];
}

/** Every hold that began to show and stood less than its floor from its fade in, or stood without the logo, or (a
 * line hold) said other than one line. A hold never shown — a load answered before its fade in began — has nothing
 * to stand. */
export function judgeHolds(record: FirstRunRecord): { held: string[]; problems: string[] } {
  const held: string[] = [];
  const problems: string[] = [];
  for (const seen of record.faces) {
    if (seen.hold === null || seen.shownAt === undefined) continue;
    const until = seen.leaveAt ?? seen.goneAt ?? record.now;
    const stood = Math.round(until - seen.shownAt);
    held.push(`${seen.face} ${stood}ms`);
    if (stood < FIRST_RUN.floorMs - FIRST_RUN.floorSlackMs) {
      problems.push(
        `the hold "${seen.face}" stood ${stood}ms from its fade in, under the floor's ${FIRST_RUN.floorMs}`,
      );
    }
    if (seen.fullAt === undefined) continue;
    if (seen.logo !== "shown") problems.push(`the hold "${seen.face}" stood without the logo`);
    if (seen.hold === "line" && seen.lines?.length !== 1) {
      problems.push(
        `the hold "${seen.face}" said ${JSON.stringify(seen.lines ?? [])}, not one line`,
      );
    }
  }
  return { held, problems };
}

/** Setting up's segment: it advanced, came full, and stood full from then on. */
export function judgeBand(progress: FirstRunRecord["progress"]): string[] {
  if (progress.length === 0) return ["Setting up's segment never carried the boot's progress"];
  const values = progress.map(([, value]) => value);
  const full = values.findIndex((value) => value >= 0.999);
  if (full < 0) {
    return [`Setting up's segment never came full (it reached ${Math.max(...values).toFixed(3)})`];
  }
  const problems: string[] = [];
  if (new Set(values.slice(0, full + 1)).size < 2) {
    problems.push("Setting up's segment never advanced: it began full");
  }
  const after = values.slice(full).find((value) => value < 0.999);
  if (after !== undefined) {
    problems.push(`Setting up's segment came full, then fell to ${after.toFixed(3)}`);
  }
  return problems;
}

/** The mark's ink in a capture `width` × `height` CSS px (BGRA, Electron's `toBitmap`, at the screen's density): the
 * glass is the median luminance of the capture's border, the ink every pixel that far from it. Its centre `at` is in
 * CSS px of the capture; null when the buffer is no picture of that size. */
export function measureMark(
  bgra: Uint8Array,
  width: number,
  height: number,
): { glass: number; ink: number; count: number; at: { x: number; y: number } } | null {
  const pixels = bgra.length / 4;
  if (width <= 0 || height <= 0 || pixels <= 0) return null;
  const scale = Math.sqrt(pixels / (width * height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (w * h !== pixels) return null;
  const luma = (i: number): number =>
    0.2126 * (bgra[i * 4 + 2] as number) +
    0.7152 * (bgra[i * 4 + 1] as number) +
    0.0722 * (bgra[i * 4] as number);
  const band = Math.max(1, Math.round(4 * scale));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) border.push(luma(y * w + x));
    }
  }
  border.sort((a, b) => a - b);
  const glass = border[Math.floor(border.length / 2)] as number;
  let count = 0;
  let sum = 0;
  let sx = 0;
  let sy = 0;
  for (let y = band; y < h - band; y++) {
    for (let x = band; x < w - band; x++) {
      const l = luma(y * w + x);
      if (Math.abs(l - glass) < FIRST_RUN.inkStep) continue;
      count += 1;
      sum += l;
      sx += x + 0.5;
      sy += y + 0.5;
    }
  }
  if (count === 0) {
    return {
      glass: Math.round(glass),
      ink: Math.round(glass),
      count,
      at: { x: width / 2, y: height / 2 },
    };
  }
  return {
    glass: Math.round(glass),
    ink: Math.round(sum / count),
    count,
    at: { x: sx / count / scale, y: sy / count / scale },
  };
}

/** The page's half: a recorder armed before any of the page's scripts (DevTools' script on every new document), and
 * the reads the walk asks of it. It presses nothing; it sets nothing but a list's scroll when asked. */
export const FIRST_RUN_PAGE = String.raw`(() => {
  if (globalThis.__vfFirstRun !== undefined) return;
  const LEAVING = "vf-wizard-pane-leaving";
  const faces = [];
  const current = new Map();
  const progress = [];
  let lastProgress = null;
  const shellOf = () => document.querySelector(".vf-wizard-shell");
  const frameOf = () => shellOf()?.querySelector(".vf-wizard-frame") ?? null;
  const rootsOf = (frame) => [...frame.children].filter((child) => child.hasAttribute("data-face"));
  // the root standing in the frame, as the frame itself finds it: its own, never a leaving copy
  const standingRoot = () => {
    const frame = frameOf();
    if (frame === null) return null;
    return rootsOf(frame).reverse().find((child) => !child.classList.contains(LEAVING)) ?? null;
  };
  const opacity = (el) => Number.parseFloat(getComputedStyle(el).opacity);
  const box = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const scrollerIn = (scope) => {
    if (scope === null) return null;
    return [...scope.querySelectorAll("*")].find((el) =>
      /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) ?? null;
  };
  const sample = () => {
    const now = performance.now();
    const shell = shellOf();
    const frame = frameOf();
    const seen = new Map();
    if (frame !== null) {
      for (const el of rootsOf(frame)) {
        const face = el.getAttribute("data-face");
        const o = opacity(el);
        const was = seen.get(face);
        if (was === undefined || o > was.o) seen.set(face, { o, el });
      }
    }
    for (const [face, { o, el }] of seen) {
      let f = current.get(face);
      if (f === undefined) {
        f = { face, hold: el.getAttribute("data-hold") };
        current.set(face, f);
        faces.push(f);
      }
      if (o > 0.02 && f.shownAt === undefined) f.shownAt = now;
      if (o >= 0.98 && f.fullAt === undefined) {
        f.fullAt = now;
        f.logo = shell?.getAttribute("data-logo") ?? null;
        f.glass = shell?.getAttribute("data-glass") ?? null;
        f.lines = [...el.querySelectorAll(".vf-wizard-status-words:not([data-state='out']) .vf-wizard-status-line")]
          .map((line) => line.textContent.trim())
          .filter((line) => line !== "");
      }
      if (f.fullAt !== undefined && f.leaveAt === undefined && o < 0.98) f.leaveAt = now;
    }
    for (const [face, f] of current) {
      if (seen.has(face)) continue;
      if (f.leaveAt === undefined) f.leaveAt = now;
      f.goneAt = now;
      current.delete(face);
    }
    const bar = shell?.querySelector('.vf-wizard-steps [data-progress="true"]') ?? null;
    if (bar !== null) {
      const value = Number.parseFloat(getComputedStyle(bar).getPropertyValue("--vf-wizard-progress"));
      if (Number.isFinite(value) && value !== lastProgress) {
        progress.push([Math.round(now), value]);
        lastProgress = value;
      }
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const targetOf = (spec) => {
    const root = standingRoot();
    if (root === null) return null;
    if (spec.selector !== undefined) return root.querySelector(spec.selector);
    return [...root.querySelectorAll(spec.within ?? "button")].find(
      (candidate) => candidate.textContent.trim() === spec.text,
    ) ?? null;
  };
  globalThis.__vfFirstRun = {
    read: () => ({ faces, progress, now: performance.now() }),
    /** the face standing whole in the frame, with no pane leaving over it */
    standing: () => {
      const frame = frameOf();
      const root = standingRoot();
      if (frame === null || root === null) return null;
      if (frame.querySelector(":scope > ." + LEAVING) !== null) return null;
      return opacity(root) >= 0.999 ? root.getAttribute("data-face") : null;
    },
    wizard: () => shellOf() !== null,
    /** a control's centre in the standing root, if the page would hand a press there to it */
    target: (spec) => {
      const el = targetOf(spec);
      if (el === null) return { hit: false, why: "absent" };
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return { hit: false, why: "no box" };
      if (el.disabled === true) return { hit: false, why: "disabled" };
      if (getComputedStyle(el).visibility !== "visible") return { hit: false, why: "hidden" };
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const under = document.elementFromPoint(x, y);
      const hit = under !== null && (under === el || el.contains(under));
      return { hit, x, y, why: hit ? "" : "covered by " + (under?.className || under?.tagName || "nothing") };
    },
    /** focus a field and select what it holds, so what is typed replaces it */
    focusAll: (spec) => {
      const el = targetOf(spec);
      if (el === null || typeof el.select !== "function") return false;
      el.focus();
      el.select();
      return document.activeElement === el;
    },
    count: (selector) => document.querySelectorAll(selector).length,
    logo: () => {
      const shell = shellOf();
      const logo = shell?.querySelector(".vf-wizard-logo") ?? null;
      if (shell === null || logo === null) return null;
      return {
        shown: shell.getAttribute("data-logo"),
        glass: shell.getAttribute("data-glass"),
        level: Number.parseFloat(getComputedStyle(shell).getPropertyValue("--vf-glass-logo")),
        visibility: getComputedStyle(logo).visibility,
        box: box(logo),
        viewport: { width: innerWidth, height: innerHeight },
        dark: matchMedia("(prefers-color-scheme: dark)").matches,
      };
    },
    /** the frame, the standing pane's head and foot, its primary action, and the list that scrolls in its body */
    frame: () => {
      const shell = shellOf();
      const frame = frameOf();
      const root = standingRoot();
      if (shell === null || frame === null || root === null) return null;
      const scroller = scrollerIn(root.querySelector(".vf-wizard-pane-body"));
      const primary = root.querySelector(".vf-wizard-actions button[type=submit]");
      const style = scroller === null ? null : getComputedStyle(scroller);
      return {
        fit: shell.getBoundingClientRect().width / shell.offsetWidth,
        frame: box(frame),
        head: box(root.querySelector(".vf-wizard-pane-head")),
        foot: box(root.querySelector(".vf-wizard-pane-foot")),
        primary: primary === null ? null : { ...box(primary), label: primary.textContent.trim() },
        scroller: scroller === null ? null : {
          ...box(scroller),
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          scrollTop: scroller.scrollTop,
          mask: style.maskImage || style.webkitMaskImage || "none",
        },
      };
    },
    scrollToEnd: () => {
      const scroller = scrollerIn(standingRoot()?.querySelector(".vf-wizard-pane-body") ?? null);
      if (scroller === null) return false;
      scroller.scrollTop = scroller.scrollHeight;
      return true;
    },
    /** a login's terminal and its Cancel, with the list that scrolls around them */
    signIn: () => {
      const shell = shellOf();
      const section = standingRoot()?.querySelector("section.vf-profiles-signin") ?? null;
      if (shell === null || section === null) return null;
      const cancel = section.querySelector(".vf-profiles-signin-row button");
      let scroller = section.parentElement;
      while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      const at = cancel === null ? null : cancel.getBoundingClientRect();
      const under = at === null ? null : document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
      return {
        fit: shell.getBoundingClientRect().width / shell.offsetWidth,
        frame: box(frameOf()),
        body: box(section.querySelector(".vf-profiles-signin-body")),
        cancel: cancel === null ? null : { ...box(cancel), label: cancel.textContent.trim() },
        cancelHit: under !== null && cancel !== null && (under === cancel || cancel.contains(under)),
        scroller: box(scroller),
      };
    },
  };
})();`;

/** A box as the page reports it, in CSS px of the window. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LogoSeen {
  readonly shown: string | null;
  readonly glass: string | null;
  readonly level: number;
  readonly visibility: string;
  readonly box: Box;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly dark: boolean;
}

export interface FrameSeen {
  readonly fit: number;
  readonly frame: Box;
  readonly head: Box | null;
  readonly foot: Box | null;
  readonly primary: (Box & { readonly label: string }) | null;
  readonly scroller:
    | (Box & {
        readonly scrollHeight: number;
        readonly clientHeight: number;
        readonly scrollTop: number;
        readonly mask: string;
      })
    | null;
}

export interface SignInSeen {
  readonly fit: number;
  readonly frame: Box;
  readonly body: Box | null;
  readonly cancel: (Box & { readonly label: string }) | null;
  readonly cancelHit: boolean;
  readonly scroller: Box | null;
}

/** The mark found in the pixels: its glass's luminance, its ink's, how many px, and its centre in the window. */
export interface InkSeen {
  readonly glass: number;
  readonly ink: number;
  readonly count: number;
  readonly at: { readonly x: number; readonly y: number };
}

/** `inner` lies inside `outer`, give or take the slack. */
export function within(inner: Box, outer: Box, slack = 0.5): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

const same = (a: Box | null, b: Box | null): boolean =>
  a !== null &&
  b !== null &&
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

/** The frame its size, and the pane's head, foot and primary action inside it (FG-L3). */
export function judgeFrameParts(pane: string, seen: FrameSeen): string[] {
  const problems: string[] = [];
  const { width, height } = FIRST_RUN.frame;
  if (
    Math.abs(seen.frame.width - width * seen.fit) > FIRST_RUN.slackPx ||
    Math.abs(seen.frame.height - height * seen.fit) > FIRST_RUN.slackPx
  ) {
    problems.push(
      `${pane}: the frame is ${seen.frame.width.toFixed(1)} × ${seen.frame.height.toFixed(1)}, not ${width} × ${height} at the glass's fit ${seen.fit.toFixed(3)}`,
    );
  }
  for (const [part, box] of [
    ["head", seen.head],
    ["foot", seen.foot],
    ["primary action", seen.primary],
  ] as const) {
    if (box === null) problems.push(`${pane}: no ${part}`);
    else if (!within(box, seen.frame))
      problems.push(`${pane}: the ${part} stands outside the frame`);
  }
  return problems;
}

/** The frame's law on a pane whose list outgrows its body (FG-L3): the frame's parts (`judgeFrameParts`), and the list
 * scrolling within itself under its fade while the head, the foot and the primary action stand unmoved. */
export function judgeFrame(pane: string, before: FrameSeen, after: FrameSeen): string[] {
  const problems = judgeFrameParts(pane, before);
  if (before.scroller === null) {
    problems.push(
      `${pane}: the list fits its body, so nothing scrolls and the row witnesses no scroll`,
    );
    return problems;
  }
  if (!before.scroller.mask.includes("linear-gradient")) {
    problems.push(`${pane}: the list scrolls with no fade (mask ${before.scroller.mask})`);
  }
  if (after.scroller === null || after.scroller.scrollTop <= 0) {
    problems.push(`${pane}: the list did not scroll within itself`);
  }
  if (!same(before.head, after.head))
    problems.push(`${pane}: the head moved with the list's scroll`);
  if (!same(before.foot, after.foot))
    problems.push(`${pane}: the foot moved with the list's scroll`);
  if (!same(before.primary, after.primary)) {
    problems.push(
      `${pane}: ${before.primary?.label ?? "the primary action"} moved with the list's scroll`,
    );
  }
  return problems;
}

/** A login's terminal on the glass: 190 tall, and its Cancel inside the frame, in view above the list's fade, and a
 * press there reaching it. */
export function judgeSignIn(seen: SignInSeen): string[] {
  const problems: string[] = [];
  if (seen.body === null) problems.push("the login has no terminal");
  else if (Math.abs(seen.body.height - FIRST_RUN.signInHeight * seen.fit) > FIRST_RUN.slackPx) {
    problems.push(
      `the login's terminal is ${seen.body.height.toFixed(1)} tall, not ${FIRST_RUN.signInHeight}`,
    );
  }
  if (seen.cancel === null) {
    problems.push("the login has no Cancel");
    return problems;
  }
  if (!within(seen.cancel, seen.frame))
    problems.push("the login's Cancel stands outside the frame");
  if (seen.scroller !== null) {
    const clear = {
      ...seen.scroller,
      height: seen.scroller.height - FIRST_RUN.scrollFade * seen.fit,
    };
    if (!within(seen.cancel, clear)) {
      problems.push("the login's Cancel is not in view above the list's fade");
    }
  }
  if (!seen.cancelHit) problems.push("a press at the login's Cancel does not reach it");
  return problems;
}

/** The logo at the welcome's title card (FG-4b, FG-D24): the page's reading of it, and the mark found in the pixels
 * around its box (`measureMark`, its centre moved into the window's px). */
export function judgeLogo(
  seen: LogoSeen,
  walk: { readonly dark: boolean; readonly webgpu: boolean },
  ink: InkSeen | null,
): string[] {
  const problems: string[] = [];
  if (seen.shown !== "shown") problems.push("the welcome stood without the logo (data-logo)");
  if (seen.dark !== walk.dark) {
    problems.push(`the page wears the ${seen.dark ? "dark" : "light"} theme, not the walk's`);
  }
  if (walk.webgpu) {
    if (seen.glass !== "field") {
      problems.push("on the live field the glass is not the field's (data-glass)");
    }
    if (seen.visibility !== "hidden") {
      problems.push("on the live field the page's own logo is not hidden");
    }
  } else {
    if (seen.glass !== null)
      problems.push(`over the still the glass says data-glass=${seen.glass}`);
    if (seen.visibility !== "visible") problems.push("over the still the page's logo is hidden");
  }
  const want = expectedLogoBox(seen.viewport.width, seen.viewport.height, !walk.webgpu);
  const centre = { x: seen.viewport.width / 2, y: seen.viewport.height / 2 };
  const at = { x: seen.box.x + seen.box.width / 2, y: seen.box.y + seen.box.height / 2 };
  if (
    Math.abs(seen.box.width - want.width) > FIRST_RUN.slackPx ||
    Math.abs(seen.box.height - want.height) > FIRST_RUN.slackPx
  ) {
    problems.push(
      `the logo's box is ${seen.box.width.toFixed(1)} × ${seen.box.height.toFixed(1)}, not the mark's ${want.width.toFixed(1)} × ${want.height.toFixed(1)}`,
    );
  }
  if (
    Math.abs(at.x - centre.x) > FIRST_RUN.slackPx ||
    Math.abs(at.y - centre.y) > FIRST_RUN.slackPx
  ) {
    problems.push(
      `the logo's box centres at ${at.x.toFixed(1)}, ${at.y.toFixed(1)}, not the window's ${centre.x}, ${centre.y}`,
    );
  }
  if (ink === null || ink.count === 0) {
    problems.push("no mark in the pixels around the logo's box");
    return problems;
  }
  if (
    Math.abs(ink.at.x - centre.x) > FIRST_RUN.inkSlackPx ||
    Math.abs(ink.at.y - centre.y) > FIRST_RUN.inkSlackPx
  ) {
    problems.push(
      `the mark's ink centres at ${ink.at.x.toFixed(1)}, ${ink.at.y.toFixed(1)}, not the window's ${centre.x}, ${centre.y}`,
    );
  }
  if (walk.dark && ink.ink < ink.glass + FIRST_RUN.inkContrast) {
    problems.push(`by night the mark (${ink.ink}) is not white on its glass (${ink.glass})`);
  }
  if (!walk.dark && ink.ink > ink.glass - FIRST_RUN.inkContrast) {
    problems.push(`by day the mark (${ink.ink}) is not inverted on its milk (${ink.glass})`);
  }
  return problems;
}

/** What the walk needs. */
export interface FirstRunDriver {
  readonly win: BrowserWindow;
  readonly viteUrl: string;
  readonly walk: FirstRunWalk;
  /** this walk's own folder of stills, outside the run's own folders (`shotDirRefusal`) */
  readonly shotDir: string;
  readonly staged: StagedTypedAgent;
  /** users.json's root, and the user this window boots as */
  readonly users: { readonly root: string; readonly userId: string };
  readonly say: (line: string) => void;
}

/** A control the walk presses: by selector, or by its words (in `within`'s elements, buttons by default). */
interface ControlSpec {
  readonly selector?: string;
  readonly text?: string;
  readonly within?: string;
}

interface Target {
  readonly hit: boolean;
  readonly x?: number;
  readonly y?: number;
  readonly why?: string;
}

/** Connect's asking, run long: its way out. */
const ASKING_OUT: ControlSpec = { text: "Continue", within: ".vf-wizard-hold-out button" };
/** A pane's primary action: its form's submit. */
const PRIMARY: ControlSpec = { selector: ".vf-wizard-actions button[type=submit]" };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The walk, from a fresh page to the desk: facts for the verdict line, and every problem in words. A step that
 * never comes throws, with a still of where the walk stood. */
export async function firstRunRows(
  d: FirstRunDriver,
): Promise<{ facts: Record<string, unknown>; problems: string[] }> {
  const walk = FIRST_RUN_WALKS[d.walk];
  const problems: string[] = [];
  const shots: string[] = [];
  const facts: Record<string, unknown> = { walk: d.walk, shots };
  const page = async <T>(call: string): Promise<T> =>
    (await d.win.webContents.executeJavaScript(
      `globalThis.__vfFirstRun?.${call} ?? null`,
      true,
    )) as T;
  const until = async <T>(
    what: string,
    ms: number,
    read: () => Promise<T | null | false>,
  ): Promise<T> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const seen = await read();
      if (seen !== null && seen !== false) return seen;
      if (Date.now() > deadline) throw new Error(`${what}: not within ${ms}ms`);
      await sleep(50);
    }
  };
  const standing = async (face: string): Promise<void> => {
    await until(`the ${face} pane standing`, FIRST_RUN.paneMs, async () =>
      (await page<string | null>("standing()")) === face ? true : null,
    );
    // its own layout settled under the frame's fade
    await sleep(120);
  };
  const capture = async (
    name: string,
    rect?: { x: number; y: number; width: number; height: number },
  ): Promise<Uint8Array> => {
    const file = `${String(shots.length + 1).padStart(2, "0")}-${name}.png`;
    const image = await d.win.capturePage(rect);
    writeFileSync(join(d.shotDir, file), image.toPNG());
    shots.push(file);
    return new Uint8Array(image.toBitmap());
  };
  const target = (spec: ControlSpec): Promise<Target | null> =>
    page<Target | null>(`target(${JSON.stringify(spec)})`);
  const press = async (spec: ControlSpec, what: string): Promise<void> => {
    const deadline = Date.now() + FIRST_RUN.paneMs;
    let seen = await target(spec);
    while (seen?.hit !== true || seen.x === undefined || seen.y === undefined) {
      if (Date.now() > deadline) {
        throw new Error(
          `${what}: no press reached it within ${FIRST_RUN.paneMs}ms (${seen?.why ?? "no page"})`,
        );
      }
      await sleep(50);
      seen = await target(spec);
    }
    const at = { x: Math.round(seen.x), y: Math.round(seen.y) };
    const input = d.win.webContents;
    input.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    await sleep(40);
    input.sendInputEvent({ type: "mouseDown", x: at.x, y: at.y, button: "left", clickCount: 1 });
    await sleep(50);
    input.sendInputEvent({ type: "mouseUp", x: at.x, y: at.y, button: "left", clickCount: 1 });
  };
  const type = async (spec: ControlSpec, text: string, what: string): Promise<void> => {
    await press(spec, what);
    await until(`${what} focused`, 5_000, () => page<boolean>(`focusAll(${JSON.stringify(spec)})`));
    for (const ch of text) {
      d.win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await sleep(30);
    }
  };
  const count = (selector: string): Promise<number> =>
    page<number>(`count(${JSON.stringify(selector)})`);
  const step = (name: string): void => d.say(`SMOKE_FIRST_RUN_STEP ${d.walk} ${name}`);

  mkdirSync(d.shotDir, { recursive: true });
  try {
    // The page's recorder, armed before any of its scripts; with no WebGPU, `navigator.gpu` taken from every
    // document first (`withoutWebgpu`'s script, on the one DevTools session a window can hold).
    step("arming");
    await d.win.loadURL(WITHOUT_WEBGPU.first);
    const dbg = d.win.webContents.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("Page.enable");
    if (!walk.webgpu) {
      await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: WITHOUT_WEBGPU.script,
      });
    }
    await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: FIRST_RUN_PAGE });
    await loadRenderer(d.win, "smoke-first-run", d.viteUrl);

    // 1 · the welcome's title card, its logo whole
    step("welcome");
    await standing("welcome");
    await until("the welcome's logo whole", 5_000, async () => {
      const seen = await page<LogoSeen | null>("logo()");
      return seen !== null && seen.level >= 0.999 ? seen : null;
    });
    // the field draws the level a frame or two after the glass says it
    await sleep(250);
    const logo = await until("the welcome's logo read", 5_000, () =>
      page<LogoSeen | null>("logo()"),
    );
    await capture("welcome");
    const margin = FIRST_RUN.logoMargin;
    const region = {
      x: Math.round(logo.box.x - margin),
      y: Math.round(logo.box.y - margin),
      width: Math.round(logo.box.width + margin * 2),
      height: Math.round(logo.box.height + margin * 2),
    };
    const mark = measureMark(await capture("welcome-logo", region), region.width, region.height);
    const ink: InkSeen | null =
      mark === null ? null : { ...mark, at: { x: region.x + mark.at.x, y: region.y + mark.at.y } };
    facts["logo"] = { box: logo.box, glass: logo.glass, ink };
    problems.push(...judgeLogo(logo, walk, ink));
    await press({ text: "Get started" }, "Get started");

    // 2 · You: a name typed into its field
    step("you");
    await standing("field");
    await capture("you");
    await type({ selector: 'input[aria-label="Your name"]' }, "Ada", "the name's field");
    await press(PRIMARY, "You's Continue");

    // 3 · Agents: More open, the list outgrowing its body
    step("agents");
    await standing("agents");
    const ready = await count(".vf-agents-pane-ready");
    facts["agentsReady"] = ready;
    if (ready < 1)
      problems.push("Agents counts no agent ready: no adapter took the staged install");
    await capture("agents");
    await press({ selector: ".vf-agents-pane-more" }, "More agents");
    await until(
      "More agents open",
      5_000,
      async () => (await count('.vf-agents-pane-more[aria-expanded="true"]')) > 0,
    );
    await sleep(300);
    const agents = await until("Agents' frame", 5_000, () => page<FrameSeen | null>("frame()"));
    await capture("agents-more");
    await page<boolean>("scrollToEnd()");
    await sleep(200);
    const scrolled = await until("Agents' frame, scrolled", 5_000, () =>
      page<FrameSeen | null>("frame()"),
    );
    await capture("agents-more-scrolled");
    facts["agentsList"] =
      agents.scroller === null
        ? null
        : {
            scrollHeight: agents.scroller.scrollHeight,
            clientHeight: agents.scroller.clientHeight,
          };
    problems.push(...judgeFrame("Agents", agents, scrolled));
    await press(PRIMARY, "Agents' Continue");

    // 4 · Profiles: This Mac's card, then a profile added, its login standing in its terminal, then cancelled
    step("profiles");
    await standing("profiles");
    await capture("profiles");
    await press({ selector: '[aria-label="Add a profile…"]' }, "Add a profile…");
    await type({ selector: "#vf-profiles-pane-name" }, "Work", "the profile's name");
    await press({ text: "Next" }, "the name's Next");
    const atTerminal = (): number =>
      readTypedAgentCalls(d.staged.calls).filter((call) => call.tty).length;
    const logins = atTerminal();
    await press({ selector: ".vf-profiles-pane-pick" }, "an agent to sign in to");
    await until("the login's terminal", FIRST_RUN.paneMs, () =>
      page<SignInSeen | null>("signIn()"),
    );
    await until("the login run at a terminal", FIRST_RUN.paneMs, async () => atTerminal() > logins);
    // a sign-in waits for its person: still standing, its line drawn
    await sleep(1_500);
    const signIn = await page<SignInSeen | null>("signIn()");
    const signingIn = await page<FrameSeen | null>("frame()");
    await capture("profiles-login");
    facts["login"] =
      signIn === null
        ? null
        : { terminal: signIn.body?.height ?? null, cancelHit: signIn.cancelHit };
    if (signIn === null) problems.push("the login did not stand: it ended before Cancel");
    else problems.push(...judgeSignIn(signIn));
    if (signingIn !== null) problems.push(...judgeFrameParts("Profiles, signing in", signingIn));
    await press({ selector: ".vf-profiles-signin-row button" }, "the login's Cancel");
    await until(
      "the add offered again",
      FIRST_RUN.paneMs,
      async () =>
        (await count('[aria-label="Add a profile…"]')) > 0 &&
        (await count("section.vf-profiles-signin")) === 0,
    );
    await press(PRIMARY, "Profiles' Continue");

    // 5 · History: the typed agent's one row, its switch on (its primary says so)
    step("history");
    await standing("history");
    const rows = await count('ul[aria-label="Past sessions on this Mac"] > li');
    facts["historyRows"] = rows;
    if (rows !== 1) problems.push(`History shows ${rows} rows, not the typed agent's one`);
    await capture("history");
    await press(
      { text: "Bring in history", within: ".vf-wizard-actions button" },
      "Bring in history",
    );

    // 6 · Connect: put off, by whatever this Mac's link said — never a sign-in
    step("connect");
    const way = await until("Connect, or its asking's way out", FIRST_RUN.paneMs, async () => {
      const face = await page<string | null>("standing()");
      if (face === "connect") return "pane";
      return face === "connect:asking" && (await target(ASKING_OUT))?.hit === true
        ? "asking"
        : null;
    });
    await capture("connect");
    if (way === "asking") {
      facts["connect"] = "asked long: its way out";
      await press(ASKING_OUT, "Connect's way out");
    } else {
      const notNow = (await target({ text: "Not now" }))?.hit === true;
      facts["connect"] = notNow ? "Not now" : "Continue";
      await press(
        notNow ? { text: "Not now" } : { text: "Continue", within: ".vf-wizard-actions button" },
        "Connect's way on",
      );
    }

    // 7 · Setting up: its line through the work to the welcome, then the desk
    step("setting-up");
    await standing("setting-up:line");
    await capture("setting-up");
    let welcomed = false;
    let startNow = false;
    await until("the wizard gone, the desk revealed", FIRST_RUN.revealMs, async () => {
      const welcome = '.vf-wizard-status-words[data-ink="true"]:not([data-state="out"])';
      if (!welcomed && (await count(welcome)) > 0) {
        welcomed = true;
        // its crossfade in
        await sleep(300);
        await capture("setting-up-welcome");
      }
      if (!startNow) startNow = (await target({ text: "Start now" }))?.hit === true;
      return (await page<boolean | null>("wizard()")) !== true;
    });
    step("desk");
    await sleep(1_000);
    await capture("desk");
    facts["welcomed"] = welcomed;
    facts["startNowShown"] = startNow;
    if (!welcomed) problems.push("Setting up's line never said the welcome");
  } catch (error) {
    if (!d.win.isDestroyed()) await capture("at-failure").catch(() => undefined);
    throw error;
  }

  const record = await until("the recorder's reading", 5_000, () =>
    page<FirstRunRecord | null>("read()"),
  );
  problems.push(...judgeRecorded(record));
  const holds = judgeHolds(record);
  facts["holds"] = holds.held;
  problems.push(...holds.problems);
  problems.push(...judgeBand(record.progress));
  facts["band"] = {
    changes: record.progress.length,
    first: record.progress[0]?.[1] ?? null,
    last: record.progress.at(-1)?.[1] ?? null,
  };
  const user = readUsersFile(d.users.root)?.users.find((u) => u.userId === d.users.userId);
  facts["onboarded"] = user?.onboarded ?? null;
  if (user?.onboarded !== true) problems.push("the walk ended without the durable onboarded: true");
  return { facts, problems };
}
