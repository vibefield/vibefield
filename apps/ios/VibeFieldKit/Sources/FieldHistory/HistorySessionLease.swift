// Item 410 — WHEN a direct read's network session ends.
//
// `URLSession` answers a task made after `invalidateAndCancel()` with an Objective-C exception ("Task created in a
// session that has been invalidated"), which no Swift `catch` takes: the app ends. A call of the read's that has left
// the main actor (an older page, a picture's bytes) makes its task a moment later, inside rosetta's client, so a close
// that falls between the two must not end the session under it.
//
// The lease is the count that decides it, and nothing else: the calls that are out, and whether a close is owed to
// the last of them. It holds no session and no clock; `HistoryDirectRead` asks it at each of its three moments (a
// call leaves, a call is back, the read closes) and ends the session when it says so.
//
// THERE IS NO BOUND. Nothing but the return of the last call ends a session a close left standing: whatever else
// ended it would end it under a call that is still out, which is the exception again. So a session stands for as long
// as one of the read's own calls is out, and a call that never returns keeps it for good. rosetta's requests carry
// their own timeouts, so such a call is one hung before it made its task: a fault to find, not one to paper over.

/// The calls of one direct read that are out, and the close kept for the last of them.
struct HistorySessionLease: Equatable, Sendable {
  /// The client's calls that are out: an older page, a picture's bytes.
  private(set) var out = 0
  /// A close came while a call was out: the session stands until the last call is back.
  private(set) var owed = false

  /// A call leaves the main actor for rosetta's client.
  mutating func leave() {
    out += 1
  }

  /// A call is back. True when the session is to be ended NOW: it was the last one out and a close was kept for it.
  mutating func back() -> Bool {
    out = max(0, out - 1)
    guard out == 0, owed else { return false }
    owed = false
    return true
  }

  /// The read closes. True when the session is to be ended at once: nothing is out. False keeps the close for the
  /// last call back: the session stands, and the caller cancels what is already on its way.
  mutating func close() -> Bool {
    guard out > 0 else { return true }
    owed = true
    return false
  }
}
