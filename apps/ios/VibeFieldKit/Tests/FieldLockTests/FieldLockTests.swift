import Foundation
import Testing

@testable import FieldLock

/// The ask, answered by the test: each ask takes the next answer (a pass when none is queued), and `during` runs
/// while it is up, as iOS's own sheet is, so a row can move the scene under it.
@MainActor
final class FakeAsk: LockAuthenticator {
  var method: LockMethod
  var answers: [LockAnswer] = []
  var during: (() -> Void)?
  /// The first ask stays up until the row releases it, as iOS's sheet does while the person looks.
  var holdsFirst = false
  private(set) var reasons: [String] = []
  private var held: CheckedContinuation<Void, Never>?

  init(_ method: LockMethod = .faceID) {
    self.method = method
  }

  var asks: Int { reasons.count }

  func ask(reason: String) async -> LockAnswer {
    reasons.append(reason)
    during?()
    if holdsFirst && reasons.count == 1 { await withCheckedContinuation { held = $0 } }
    return answers.isEmpty ? .passed : answers.removeFirst()
  }

  func release() {
    held?.resume()
    held = nil
  }
}

@MainActor
final class MemoryKeeping: LockKeeping {
  var lockOn: Bool
  var lockDelay: LockDelay?

  init(on: Bool = false, delay: LockDelay? = nil) {
    lockOn = on
    lockDelay = delay
  }
}

/// The lock's own clock, stepped by the row: no row waits on the wall clock (item 157's lesson).
@MainActor
final class StepClock {
  var now = ContinuousClock.now

  func advance(_ duration: Duration) {
    now += duration
  }
}

/// WI-3 — the lock's rules (DESIGN.md §9 "The lock"; WI-D3…D7 A, WI-L5): when it asks, what the curtain covers,
/// that a change asks first, and that a lock which cannot ask stands down.
@Suite("the lock asks on a launch, after its time away and on Lock now; it covers while away; a change asks first")
@MainActor
struct FieldLockTests {
  let ask: FakeAsk
  let keeping: MemoryKeeping
  let clock = StepClock()

  init() {
    ask = FakeAsk()
    keeping = MemoryKeeping()
  }

  private func make(on: Bool = true, delay: LockDelay? = nil, method: LockMethod = .faceID) -> FieldLock {
    ask.method = method
    keeping.lockOn = on
    keeping.lockDelay = delay
    let clock = clock
    return FieldLock(authenticator: ask, keeping: keeping, now: { clock.now })
  }

  /// The app goes away (the switcher, the home screen) and comes back after `after`.
  private func away(_ lock: FieldLock, for after: Duration) async {
    lock.phase(.inactive)
    lock.phase(.background)
    clock.advance(after)
    lock.phase(.inactive)
    await lock.phase(.active)?.value
  }

  @Test("a launch with the lock on stands the curtain, asks once the scene is active, and a pass opens it (WI-L5)")
  func launchAsks() async {
    let lock = make()
    #expect(lock.state == .waiting)
    #expect(lock.covers, "nothing of yours shows before it passes")
    lock.phase(.inactive)
    #expect(ask.asks == 0, "the ask waits for the scene to be active")
    await lock.phase(.active)?.value
    #expect(ask.asks == 1)
    #expect(ask.reasons == ["Only you can open VibeField on this iPhone."])
    #expect(lock.state == .open)
    #expect(!lock.covers)
  }

  @Test("with the lock off nothing is covered and nothing is asked, whatever the scene does")
  func offAsksNothing() async {
    let lock = make(on: false)
    #expect(lock.state == .open)
    #expect(!lock.covers)
    lock.phase(.inactive)
    #expect(!lock.covers, "with the lock off the switcher shows your last screen (WI-D6 A)")
    await away(lock, for: .seconds(3600))
    #expect(ask.asks == 0)
    #expect(lock.state == .open)
  }

  @Test("the time away: at a minute, 59 seconds comes back open and 60 asks (WI-D4 A)")
  func timeAway() async {
    let lock = make()
    #expect(lock.delay == .oneMinute, "a minute to start")
    await lock.phase(.active)?.value
    #expect(ask.asks == 1)
    await away(lock, for: .seconds(59))
    #expect(ask.asks == 1, "a quick trip to copy a code comes back open")
    #expect(lock.state == .open)
    #expect(!lock.covers)
    await away(lock, for: .seconds(60))
    #expect(ask.asks == 2, "anything longer asks")
    #expect(lock.state == .open)
  }

  @Test("each of Settings' times is the lock's: 5 minutes lets 4:59 back and asks at 5:00", arguments: [
    LockDelay.oneMinute, .fiveMinutes, .fifteenMinutes,
  ])
  func eachDelay(delay: LockDelay) async {
    let lock = make(delay: delay)
    await lock.phase(.active)?.value
    await away(lock, for: delay.duration - .seconds(1))
    #expect(ask.asks == 1)
    await away(lock, for: delay.duration)
    #expect(ask.asks == 2)
  }

  @Test("Immediately asks on every return from the background, never on a trip to Control Center")
  func immediately() async {
    let lock = make(delay: .immediately)
    await lock.phase(.active)?.value
    lock.phase(.inactive)
    await lock.phase(.active)?.value
    #expect(ask.asks == 1, "inactive and back is not away")
    await away(lock, for: .zero)
    #expect(ask.asks == 2)
  }

  @Test("the cover: up while the scene is away and the lock is on, so the switcher shows the launch picture (WI-D6 A)")
  func coverWhileAway() async {
    let lock = make()
    await lock.phase(.active)?.value
    #expect(!lock.covers)
    lock.phase(.inactive)
    #expect(lock.covers, "at inactive, before iOS takes the switcher's picture")
    lock.phase(.background)
    #expect(lock.covers)
    lock.phase(.inactive)
    await lock.phase(.active)?.value
    #expect(!lock.covers, "back inside the lock's time: your last screen")
  }

