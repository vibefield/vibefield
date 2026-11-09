// ES-6 — skeleton for the red: the judges answer nothing yet.

import type { BrowserWindow } from "electron";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface NightStep {
  readonly value: string | null;
  readonly at: number;
}
export interface NightSeen {
  readonly lean: readonly NightStep[];
  readonly portal: readonly NightStep[];
  readonly lent: readonly NightStep[];
}
export interface NightFacts {
  readonly view: string;
  readonly chat: Box | null;
  readonly drawn: boolean;
  readonly newSpark: Box | null;
  readonly newSparkOff: boolean;
  readonly hit: boolean;
  readonly nightClip: string;
  readonly sheet: boolean;
  readonly open: string | null;
  readonly portal: string | null;
  readonly lean: string | null;
  readonly lent: string | null;
  readonly sky: Box | null;
  readonly window: Box | null;
  readonly windowClip: string;
  readonly wordsOpacity: number | null;
}
export interface Capture {
  readonly bgra: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
}
export type Mask = (x: number, y: number) => boolean;
export interface Moved {
  readonly pixels: number;
  readonly moved: number;
}
export interface ChatNightDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string;
  readonly say: (line: string) => void;
  readonly pressChat: () => void;
  readonly pressNewSparkKey: () => void;
}

export const CHAT_NIGHT_RECORDER = "";
export const CHAT_NIGHT_FACTS = "";
export const captureOf = (bgra: Uint8Array, _w: number, _h: number): Capture | null =>
  bgra.length < 0 ? null : null;
export const outsideHush =
  (_panel: Box): Mask =>
  () =>
    false;
export const belowTheStar =
  (_sky: Box, _panel: Box): Mask =>
  () =>
    false;
export const spreadOf = (_c: Capture, _mask: Mask): number => 0;
export const movedBetween = (_a: Capture, _b: Capture, _mask: Mask): Moved => ({
  pixels: 0,
  moved: 0,
});
export const windowVisibleBox = (_window: Box | null, _clip: string): Box | null => null;
export const judgeNightStands = (_f: NightFacts, _spread: number): string[] => [];
export const judgeLean = (_s: NightSeen, _clip: string, _leftAt: number): string[] => [];
export const judgeClose = (_s: NightSeen, _f: NightFacts): string[] => [];
export const judgeFold = (_s: NightSeen, _f: NightFacts, _spread: number): string[] => [];
export const judgeHandOff = (_floor: Moved, _handOff: Moved, _spread: number): string[] => [];
export const chatNightRows = async (_d: ChatNightDriver): Promise<string[]> => [];
