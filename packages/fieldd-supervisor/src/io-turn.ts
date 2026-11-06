// WG-E1 (thinking-floor-wedge.md §4) on the shell's side of the fieldd link (item 212, RV #30): the one yield before
// a timeout verdict. A deadline's timer runs in the event loop's timers phase, BEFORE the poll phase reads the sockets
// that became readable in that same turn, so a reply already buffered would lose to its own deadline. A setImmediate
// callback runs in the check phase, after that poll phase: a reply waiting there is read, and settles, first.
// fieldd's floor ladder yields the same way with its own (`yieldToIo`, native-supervisor.ts): fieldd never imports
// this package, which is the shell's.

/** Run `fn` after one turn of the event loop's I/O (one `setImmediate`): a reply already read in this turn's poll
 * phase settles before `fn` gives its verdict. The adoption probe's timeout goes through it (probe.ts). */
export function afterIoTurn(fn: () => void): void {
  setImmediate(fn);
}
