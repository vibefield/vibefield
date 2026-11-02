import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// PG-3e (design v2 §3.7, Q-P2 as ruled; the v2 check's M3 (a) and S1) — the OLD HOME. A pre-PG-2 desktop answers the
// phone's `{projection: "remote", scope: "mesh"}` with PRECONDITION_FAILED, `retryable: false` (fieldd's
// `malformedBoardAsk`, before `remote` joined its list). The phone does not fall back to `field`. Each such desktop is
// asked again on its OWN ladder — 30, 60, 120, 240 s apart, then every 300 — that no hello resets; a desktop that
// serves the cut is home first; and the corner says the door's own words for as long as the ladder holds, wherever
// the desktop has been in between. Only an open from that desktop that reads, or its board listed live by a home,
// clears the record.
//
// Every row moves a test clock and drives its passes by hand (`sweepNow`, on `idleSchedule`, whose ticker never comes
// round inside a row): the rule is about TIME, never the ticker's cadence.

/// fieldd's refusal of an ask it cannot parse, as a desktop from before `remote` spells it.
private let malformedAsk =
  #"expected { projection?: "full" | "field" | "model", scope?: "local" | "mesh", minIntervalMs?: number, heartbeatMs?: number }"#

/// A desktop from before PG-2: it answers hello and its roster, and refuses the remote cut.
private let oldDoor: LinkDoor.Script = { method, id, _ in
  switch method {
  case "system.hello": return [frame(id: id, ack)]
  case "agent.subscribe":
    return [failureFrame(id: id, kind: "PRECONDITION_FAILED", message: malformedAsk)]
  default: return []
  }
}

/// What a modern door says while this phone is not yet let into the field (UA-P-1d's FORBIDDEN_SCOPE).
private let notYet = "this phone is not yet approved for the field"

/// A desktop that serves the cut and answers the field "not yet": a refusal of another kind than the old version's,
/// transient (asked again on the sweep), never a ladder.
private let notYetDoor: LinkDoor.Script = { method, id, _ in
  switch method {
  case "system.hello": return [frame(id: id, ack)]
  case "agent.subscribe": return [failureFrame(id: id, kind: "FORBIDDEN_SCOPE", message: notYet)]
  default: return []
  }
}

/// A desktop that is old until the row upgrades it: from then its door serves `board`.
private final class Upgrade: @unchecked Sendable {
  private let lock = NSLock()
  private var served = false
  func now() { lock.withLock { served = true } }
  var done: Bool { lock.withLock { served } }
}

private func upgradable(_ upgrade: Upgrade, board: [MeshEntry]) -> LinkDoor.Script {
  { method, id, params in
    upgrade.done ? homeDoor(board)(method, id, params) : oldDoor(method, id, params)
  }
}

