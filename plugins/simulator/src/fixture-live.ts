// THE FIXTURE AS A LIVE SOURCE — the frame-source seam's first source (James's choice 4, ruled 2026-10-29; the brief's R1.7).
// A phone's screen is fed through ONE seam: ICE's `LIVE`, opened with the SDK's `LiveSimulatorSpec` (the device the phone is
// bound to) and answered with the SDK's `LiveSimulatorFace` words. The kind reads nothing else (live.ts), and nothing in this
// plugin names how a host makes its frames, so whichever source a host lends under `LIVE` feeds the phone unchanged: this
// one, or PT-S2's (its producer is wired by PT-S2, never here). No contract row is needed: the spec and the words are the
// SDK's, declared once, and the demand is ICE's `LiveDemand`.
//
// This source is the fixture feed (fixture.ts) behind `LiveSources`: paused until a demand asks, frames at the demanded size
// and rate, none while nothing changed. It presents into a writer the HOST makes — a kind never makes a texture (PA-22; ICE
// I51 put `createLiveTexture` on the host's half, `@vibecook/ice/desk`, off the kit): `FixtureWriter` names the part of ICE's
// `LiveWriter` it uses, so a host passes `createLiveTexture`'s writer as it is.
//  - Its face is WOKEN only when a frame is due (`FixtureFeed.next`: the rate's slot, the minute's turn) or what it says has
//    moved, on the host's timer and outside a frame, as `LiveSources.open` asks; a face asked for nothing (paused) is woken
//    once, to say it rests, and then never.
//  - PAUSED with a frame held, it says what it shows: a STILL — ICE's `paused` ("the last frame holds") and the words
//    `at-rest` — as the product's host says a paused face, so the phone draws it at 0.7 with the rest mark (the PT-S design
//    §3: "a still never claims to be live"); a live demand again streams, and says `live`.
//  - Its frames follow the scheme the spec named at the open (the desk's then); a real Simulator keeps its own (the PT-S
//    design §6 Q-4), so the seam carries no re-spec — a face opened before the desk changed its light keeps the old one.
//  - A device the fixture's catalog lacks is said honestly — `no-device`, nothing drawn — and a spec that is not a simulator's
//    device fails with its reason: neither is ever a guess.
//  - View-only, as every simulator face is until PT-S4's touch lands: no `input`.

import {
  type LiveDemand,
  type LiveFace,
  type LiveInfo,
  type LiveSimulatorFace,
  type LiveSources,
  type LiveState,
  type LiveTexture,
  liveSimulatorSpec,
} from "@vibefield/plugin-sdk/desk";
import { FixtureFeed, feedScreenOf } from "./fixture";
import { phoneById, shapeOf } from "./law";

/** What the fixture presents into: the part of a host's live writer it uses (ICE's `LiveWriter` — `createLiveTexture`'s). */
export interface FixtureWriter {
  /** The face's texture (the kind reads it through `LiveFace.texture`). */
  readonly face: LiveTexture;
  presentBytes(
    bytes: Uint8Array,
    width: number,
    height: number,
    logical?: readonly [number, number],
  ): void;
  destroy(): void;
}

/** The host's clock and timer, in ms: `now`, and `at(t, fn)` — `fn` once at `t` or soon after, outside any frame; answers its cancel. */
export interface FixtureClock {
  now(): number;
  at(t: number, fn: () => void): () => void;
}

export interface FixtureSourceOptions {
  /** A writer for `key`'s face, made at its first frame's size (`createLiveTexture(device, { label, width, height })`). */
  readonly writer: (key: string, width: number, height: number) => FixtureWriter;
  readonly clock: FixtureClock;
}

/** What the fixture's faces have done — a test's witness. */
export interface FixtureSourceStats {
  readonly opened: number;
  readonly closed: number;
  /** Frames presented, and the wakes the timer sent. */
  readonly frames: number;
  readonly wakes: number;
}

