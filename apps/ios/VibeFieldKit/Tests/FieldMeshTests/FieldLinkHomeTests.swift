import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// DS-8 (DS-D13; design-06 §7) — the phone HOMES to one desktop. Its home is
// the last home when that door answers, else the first self desktop whose door
// answers; the FIELD is read only through the home's `agent.subscribe
// {projection: "field", scope: "mesh"}` — every self desktop's board, each on
// its own chain; a desktop asleep keeps its rows, greyed, because the home's
// replica answers for them (DS-L8); on the home's loss the phone re-homes by
// sweeping the roster; and a terminal ticket still goes to the desktop that
// OWNS the session, over a door opened for that ask and let go after (DS-L4).
// *Corrected 2026-11-06 (SP-7b's 7c-2, D-c2 (a)): a ticket, its renewal and
// Resume ride the HOME's door now, `{device}` added for another desktop's, as
// F1b's approval does; the owner still mints. The per-ask owner door stays for
// Files (FS-2) alone.*

private let alice = "alice@corp.com"

/// 7c-2 — the asks about a session or run that ride the home's door.
private let carriedAsks: Set<String> = ["terminal.openTicket", "terminal.renewAttach", "agent.resume"]

/// A peer under this phone's login — what a gated node reports.
private func mine(_ base: FieldStorePeer) -> FieldStorePeer { peer(base, login: alice) }