/// The studio's own board, as a desktop that serves the cut answers it.
private let studioOnly = [MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")])]

private let start = Date(timeIntervalSince1970: 1_790_800_000)

/// A link on a moving clock and an idle ticker, with its pass counter.
@MainActor
private func oldHomeLink(
  peers: [FieldStorePeer] = [studio], door: LinkDoor, clock: MovableClock
) async throws -> (FieldLink, MeshRehearsal, SweepCounter) {
  let counter = SweepCounter()
  let (link, mesh, _, _) = try await standingLink(
    peers: peers, door: door, schedule: idleSchedule, counter: counter, clock: clock)
  return (link, mesh, counter)
}

/// A pass, then a beat for whatever it armed to reach the door: "not asked" is evidence only after both.
@MainActor
private func passAndSettle(_ mesh: MeshRehearsal, _ counter: SweepCounter, peer: FieldStorePeer = studio)
  async throws
{
  try await sweepNow(mesh, counter, peer: peer)
  try await Task.sleep(for: .milliseconds(80))
}

/// A positive wait that STOPS the row when it times out. The ladder runs on the moving clock (`MovableClock`, the
/// link's injected `now`) and every pass is driven by hand, so wall time enters only here: a rung whose asks have not
/// landed must never see the clock moved on under it, or the refusal is stamped at the next rung's time and every later
/// rung shifts (O3 under the first whole-kit run's load, 2026-11-02 07:42Z: t30 missed its 5 s wait, the row went on,
/// and t90 and t210 missed after it). Thirty seconds of wall time, for a loaded Mac; a miss stops the row there.
@MainActor
private func settle(_ what: String, _ condition: @MainActor () async -> Bool) async throws {
  try await waitUntil(what, timeout: .seconds(30), condition)
  guard await condition() else { throw RowStopped(what: what) }
}

private struct RowStopped: Error, CustomStringConvertible {
  let what: String
  var description: String { "stopped: \(what) never settled" }
}

@MainActor
private func row(_ deviceId: String, in link: FieldLink) -> FieldDesktop? {
  link.desktops.first { $0.deviceId == deviceId }
}

@MainActor
@Suite struct FieldLinkOldHomeTests {
  /// O1 — one old desktop: asked at 0, then at 30 s, then at 90 s — and not at the sweeps between.
  @Test func aNotRetryableRefusalIsAskedOnItsLadder() async throws {
    let clock = MovableClock(start)
    let door = LinkDoor(script: oldDoor)
    let (link, mesh, counter) = try await oldHomeLink(door: door, clock: clock)
    defer { link.stop() }
    try await settle("the first refusal") { row("dev-studio", in: link)?.fieldRefusal != nil }
    #expect(await door.subscribes() == 1)

    for step in [10.0, 10, 9] {  // t10, t20, t29
      clock.advance(step)
      try await passAndSettle(mesh, counter)
    }
    let inside = await door.subscribes()
    #expect(inside == 1, "three passes inside the first 30 s ask nothing")

    clock.advance(1)  // t30
    try await passAndSettle(mesh, counter)
    try await settle("the second ask") { await door.subscribes() >= 2 }

    clock.advance(59)  // t89
    try await passAndSettle(mesh, counter)
    let doubled = await door.subscribes()
    #expect(doubled == 2, "the next interval is 60 s")

    clock.advance(1)  // t90
    try await passAndSettle(mesh, counter)
    try await settle("the third ask") { await door.subscribes() >= 3 }
    let third = await door.subscribes()
    #expect(third == 3)
  }

  /// O2 — a new hello inside the window (the home's socket dropped and re-dialled) asks nothing: no hello resets the
  /// ladder, which is what made the first design loop (§0.13).
  @Test func aHelloDoesNotResetTheLadder() async throws {
    let clock = MovableClock(start)
    let door = LinkDoor(script: oldDoor)
    let (link, mesh, counter) = try await oldHomeLink(door: door, clock: clock)
    defer { link.stop() }
    try await settle("the first refusal") { row("dev-studio", in: link)?.fieldRefusal != nil }

    clock.advance(5)
    await door.latest(to: studioDoorHost)?.drop()
    try await settle("a second hello") {
      await door.dials(to: studioDoorHost) >= 2 && row("dev-studio", in: link)?.state == .ready
    }
    try await passAndSettle(mesh, counter)
    let held = await door.subscribes()
    #expect(held == 1, "the hello is not the ladder's time")

    clock.advance(25)  // t30
    try await passAndSettle(mesh, counter)
    try await settle("the ask at its time") { await door.subscribes() >= 2 }
    // EXACT at each rung (the review's [16]): `>= 2` alone absorbed an early ask that landed late under load
    try await Task.sleep(for: .milliseconds(80))
    let atThirty = await door.subscribes()
    #expect(atThirty == 2, "one ask at t30 and none before it")
    clock.advance(5)  // t35: where a ladder the hello reset would next be due
    try await passAndSettle(mesh, counter)
    let atThirtyFive = await door.subscribes()
    #expect(atThirtyFive == 2, "the next rung is t90, not the hello's")
  }

  /// O3 — two old desktops: each is asked at 0, 30, 90 and 210 s, the field moving to whichever is due — never both
  /// every 30 s (§3.7's walk).
  @Test func twoOldDesktopsDoubleTheirBackoff() async throws {
    let clock = MovableClock(start)
    let door = LinkDoor(script: oldDoor)
    await door.route(laptopDoorHost, oldDoor)
    await door.route(studioDoorHost, oldDoor)
    let (link, mesh, counter) = try await oldHomeLink(
      peers: [laptop, studio], door: door, clock: clock)
    defer { link.stop() }

    func asks() async -> [Int] {
      [await door.subscribes(to: laptopDoorHost), await door.subscribes(to: studioDoorHost)]
    }
    try await settle("each asked once") { await asks() == [1, 1] }

    var at = 0.0
    for (due, expected) in [(30.0, [2, 2]), (90, [3, 3]), (210, [4, 4])] {
      clock.advance(due - 1 - at)
      at = due - 1
      try await passAndSettle(mesh, counter)
      let before = await asks()
      let earlier = expected.map { $0 - 1 }
      #expect(before == earlier, "nothing asked at t\(Int(at))")
      clock.advance(1)
      at = due
      try await passAndSettle(mesh, counter)
      try await settle("each asked at t\(Int(due))") { await asks() == expected }
      let heard = await asks()
      #expect(heard == expected, "t\(Int(due)): home \(link.home ?? "none"); \(link.notes.suffix(10))")
    }
    #expect(link.home != nil, "still homed: a refused home answers")
  }

  /// O4 — the old desktop is home and refuses; the newer one serves the cut: home is the newer within one pass, its
  /// board drawn, and the old one's corner row stays "connected · the field was refused: …".
  @Test func aDesktopThatServesTheCutIsHomeFirst() async throws {
    let clock = MovableClock(start)
    let door = LinkDoor(script: selfDoor)
    await door.route(laptopDoorHost, oldDoor)  // dev-laptop sorts first: the first home
    await door.route(studioDoorHost, homeDoor(studioOnly))
    let (link, _, _) = try await oldHomeLink(peers: [laptop, studio], door: door, clock: clock)
    defer { link.stop() }

    try await settle("home is the desktop that serves the cut") {
      link.home == "dev-studio" && link.rows.map { $0.key } == ["s-1"]
    }
    let old = try #require(row("dev-laptop", in: link))
    #expect(old.state == .ready, "a refused home still answers")
    let line = MeshDisplay.linkLine(desktop: old)
    #expect(line.contains("connected · the field was refused: "))
    let laptopAsks = await door.subscribes(to: laptopDoorHost)
    #expect(laptopAsks == 1)
  }

  /// O5 — the old desktop upgrades: at its next due ask the open reads, the record and the corner's words go, and a
  /// later hello asks at once, with no wait.
  @Test func anOpenThatDecodesClearsTheLadder() async throws {
    let clock = MovableClock(start)
    let upgrade = Upgrade()
    let door = LinkDoor(script: upgradable(upgrade, board: studioOnly))
    let (link, mesh, counter) = try await oldHomeLink(door: door, clock: clock)
    defer { link.stop() }
    try await settle("the first refusal") { row("dev-studio", in: link)?.fieldRefusal != nil }

    upgrade.now()
    clock.advance(10)
    try await passAndSettle(mesh, counter)
    let held = await door.subscribes()
    #expect(held == 1, "upgraded or not, it is asked at its ladder's time")

    clock.advance(20)  // t30
    try await passAndSettle(mesh, counter)
    try await settle("the open read, the words gone") {
      link.rows.map { $0.key } == ["s-1"] && row("dev-studio", in: link)?.fieldRefusal == nil
    }

    let before = await door.subscribes()
    await door.latest(to: studioDoorHost)?.drop()
    try await settle("a later hello asks at once") { await door.subscribes() > before }
  }

  /// S1 — a desktop that sleeps and wakes inside its ladder keeps its place on it AND its words: the corner never
  /// reads "connected" over a blank field while the ladder holds it off.
  @Test func aDesktopThatSleepsAndWakesKeepsItsWords() async throws {
    let clock = MovableClock(start)
    let door = LinkDoor(script: oldDoor)
    let (link, mesh, counter) = try await oldHomeLink(door: door, clock: clock)
    defer { link.stop() }
    try await settle("the first refusal") { row("dev-studio", in: link)?.fieldRefusal != nil }

    clock.advance(2)
    let sleeping = asleepCopy(studio)
    await mesh.set(peers: [sleeping])
    try await passAndSettle(mesh, counter, peer: sleeping)
    try await settle("forgotten while asleep") { row("dev-studio", in: link) == nil }

    clock.advance(3)  // t5
    await mesh.set(peers: [studio])
    try await passAndSettle(mesh, counter)
    try await settle("back, with its words") {
      row("dev-studio", in: link)?.fieldRefusal != nil
    }
    let held = await door.subscribes()
    #expect(held == 1, "waking is not the ladder's time")

    clock.advance(25)  // t30
    try await passAndSettle(mesh, counter)
    try await passAndSettle(mesh, counter)
    try await settle("asked at its time") { await door.subscribes() >= 2 }
    // EXACT at each rung (the review's [16])
    try await Task.sleep(for: .milliseconds(80))
    let atThirty = await door.subscribes()
    #expect(atThirty == 2, "one ask at t30 and none before it")
    clock.advance(5)  // t35: where a ladder the wake reset would next be due
    try await passAndSettle(mesh, counter)
    let atThirtyFive = await door.subscribes()
    #expect(atThirtyFive == 2, "the next rung is t90, not the wake's")
  }

  /// S1 — the old desktop upgrades while ANOTHER is home: the home's board lists it live with its board, and that
  /// clears its record and its words — its row reads connected, its agents are drawn, and nothing waits for it to be
  /// home again.
  @Test func anUpgradeBehindAnotherHomeClearsItsWords() async throws {
    let clock = MovableClock(start)
    let door = LinkDoor(script: selfDoor)
    await door.route(laptopDoorHost, oldDoor)
    await door.route(studioDoorHost, homeDoor(studioOnly))
    let (link, _, _) = try await oldHomeLink(peers: [laptop, studio], door: door, clock: clock)
    defer { link.stop() }
    // the home's own board drawn, not only chosen: `openHome` names the home before its door is dialled
    try await settle("home is the studio, the laptop refused") {
      link.home == "dev-studio" && row("dev-laptop", in: link)?.fieldRefusal != nil
        && link.rows.map { $0.key } == ["s-1"]
    }

    // the laptop upgraded: the studio's board now carries its board, live (the home's whole-mesh resync)
    clock.advance(5)
    let home = try #require(await door.latest(to: studioDoorHost))
    await home.deliver(
      event(
        method: "agent.snapshot", subId: "m1",
        payload: meshOpen([
          MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")], revision: 2),
          MeshEntry(device: "dev-laptop", rows: [remoteBoardRow(key: "l-1", device: "dev-laptop")]),
        ])))
    try await settle("the laptop's agents drawn and its words gone") {
      link.rows.map { $0.key } == ["s-1", "l-1"] && row("dev-laptop", in: link)?.fieldRefusal == nil
    }
    let upgraded = try #require(row("dev-laptop", in: link))
    let line = MeshDisplay.linkLine(desktop: upgraded)
    #expect(!line.contains("refused"))
  }

  /// O6 (PG-3e, the review's [9]; S1 as bound) — a former home's TRANSIENT refusal (its door refused the field for a
  /// reason other than the old version's, so no ladder holds it) clears once the new home's board lists that desktop
  /// live with its board: its words go with or without a record.
  @Test func aFormerHomesTransientWordsClearWhenListedLive() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(laptopDoorHost, notYetDoor)  // dev-laptop sorts first: the first home
    await door.route(
      studioDoorHost,
      homeDoor([
        MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")]),
        MeshEntry(device: "dev-laptop", rows: [remoteBoardRow(key: "l-1", device: "dev-laptop")]),
      ]))
    let (link, _, _, _) = try await standingLink(peers: [laptop, studio], door: door)
    defer { link.stop() }
    try await settle("the laptop home, its field refused") {
      link.home == "dev-laptop" && row("dev-laptop", in: link)?.fieldRefusal != nil
    }
    #expect(link.laddered.isEmpty, "a refusal of another kind holds no ladder")

    await door.refuse(laptopDoorHost)
    await door.latest(to: laptopDoorHost)?.drop()
    try await settle("re-homed, the laptop's agents drawn live") {
      link.home == "dev-studio" && link.rows.map { $0.key } == ["s-1", "l-1"]
    }
    let former = try #require(row("dev-laptop", in: link))
    #expect(former.fieldRefusal == nil, "listed live by the new home: its words go")
  }

  /// O7 (PG-3e, the review's [10]; M3 (a)'s scope) — the old desktop upgrades, and at its due ask its door refuses with
  /// a DIFFERENT kind ("not yet", FORBIDDEN_SCOPE): it speaks the new protocol now, so its ladder record goes, and the
  /// corner says the door's own words, not the old version's.
  @Test func aLaterRefusalOfAnotherKindClearsTheLadder() async throws {
    let clock = MovableClock(start)
    let upgrade = Upgrade()
    let door = LinkDoor(script: { method, id, params in
      upgrade.done ? notYetDoor(method, id, params) : oldDoor(method, id, params)
    })
    let (link, mesh, counter) = try await oldHomeLink(door: door, clock: clock)
    defer { link.stop() }
    try await settle("the first refusal, on the ladder") { link.laddered == ["dev-studio"] }

    upgrade.now()
    clock.advance(30)  // t30: due
    try await passAndSettle(mesh, counter)
    try await settle("the second ask") { await door.subscribes() >= 2 }
    try await settle("the door's own words") {
      row("dev-studio", in: link)?.fieldRefusal?.contains("not yet") == true
    }
    #expect(link.laddered.isEmpty, "no ladder: a refusal of the new protocol is the sweep's")
    let said = try #require(row("dev-studio", in: link))
    let line = MeshDisplay.linkLine(desktop: said)
    #expect(line.contains("not yet"))
    #expect(!line.contains("expected {"))
  }
}