/** The words of a face that streams, and of one whose last frame holds as a still (asked for nothing: paused). */
const STREAMING: { readonly simulator: LiveSimulatorFace } = { simulator: { is: "live" } };
const RESTING: { readonly simulator: LiveSimulatorFace } = { simulator: { is: "at-rest" } };
/** The words of a device the fixture's catalog lacks. */
const NO_DEVICE: { readonly simulator: LiveSimulatorFace } = { simulator: { is: "no-device" } };
/** A spec that is not a simulator's device: the kind sent what this source cannot read. */
const NOT_A_DEVICE: LiveState = { is: "failed", reason: "not a simulator's device" };
/** A device the catalog lacks: no frame will come (its words say why, in the voice's). */
const NO_SUCH_DEVICE: LiveState = { is: "failed", reason: "no device of this type" };

/** THE FIXTURE'S LIVE SOURCES: lend them under `LIVE` where no device streams (a dev desk, a rig). */
export function fixtureSources(
  o: FixtureSourceOptions,
): LiveSources & { stats(): FixtureSourceStats } {
  const open = new Set<string>();
  const counts = { opened: 0, closed: 0, frames: 0, wakes: 0 };

  /** A face that never streams: its state and words fixed, nothing drawn, nothing woken. */
  const still = (key: string, state: LiveState, info: LiveInfo): LiveFace => {
    let closed = false;
    return {
      key,
      texture: () => undefined,
      take: () => false,
      state: () => (closed ? { is: "closed" } : state),
      info: () => info,
      demand: () => {},
      close() {
        if (closed) return;
        closed = true;
        open.delete(key);
        counts.closed += 1;
      },
    };
  };

  return {
    open(key, spec, arrived) {
      if (open.has(key)) throw new Error(`fixtureSources: the face "${key}" is open already`);
      open.add(key);
      counts.opened += 1;
      const device = liveSimulatorSpec(spec);
      if (device === undefined) return still(key, NOT_A_DEVICE, {});
      const model = phoneById(device.deviceType);
      if (model === undefined) return still(key, NO_SUCH_DEVICE, { extra: NO_DEVICE });

      const feed = new FixtureFeed(feedScreenOf(shapeOf(model)), model.screen.px, device.scheme);
      let writer: FixtureWriter | undefined;
      let closed = false;
      /** Asked for nothing (the feed's own start: paused until a demand asks). */
      let paused = true;
      /** What the face says moved since the last take (a pause, a resume): the take answers true for it. */
      let told = false;
      let cancel: (() => void) | undefined;
      // `starting` until its first frame (the kind draws no still it does not have); then `live`, or `paused` while the
      // last frame holds as a still
      const stateNow = (): LiveState =>
        closed
          ? { is: "closed" }
          : writer === undefined
            ? { is: "starting" }
            : paused
              ? { is: "paused" }
              : { is: "live" };
      /** Wake the face when its next frame is due, or at once when what it says moved — the one timer it holds, moved at every take and demand. */
      const schedule = (): void => {
        cancel?.();
        cancel = undefined;
        if (closed) return;
        const now = o.clock.now();
        const at = told ? now : feed.next(now);
        if (at === Number.POSITIVE_INFINITY) return;
        cancel = o.clock.at(at, () => {
          cancel = undefined;
          if (closed) return;
          counts.wakes += 1;
          arrived();
        });
      };
      return {
        key,
        texture: () => writer?.face,
        take() {
          if (closed) return false;
          const f = feed.frame(o.clock.now());
          if (f !== undefined) {
            writer ??= o.writer(key, f.width, f.height);
            writer.presentBytes(f.bytes, f.width, f.height, f.logical);
            counts.frames += 1;
          }
          const moved = told;
          told = false;
          schedule();
          return f !== undefined || moved;
        },
        state: stateNow,
        info: () => (writer === undefined ? {} : { extra: paused ? RESTING : STREAMING }),
        demand(d: LiveDemand) {
          const was = stateNow().is;
          paused = d.mode === "paused";
          feed.demand(d);
          // a pause or a resume with a frame held is news: the phone draws a still for a stream, or the stream again
          if (stateNow().is !== was) told = true;
          schedule();
        },
        close() {
          if (closed) return;
          closed = true;
          cancel?.();
          cancel = undefined;
          writer?.destroy();
          writer = undefined;
          open.delete(key);
          counts.closed += 1;
        },
      };
    },
    stats: () => ({ ...counts }),
  };
}
