// BP-D7 (thinking-browser-profile.md §3·6; VF-PM 01:32Z, the two-phase row) — PHASE A of `smoke:profile` (desk-gates row
// 31): the harness, UNPACKAGED, lays ONE browser pane on the desk and points it at the row's own fixture page (the URL the
// runner gives, `--profile-seed=<url>`: its response sets the witness cookie), waits until the page is live on its face and
// the board's save of it is acknowledged, then LEAVES it there. The runner keeps this run's data root
// (`VF_SMOKE_KEEP_ROOT`), and PHASE B launches the PACKAGED app on that root, where the board it reopens is the only
// driver: no smoke trigger is in the asar (EDP §13.5), and no input reaches the packaged app.
//
// This run writes the UNPACKAGED profile directory (BP-D6), the fuse off: the row's plaintext control by construction.

import { layPane, PANE, type PaneRowsDriver, paneHands, paneToMiddle } from "./smoke-browser-pane";

/** The flag beside `--smoke-canvas` that runs the seed alone after the boot's: `--profile-seed=<http(s) url>`. */
export const PROFILE_SEED_FLAG = "--profile-seed";

/** The seed rows' numbers. */
export const PROFILE_SEED = {
  /** how long the page is waited for, live on its face (a first load of a loopback page) */
  liveWithinMs: 30_000,
  /** how long the board's save of the pointed pane is waited for */
  savedWithinMs: 15_000,
} as const;

/** The seed's URL off argv (`--profile-seed=<url>`), or undefined: absent, or not an http(s) address. */
export function profileSeedUrl(argv: readonly string[]): string | undefined {
  const arg = argv.find((a) => a.startsWith(`${PROFILE_SEED_FLAG}=`));
  if (arg === undefined) return undefined;
  const url = arg.slice(PROFILE_SEED_FLAG.length + 1);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The face row of a pane's page, by its durable key (the desk door's live read). */
const faceRow = (key: string): string =>
  `(globalThis.__vfDesk.live()?.faces ?? []).find((f) => f.key === ${JSON.stringify(key)}) ?? null`;

/** PHASE A's hands: the pane rows' driver, and the seeded page's cookie store flushed to disk through its OWN session (the
 * page found by its address among the offscreen contents): the names of the cookies it holds for that address, or null if
 * no such page is open. Chromium writes cookies on its own schedule (or at a graceful quit), so the kept root holds the
 * cookie only once it is flushed (the mini, 2026-10-26 03:10Z: a page that sent the cookie back, and no Cookies file). */
export interface ProfileSeedDriver extends PaneRowsDriver {
  readonly flushPage: (address: string) => Promise<readonly string[] | null>;
}

/** PHASE A's rows. Returns the problems, each in words; says `PROFILE_SEED {…}` once the pane is laid, live, saved and its
 * cookie store flushed. */
export async function profileSeedRows(d: ProfileSeedDriver, url: string): Promise<string[]> {
  const h = paneHands(d);
  const { js, until, rows, census } = h;
  try {
    const before = await census();
    const at = await layPane(h, before, () => undefined);
    if (at.pane === undefined) return ["PROFILE SEED: no new pane on the board after the take"];
    const e = at.pane;
    await paneToMiddle(h, e, at);
    await sleep(500);
    const key = (await rows()).find((r) => r.entity === e)?.key ?? undefined;
    if (key === undefined) return ["PROFILE SEED: the door gives the pane no durable key"];
    const savedBefore = await js<number | null>("globalThis.__vfDesk.board().lastSavedAt");
    if (
      !(await js<boolean>(`globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(url)} })`))
    )
      return ["PROFILE SEED: the door could not point the pane at the row's fixture"];
    try {
      await until(
        "the seeded page live on its face",
        PROFILE_SEED.liveWithinMs,
        `(() => { const f = ${faceRow(key)}; return f !== null && f.state.is === "live" && f.presented >= 1 && f.info.loading === undefined; })()`,
      );
    } catch (error) {
      // the desk's own word for the face it never saw live (the honest rows' way): its state, arrivals, info and the stats
      d.say(
        `PROFILE_SEED_FACE ${JSON.stringify({ face: await js(faceRow(key)), live: await js("globalThis.__vfDesk.live()") })}`,
      );
      throw error;
    }
    // the pointed pane is the board's: its save acknowledged after the write (the persistence row's own word)
    await until(
      "the board's save of the pointed pane",
      PROFILE_SEED.savedWithinMs,
      `(() => { const b = globalThis.__vfDesk.board(); return b.state === "live" && b.lastSavedAt !== null && b.lastSavedAt > ${savedBefore ?? 0}; })()`,
    );
    const cookies = await d.flushPage(url);
    if (cookies === null)
      return ["PROFILE SEED: the seeded page is not open to flush its cookie store"];
    const face = await js<{ address: string | null } | null>(
      `(() => { const f = ${faceRow(key)}; return f === null ? null : { address: f.info.address ?? null }; })()`,
    );
    d.say(
      `PROFILE_SEED ${JSON.stringify({ type: PANE.type, key, url, address: face?.address ?? null, cookies })}`,
    );
    return [];
  } catch (error) {
    return [`PROFILE SEED: ${error instanceof Error ? error.message : String(error)}`];
  }
}