/// A link homed by memory to `dev-studio`, on a door whose hosts are scripted
/// by the row.
@MainActor
private func homedLink(
  peers: [FieldStorePeer] = [mine(laptop), mine(studio)],
  probe: LinkProbe = LinkProbe(),
  door: LinkDoor,
  memory: HomeMemory = scratchHomeMemory(),
  schedule: FieldDiscoverySchedule = briskSchedule,
  options: FieldProductClient.Options = .init(
    maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
  budget: PhoneConnectionBudget? = nil,
  counter: SweepCounter? = nil,
  clock: MovableClock? = nil
) async throws -> (FieldLink, MeshRehearsal) {
  memory.record("dev-studio", login: alice)
  let (link, mesh, _, _) = try await standingLink(
    peers: peers, probe: probe, selfLogin: alice, door: door, homeMemory: memory,
    schedule: schedule, options: options, budget: budget, counter: counter, clock: clock)
  return (link, mesh)
}

/// The two-desktop board the studio serves as a home — the home's own entry
/// first, as a home lists itself (PG-3e: the copy keeps the open's order, so
/// the rows read home first).
private let studioBoard = [
  MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")]),
  MeshEntry(device: "dev-laptop", rows: [remoteBoardRow(key: "l-1", device: "dev-laptop")]),
]

/// The same two desktops, as the LAPTOP serves them once the studio is gone:
/// the laptop's run has moved on, and the studio is asleep with its last board.
private let laptopBoard = [
  MeshEntry(
    device: "dev-laptop", rows: [remoteBoardRow(key: "l-1", device: "dev-laptop", status: "idle")]),
  MeshEntry(device: "dev-studio", state: "asleep", rows: [remoteBoardRow(key: "s-1")]),
]

/// A row's drawn status, found by its board key (PG-3e: the link draws
/// `FieldBubble`s; the board key is each one's `runKey`).
@MainActor
private func status(of key: String, in link: FieldLink) -> AgentVisualStatus? {
  link.bubbles.first { $0.runKey == key }?.status
}

/// Whether a row's desktop reads live, found by its board key.
@MainActor
private func desktopLive(_ key: String, in link: FieldLink) -> Bool? {
  link.bubbles.first { $0.runKey == key }?.agent?.join?.deviceLive
}

// MARK: - Which desktop is home

@MainActor
@Suite struct FieldLinkHomeChoiceTests {
  /// The home is the LAST home when its door answers — even though another
  /// self desktop that answers sorts before it — and the field is read through
  /// it alone: one door, one `agent.subscribe {projection: "field", scope:
  /// "mesh"}`.
  @Test func theHomeIsTheLastHomeWhenItAnswers() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(laptopDoorHost, homeDoor([MeshEntry(device: "dev-laptop")]))
    await door.route(studioDoorHost, homeDoor([MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")])]))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }

    try await waitUntil("the field through the remembered home") {
      link.rows.map { $0.key } == ["s-1"]
    }
    #expect(link.home == "dev-studio")
    #expect(await door.dials(to: studioDoorHost) == 1)
    #expect(await door.dials(to: laptopDoorHost) == 0, "one door: the home's")
    let ask = try await settledRequest(door, "agent.subscribe", host: studioDoorHost)
    let asked = AgentSubscribeParams.phoneRemote.json
    #expect(ask.params == asked, "the remote cut (PG-3e)")
  }

  /// No last home that answers: the FIRST self desktop whose door answers, in
  /// device order. A desktop whose door is silent is skipped, a remembered home
  /// no longer on the tailnet is not waited for, and the one chosen becomes
  /// the last home once it answers hello.
  @Test func elseTheFirstSelfDesktopWhoseDoorAnswers() async throws {
    let memory = scratchHomeMemory()
    memory.record("dev-gone", login: alice)  // remembered, and not on the tailnet
    let probe = LinkProbe(answers: [laptopDoorHost: .unreachable("asleep")])
    let door = LinkDoor(script: selfDoor)
    await door.route(
      miniDoorHost,
      homeDoor([MeshEntry(device: "dev-mini", rows: [remoteBoardRow(key: "m-1", device: "dev-mini")])]))
    await door.route(studioDoorHost, homeDoor([MeshEntry(device: "dev-studio")]))
    let (link, _, _, _) = try await standingLink(
      peers: [mine(laptop), mine(mini), mine(studio)], probe: probe, selfLogin: alice, door: door,
      homeMemory: memory)
    defer { link.stop() }

    try await waitUntil("the field through the first that answers") {
      link.rows.map { $0.key } == ["m-1"]
    }
    #expect(link.home == "dev-mini")
    #expect(await door.dials(to: miniDoorHost) == 1)
    #expect(await door.dials(to: studioDoorHost) == 0)
    #expect(await door.dials(to: laptopDoorHost) == 0)
    try await waitUntil("remembered") { memory.lastHome(for: alice) == "dev-mini" }
  }
}

// MARK: - The field, through the home

@MainActor
@Suite struct FieldLinkHomeFieldTests {
  /// Every row carries the desktop it LIVES on — the home's own, and another
  /// desktop's the phone never dialled — and the home's roster names that other
  /// desktop and says whether its terminal doors are out.
  @Test func everyRowCarriesItsDesktopAndOnlyTheHomeIsDialled() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(
      studioDoorHost,
      homeDoor(
        studioBoard,
        roster: [
          deviceRow(name: "studio"),
          deviceRow(name: "James's laptop", deviceId: "dev-laptop", terminalMesh: false, isSelf: false),
        ]))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }

    try await waitUntil("both desktops' rows") { link.rows.count == 2 }
    // the home's own rows first, then the other desktops' in the board's order
    // (PG-3e: `RemoteWindowRows.order`, the desktop's own window order)
    let keys = link.rows.map { $0.key }
    let devices = link.bubbles.map { $0.agent?.join?.deviceID }
    #expect(keys == ["s-1", "l-1"])
    #expect(devices == ["dev-studio", "dev-laptop"])
    #expect(link.bubbles.allSatisfy { $0.agent?.join?.deviceLive == true })
    #expect(await door.dials(to: laptopDoorHost) == 0)

    try await waitUntil("the laptop named by the home's roster") {
      link.desktops.first { $0.deviceId == "dev-laptop" }?.name == "James's laptop"
    }
    let laptopRow = try #require(link.desktops.first { $0.deviceId == "dev-laptop" })
    #expect(laptopRow.feed == .door, "its board arrives through the home's door")
    #expect(laptopRow.publishesTerminalDoors == false)
  }

  /// DS-L8 — a desktop that goes to sleep sends only its STATE: its rows stay
  /// on the field, answered for by the home's replica, and greyed — the field's
  /// own stale dim — until its chain is live again.
  @Test func anAsleepDesktopsRowsStayGreyed() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("both desktops' rows") { link.rows.count == 2 }

    let home = try #require(await door.latest(to: studioDoorHost))
    await home.deliver(meshFrame(meshState("dev-laptop", "asleep")))
    try await waitUntil("the laptop's row greyed") { desktopLive("l-1", in: link) == false }
    let kept = link.rows.map { $0.key }
    #expect(kept == ["s-1", "l-1"], "the row stays")
    #expect(desktopLive("s-1", in: link) == true)

    var assembly = FieldAssembly(tint: .light)
    let dressed = assembly.fold(link.bubbles, cardSubjectID: nil)
    #expect(dressed.first { $0.runKey == "l-1" }?.stale == true)
    #expect(dressed.first { $0.runKey == "s-1" }?.stale == false)

    await home.deliver(meshFrame(meshState("dev-laptop", "live")))
    try await waitUntil("the laptop live again") { desktopLive("l-1", in: link) == true }
  }

  /// PG-3e — PG-3a's witness, through the home: the link draws what the copy draws, open by frame by resync, the
  /// three desktops in the board's order — the home's rows first, the loft's beside them, the attic's kept greyed —
  /// and the old chain's delta after the resync is a GAP the link repairs by asking the home again (the body
  /// golden's own walk, `PhoneBodyParityTests.theBodyGoldenStepByStep`, at the link's seam).
  @Test func theWitnessDrawsThroughTheHome() async throws {
    let witness = try RemoteRows.openJSON()
    let frames = try #require(try MeshFixture.json("agent-remote-mesh-frames.witness").arrayValue)
    let resync = try MeshFixture.json("agent-remote-mesh-open.resync")
    let door = LinkDoor { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("m1"), "snapshot": witness]))]
      default: return []
      }
    }
    let (link, _, _, _) = try await standingLink(door: door)
    defer { link.stop() }

    // the copy, driven by hand as the link drives it: what each step should draw
    var copy = RemoteMeshCopy()
    copy.open(try RemoteRows.open(), now: RemoteRows.now)
    _ = copy.publish()
    let opened = copy.drawn().map { $0.key }
    let openedStale = copy.drawn().map(\.stale)
    #expect(opened.count > 2)
    try await waitUntil("the witness drawn") { link.rows.map { $0.key } == opened }
    let stale = link.rows.map(\.stale)
    #expect(stale == openedStale)
    let atticRows = link.rows.filter { $0.device == RemoteRows.attic }.count
    let atticGrey = link.bubbles.filter { $0.agent?.join?.deviceID == RemoteRows.attic }
      .allSatisfy { $0.agent?.join?.deviceLive == false }
    #expect(atticRows > 0, "the asleep desktop's kept board is drawn")
    #expect(atticGrey)

    let home = try #require(await door.latest)
    let parsed = try frames.map(AgentRemoteMeshFrame.init(json:))
    for index in 0...PhoneFoldResync.after {
      _ = copy.frame(parsed[index], now: RemoteRows.now)
      _ = copy.publish()
      await home.deliver(meshFrame(frames[index]))
    }
    let framed = copy.drawn().map { $0.key }
    try await waitUntil("the frames applied") { link.rows.map { $0.key } == framed }

    copy.open(try RemoteRows.resync(), now: RemoteRows.now)
    _ = copy.publish()
    await home.deliver(event(method: "agent.snapshot", subId: "m1", payload: resync))
    let resynced = copy.drawn().map { $0.key }
    try await waitUntil("the resync replaced the board") { link.rows.map { $0.key } == resynced }
    let subscribes = await home.methods.filter { $0 == "agent.subscribe" }.count
    #expect(subscribes == 1, "a resync asks the home for nothing")
    #expect(!link.notes.contains { $0.contains("re-subscribing") })

    // the old chain's next delta continues nothing the resync stands at
    let gapping = parsed[PhoneFoldResync.after + 1]
    let outcome = copy.frame(gapping, now: RemoteRows.now)
    guard case .gap = outcome else {
      Issue.record("the witness's last frame should gap after the resync, read \(outcome)")
      return
    }
    await home.deliver(meshFrame(frames[PhoneFoldResync.after + 1]))
    try await waitUntil("a fresh subscribe") {
      await home.methods.filter { $0 == "agent.subscribe" }.count >= 2
    }
    #expect(link.notes.contains { $0.contains("— re-subscribing") })
    // the fresh open is the witness again: the board it draws is the open's
    try await waitUntil("the fresh open drawn") { link.rows.map { $0.key } == opened }
  }

  /// PG-1c — the door's resync of a phone behind its cap: the whole mesh,
  /// mid-stream, as `agent.snapshot` (the door's own spelling, `${base}.snapshot`).
  /// It replaces the board, the chain goes on from its revisions, and the phone
  /// asks the home for nothing.
  @Test func aMidStreamMeshSnapshotReplacesTheBoardWithoutAskingAgain() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(
      studioDoorHost, homeDoor([MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")])]))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("the board") { link.rows.map { $0.key } == ["s-1"] }

    let home = try #require(await door.latest(to: studioDoorHost))
    // the deltas the door held are never sent: the resync stands at revision 14
    await home.deliver(
      event(
        method: "agent.snapshot", subId: "m1",
        payload: meshOpen([
          MeshEntry(
            device: "dev-studio", rows: [remoteBoardRow(key: "s-2"), remoteBoardRow(key: "s-3")], revision: 14)
        ])))
    try await waitUntil("the resync replaced the board") {
      Set(link.rows.map { $0.key }) == ["s-2", "s-3"]
    }
    // the next delta continues from the snapshot's revision
    await home.deliver(
      meshFrame(meshDelta("dev-studio", since: 14, revision: 15, removed: ["s-2"])))
    try await waitUntil("the next delta applied") { link.rows.map { $0.key } == ["s-3"] }
    #expect(await home.methods.filter { $0 == "agent.subscribe" }.count == 1)
    #expect(!link.notes.contains { $0.contains("re-subscribing") })
  }

  /// A frame that does not continue its desktop's chain is a GAP: the phone
  /// asks the home for a fresh board, and the board on the field STAYS until
  /// it lands — a repair is not a reason to draw nothing.
  @Test func aGapAsksTheHomeForAFreshBoard() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor([MeshEntry(device: "dev-studio", rows: [remoteBoardRow(key: "s-1")])]))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("the board") { link.rows.map { $0.key } == ["s-1"] }

    let home = try #require(await door.latest(to: studioDoorHost))
    await home.deliver(
      meshFrame(meshDelta("dev-studio", since: 9, revision: 10, upserts: [remoteBoardRow(key: "s-9")])))
    try await waitUntil("a fresh subscribe") {
      await home.methods.filter { $0 == "agent.subscribe" }.count >= 2
    }
    let stayed = link.rows.map { $0.key }
    #expect(stayed == ["s-1"], "the board stays; s-9 continued nothing")
    // PG-3e: the copy's own reason (`RemoteModelBoard`'s "a delta since N, held M"), then the repair
    #expect(link.notes.contains { $0.contains("a delta since 9") && $0.contains("re-subscribing") })
  }

  /// UA-P-5's law, kept under a home: a desktop THIS phone established is not
  /// this account's (its door refused this login) is held off the field even
  /// when the home lists it. The door decides; the home is not a second
  /// opinion that overrides it.
  @Test func aDesktopThisPhoneRefusedStaysOffTheFieldWhenTheHomeListsIt() async throws {
    let probe = LinkProbe(answers: [laptopDoorHost: .status(403)])
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    let (link, _) = try await homedLink(peers: [laptop, studio], probe: probe, door: door)
    defer { link.stop() }

    try await waitUntil("the laptop refused and the studio's row drawn") {
      link.foreignDoors["dev-laptop"] != nil && link.rows.map { $0.key } == ["s-1"]
    }
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.rows.map { $0.key } == ["s-1"])
  }
}

