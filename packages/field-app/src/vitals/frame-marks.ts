import type { VitalsModel } from "./vitals-model";

// VT-3c (track VT, 2026-11-24; VT-D10 A) — the desk window's long frames, as the Loop lane marks them (DESIGN.md §8
// "Vitals", the Loop lane's "Long frames"): one mark for each second in which a process said it had a long frame.
// A second that said none has no mark; nothing here is a zero.

export interface FrameMark {
  /** the sample's time: where the mark stands */
  time: number;
  key: string;
  frames: number;
}

/** Every second, in the model's samples, in which a process said it had a long frame, oldest first. */
export function frameMarks(model: VitalsModel): FrameMark[] {
  const marks: FrameMark[] = [];
  for (const sample of model.samples) {
    for (const point of sample.points) {
      const frames = point.own?.longFrames;
      if (frames !== undefined && frames > 0)
        marks.push({ time: sample.time, key: point.key, frames });
    }
  }
  return marks;
}
