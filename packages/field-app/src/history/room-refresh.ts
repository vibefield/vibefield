// THE ROOM IS ASKED TO LOOK AGAIN (track HD, HD-1). The room reads the index's state at its own pace, every 30 s once
// an import is done, and an act made outside it changes that state under it: Settings → History clears what History
// read, or changes whose sessions it reads, and the history service restarts. The act says so here, and the History
// view asks its room's status at once (`HistoryRoomHandle.refreshStatus`, as the consent slot's grant does). A module
// store, as the line's door and the import sign's are: Settings is its own chunk and the room sits deep in the cover.

const listeners = new Set<() => void>();

/** An act outside the room changed what the index holds or reads. */
export function requestHistoryRoomRefresh(): void {
  for (const listener of listeners) listener();
}

/** The History view's subscription; answers its undo. */
export function onHistoryRoomRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