// MARK: - The home's loss

@MainActor
@Suite struct FieldLinkRehomeTests {
  /// THE HOME'S LOSS. Its socket drops and its door answers no more dials: the
  /// phone sweeps the roster — every candidate asked afresh — and homes to the
  /// first that answers, in the ONE pass the loss itself asked for: the laptop
  /// is asked exactly once, and that answer moves the field (the tick here is
  /// two minutes and never comes). The field is resnapshotted from the new home
  /// and nothing is drawn twice.
  ///
  /// The pass is counted by the laptop's PROBE, not by peer-list reads: the
  /// dropped home's own client reads the roster before every re-dial (SP-2 d),
  /// so a read count measures its ladder, not the sweeps (this row's first cut
  /// counted reads and went red at 3 under load).
  @Test func theHomesLossRehomesWithinOneSweep() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    await door.route(laptopDoorHost, homeDoor(laptopBoard))
    let probe = LinkProbe()
    let memory = scratchHomeMemory()
    let (link, _) = try await homedLink(
      probe: probe, door: door, memory: memory, schedule: idleSchedule)
    defer { link.stop() }
    try await waitUntil("the field through the studio") {
      link.home == "dev-studio" && link.rows.count == 2
    }
    let asked = await probe.asks(of: laptopDoorHost)

