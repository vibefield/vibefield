import Testing

@testable import FieldHistory

/// Item 410 (found by the old mini's kit run of 2026-11-14, mini-kitr3a, in
/// `anOlderPageIsRevealedAndMovesTheCursor()`: "Task created in a session that has been invalidated") — a direct
/// read closed while one of its calls is out must not end its network session under that call: `URLSession` answers
/// a task made on an invalidated session with an Objective-C exception, and the app ends. On the phone it is a
/// session left while its older pages are being read, or while a picture's bytes are on their way.
///
/// These rows hold the LAW, which is a count: the session ends at once when nothing is out; a close while a call is
/// out is kept, and the last call back ends the session; a call that never comes back leaves the session standing,
/// because nothing may end it under a call that is out; and nothing is ended twice.
///
/// THE RACE ITSELF IS NOT FORCED HERE. It lies between a call's `await` on the main actor and the task rosetta's
/// client makes for it, and a test has no hand on that moment without a seam inside rosetta's client. What these
/// rows cannot hold is the wiring in `HistoryDirectRead` (each call counted, the session ended where the lease
/// says): that is read in the source, and the kit's own direct-read rows run over it.
///
/// Every mutating call is taken into a `let` first, so no macro has to expand one.
@Suite("item 410 — a direct read's session ends only when none of its calls is out")
struct HistorySessionLeaseTests {
  @Test("a close with no call out ends the session at once")
  func nothingOut() {
    var fresh = HistorySessionLease()
    let atOnce = fresh.close()
    #expect(atOnce)

    // a call that left and came back before the close leaves nothing behind it
    var used = HistorySessionLease()
    used.leave()
    let early = used.back()
    #expect(!early)
    let after = used.close()
    #expect(after)
  }

  @Test("a close while a call is out leaves the session standing, and that call back ends it")
  func oneOut() {
    var lease = HistorySessionLease()
    lease.leave()
    let atOnce = lease.close()
    #expect(!atOnce, "the session was ended under a call that is out")
    let ended = lease.back()
    #expect(ended, "the last call back did not end the session")
  }

  @Test("with two calls out the first back ends nothing, and the last ends the session once")
  func twoOut() {
    var lease = HistorySessionLease()
    lease.leave()
    lease.leave()
    let atOnce = lease.close()
    #expect(!atOnce, "the session was ended under two calls that are out")
    let first = lease.back()
    #expect(!first, "the session was ended under the call still out")
    let last = lease.back()
    #expect(last, "the last call back did not end the session")

    // nothing is ended twice: a return that is counted again ends nothing
    let again = lease.back()
    #expect(!again)
  }

  @Test("a call that never comes back leaves the session standing: nothing ends it under a call that is out")
  func neverBack() {
    var lease = HistorySessionLease()
    lease.leave()
    let atOnce = lease.close()
    #expect(!atOnce, "the session was ended under a call that is out")
    // there is no bound to ask: while the call is out the close stays owed to it, and the session stands
    #expect(lease.out == 1)
    #expect(lease.owed)
    // only the call's own return ends it
    let ended = lease.back()
    #expect(ended, "the call's return did not end the session")
    #expect(!lease.owed)
  }
}
