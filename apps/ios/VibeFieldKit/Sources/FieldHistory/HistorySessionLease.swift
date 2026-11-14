// Item 410 — WHEN a direct read's network session ends.
//
// `URLSession` answers a task made after `invalidateAndCancel()` with an Objective-C exception ("Task created in a
// session that has been invalidated"), which no Swift `catch` takes: the app ends. A call of the read's that has left
// the main actor (an older page, a picture's bytes) makes its task a moment later, inside rosetta's client, so a close
// that falls between the two must not end the session under it.
//
// The lease is the count that decides it, and nothing else: the calls that are out, and whether a close is owed to
// the last of them. It holds no session and starts no clock; `HistoryDirectRead` asks it at each of its four moments
// (a call leaves, a call is back, the read closes, the bound passes) and ends the session when it says so.

/// The calls of one direct read that are out, and the close kept for the last of them.
struct HistorySessionLease: Equatable, Sendable {
  /// The client's calls that are out: an older page, a picture's bytes.
  private(set) var out = 0
  /// A close came while a call was out: the session stands until the last call is back, or until the bound.
  private(set) var owed = false

  /// A call leaves the main actor for rosetta's client.
  mutating func leave() {
    out += 1
  }

  /// A call is back. True when the session is to be ended NOW: it was the last one out and a close was kept for it.
  ///
  /// Item 410 (red) — a STUB so the rows compile: no close is ever kept, so no call back ends a session.
  mutating func back() -> Bool {
    out = max(0, out - 1)
    return false
  }

  /// The read closes. True when the session is to be ended at once; false keeps the close for the last call back.
  ///
  /// Item 410 (red) — a STUB so the rows compile: the session is ended at once whatever is out, as
  /// `HistoryDirectRead.shutDown()` ends it today.
  mutating func close() -> Bool {
    true
  }

  /// The bound on a kept close passed. True when the session is to be ended NOW: its close is still owed, to a call
  /// that did not come back.
  ///
  /// Item 410 (red) — a STUB so the rows compile: nothing is owed, so the bound ends nothing.
  mutating func expire() -> Bool {
    false
  }
}