    await door.refuse(studioDoorHost)
    await door.latest(to: studioDoorHost)?.drop()
    try await waitUntil("re-homed to the laptop") { link.home == "dev-laptop" }
    #expect(
      await probe.asks(of: laptopDoorHost) - asked == 1,
      "one pass: the laptop asked once, and its answer moved the field")

    try await waitUntil("the laptop's board") { status(of: "l-1", in: link) == .idle }
    #expect(link.rows.map { $0.key } == ["l-1", "s-1"], "nothing drawn twice")
    #expect(desktopLive("s-1", in: link) == false, "asleep on the new home's board")
    #expect(await door.dials(to: laptopDoorHost) == 1)
    try await waitUntil("the new home remembered") { memory.lastHome(for: alice) == "dev-laptop" }
  }

  /// THE DOOR'S DEADLINE (SP-L7), on the manual clock: the home goes silent —
  /// no tick, no pong — and the receive deadline closes it after 2.5 × the
  /// door's interval; the phone re-homes to the desktop that answers.
  @Test func aHomeTheDeadlineClosesIsLeftForTheNext() async throws {
    let clock = ManualProductClock()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    await door.route(laptopDoorHost, homeDoor(laptopBoard))
    let (link, _) = try await homedLink(
      door: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5), clock: clock))
    defer { link.stop() }
    try await waitUntil("the field through the studio") {
      link.home == "dev-studio" && link.rows.count == 2
    }
    // The LAST frame the home sends before going quiet — its roster's answer —
    // landed: any frame is liveness, so one arriving after the clock moved
    // would restart the deadline from 301 s and it would never fire (this
    // row's first cut raced it and went red under load).
    try await waitUntil("the home's roster answered") {
      link.notes.contains { $0.contains("dev-studio named no device of its own") }
    }
    let silent = try #require(link.client(for: "dev-studio"))

    await door.refuse(studioDoorHost)
    clock.advance(by: .seconds(301))  // 2.5 × the registry's 120 s, and a second
    try await waitUntil("re-homed to the laptop") { link.home == "dev-laptop" }
    #expect(silent.silentDoorCloses == 1)
    try await waitUntil("the laptop's board") { status(of: "l-1", in: link) == .idle }
    #expect(link.rows.map { $0.key } == ["l-1", "s-1"])
  }

  /// A home whose door STOPS this phone (INCOMPATIBLE — another contracts
  /// major) is left for the next desktop that answers, says why in its own
  /// words, and is not asked again until its backoff passes (SP-2 e).
  @Test func anIncompatibleHomeIsLeftForTheNextDesktop() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, _ in
      method == "system.hello"
        ? [failureFrame(id: id, kind: "INCOMPATIBLE", message: "contracts 0.1.0 vs 0.2.0")] : []
    }
    await door.route(
      laptopDoorHost,
      homeDoor([MeshEntry(device: "dev-laptop", rows: [remoteBoardRow(key: "l-1", device: "dev-laptop")])]))
    let memory = scratchHomeMemory()
    let (link, _) = try await homedLink(door: door, memory: memory)
    defer { link.stop() }

    try await waitUntil("homed to the laptop") {
      link.home == "dev-laptop" && link.rows.map { $0.key } == ["l-1"]
    }
    #expect(await door.dials(to: studioDoorHost) == 1)
    #expect(
      link.desktops.first { $0.deviceId == "dev-studio" }?.state
        == .failed("contracts 0.1.0 vs 0.2.0"))
    try await waitUntil("the laptop remembered") { memory.lastHome(for: alice) == "dev-laptop" }
  }

  /// A desktop that stopped this phone says so for as long as its backoff
  /// runs — and no longer: it holds no door once it is not the home, so
  /// nothing would ever clear the word, and a desktop upgraded since would
  /// read "refused" forever. Past the backoff its word is its probe's again,
  /// and it is a candidate for the next re-home.
  @Test func aStoppedDesktopsWordLastsAsLongAsItsBackoff() async throws {
    let clock = MovableClock(Date(timeIntervalSince1970: 1_757_808_001))
    let counter = SweepCounter()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, _ in
      method == "system.hello"
        ? [failureFrame(id: id, kind: "INCOMPATIBLE", message: "contracts 0.1.0 vs 0.2.0")] : []
    }
    await door.route(
      laptopDoorHost,
      homeDoor([MeshEntry(device: "dev-laptop", rows: [remoteBoardRow(key: "l-1", device: "dev-laptop")])]))
    let (link, mesh) = try await homedLink(door: door, counter: counter, clock: clock)
    defer { link.stop() }
    try await waitUntil("homed to the laptop, the studio refused") {
      link.home == "dev-laptop"
        && link.desktops.first { $0.deviceId == "dev-studio" }?.state
          == .failed("contracts 0.1.0 vs 0.2.0")
    }

    clock.advance(35)  // past the first rung of the ladder (30 s)
    try await sweepNow(mesh, counter, peer: mine(studio))
    try await waitUntil("the studio's word is its probe's again") {
      link.desktops.first { $0.deviceId == "dev-studio" }?.state == .ready
    }
    #expect(link.home == "dev-laptop", "a re-home only on the home's loss")
  }
}

