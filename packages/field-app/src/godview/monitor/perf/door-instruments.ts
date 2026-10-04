import type { DoorClient } from "../doors";
import type { MonitorDoor } from "../remote-door";
import {
  createFrameRecorder,
  encodeFramesJsonl,
  type FrameRecorder,
  type FrameStamp,
  recordingDoor,
} from "./frame-recorder";
import { godviewPerfLab, installGodviewPerfLab } from "./lab-bridge";
import { createModelReplayClient, type ModelReplayClient } from "./model-replay-client";
import { createReplayDoor } from "./replay-door";

// THE DOOR'S INSTRUMENTS (MV-0) — the one switch at the renderer's seam.
//
// `GodviewDeck` builds the monitor's door and hands it through this function.
// With no switch set it hands back THE SAME OBJECT: not a wrapper, not a copy —
// the identity `godview-frame-recorder.test.ts` holds — so the shipping path is
// the unchanged path and a review of this file is a review of what a lab run
// adds, never of what every run pays.
//
// The switch is a URL parameter, like `godviewMarkers` (`development-console.ts`),
// and for the same reason: it is set by the HOST that launched the renderer and
// read once where the door is built, so a renderer that was not launched for a
// recording cannot be talked into one from inside the page. Electron main sets
// it from `VF_GODVIEW_RECORD=<dir>` (`main/godview-recording.ts`), which is also
// where the frames land, gzipped, because the renderer cannot write a file.
//
//   godviewRecord=1   the door is teed into a frame recorder, published on
//                     `window.__vfGodviewRecorder` for the host to drain.

//   godviewReplay=1   the door's two streams come from the lab's player
//                     (`lab-bridge.ts`, `replay-door.ts`); every other verb and
//                     feed stays the real door's. Replay wins over record.
//                     MV-3c: so does the window's model board, when the window
//                     adapter hands its client through `instrumentModelClient`.

export type GodviewDoorInstrument = "off" | "record" | "replay";

export const GODVIEW_RECORD_PARAM = "godviewRecord";
export const GODVIEW_REPLAY_PARAM = "godviewReplay";

export function godviewDoorInstrument(search: string): GodviewDoorInstrument {
  const params = new URLSearchParams(search);
  if (params.get(GODVIEW_REPLAY_PARAM) === "1") return "replay";
  if (params.get(GODVIEW_RECORD_PARAM) === "1") return "record";
  return "off";
}

/** What the host pulls over `executeJavaScript`: JSONL, then nothing held. */
export interface GodviewRecorderBridge {
  drain(): string;
  held(): number;
  dropped(): number;
  readonly origin: FrameStamp;
}

declare global {
  interface Window {
    __vfGodviewRecorder?: GodviewRecorderBridge;
  }
}

let recorder: FrameRecorder | undefined;

/** One recorder per renderer life: a door rebuilt for a new runtime keeps
 * recording into the same buffer, so a reconnect is one corpus, not two. */
function publishedRecorder(): FrameRecorder {
  if (recorder !== undefined) return recorder;
  const created = createFrameRecorder();
  recorder = created;
  if (typeof window !== "undefined") {
    window.__vfGodviewRecorder = {
      drain: () => encodeFramesJsonl(created.drain()),
      held: () => created.held(),
      dropped: () => created.dropped(),
      origin: created.origin,
    };
  }
  return created;
}

function locationSearch(): string {
  return typeof location === "undefined" ? "" : location.search;
}

/**
 * The deck's door, instrumented as the renderer's URL asks — or, with nothing
 * asked, the door itself.
 */
export function instrumentMonitorDoor(door: MonitorDoor, search = locationSearch()): MonitorDoor {
  switch (godviewDoorInstrument(search)) {
    case "off":
      return door;
    case "record":
      return recordingDoor(door, publishedRecorder());
    case "replay": {
      const { player } = godviewPerfLab() ?? installGodviewPerfLab();
      const replay = createReplayDoor({
        real: door,
        roster: {
          current: () => player.roster(),
          onChange: (listener) => player.onRoster(listener),
        },
      });
      player.attach(replay);
      return replay;
    }
  }
}

let modelReplay: ModelReplayClient | undefined;

/** One model replay client per renderer life, like the recorder: a feed built
 * again (Godview reopened, a gap re-asked) hears the same stream. */
function publishedModelReplay(): ModelReplayClient {
  if (modelReplay !== undefined) return modelReplay;
  const created = createModelReplayClient();
  modelReplay = created;
  const { player } = godviewPerfLab() ?? installGodviewPerfLab();
  player.attachModel(created);
  return created;
}

/**
 * MV-3c — THE MODEL DOOR'S INSTRUMENT, the same switch: `createGodviewMonitorFeed`
 * hands its client through here. With nothing asked it hands back THE SAME
 * OBJECT; under `godviewReplay=1` the model board is answered by the lab's
 * player from a model stream (`model-replay-client.ts`), and every other call
 * goes to the newest client given.
 */
export function instrumentModelClient(client: DoorClient, search = locationSearch()): DoorClient {
  if (godviewDoorInstrument(search) !== "replay") return client;
  const replay = publishedModelReplay();
  if (client !== replay) replay.setReal(client);
  return replay;
}

/** The lab's own handle on the model replay (its witness feed, `lab-bridge.ts`). */
export function godviewModelReplay(): ModelReplayClient {
  return publishedModelReplay();
}

/** Test seam: the published recorder is per-renderer-life by design. */
export function resetGodviewDoorInstrumentsForTest(): void {
  recorder = undefined;
  modelReplay = undefined;
  if (typeof window !== "undefined") delete window.__vfGodviewRecorder;
}
