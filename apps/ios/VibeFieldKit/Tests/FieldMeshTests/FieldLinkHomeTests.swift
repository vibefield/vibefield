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

private let alice = "alice@corp.com"

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

/// The two-desktop board the studio serves as a home.
private let studioBoard = [
  MeshEntry(device: "dev-laptop", rows: [boardRow(id: "l-1", device: "dev-laptop")]),
  MeshEntry(device: "dev-studio", rows: [boardRow(id: "s-1")]),
]

/// The same two desktops, as the LAPTOP serves them once the studio is gone:
/// the laptop's run has moved on, and the studio is asleep with its last board.
private let laptopBoard = [
  MeshEntry(
    device: "dev-laptop", rows: [boardRow(id: "l-1", status: "idle", device: "dev-laptop")]),
  MeshEntry(device: "dev-studio", state: "asleep", rows: [boardRow(id: "s-1")]),
]

@MainActor
private func status(of id: String, in link: FieldLink) -> AgentVisualStatus? {
  link.agents.first { $0.id == id }.flatMap { classifyAgentStatus($0.state) }
}

@MainActor
private func desktopLive(_ id: String, in link: FieldLink) -> Bool? {
  link.agents.first { $0.id == id }?.join?.deviceLive
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
    await door.route(studioDoorHost, homeDoor([MeshEntry(device: "dev-studio", rows: [boardRow(id: "s-1")])]))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }

    try await waitUntil("the field through the remembered home") {
      link.agents.map(\.id) == ["s-1"]
    }
    #expect(link.home == "dev-studio")
    #expect(await door.dials(to: studioDoorHost) == 1)
    #expect(await door.dials(to: laptopDoorHost) == 0, "one door: the home's")
    let ask = try await settledRequest(door, "agent.subscribe", host: studioDoorHost)
    #expect(ask.params == AgentSubscribeParams.phoneMesh.json)
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
      homeDoor([MeshEntry(device: "dev-mini", rows: [boardRow(id: "m-1", device: "dev-mini")])]))
    await door.route(studioDoorHost, homeDoor([MeshEntry(device: "dev-studio")]))
    let (link, _, _, _) = try await standingLink(
      peers: [mine(laptop), mine(mini), mine(studio)], probe: probe, selfLogin: alice, door: door,
      homeMemory: memory)
    defer { link.stop() }

    try await waitUntil("the field through the first that answers") {
      link.agents.map(\.id) == ["m-1"]
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

    try await waitUntil("both desktops' rows") { link.agents.count == 2 }
    // device order, then each board's own
    #expect(link.agents.map(\.id) == ["l-1", "s-1"])
    #expect(link.agents.map { $0.join?.deviceID } == ["dev-laptop", "dev-studio"])
    #expect(link.agents.allSatisfy { $0.join?.deviceLive == true })
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
    try await waitUntil("both desktops' rows") { link.agents.count == 2 }

    let home = try #require(await door.latest(to: studioDoorHost))
    await home.deliver(meshFrame(meshState("dev-laptop", "asleep")))
    try await waitUntil("the laptop's row greyed") { desktopLive("l-1", in: link) == false }
    #expect(link.agents.map(\.id) == ["l-1", "s-1"], "the row stays")
    #expect(desktopLive("s-1", in: link) == true)

    var assembly = FieldAssembly(tint: .light)
    let dressed = assembly.fold(
      link.agents.compactMap(fieldBubble(from:)), cardSubjectID: nil, nowMs: 1_757_808_001_000)
    #expect(dressed.first { $0.id == "l-1" }?.stale == true)
    #expect(dressed.first { $0.id == "s-1" }?.stale == false)

    await home.deliver(meshFrame(meshState("dev-laptop", "live")))
    try await waitUntil("the laptop live again") { desktopLive("l-1", in: link) == true }
  }

  /// The contracts' own golden, through the home: every desktop it lists on its
  /// own chain — the sleeping one's kept board drawn greyed, the stale one
  /// listed with none — and then the golden frames, in order, moving them.
  @Test func theGoldenMeshBoardDrawsThroughTheHome() async throws {
    let golden = try MeshFixture.json("agent-mesh-open.valid")
    let frames = try #require(try MeshFixture.json("agent-mesh-frames.valid").arrayValue)
    let door = LinkDoor { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("m1"), "snapshot": golden]))]
      default: return []
      }
    }
    let (link, _, _, _) = try await standingLink(door: door)
    defer { link.stop() }

    try await waitUntil("the golden's three boards") { link.agents.count == 3 }
    #expect(link.agents.map(\.id) == ["run-here-w", "run-studio-q", "run-air-i"])
    #expect(link.agents.map { $0.join?.deviceLive } == [true, true, false])

    let home = try #require(await door.latest)
    for payload in frames { await home.deliver(meshFrame(payload)) }
    try await waitUntil("the frames applied") {
      link.agents.map(\.id) == ["run-studio-q", "run-air-i"]
        && link.agents.allSatisfy { $0.join?.deviceLive == true }
    }
    #expect(status(of: "run-studio-q", in: link) == .working)
    #expect(!link.notes.contains { $0.contains("re-subscribing") })
  }

  /// A frame that does not continue its desktop's chain is a GAP: the phone
  /// asks the home for a fresh board, and the board on the field STAYS until
  /// it lands — a repair is not a reason to draw nothing.
  @Test func aGapAsksTheHomeForAFreshBoard() async throws {
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor([MeshEntry(device: "dev-studio", rows: [boardRow(id: "s-1")])]))
    let (link, _) = try await homedLink(door: door)
    defer { link.stop() }
    try await waitUntil("the board") { link.agents.map(\.id) == ["s-1"] }

    let home = try #require(await door.latest(to: studioDoorHost))
    await home.deliver(
      meshFrame(meshDelta("dev-studio", since: 9, revision: 10, upserts: [boardRow(id: "s-9")])))
    try await waitUntil("a fresh subscribe") {
      await home.methods.filter { $0 == "agent.subscribe" }.count >= 2
    }
    #expect(link.agents.map(\.id) == ["s-1"], "the board stays; s-9 continued nothing")
    #expect(link.notes.contains { $0.contains("does not continue") })
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
      link.foreignDoors["dev-laptop"] != nil && link.agents.map(\.id) == ["s-1"]
    }
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.agents.map(\.id) == ["s-1"])
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
      link.home == "dev-studio" && link.agents.count == 2
    }
    let asked = await probe.asks(of: laptopDoorHost)

    await door.refuse(studioDoorHost)
    await door.latest(to: studioDoorHost)?.drop()
    try await waitUntil("re-homed to the laptop") { link.home == "dev-laptop" }
    #expect(
      await probe.asks(of: laptopDoorHost) - asked == 1,
      "one pass: the laptop asked once, and its answer moved the field")

    try await waitUntil("the laptop's board") { status(of: "l-1", in: link) == .idle }
    #expect(link.agents.map(\.id) == ["l-1", "s-1"], "nothing drawn twice")
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
      link.home == "dev-studio" && link.agents.count == 2
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
    #expect(link.agents.map(\.id) == ["l-1", "s-1"])
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
      homeDoor([MeshEntry(device: "dev-laptop", rows: [boardRow(id: "l-1", device: "dev-laptop")])]))
    let memory = scratchHomeMemory()
    let (link, _) = try await homedLink(door: door, memory: memory)
    defer { link.stop() }

    try await waitUntil("homed to the laptop") {
      link.home == "dev-laptop" && link.agents.map(\.id) == ["l-1"]
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
      homeDoor([MeshEntry(device: "dev-laptop", rows: [boardRow(id: "l-1", device: "dev-laptop")])]))
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
    try await waitUntil("home ready") { link.agents.count == 2 }
    let history = try #require(link.openHistoryDoor("dev-laptop"))
    defer { history.client.close() }
    _ = try await history.client.call("index.projects")
    let answer = try await link.workspaceCall(on: "dev-laptop", method: "workspace.roots")
    #expect(answer["from"] == .string("laptop"))
    #expect(await door.dials(to: laptopDoorHost) == 1)
    #expect(ledger.inUse(.door(desktop: "dev-laptop")) == 1)
    #expect(ledger.waiting(for: .door(desktop: "dev-laptop")) == 0)
  }

  /// A terminal ticket for a session on ANOTHER desktop dials THAT desktop's
  /// door, on demand — hello, the ticket, nothing else — and lets it go when
  /// the answer is in. A ticket for the home's own session rides the home's
  /// door. The home never mints for a desktop it is not.
  @Test func aTicketDialsTheOwnersDoorNotTheHomes() async throws {
    let ledger = PhoneConnectionBudget()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost) { method, id, params in
      if method == "terminal.openTicket" { return [frame(id: id, .object(["from": .string("studio")]))] }
      return homeDoor(studioBoard)(method, id, params)
    }
    await door.route(laptopDoorHost) { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "terminal.openTicket": return [frame(id: id, .object(["from": .string("laptop")]))]
      default: return []
      }
    }
    let (link, _) = try await homedLink(door: door, budget: ledger)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.agents.count == 2 }

    let ticket = try await link.openTerminalTicket(on: "dev-laptop", sessionId: "pty-l")
    #expect(ticket["from"]?.stringValue == "laptop")
    #expect(await door.dials(to: laptopDoorHost) == 1)
    let owner = try #require(await door.latest(to: laptopDoorHost))
    #expect(await owner.methods == ["system.hello", "terminal.openTicket"])
    let asked = await owner.requests.first { $0.method == "terminal.openTicket" }
    #expect(asked?.params == .object(["sessionId": .string("pty-l")]))
    try await waitUntil("the owner's door let go") {
      ledger.inUse(.door(desktop: "dev-laptop")) == 0
    }
    #expect(await owner.closed)
    #expect(ledger.inUse(.door(desktop: "dev-studio")) == 1, "the home keeps its door")
    #expect(await door.latest(to: studioDoorHost)?.methods.contains("terminal.openTicket") == false)

    let own = try await link.openTerminalTicket(on: "dev-studio", sessionId: "pty-s")
    #expect(own["from"]?.stringValue == "studio")
    #expect(await door.dials(to: studioDoorHost) == 1, "the home's own door: no second dial")
  }

  /// The owner's door counts against the phone's budget — one door per desktop
  /// (`PHONE_BUDGET`, SP-D12): a second ask to the same owner WAITS for the
  /// first's slot, and is dialled the moment it frees.
  @Test func aSecondAskToTheSameOwnerWaitsForTheFirstsSlot() async throws {
    let ledger = PhoneConnectionBudget()
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    await door.route(laptopDoorHost) { method, id, _ in
      method == "system.hello" ? [frame(id: id, ack)] : []  // tickets answered by hand
    }
    // A call deadline long enough that the ticket this row holds open by hand
    // is not raced by a TIMEOUT on a loaded host (the catalog rows' reason).
    let (link, _) = try await homedLink(
      door: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(30)),
      budget: ledger)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.agents.count == 2 }

    let first = Task { try await link.openTerminalTicket(on: "dev-laptop", sessionId: "pty-1") }
    let firstAsk = try await settledRequest(door, "terminal.openTicket", host: laptopDoorHost)
    #expect(ledger.inUse(.door(desktop: "dev-laptop")) == 1)

    let second = Task { try await link.openTerminalTicket(on: "dev-laptop", sessionId: "pty-2") }
    try await waitUntil("the second waiting for the slot") {
      ledger.waiting(for: .door(desktop: "dev-laptop")) == 1
    }
    #expect(await door.dials(to: laptopDoorHost) == 1)

    await door.latest(to: laptopDoorHost)?.deliver(frame(id: firstAsk.id, .object(["n": .int(1)])))
    #expect(try await first.value["n"] == .int(1))
    try await waitUntil("the second dialled") { await door.dials(to: laptopDoorHost) == 2 }
    let secondAsk = try await settledRequest(door, "terminal.openTicket", host: laptopDoorHost)
    #expect(secondAsk.params == .object(["sessionId": .string("pty-2")]))
    await door.latest(to: laptopDoorHost)?.deliver(frame(id: secondAsk.id, .object(["n": .int(2)])))
    #expect(try await second.value["n"] == .int(2))
    try await waitUntil("both let go") { ledger.inUse(.door(desktop: "dev-laptop")) == 0 }
  }

  /// An owner whose door did not answer its probe is refused at once, in the
  /// honest shape, and nothing is dialled — there is no door to ask.
  @Test func anOwnerWithNoAnsweringDoorIsRefusedWithoutADial() async throws {
    let probe = LinkProbe(answers: [laptopDoorHost: .unreachable("asleep")])
    let door = LinkDoor(script: selfDoor)
    await door.route(studioDoorHost, homeDoor(studioBoard))
    let (link, _) = try await homedLink(probe: probe, door: door)
    defer { link.stop() }
    try await waitUntil("the field through the studio") { link.agents.count == 2 }

    do {
      _ = try await link.openTerminalTicket(on: "dev-laptop", sessionId: "pty")
      Issue.record("a ticket was minted for a desktop with no door")
    } catch let error as FieldProductError {
      #expect(error.unavailable?.state == "no_door")
      #expect(error.unavailable?.service == "terminal")
    }
    #expect(await door.dials(to: laptopDoorHost) == 0)
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
    try await waitUntil("the field through the studio") { link.agents.count == 2 }

    do {
      _ = try await link.workspaceCall(on: "dev-laptop", method: "workspace.roots")
      Issue.record("a Files ask reached a desktop with no door")
    } catch let error as FieldProductError {
      #expect(error.unavailable?.service == "workspace")
      #expect(error.unavailable?.state == "no_door")
    }
    #expect(await door.dials(to: laptopDoorHost) == 0)
  }
}