// MARK: - A ticket goes to its owner (DS-L4)

@MainActor
@Suite struct FieldLinkOwnerDoorTests {
  @Test func workspaceBorrowsHistorysOwnerDoorWithoutAnotherBudgetLeg() async throws {
    let ledger = PhoneConnectionBudget()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    await door.route(laptopDoorHost) { method, id, _ in
      if method == "system.hello" { return [frame(id: id, ack)] }
      return [frame(id: id, .object(["from": .string("laptop")]))]
    }
    let (link, _) = try await homedLink(door: door, budget: ledger)
    defer { link.stop() }
    try await waitUntil("home ready") { link.rows.count == 2 }
    let history = try #require(link.openHistoryDoor("dev-laptop"))
    defer { history.client.close() }
    _ = try await history.client.call("index.projects")
    let answer = try await link.workspaceCall(on: "dev-laptop", method: "workspace.roots")
    #expect(answer["from"] == .string("laptop"))
    #expect(await door.dials(to: laptopDoorHost) == 1)
    #expect(ledger.inUse(.door(desktop: "dev-laptop")) == 1)
    #expect(ledger.waiting(for: .door(desktop: "dev-laptop")) == 0)
  }

  /// SP-7b's 7c-2 (D-c2 (a), VF-PM 2026-11-06 23:17Z) — a terminal ticket, its renewal and Resume
  /// for a session on ANOTHER desktop are asked of the HOME, `{device}` added, which forwards each
  /// whole to that desktop (DS-4) — as F1b's approval is. The owner still mints: its grants, and the
  /// TAILNET doors this phone's own node dials. The other desktop's door is never dialled for them,
  /// and the answers come back unread. The home's own session is asked with nothing more.
  @Test func aTicketItsRenewalAndResumeForAnotherDesktopRideTheHomesDoor() async throws {
    let ledger = PhoneConnectionBudget()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if carriedAsks.contains(method) { return [frame(id: id, .object(["from": .string("studio")]))] }
      return homeDoor(studioBoard)(method, id, params)
    }
    // the owner answers too, so the old road reads as an answer from the wrong door, never a timeout
    await door.route(laptopDoorHost) { method, id, _ in
      if method == "system.hello" { return [frame(id: id, ack)] }
      return [frame(id: id, .object(["from": .string("laptop")]))]
    }
    let (link, _) = try await homedLink(door: door, budget: ledger)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    let ticket = try await link.openTerminalTicket(on: "dev-laptop", sessionId: "pty-l")
    let renewed = try await link.renewTerminalGrant(
      on: "dev-laptop", sessionId: "pty-l", expectGeneration: 1, requestId: "r-1")
    let resumed = try await link.resume(runtimeRunId: "run-l", on: "dev-laptop")
    #expect([ticket, renewed, resumed].map { $0["from"]?.stringValue } == ["studio", "studio", "studio"])
    let home = try #require(await door.latest(to: studioDoorHost))
    let asked = await home.requests.filter { carriedAsks.contains($0.method) }
    #expect(asked.map { $0.method } == ["terminal.openTicket", "terminal.renewAttach", "agent.resume"])
    #expect(
      asked.map { $0.params } == [
        .object(["sessionId": .string("pty-l"), "device": .string("dev-laptop")]),
        .object([
          "sessionId": .string("pty-l"), "expectGeneration": .int(1), "requestId": .string("r-1"),
          "device": .string("dev-laptop"),
        ]),
        .object(["runtimeRunId": .string("run-l"), "device": .string("dev-laptop")]),
      ])
    #expect(await door.dials(to: laptopDoorHost) == 0, "the owner's door is not dialled for them")
    #expect(ledger.inUse(.door(desktop: "dev-laptop")) == 0)

    let own = try await link.openTerminalTicket(on: "dev-studio", sessionId: "pty-s")
    #expect(own["from"]?.stringValue == "studio")
    let ownAsk = await home.requests.last { $0.method == "terminal.openTicket" }
    #expect(ownAsk?.params == .object(["sessionId": .string("pty-s")]))
    #expect(await door.dials(to: studioDoorHost) == 1, "the home's own door: no second dial")
  }

  /// SP-7b's 7b-2b — a session's read ticket rides the HOME, `{device}` added for another desktop's session, as the
  /// terminal's does; the owner mints it, and the home's own session is asked with nothing more.
  @Test func aHistoryTicketRidesTheHomesDoor() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if method == "index.openTicket" { return [frame(id: id, .object(["from": .string("studio")]))] }
      return homeDoor(studioBoard)(method, id, params)
    }
    await door.route(laptopDoorHost) { method, id, _ in
      if method == "system.hello" { return [frame(id: id, ack)] }
      return [frame(id: id, .object(["from": .string("laptop")]))]
    }
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    let ticket = try await link.openIndexTicket(on: "dev-laptop", sessionId: "s-l")
    #expect(ticket["from"]?.stringValue == "studio")
    let home = try #require(await door.latest(to: studioDoorHost))
    let asked = await home.requests.last { $0.method == "index.openTicket" }
    #expect(asked?.params == .object(["sessionId": .string("s-l"), "device": .string("dev-laptop")]))
    #expect(await door.dials(to: laptopDoorHost) == 0, "the owner's door is not dialled for it")

    let own = try await link.openIndexTicket(on: "dev-studio", sessionId: "s-s")
    #expect(own["from"]?.stringValue == "studio")
    let ownAsk = await home.requests.last { $0.method == "index.openTicket" }
    #expect(ownAsk?.params == .object(["sessionId": .string("s-s")]))
  }

  /// The owner's door counts against the phone's budget — one door per desktop
  /// (`PHONE_BUDGET`, SP-D12): a second ask to the same owner WAITS for the
  /// first's slot, and is dialled the moment it frees. (7c-2, 2026-11-06: a
  /// Files ask, the one the owner's door still carries; this row drove two
  /// terminal tickets until they moved to the home.)
  @Test func aSecondAskToTheSameOwnerWaitsForTheFirstsSlot() async throws {
    let ledger = PhoneConnectionBudget()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    await door.route(laptopDoorHost) { method, id, _ in
      method == "system.hello" ? [frame(id: id, ack)] : []  // the asks answered by hand
    }
    // A call deadline long enough that the ask this row holds open by hand
    // is not raced by a TIMEOUT on a loaded host (the catalog rows' reason).
    let (link, _) = try await homedLink(
      door: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(30)),
      budget: ledger)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    let first = Task {
      try await link.workspaceCall(
        on: "dev-laptop", method: "workspace.list", params: .object(["path": .string("p-1")]))
    }
    let firstAsk = try await settledRequest(door, "workspace.list", host: laptopDoorHost)
    #expect(ledger.inUse(.door(desktop: "dev-laptop")) == 1)

    let second = Task {
      try await link.workspaceCall(
        on: "dev-laptop", method: "workspace.list", params: .object(["path": .string("p-2")]))
    }
    try await waitUntil("the second waiting for the slot") {
      ledger.waiting(for: .door(desktop: "dev-laptop")) == 1
    }
    #expect(await door.dials(to: laptopDoorHost) == 1)

    await door.latest(to: laptopDoorHost)?.deliver(frame(id: firstAsk.id, .object(["n": .int(1)])))
    #expect(try await first.value["n"] == .int(1))
    try await waitUntil("the second dialled") { await door.dials(to: laptopDoorHost) == 2 }
    let secondAsk = try await settledRequest(door, "workspace.list", host: laptopDoorHost)
    #expect(secondAsk.params == .object(["path": .string("p-2")]))
    await door.latest(to: laptopDoorHost)?.deliver(frame(id: secondAsk.id, .object(["n": .int(2)])))
    #expect(try await second.value["n"] == .int(2))
    try await waitUntil("both let go") { ledger.inUse(.door(desktop: "dev-laptop")) == 0 }
  }

  /// 7c-2 — an owner whose door never answered THIS phone is still asked through its home: the
  /// home's own link to it decides, and its honest state comes back as the home said it (FW-R6).
  /// Nothing is dialled toward the owner. (This row said the ask was refused at once, `no_door`,
  /// while each ticket dialled its owner.)
  @Test func anOwnerThisPhoneNeverHeardIsStillAskedThroughItsHome() async throws {
    let probe = LinkProbe(answers: [laptopDoorHost: .unreachable("asleep")])
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if method == "terminal.openTicket" { return [frame(id: id, .object(["from": .string("studio")]))] }
      return homeDoor(studioBoard)(method, id, params)
    }
    let (link, _) = try await homedLink(probe: probe, door: door)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    let outcome: String
    do {
      let ticket = try await link.openTerminalTicket(on: "dev-laptop", sessionId: "pty")
      outcome = ticket["from"]?.stringValue ?? "?"
    } catch {
      outcome = "refused: \(error)"
    }
    #expect(outcome == "studio")
    #expect(await door.dials(to: laptopDoorHost) == 0)
  }

  /// 7c-2 — with no home there is no door to ask through: the ticket is refused at once as the
  /// terminal's `no_door`, retryable (the phone re-homes, and the next ask goes there).
  @Test func withNoHomeATicketIsRefusedAsTheTerminalsNoDoor() async throws {
    let probe = LinkProbe(fallback: .unreachable("asleep"))
    let (link, _, _, _) = try await standingLink(probe: probe)
    defer { link.stop() }
    try await waitUntil("the desktop") { !link.desktops.isEmpty }

    do {
      _ = try await link.openTerminalTicket(on: "dev-studio", sessionId: "pty")
      Issue.record("a ticket was asked with no home to ask through")
    } catch let error as FieldProductError {
      #expect(error.unavailable?.service == "terminal")
      #expect(error.unavailable?.state == "no_door")
      #expect(error.retryable)
    }
  }

  /// R6 (2026-10-07) — a Files ask refused for want of a door says so as
  /// FILES (`service: "workspace"`, the desktop's own word), never tagged as
  /// the terminal's, and nothing is dialled.
  @Test func aFilesAskWithNoAnsweringDoorIsTaggedFilesNotTerminal() async throws {
    let probe = LinkProbe(answers: [laptopDoorHost: .unreachable("asleep")])
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    let (link, _) = try await homedLink(probe: probe, door: door)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    do {
      _ = try await link.workspaceCall(on: "dev-laptop", method: "workspace.roots")
      Issue.record("a Files ask reached a desktop with no door")
    } catch let error as FieldProductError {
      #expect(error.unavailable?.service == "workspace")
      #expect(error.unavailable?.state == "no_door")
    }
    #expect(await door.dials(to: laptopDoorHost) == 0)
  }
  // MARK: F1b's kit half — the approval rides the home's door

  /// F1b (FW-D5; FW-R3, FW-R6) — the phone's freeway approval for ANOTHER
  /// desktop is asked of the HOME: `freeway.approve {device}` on the home's
  /// door, which forwards it whole to that desktop (M63). The other desktop's
  /// door is never dialled for it — the owner mints, and only the ask rides the
  /// home. The answer comes back unread, as the owner minted it.
  @Test func anApprovalForAnotherDesktopRidesTheHomesDoor() async throws {
    let ledger = PhoneConnectionBudget()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if method == "freeway.approve" {
        return [frame(id: id, .object(["minted": params["device"] ?? .string("the home"), "expiresAt": .int(1)]))]
      }
      return homeDoor(studioBoard)(method, id, params)
    }
    await door.route(laptopDoorHost) { method, id, _ in
      method == "system.hello" ? [frame(id: id, ack)] : []
    }
    let (link, _) = try await homedLink(door: door, budget: ledger)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    let approved = try await link.approveFreeway(on: "dev-laptop")
    #expect(approved["minted"]?.stringValue == "dev-laptop")
    let asked = try await settledRequest(door, "freeway.approve", host: studioDoorHost)
    #expect(asked.params == .object(["device": .string("dev-laptop")]))
    #expect(await door.dials(to: laptopDoorHost) == 0, "the owner's door is not dialled for it")
    #expect(await door.dials(to: studioDoorHost) == 1, "the home's own door: no second dial")
    #expect(ledger.inUse(.door(desktop: "dev-laptop")) == 0)
  }

  /// The home's own link asks the home with nothing more: `freeway.approve {}`.
  @Test func theHomesOwnApprovalAsksNothingMore() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if method == "freeway.approve" { return [frame(id: id, .object(["expiresAt": .int(1)]))] }
      return homeDoor(studioBoard)(method, id, params)
    }
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    _ = try await link.approveFreeway(on: "dev-studio")
    let asked = try await settledRequest(door, "freeway.approve", host: studioDoorHost)
    #expect(asked.params == .object([:]))
  }

  /// The owner's refusal comes back through the home as the owner said it —
  /// its kind, its retryability, its `{service, state}` — for the link to put
  /// into the phone's words (`FreewayApproval.said`); FieldLink reads nothing.
  @Test func anOwnersRefusalComesBackThroughTheHomeAsSent() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if method == "freeway.approve" {
        return [
          failureFrame(
            id: id, kind: "UNAVAILABLE", message: "uncorrelated", retryable: true,
            details: .object(["service": .string("freeway"), "state": .string("uncorrelated")]))
        ]
      }
      return homeDoor(studioBoard)(method, id, params)
    }
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.rows.count == 2 }

    do {
      _ = try await link.approveFreeway(on: "dev-laptop")
      Issue.record("a refused approval was handed back as granted")
    } catch let error as FieldProductError {
      #expect(error.unavailable?.service == "freeway")
      #expect(error.unavailable?.state == "uncorrelated")
      #expect(error.retryable)
    }
    #expect(await door.dials(to: laptopDoorHost) == 0)
  }
}
