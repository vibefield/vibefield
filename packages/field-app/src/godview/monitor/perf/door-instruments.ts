import type { DoorClient } from "../doors";
import type { DevicesPort } from "../remote-door";
import { godviewPerfLab, installGodviewPerfLab } from "./lab-bridge";
import { createModelReplayClient, type ModelReplayClient } from "./model-replay-client";

// MV-8: the lab replaces only the model client and device roster. The live
// fold recorder, desk-board replay door and their URL switch are retired.
// With no replay requested both adapters return the exact object received.
export const GODVIEW_REPLAY_PARAM = "godviewReplay";

export function godviewReplayRequested(search: string): boolean {
  return new URLSearchParams(search).get(GODVIEW_REPLAY_PARAM) === "1";
}

function locationSearch(): string {
  return typeof location === "undefined" ? "" : location.search;
}

export function instrumentDevicesPort(port: DevicesPort, search = locationSearch()): DevicesPort {
  if (!godviewReplayRequested(search)) return port;
  const { player } = godviewPerfLab() ?? installGodviewPerfLab();
  return {
    subscribe(listener) {
      const current = player.roster();
      if (current.length > 0) listener(current);
      return player.onRoster(listener);
    },
  };
}

let modelReplay: ModelReplayClient | undefined;

/** One client per renderer life: a reopened stage receives the same stream. */
function publishedModelReplay(): ModelReplayClient {
  if (modelReplay !== undefined) return modelReplay;
  const created = createModelReplayClient();
  modelReplay = created;
  const { player } = godviewPerfLab() ?? installGodviewPerfLab();
  player.attachModel(created);
  return created;
}

export function instrumentModelClient(client: DoorClient, search = locationSearch()): DoorClient {
  if (!godviewReplayRequested(search)) return client;
  const replay = publishedModelReplay();
  if (client !== replay) replay.setReal(client);
  return replay;
}

/** Test seam: the replay client is per renderer life. */
export function resetGodviewDoorInstrumentsForTest(): void {
  modelReplay = undefined;
}