  @Test("the cover: never for iOS's own sheet, which makes the app inactive too, while a change asks")
  func noCoverForTheSystemAsk() async {
    let lock = make()
    await lock.phase(.active)?.value
    var coveredDuringAsk: Bool?
    ask.during = { [lock] in
      lock.phase(.inactive)
      coveredDuringAsk = lock.covers
    }
    #expect(await lock.setDelay(.fiveMinutes))
    #expect(coveredDuringAsk == false, "Settings stays under Face ID's sheet")
    await lock.phase(.active)?.value
    #expect(!lock.covers)
    #expect(ask.asks == 2, "and coming back from the sheet asks nothing more")
  }

  @Test("a change asks first, and a miss or a Cancel leaves it as it was (§9: Changing these asks Face ID first)")
  func changesAskFirst() async {
    let lock = make(on: false)
    ask.answers = [.missed]
    #expect(await lock.setOn(true) == false)
    #expect(!lock.isOn)
    #expect(!keeping.lockOn)
    #expect(await lock.setOn(true))
    #expect(lock.isOn)
    #expect(keeping.lockOn, "kept, for the next launch")
    ask.answers = [.missed]
    #expect(await lock.setDelay(.fifteenMinutes) == false)
    #expect(lock.delay == .oneMinute)
    #expect(await lock.setDelay(.fifteenMinutes))
    #expect(lock.delay == .fifteenMinutes)
    #expect(keeping.lockDelay == .fifteenMinutes)
    ask.answers = [.missed]
    #expect(await lock.setOn(false) == false)
    #expect(lock.isOn, "turning it off asks too")
    #expect(ask.asks == 5)
  }

  @Test("a miss says so with its one act, a return asks again, and Unlock opens it (WI-D5 A)")
  func missThenUnlock() async {
    let lock = make()
    ask.answers = [.missed]
    await lock.phase(.active)?.value
    #expect(lock.state == .missed)
    #expect(lock.covers)
    lock.phase(.inactive)
    await lock.phase(.active)?.value
    #expect(ask.asks == 1, "the sheet's own inactive and back never asks again on its own")
    ask.answers = [.missed]
    await away(lock, for: .seconds(1))
    #expect(ask.asks == 2, "a return finds the curtain up and asks")
    #expect(lock.state == .missed)
    await lock.unlock()
    #expect(ask.asks == 3)
    #expect(lock.state == .open)
    #expect(!lock.covers)
  }

  @Test("Lock now locks at once and asks, and only while the lock is on")
  func lockNow() async {
    let off = make(on: false)
    #expect(off.lockNow() == nil)
    #expect(off.state == .open)
    let lock = make()
    await lock.phase(.active)?.value
    ask.answers = [.missed]
    let asking = lock.lockNow()
    #expect(lock.covers, "the curtain stands before the ask comes")
    await asking?.value
    #expect(ask.asks == 2)
    #expect(lock.state == .missed)
  }

  @Test("the way in offers the lock only while it is off and the phone can lock (WI-D3 A)")
  func offer() {
    #expect(make(on: false).canOffer)
    #expect(!make(on: true).canOffer, "already on: no third step")
    #expect(!make(on: false, method: .none).canOffer, "no passcode: nothing to offer")
    #expect(make(on: false, method: .passcode).canOffer)
  }

  @Test("the stand-down: a passcode removed with the lock on opens VibeField, turns the switch off and says why")
  func standDown() async {
    let lock = make()
    await lock.phase(.active)?.value
    #expect(lock.isOn)
    #expect(lock.switchFoot == "Face ID opens VibeField. When Face ID can’t, your iPhone passcode does.")
    ask.method = .none
    await away(lock, for: .seconds(3600))
    #expect(lock.state == .open, "a lock that cannot ask must not hold the door")
    #expect(!lock.covers)
    #expect(!lock.isOn)
    #expect(!keeping.lockOn)
    #expect(lock.switchFoot == "Set a passcode in iOS Settings to lock VibeField.")
    #expect(ask.asks == 1, "nothing was asked of a phone that cannot answer")
    #expect(await lock.setOn(true) == false, "and it cannot be turned on again until a passcode is set")
    #expect(!lock.isOn)
  }

  @Test("a launch with the lock kept on but no passcode set opens, the switch off")
  func launchStandsDown() async {
    let lock = make(method: .none)
    #expect(lock.state == .open)
    #expect(!lock.covers)
    #expect(!lock.isOn)
    #expect(!keeping.lockOn)
    await lock.phase(.active)?.value
    #expect(ask.asks == 0)
  }

  @Test("the switch's foot: its line while on, what off means while off")
  func switchFoot() async {
    let lock = make(on: false)
    #expect(
      lock.switchFoot
        == "VibeField opens without Face ID. Anyone holding this phone unlocked can open your agents’ terminals.")
    #expect(await lock.setOn(true))
    #expect(lock.switchFoot == "Face ID opens VibeField. When Face ID can’t, your iPhone passcode does.")
  }

  @Test("one ask at a time: a second tap while iOS's ask is up asks nothing, and the first's answer stands")
  func oneAskAtATime() async {
    let lock = make(on: false)
    ask.holdsFirst = true
    let first = Task { await lock.setOn(true) }
    for _ in 0..<100 where ask.asks == 0 { await Task.yield() }
    #expect(ask.asks == 1)
    #expect(await lock.setOn(true) == false)
    #expect(ask.asks == 1)
    ask.release()
    #expect(await first.value)
    #expect(lock.isOn && keeping.lockOn)
  }
}
