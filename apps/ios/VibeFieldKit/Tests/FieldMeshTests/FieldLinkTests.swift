import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// The join, driven headless: a rehearsed mesh under discovery, a scripted probe
// at each peer's door and a scripted door behind it. No simulator network, no
// tailnet, no desktop — and every rule the join has is a rule about what
// arrives, so none of them needs one.
//
// **UA-P-1a rewrote what drives these.** Discovery used to be the
// `field.devices.v1` store: a desktop published a slice naming its capability
// URL and the phone dialed it. James ruled on 2026-09-15 that a store is scoped
// to the login identity, and that until truffle can gate by login nothing
// content-bearing rides the bus — so that store is not published, and the
// driver is truffle's PEER LIST. The rows below are the same rules asked of the
// new first link: a peer arrives, its door is asked whether it admits this
// login, and only the doors that say yes become desktops.
//
// **DS-8 rewrote what carries the field (2026-10-01).** The phone homes to ONE
// desktop and reads every desktop's board through the home's mesh board
// (`agent.subscribe {projection: "field", scope: "mesh"}`), so a door's field
// answer below is a MESH open — here mostly the studio's own board, the studio
// being both the only desktop and the home. The rows about which door is
// dialled, re-homing and the owner's door are `FieldLinkHomeTests`. The
// agents slice (`field.agents.v1`) is retired (DS-D14): the rows that drove its
// reader are deleted with it, and one row pins that a gated link never listens
// for it.

private let devicesNamespace = FieldStore.namespace(for: FieldStoreID.devices)
/// The retired board store's namespace, spelled here only so a row can prove
/// nothing listens on it (DS-D14). Test files may name it; product code no
/// longer does.
private let retiredAgentsNamespace = FieldStore.namespace(for: "field.agents.v1")

/// An agents SLICE, as an older desktop would still publish it.
private func agentsSlice(
  rows: [JSONValue], device: String = "dev-studio", revision: Int64 = 1,
  published: Int64 = 1_757_808_000_000, expires: Int64 = 1_757_808_030_000
) -> JSONValue {
  .object([
    "v": .int(1), "deviceId": .string(device),
    "publishedAt": .int(published), "expiresAt": .int(expires),
    "revision": .int(revision), "rows": .array(rows),
  ])
}

/// The studio's own board, as the studio — the only desktop, so the home —
/// serves it on its mesh board: one desktop, its board at `revision`.
private func snapshotFrame(revision: Int64, rows: [JSONValue]) -> JSONValue {
  meshOpen([MeshEntry(device: "dev-studio", rows: rows, revision: revision)])
}

/// The studio's own board moving, as one mesh frame.
private func deltaFrame(
  since: Int64, revision: Int64, upserts: [JSONValue], removed: [String]
) -> JSONValue {
  meshDelta("dev-studio", since: since, revision: revision, upserts: upserts, removed: removed)
}

/// The presence reader's rig: the same link with the bus ON (a gated node), for
/// the rows that exercise `FieldStore` deliberately. It listens for
/// `field.devices.v1` and for nothing else (DS-D14).
@MainActor
private func storeBusLink(
  now: Date = Date(timeIntervalSince1970: 1_757_808_001),
  peers: [FieldStorePeer] = [studio],
  probe: LinkProbe = LinkProbe(fallback: .unreachable("nothing there")),
  selfLogin: String? = nil,
  script: @escaping LinkDoor.Script = selfDoor
) async throws -> (FieldLink, MeshRehearsal, LinkDoor, LinkProbe) {
  let rig = try await standingLink(
    now: now, peers: peers, probe: probe, storeBus: true, selfLogin: selfLogin, script: script)
  try await waitUntil("the presence store listening") {
    await rig.1.isListening(to: devicesNamespace)
  }
  return rig
}

@MainActor
private func publishDevice(_ mesh: MeshRehearsal, url: String?, version: Int64 = 1) async {
  await mesh.deliver(
    inbound(
      from: "node-studio", deviceId: "dev-studio", msgType: "full",
      payload: sliceFrame(
        "full", deviceId: "dev-studio", version: version,
        data: deviceSlice(name: "studio", url: url))),
    to: devicesNamespace)
}

/// An older desktop publishing its agents slice anyway — delivered to the
/// retired namespace, where a listener would hear it if there were one.
@MainActor
private func publishAgentsSlice(
  _ mesh: MeshRehearsal, _ value: JSONValue, version: Int64 = 1
) async {
  await mesh.deliver(
    inbound(
      from: "node-studio", deviceId: "dev-studio", msgType: "update",
      payload: sliceFrame("update", deviceId: "dev-studio", version: version, data: value)),
    to: retiredAgentsNamespace)
}

// MARK: - Discovery by the door (UA-P-1a)

@MainActor
@Suite struct FieldLinkDiscoveryTests {
  /// The whole of UA-P-1a in one row: a peer on the tailnet, a door that
  /// admits this login, and a desktop.
  @Test func aPeerWhoseDoorAdmitsThisLoginBecomesADesktop() async throws {
    let (link, _, door, _) = try await standingLink()
    defer { link.stop() }

    try await waitUntil("the door to be ready") { link.desktops.first?.state == .ready }
    #expect(await door.dials == 1)
    #expect(link.desktops.map(\.deviceId) == ["dev-studio"])
    #expect(await door.latest?.methods.first == "system.hello")
    #expect(link.foreignDoors.isEmpty)
  }

  /// WHAT IT DIALED. Nothing in this app reads a dial target from the wire any
  /// more: the address is the peer's own fully-qualified MagicDNS name plus the
  /// registry port, and the path is the bare root — the sidecar adds the C3
  /// capability path on forward, so no secret was ever on a store for a phone
  /// to have read.
  @Test func theDialIsBuiltFromThePeerAndTheRegistryPort() async throws {
    let (link, _, door, probe) = try await standingLink()
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    let dialed = try #require(await door.dialed.first)
    #expect(dialed.scheme == "ws")
    #expect(dialed.host == studioDoorHost)
    #expect(dialed.port == FieldMeshContract.productServePort)
    #expect(dialed.path == "/")
    #expect(!dialed.absoluteString.contains("/t/"))

    // And the probe asked the same listener over plain HTTP.
    let probed = try #require(await probe.asked.first)
    #expect(probed.scheme == "http")
    #expect(probed.host == studioDoorHost)
    #expect(probed.port == FieldMeshContract.productServePort)
  }

  /// The sidecar's allow-list refuses a login it does not name, BEFORE fieldd
  /// sees the socket. That peer is not this account's desktop: not drawn, no
  /// client kept, and the fact logged rather than rendered as a failure.
  @Test func aDoorThatRefusesThisLoginIsNeverDrawn() async throws {
    let probe = LinkProbe(answers: [studioDoorHost: .status(403)])
    let (link, _, door, _) = try await standingLink(probe: probe)
    defer { link.stop() }

    try await waitUntil("the refusal") { !link.foreignDoors.isEmpty }
    #expect(link.desktops.isEmpty)
    #expect(await door.dials == 0)
    #expect(link.client(for: "dev-studio") == nil)
    #expect(link.foreignDoors["dev-studio"] == "the door refused this login (403)")
    // Never a failure face: somebody else's desktop is an ordinary thing for a
    // tailnet to contain.
    #expect(MeshDisplay.linkLabel(desktops: link.desktops) == nil)
    #expect(!MeshDisplay.chipWantsAttention(desktops: link.desktops))
    #expect(link.notes.contains { $0.contains("is not this account's desktop") })
  }

  /// The SECOND half of the account check, which lives behind a successful
  /// hello: fieldd's stored-login comparison mints a zero-scope
  /// `tailnet-guest`. The desktop lane is removing that case; the phone stays
  /// honest if it ever sees it.
  @Test func aHelloThatGrantsNothingIsNotThisAccountEither() async throws {
    let (link, _, door, _) = try await standingLink(script: { method, id, _ in
      method == "system.hello" ? [frame(id: id, guestAck)] : []
    })
    defer { link.stop() }

    try await waitUntil("the guest verdict") { !link.foreignDoors.isEmpty }
    #expect(link.desktops.isEmpty)
    // It WAS dialed — that is the only way to learn this — and then dropped.
    #expect(await door.dials == 1)
    #expect(link.client(for: "dev-studio") == nil)
    #expect(
      link.foreignDoors["dev-studio"]
        == "the door granted nothing — this is another account's desktop")
  }

  /// A peer whose door did not answer is on the mesh and not serving. A STATE,
  /// not a failure, and a different one from a door that said no.
  @Test func aPeerWhoseDoorIsSilentIsOnTheMeshAndNotServing() async throws {
    let probe = LinkProbe(fallback: .unreachable("connection refused"))
    let (link, _, door, _) = try await standingLink(probe: probe)
    defer { link.stop() }

    try await waitUntil("the desktop") { link.desktops.first?.state == .noDoor }
    #expect(await door.dials == 0)
    #expect(link.foreignDoors.isEmpty)
    #expect(
      MeshDisplay.linkLine(desktop: try #require(link.desktops.first))
        == "studio — on the mesh, not serving its product surface")
    #expect(MeshDisplay.linkLabel(desktops: link.desktops) == "NO DOOR")
  }

  /// EL7 M1, under the new shape. The phone builds the address, so a peer
  /// cannot name a machine it is not — what it CAN be is a peer the mesh gives
  /// no address for at all, and that is a state with a sentence rather than a
  /// silent absence.
  @Test func aPeerWithNoVouchedAddressIsRefusedRatherThanGuessedAt() async throws {
    let nameless = FieldStorePeer(
      id: "node-nameless", deviceId: "dev-nameless", online: true, hostname: nil,
      tailnetIPs: [])
    let (link, _, door, probe) = try await standingLink(peers: [nameless])
    defer { link.stop() }

    try await waitUntil("the refusal") { !link.endpointRefusals.isEmpty }
    #expect(await door.dials == 0)
    #expect(await probe.asks == 0)
    #expect(
      link.endpointRefusals["dev-nameless"]
        == "this desktop has no address the mesh will vouch for")
    #expect(
      link.desktops.first?.state
        == .refusedDoor("this desktop has no address the mesh will vouch for"))
    #expect(MeshDisplay.linkLabel(desktops: link.desktops) == "DOOR")
    #expect(MeshDisplay.chipWantsAttention(desktops: link.desktops))
  }

  /// A peer with a tailnet IP and no hostname is dialable at the IP — which is
  /// an address the mesh vouches for, so it passes the pin.
  @Test func aPeerWithOnlyAnAddressIsStillDialable() async throws {
    let ipOnly = FieldStorePeer(
      id: "node-ip", deviceId: "dev-ip", online: true, hostname: nil,
      tailnetIPs: ["100.64.0.9"])
    let (link, _, door, _) = try await standingLink(peers: [ipOnly])
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(await door.dialed.first?.host == "100.64.0.9")
  }

  /// A peer that leaves takes its door, its board and its verdict with it.
  @Test func aPeerThatLeavesTakesItsDoorWithIt() async throws {
    let (link, mesh, _, _) = try await standingLink()
    defer { link.stop() }
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    await mesh.set(peers: [])
    await mesh.emit(.left(studio))
    try await waitUntil("the desktop to go") { link.desktops.isEmpty }
    #expect(link.client(for: "dev-studio") == nil)
  }

  /// A peer whose truffle hello has not completed carries no durable id, so
  /// there is nothing to file it under. Not a state and not a refusal — the
  /// next sweep sees it wearing one.
  @Test func aPeerWithNoDurableIdIsNotYetADesktop() async throws {
    let early = FieldStorePeer(
      id: "node-early", deviceId: nil, online: true, hostname: "early",
      tailnetIPs: ["100.64.0.7"])
    let (link, mesh, _, probe) = try await standingLink(peers: [early])
    defer { link.stop() }

    try await Task.sleep(for: .milliseconds(120))
    #expect(link.desktops.isEmpty)
    #expect(await probe.asks == 0)
    #expect(link.endpointRefusals.isEmpty)

    // And it becomes one the moment truffle names it.
    await mesh.set(
      peers: [
        FieldStorePeer(
          id: "node-early", deviceId: "dev-early", online: true, hostname: "early",
          tailnetIPs: ["100.64.0.7"])
      ])
    try await waitUntil("the desktop") { link.desktops.count == 1 }
  }
}

// MARK: - The re-ask schedule (UA-P-1a)

@MainActor
private func clockedLink(
  clock: MovableClock, probe: LinkProbe
) async -> (FieldLink, MeshRehearsal, SweepCounter) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: [studio])
  let counter = SweepCounter()
  var doors = await mesh.doors()
  let peers = doors.onlinePeers
  doors.onlinePeers = {
    await counter.bump()
    return await peers()
  }
  let door = LinkDoor(script: selfDoor)
  let link = FieldLink(
    storeDoors: doors, transport: door, probe: probe,
    options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
    magicDNSSuffix: rehearsalSuffix, schedule: briskSchedule, storeBus: false,
    now: { clock.now })
  link.start()
  return (link, mesh, counter)
}

@MainActor
@Suite struct FieldLinkScheduleTests {
  /// A login can be linked later, so a refusal is not forever — but it is
  /// MINUTES, not seconds. A phone that re-asked a stranger's desktop every
  /// thirty seconds would be a tailnet full of pointless requests.
  @Test func aRefusedLoginIsAskedAgainOnlyAfterMinutes() async throws {
    let clock = MovableClock(Date(timeIntervalSince1970: 1_757_808_001))
    let probe = LinkProbe(answers: [studioDoorHost: .status(403)])
    let (link, mesh, counter) = await clockedLink(clock: clock, probe: probe)
    defer { link.stop() }

    try await waitUntil("the first ask") { await probe.asks >= 1 }

    // PIN THE PRECONDITION: a pass RAN inside the window and chose not to ask.
    // Without the pass, "it was not asked again" is equally true of a sweep
    // that had not happened yet.
    clock.advance(120)
    try await sweepNow(mesh, counter)
    #expect(await probe.asks == 1, "a refusal is not re-asked inside its window")

    clock.advance(200)  // past 300 s in total
    try await sweepNow(mesh, counter)
    try await waitUntil("the second ask") { await probe.asks >= 2 }
  }

  /// A door that did not answer is weather, and weather is asked about often.
  @Test func anUnreachableDoorIsAskedAgainSoon() async throws {
    let clock = MovableClock(Date(timeIntervalSince1970: 1_757_808_001))
    let probe = LinkProbe(fallback: .unreachable("connection refused"))
    let (link, mesh, counter) = await clockedLink(clock: clock, probe: probe)
    defer { link.stop() }

    try await waitUntil("the first ask") { await probe.asks >= 1 }

    clock.advance(10)
    try await sweepNow(mesh, counter)
    #expect(await probe.asks == 1, "not yet")

    clock.advance(25)  // past 30 s in total
    try await sweepNow(mesh, counter)
    try await waitUntil("the second ask") { await probe.asks >= 2 }
  }

  /// A desktop whose door is OPEN is never probed again: the socket is its own
  /// liveness, and a sweep that re-asked would be paying for an answer it
  /// already has, on a radio.
  @Test func anOpenDoorIsNotProbedAgain() async throws {
    let clock = MovableClock(Date(timeIntervalSince1970: 1_757_808_001))
    let probe = LinkProbe()
    let (link, mesh, counter) = await clockedLink(clock: clock, probe: probe)
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    clock.advance(600)
    try await sweepNow(mesh, counter)
    try await sweepNow(mesh, counter)
    #expect(await probe.asks == 1)
  }
}

// MARK: - The desktop's own row (UA-P-1a)

@MainActor
@Suite struct FieldLinkDeviceRowTests {
  /// `device.list` has existed on this client and been called by NOTHING since
  /// IOS-4b — the name, the platform and the terminal-mesh word all came from
  /// the devices store. With that store off, the door is where they live.
  @Test func theDoorNamesTheDesktopAndItsTerminalDoors() async throws {
    let (link, _, door, _) = try await standingLink()
    defer { link.stop() }

    try await waitUntil("the desktop's own row") {
      link.desktops.first?.publishesTerminalDoors == true
    }
    #expect(link.desktops.first?.name == "studio")
    #expect(link.desktops.first?.platform == "darwin")
    #expect(await door.latest?.methods.contains("device.list") == true)
  }

  /// Until it answers, the peer's own tailscale hostname stands in. A real
  /// fact about that machine — a corner reading "unknown desktop" for a beat
  /// would be less true than one reading `studio`.
  @Test func thePeersHostnameStandsInUntilTheRowArrives() async throws {
    let (link, _, _, _) = try await standingLink(script: { method, id, _ in
      // Hello answers; `device.list` never does.
      method == "system.hello" ? [frame(id: id, ack)] : []
    })
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(link.desktops.first?.name == "studio")
    // It did not SAY, which is never drawn as a refusal.
    #expect(link.desktops.first?.publishesTerminalDoors == nil)
  }

  /// A desktop that answers `device.list` with no row of its own is open and
  /// answering; what is missing is a nicety, so it is a note and not a state.
  @Test func aRosterWithNoSelfRowIsANoteRatherThanAState() async throws {
    let (link, _, _, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "device.list": return [frame(id: id, deviceListResult([]))]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the note") {
      link.notes.contains { $0.contains("named no device of its own") }
    }
    #expect(link.desktops.first?.state == .ready)
    #expect(link.desktops.first?.name == "studio")
  }
}

// MARK: - The field, over the door

@MainActor
@Suite struct FieldLinkFeedTests {
  /// Since UA-P-1b the door is the ONLY leg, and since DS-8 it is the HOME's
  /// door: the studio is the only desktop, so it is the home, and its mesh
  /// board carries its own rows.
  @Test func theDoorCarriesTheField() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-door")])
    let (link, _, _, _) = try await standingLink(script: { method, id, params in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
      case "agent.subscribe":
        #expect(params["projection"]?.stringValue == "field")
        #expect(params["scope"]?.stringValue == "mesh")
        #expect(params["minIntervalMs"] == .int(250))
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("a body over the door") { link.agents.count == 1 }
    #expect(link.agents.first?.id == "run-door")
    #expect(link.agents.first?.project == "vibe-field")
    #expect(classifyAgentStatus(link.agents.first?.state) == .working)
    #expect(link.desktops.first?.feed == .door)
    #expect(link.isHearing)
    #expect(
      MeshDisplay.linkLine(desktop: try #require(link.desktops.first))
        == "studio — connected · field over the door")
  }

  /// Deltas move the board, and the row's own revision is what changed.
  @Test func aDeltaOverTheDoorMovesTheField() async throws {
    let snapshot = snapshotFrame(
      revision: 5, rows: [boardRow(id: "run-1"), boardRow(id: "run-2")])
    let (link, _, door, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("two bodies") { link.agents.count == 2 }
    await door.latest?.deliver(
      event(
        method: "agent.subscribe.delta", subId: "s1",
        payload: deltaFrame(
          since: 5, revision: 6, upserts: [boardRow(id: "run-3")], removed: ["run-1"])))
    try await waitUntil("the delta") { link.agents.map(\.id) == ["run-2", "run-3"] }
  }

  /// A lost frame is repaired by RE-SUBSCRIBING for a fresh snapshot — the
  /// tolerant reader's own rule, with no ack protocol and nothing replayed.
  @Test func aRevisionGapReSubscribesInsteadOfGuessing() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-1")])
    let (link, _, door, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the first board") { link.agents.count == 1 }
    await door.latest?.deliver(
      event(
        method: "agent.subscribe.delta", subId: "s1",
        payload: deltaFrame(since: 99, revision: 100, upserts: [], removed: [])))
    try await waitUntil("a second subscribe") {
      await (door.latest?.methods.filter { $0 == "agent.subscribe" }.count ?? 0) >= 2
    }
    // DS-8: the mesh board carries a chain per desktop, so the gap is caught by
    // the link's board copy; the repair is the client table's re-subscribe,
    // and the table's own note says so.
    #expect(link.notes.contains { $0.contains("does not continue") })
    #expect(
      link.client(for: "dev-studio")?.tolerantNotes.contains { $0.contains("re-subscribing") }
        == true)
  }

  /// Every row on a live board reaches the field, whatever vendor it names.
  @Test func anUnfamiliarProviderStillReachesTheField() async throws {
    let snapshot = snapshotFrame(
      revision: 1, rows: [boardRow(id: "a"), boardRow(id: "b", kind: "hermes")])
    let (link, _, _, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("both bodies") { link.agents.count == 2 }
    #expect(link.agents.map(\.provider.rawValue) == ["claude", "hermes"])
  }

  /// THE STORM. A burst of discovery edges around hello opened four
  /// subscriptions on one door; each streamed at 250 ms and fought over one
  /// revision, so every frame disagreed and triggered a resubscribe.
  @Test func aBurstOfPeerEventsOpensOneSubscription() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-1")])
    // The door answers a subscribe SLOWLY, which is what leaves the arming
    // window open — a door that replies instantly closes it before a burst can
    // walk through, and the test would pass without the latch it is about.
    let (link, mesh, door, _) = try await standingLink(
      answerDelay: .milliseconds(60),
      script: { method, id, _ in
        switch method {
        case "system.hello": return [frame(id: id, ack)]
        case "agent.subscribe":
          return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
        default: return []
        }
      })
    defer { link.stop() }

    // The window is AFTER hello and BEFORE the subscribe is answered, which is
    // the only moment the slot is empty and the client is ready.
    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    for _ in 0..<7 { await mesh.emit(.upsert(studio)) }

    try await waitUntil("a board") { link.agents.count == 1 }
    try await Task.sleep(for: .milliseconds(200))

    let subscribes = await door.latest?.methods.filter { $0 == "agent.subscribe" }.count
    #expect(subscribes == 1, "one door, one subscription")
    #expect(!link.notes.contains { $0.contains("re-subscribing") })
  }
}

// MARK: - The field's own refusal reaches the desktop

@MainActor
@Suite struct FieldLinkFieldRefusalTests {
  /// A door that answered hello and then refused the FIELD. The reason used to
  /// go to `FieldLink.notes` alone, which no view reads; it is on the desktop
  /// row now, which is what lets a face say it (UA-P-1d has the display half
  /// and its own rows).
  @Test func aRefusedFieldSubscriptionLandsOnTheDesktop() async throws {
    let (link, _, _, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
      case "agent.subscribe":
        return [
          failureFrame(id: id, kind: "FORBIDDEN_SCOPE", message: "agent.read is not granted")
        ]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the refusal on the desktop") {
      link.desktops.first?.fieldRefusal != nil
    }
    let desktop = try #require(link.desktops.first)
    #expect(desktop.state == .ready)
    #expect(desktop.feed == FieldFeedSource.none)
    #expect(desktop.fieldRefusal?.contains("FORBIDDEN_SCOPE") == true)
    // The note stays as the diagnostic it always was.
    #expect(link.notes.contains { $0.contains("refused the field subscription") })
  }

  /// And it CLEARS when a later subscribe lands: a reason that outlived its
  /// refusal would be a corner saying no over a field that is arriving.
  @Test func theRefusalClearsWhenTheFieldArrives() async throws {
    let snapshot = snapshotFrame(revision: 1, rows: [boardRow(id: "run-1")])
    let refuseFirst = Refusal()
    let (link, _, door, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        if refuseFirst.take() {
          return [failureFrame(id: id, kind: "FORBIDDEN_SCOPE", message: "not yet")]
        }
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the refusal") { link.desktops.first?.fieldRefusal != nil }
    // THE REGRESSION THIS ROW CAUGHT. `pause` cancels every subscription and
    // leaves the clients open, so nothing about them changes on the way back
    // and the observation that arms a subscription never fires; the sweep
    // skips an open door too. Before `resume` re-armed them by hand, a phone
    // returning from the background sat behind a desktop reading "connected"
    // over a field that never came back.
    _ = door
    link.pause()
    link.resume()
    try await waitUntil("the field, and no reason left") {
      link.agents.count == 1 && link.desktops.first?.fieldRefusal == nil
    }
  }
}

/// One-shot: the door refuses the first subscribe and answers the next.
private final class Refusal: @unchecked Sendable {
  private let lock = NSLock()
  private var pending = true
  func take() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard pending else { return false }
    pending = false
    return true
  }
}

// MARK: - Background

@MainActor
@Suite struct FieldLinkBackgroundTests {
  /// §5: the door's subscription goes and discovery stops asking, but the
  /// field STANDS. Emptying it on a two-second app switch would be a worse lie
  /// than a board that is a moment old.
  @Test func pausingDropsTheSubscriptionAndAsksNobody() async throws {
    let snapshot = snapshotFrame(revision: 1, rows: [boardRow(id: "run-1")])
    let (link, _, _, probe) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }
    try await waitUntil("a body") { link.agents.count == 1 }

    link.pause()
    #expect(link.isPaused)
    let asksWhilePaused = await probe.asks
    try await Task.sleep(for: .milliseconds(120))
    #expect(await probe.asks == asksWhilePaused, "a paused link asks nobody")
  }

  @Test func pausingIsIdempotentAndSoIsResuming() async throws {
    let (link, _, _, _) = try await standingLink()
    defer { link.stop() }
    link.pause()
    link.pause()
    #expect(link.isPaused)
    link.resume()
    link.resume()
    #expect(!link.isPaused)
  }

  /// Back from the background: discovery sweeps again.
  ///
  /// Witnessed with a peer that ARRIVED while the phone was away, because that
  /// is the case a resumed sweep has to catch and the one a re-ask schedule
  /// cannot produce on its own: every peer already asked is inside its window,
  /// so a resume that swept and found nothing new would look identical to a
  /// resume that never swept at all.
  @Test func resumingSweepsAgain() async throws {
    let probe = LinkProbe(fallback: .unreachable("asleep"))
    let (link, mesh, _, _) = try await standingLink(probe: probe)
    defer { link.stop() }
    try await waitUntil("the first desktop") { link.desktops.count == 1 }

    link.pause()
    let arrived = FieldStorePeer(
      id: "node-laptop", deviceId: "dev-laptop", online: true, hostname: "laptop",
      tailnetIPs: ["100.64.0.3"])
    await mesh.set(peers: [studio, arrived])
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.desktops.count == 1, "a paused link discovers nobody")

    link.resume()
    try await waitUntil("the peer that arrived while we were away") {
      link.desktops.count == 2
    }
  }
}

// MARK: - The card's one question

@MainActor
@Suite struct FieldLinkReplyTests {
  /// The field carries no reply text by design, so the card asks for one — for
  /// ONE run, when it opens, and never for a body nobody is reading.
  @Test func theCardAsksTheDoorForTheLatestReply() async throws {
    let sessions = JSONValue.object([
      "sessions": .array([
        .object([
          "runtimeRunId": .string("run-1"), "kind": .string("claude"),
          "label": .string("Claude"), "device": .string("dev-studio"),
          "tier": .string("managed"), "status": .string("idle"),
          "createdAt": .string("2026-09-13T18:03:52.000Z"),
          "stateChangedAt": .string("2026-09-13T18:03:52.000Z"),
          "monitor": .object([
            "lastAssistantMessage": .object([.init("text"): .string("the gate is green")])
          ]),
        ])
      ])
    ])
    let (link, _, _, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.list": return [frame(id: id, sessions)]
      default: return []
      }
    })
    defer { link.stop() }
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let reply = try await link.latestReply(runtimeRunId: "run-1", on: "dev-studio")
    #expect(reply == "the gate is green")
  }

  /// A desktop with no door cannot be asked, and says that rather than
  /// answering nothing.
  @Test func askingADesktopWithNoDoorIsAnHonestRefusal() async throws {
    let probe = LinkProbe(fallback: .unreachable("asleep"))
    let (link, _, _, _) = try await standingLink(probe: probe)
    defer { link.stop() }
    try await waitUntil("the desktop") { !link.desktops.isEmpty }

    await #expect(throws: FieldProductError.self) {
      _ = try await link.latestReply(runtimeRunId: "run-1", on: "dev-studio")
    }
  }
}

// MARK: - The chip's vocabulary

@MainActor
@Suite struct FieldLinkChipTests {
  @Test func theChipSaysNothingWhenTheFieldIsSimplyArriving() {
    let ready = FieldDesktop(
      deviceId: "d", name: "studio", platform: "darwin", state: .ready, feed: .door)
    #expect(MeshDisplay.linkLabel(desktops: [ready]) == nil)
    #expect(!MeshDisplay.chipWantsAttention(desktops: [ready]))
    #expect(MeshDisplay.linkLine(desktop: ready) == "studio — connected · field over the door")
  }

  @Test func aRefusedDoorWantsTheUser() {
    let failed = FieldDesktop(
      deviceId: "d", name: "studio", platform: "darwin",
      state: .failed("no grant for this peer"), feed: FieldFeedSource.none)
    #expect(MeshDisplay.linkLabel(desktops: [failed]) == "DOOR")
    #expect(MeshDisplay.chipWantsAttention(desktops: [failed]))
    #expect(
      MeshDisplay.linkLine(desktop: failed) == "studio — refused: no grant for this peer")
  }

  @Test func dialingSaysSoAndAnEmptyMeshSaysNothing() {
    let dialing = FieldDesktop(
      deviceId: "d", name: "studio", platform: "darwin", state: .connecting,
      feed: FieldFeedSource.none)
    #expect(MeshDisplay.linkLabel(desktops: [dialing]) == "…")
    #expect(MeshDisplay.linkLabel(desktops: []) == nil)
  }

  /// One ready desktop is enough to keep the chip quiet, because the bodies on
  /// the screen are the word.
  @Test func oneReadyDesktopOutranksAnotherThatIsStillDialing() {
    let ready = FieldDesktop(
      deviceId: "a", name: "studio", platform: "darwin", state: .ready, feed: .door)
    let dialing = FieldDesktop(
      deviceId: "b", name: "laptop", platform: "darwin", state: .connecting,
      feed: FieldFeedSource.none)
    #expect(MeshDisplay.linkLabel(desktops: [ready, dialing]) == nil)
  }
}

// MARK: - IOS-4c: the acts over the door

@MainActor
@Suite struct FieldLinkActTests {
  /// RESUME goes to the desktop that owns the run, and the answer is handed
  /// back whole. The new run is NOT put on the field here: the board is the
  /// fold's to publish, and a row invented on the phone would be a body the
  /// desktop has not agreed exists.
  @Test func resumeCallsTheDoorAndDoesNotInventARow() async throws {
    let (link, _, door, _) = try await standingLink(script: { method, id, params in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.resume":
        #expect(params["runtimeRunId"]?.stringValue == "run-exited")
        return [frame(id: id, .object(["runtimeRunId": .string("run-new")]))]
      default: return []
      }
    })
    defer { link.stop() }
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let answer = try await link.resume(runtimeRunId: "run-exited", on: "dev-studio")
    #expect(answer["runtimeRunId"]?.stringValue == "run-new")
    #expect(link.agents.isEmpty)
    #expect(await door.latest?.methods.contains("agent.resume") == true)
  }

  @Test func resumingADesktopWithNoDoorIsAnHonestRefusal() async throws {
    let probe = LinkProbe(fallback: .unreachable("asleep"))
    let (link, _, _, _) = try await standingLink(probe: probe)
    defer { link.stop() }
    try await waitUntil("the desktop") { !link.desktops.isEmpty }

    await #expect(throws: FieldProductError.self) {
      _ = try await link.resume(runtimeRunId: "run-1", on: "dev-studio")
    }
  }

  // RETIRED 2026-09-14 (TM-3, TM-D3): the six grant rows (IOS-4d) — the ask
  // once per connection, the deliberate re-ask through the latch, a refusal as
  // a sentence, an unminted desktop keeping the paste path, no door, and the
  // EL7 row proving no outcome ever printed the capability. The door they
  // drove is deleted on the desktop and the client half went with it; the
  // right to type is a claim in the attach grant the ticket carries.
}

// MARK: - The bus, scoped to the gate (UA-P-1b, UA-P-5)

@MainActor
@Suite struct FieldStoreBusTests {
  /// THE SWITCH, and what it is keyed to since UA-P-5.
  ///
  /// The FLAG says the bus exists again — truffle gates a node by login now
  /// (RFC 025), which is the condition James's ruling set. The LINK still
  /// reads nothing unless its node is gated, and a link that names neither
  /// reads nothing at all: an ungated node is on the whole tailnet, which is
  /// the audience the ruling forbids. Both halves in one row, because it is
  /// the pair that is the rule and either alone reads as the opposite.
  @Test func theBusExistsAgainAndAnUngatedLinkStillReadsNothing() async throws {
    #expect(FieldStoreBus.enabledByDefault == true)
    let (link, mesh, _, _) = try await standingLink()
    defer { link.stop() }
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    #expect(await mesh.isListening(to: devicesNamespace) == false)
    #expect(await mesh.isListening(to: retiredAgentsNamespace) == false)
    #expect(link.devices.storeId == nil)
  }

  /// And a slice delivered to an UNGATED link changes nothing: nothing is
  /// listening, and the desktop is named by its door alone.
  @Test func aSliceOnAnUngatedLinkDrawsNothing() async throws {
    let (link, mesh, _, _) = try await standingLink()
    defer { link.stop() }
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    await publishAgentsSlice(mesh, agentsSlice(rows: [boardRow(id: "run-from-store")]))
    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await Task.sleep(for: .milliseconds(120))
    #expect(link.agents.isEmpty)
    #expect(link.devices.slices.isEmpty)
    #expect(link.desktops.first?.feed == FieldFeedSource.none)
  }

  /// DS-D14 — a GATED link reads presence and never the board. The devices
  /// slice names the desktop as it always did; an agents slice an older desktop
  /// still publishes reaches no listener and draws nothing — the field is the
  /// home's mesh board alone. (This row was "the reader, back" until the
  /// reader retired.)
  @Test func aGatedLinkReadsPresenceAndNeverTheBoard() async throws {
    let (link, mesh, _, _) = try await storeBusLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishAgentsSlice(
      mesh, agentsSlice(rows: [boardRow(id: "run-1"), boardRow(id: "run-2")]))
    try await waitUntil("the slice's own name on the row") {
      link.devices.slices["dev-studio"] != nil
    }
    try await Task.sleep(for: .milliseconds(120))
    #expect(await mesh.isListening(to: retiredAgentsNamespace) == false)
    #expect(link.agents.isEmpty)
    #expect(link.desktops.first?.feed == FieldFeedSource.none)
    #expect(link.desktops.first?.name == "studio")
  }

  /// The store's conflict rule, still enforced by the reader that owns it.
  @Test func theAttributionRefusalStillHolds() async throws {
    let (link, mesh, _, _) = try await storeBusLink()
    defer { link.stop() }

    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "full",
        payload: sliceFrame(
          "full", deviceId: "dev-studio", version: 9,
          data: deviceSlice(name: "impostor", url: "ws://attacker.example/t/secret"))),
      to: devicesNamespace)
    try await waitUntil("the refusal") { link.devices.attributionRefusals == 1 }
    #expect(link.devices.slices["dev-studio"] == nil)
  }

  // RETIRED 2026-10-01 (DS-D14): `anExpiredBoardStaysOffTheField` — the
  // agents slice's own expiry, which left with its reader. A desktop's
  // staleness is its STATE on the home's mesh board now (DS-L8), pinned by
  // `FieldLinkHomeFieldTests.anAsleepDesktopsRowsStayGreyed`.
}

// MARK: - The golden fixture

@MainActor
@Suite struct GoldenFixtureStageTests {
  /// `-vf-demo-field-slice` (DS-8) stages the contracts' GOLDEN mesh board
  /// through the real home path, with no listener anywhere: four desktops on
  /// the fixture's tailnet (one asleep and not listed), the phone homing to
  /// the first whose door answers, and the field read through its mesh board
  /// — the sleeping desktop's kept board drawn greyed. It used to stage the
  /// golden `field.agents.v1` slice through the store reader, retired by
  /// DS-D14.
  @Test func theFixtureStagesItsDesktopsAndTheGoldenMeshBoard() async throws {
    let link = try #require(FieldLink.goldenFixture(schedule: briskSchedule))
    defer { link.stop() }
    link.start()

    try await waitUntil("the golden through the home") { link.agents.count == 3 }
    #expect(link.home == "dev-01HQ8ZK4M7")
    #expect(link.agents.map(\.id) == ["run-here-w", "run-studio-q", "run-air-i"])
    #expect(link.agents.map { $0.join?.deviceLive } == [true, true, false])

    // The names a beat later, from the home's roster.
    try await waitUntil("three named desktops") {
      link.desktops.map(\.name).sorted() == ["laptop", "mini", "studio"]
    }
    let quiet = try #require(link.desktops.first { $0.name == "mini" })
    #expect(quiet.state == .noDoor)
    #expect(quiet.feed == FieldFeedSource.none, "listed stale on the board, with no board")
    let laptopRow = try #require(link.desktops.first { $0.name == "laptop" })
    #expect(laptopRow.state == .ready)
    #expect(laptopRow.feed == .door)
    #expect(link.endpointRefusals.isEmpty)
    #expect(link.foreignDoors.isEmpty)
  }
}

// MARK: - Self and guest, by login (UA-P-5)

@MainActor
@Suite struct FieldLinkAccountTests {
  /// A peer this account owns is probed and drawn, exactly as before — the
  /// login is a cheaper FIRST verdict, never a replacement for the door.
  @Test func aPeerUnderThisLoginIsProbedAndDrawn() async throws {
    let (link, _, door, probe) = try await standingLink(
      peers: [peer(studio, login: "alice@corp.com")], selfLogin: "alice@corp.com")
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(await door.dials == 1)
    #expect(await probe.asks >= 1)
    #expect(link.foreignDoors.isEmpty)
  }

  /// **THE SAVING.** A peer the tailnet says belongs to someone else is never
  /// probed at all: no socket, no timeout, no row. The verdict is the one the
  /// door would have reached, arrived at from a fact the mesh already carried.
  @Test func aPeerUnderAnotherLoginIsNeverDialedAndNeverDrawn() async throws {
    let (link, _, door, probe) = try await standingLink(
      peers: [peer(studio, login: "bob@corp.com")], selfLogin: "alice@corp.com")
    defer { link.stop() }

    try await waitUntil("the refusal") { !link.foreignDoors.isEmpty }
    #expect(link.desktops.isEmpty)
    #expect(await probe.asks == 0)
    #expect(await door.dials == 0)
    #expect(
      link.foreignDoors["dev-studio"]
        == "the tailnet says this device is signed in as bob@corp.com")
    #expect(link.notes.contains { $0.contains("is not this account's desktop") })
    // Never a failure face — somebody else's desktop is an ordinary thing for
    // a tailnet to contain.
    #expect(!MeshDisplay.chipWantsAttention(desktops: link.desktops))
  }

  /// The case comparison is the gate's own (RFC 025 §3.2 — lowercased on both
  /// sides). A tailnet that spells a login differently must not turn this
  /// person's own desktop into a stranger.
  @Test func theLoginComparisonIsCaseInsensitive() async throws {
    let (link, _, _, _) = try await standingLink(
      peers: [peer(studio, login: "ALICE@Corp.COM")], selfLogin: "alice@corp.com")
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(link.foreignDoors.isEmpty)
  }

  /// **ABSENT IS NOT FOREIGN.** A row that names no owner is a netmap that
  /// could not resolve one (RFC 024 §8.1.2 keeps such a peer rather than
  /// evicting it), so the phone keeps asking the door — which is where the
  /// authority has been since UA-P-1a — instead of inventing a refusal.
  @Test func aPeerWithNoLoginIsStillAskedAtItsDoor() async throws {
    let (link, _, door, probe) = try await standingLink(
      peers: [peer(studio, login: nil)], selfLogin: "alice@corp.com")
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(await probe.asks >= 1)
    #expect(await door.dials == 1)
    #expect(link.foreignDoors.isEmpty)
  }

  /// The PRE-LOGIN WINDOW: this node does not know its own login yet, so it
  /// has no account to compare against and calls nobody foreign on that
  /// evidence. The door is the only witness there, exactly as through UA-P-1a.
  @Test func withNoSelfLoginNothingIsForeignOnLoginEvidence() async throws {
    let (link, _, door, probe) = try await standingLink(
      peers: [peer(studio, login: "bob@corp.com")], selfLogin: nil)
    defer { link.stop() }

    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(await probe.asks >= 1)
    #expect(await door.dials == 1)
    #expect(link.foreignDoors.isEmpty)
  }

  /// And the door's verdict still stands on its own in that window: a 403 is
  /// the other way a peer lands in `foreignDoors`, which is what keeps the
  /// optional "N other accounts' desktops" line a fact rather than a zero.
  @Test func theDoorsRefusalStillFillsTheTableInThePreLoginWindow() async throws {
    let probe = LinkProbe(answers: [studioDoorHost: .status(403)])
    let (link, _, _, _) = try await standingLink(
      peers: [peer(studio, login: nil)], probe: probe, selfLogin: nil)
    defer { link.stop() }

    try await waitUntil("the refusal") { !link.foreignDoors.isEmpty }
    #expect(link.desktops.isEmpty)
    #expect(link.foreignDoors["dev-studio"] == "the door refused this login (403)")
  }
}

// MARK: - The scoped bus and the door's last word (UA-P-5)

@MainActor
@Suite struct FieldLinkScopedBusTests {
  // MOVED 2026-10-01 (DS-8, DS-D14): `aRefusedPeersBoardIsHeldOffTheField` —
  // a desktop the phone established is somebody else's was held off the field
  // when its agents SLICE arrived. The slice is retired; the same law now
  // holds against the home's mesh board, pinned by
  // `FieldLinkHomeFieldTests.aDesktopThisPhoneRefusedStaysOffTheFieldWhenTheHomeListsIt`.

  /// A device row from a refused peer is not read either — the store is not a
  /// second opinion that overrides a door.
  @Test func aRefusedPeersDeviceRowNeverNamesADesktop() async throws {
    let probe = LinkProbe(answers: [laptopDoorHost: .status(403)])
    let (link, mesh, _, _) = try await storeBusLink(peers: [laptop], probe: probe)
    defer { link.stop() }

    try await waitUntil("the refusal") { link.foreignDoors["dev-laptop"] != nil }
    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "full",
        payload: sliceFrame(
          "full", deviceId: "dev-laptop", version: 1,
          data: deviceSlice(name: "not-mine", url: nil))),
      to: devicesNamespace)
    try await Task.sleep(for: .milliseconds(120))

    #expect(link.desktops.isEmpty)
    #expect(!link.desktops.contains { $0.name == "not-mine" })
  }

  // RETIRED 2026-10-01 (DS-D14): `aBoardStillArrivesWhileTheDoorIsAsleep` —
  // the store leg's whole reason (a board with no connection open). Its DS-8
  // analogue is a desktop asleep keeping its rows because the HOME's replica
  // answers for them: `FieldLinkHomeFieldTests.anAsleepDesktopsRowsStayGreyed`.

  /// THE GOLDEN, THROUGH THE LIVE READER. The device row the re-armed bus
  /// decodes is the contracts' own bytes — `device-slice.valid.json`, byte for
  /// byte, kept so by `pnpm check:ios-fixtures` — and not a shape this lane
  /// typed out for itself. A reader pinned by its own author's idea of the
  /// wire is pinned to nothing (the TM-r lesson).
  @Test func theDeviceRowTheBusReadsIsTheContractsGolden() async throws {
    let golden = try MeshFixture.json("device-slice.valid")
    let (link, mesh, _, _) = try await storeBusLink()
    defer { link.stop() }

    // The golden's own device id, so the slice is filed where the peer is.
    let goldenId = try #require(golden["deviceId"]?.stringValue)
    #expect(goldenId == "nodeid-8f2a1c9b7e")

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: golden)),
      to: devicesNamespace)

    // It reads, through `FieldStore` and `DeviceInfo` — the same decoder the
    // roster uses — and the name it carries reaches the desktop row.
    try await waitUntil("the golden's name on the row") {
      link.desktops.first?.name == "James MacBook Pro"
    }
    let row = try #require(link.desktops.first)
    #expect(row.platform == "darwin")
    #expect(row.publishesTerminalDoors == nil)  // the golden says nothing about it
  }

}

// MARK: - IOS-8c: who the desktop serves

/// A self desktop whose hello NAMES its user (UA-2's ULID), as every fieldd
/// since UA-2 does.
private let namingDoor: LinkDoor.Script = { method, id, _ in
  switch method {
  case "system.hello":
    return [
      frame(
        id: id,
        JSONValue.object([
          "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
          "grantedScopes": .array([.string("agent.read"), .string("terminal.attach")]),
          "userId": .string("01J8F2ZQ9K3M4N5P6Q7R8S9T0V"),
        ]))
    ]
  case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
  default: return []
  }
}

/// IOS-8c — the hello's user id rides the desktop row. It is the seed the
/// account corner's face is dealt from until the door carries the face
/// itself (AP-D3), and it was decoded since UA-2 and read by nothing.
@Suite("the hello's user id rides the desktop row")
@MainActor
struct FieldLinkUserIdTests {
  @Test func theRowSaysWhoTheDesktopServes() async throws {
    let (link, _, _, _) = try await standingLink(script: namingDoor)
    defer { link.stop() }
    try await waitUntil("the door to be ready") { link.desktops.first?.state == .ready }
    try await waitUntil("the user id") {
      link.desktops.first?.userId == "01J8F2ZQ9K3M4N5P6Q7R8S9T0V"
    }
  }

  @Test func aDaemonThatNamesNobodyLeavesItAbsent() async throws {
    let (link, _, _, _) = try await standingLink()
    defer { link.stop() }
    try await waitUntil("the door to be ready") { link.desktops.first?.state == .ready }
    #expect(link.desktops.first?.userId == nil)
  }
}

// MARK: - The agent catalog over the door (AC-5, AC-D9)

/// Which request ids asked for the catalog. A door script is a synchronous
/// `@Sendable` closure, so the tally is a lock-held box rather than an actor.
private final class CatalogTally: @unchecked Sendable {
  private let lock = NSLock()
  private var ids: [Int64] = []

  /// Records one ask and says which it was, counting from 1.
  func record(_ id: Int64) -> Int {
    lock.withLock {
      ids.append(id)
      return ids.count
    }
  }

  var asks: Int { lock.withLock { ids.count } }
  var last: Int64? { lock.withLock { ids.last } }
}

/// The standing rig with its passes COUNTED, so a row can pin "a pass ran and
/// did not ask" rather than "nothing asked yet", and with a call deadline long
/// enough that a row holding an answer back is not raced by a TIMEOUT on a
/// loaded host.
@MainActor
private func countedLink(
  schedule: FieldDiscoverySchedule = briskSchedule,
  script: @escaping LinkDoor.Script
) async -> (FieldLink, MeshRehearsal, LinkDoor, SweepCounter) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: [studio])
  let counter = SweepCounter()
  var doors = await mesh.doors()
  let peers = doors.onlinePeers
  doors.onlinePeers = {
    await counter.bump()
    return await peers()
  }
  let door = LinkDoor(script: script)
  let link = FieldLink(
    storeDoors: doors, transport: door, probe: LinkProbe(),
    options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(30)),
    magicDNSSuffix: rehearsalSuffix, schedule: schedule, storeBus: false)
  link.start()
  return (link, mesh, door, counter)
}

/// The subscribe answer every row below uses: one Claude run, one agent a
/// catalog may or may not have decided on, and one ACP run — a row the door
/// keeps off a phone's catalog (AC-D7). Every row carries the label the
/// desktop stamped, as fieldd's field rows do.
private func catalogBoard(_ id: Int64) -> String {
  frame(
    id: id,
    .object([
      "subId": .string("s1"),
      "snapshot": snapshotFrame(
        revision: 1,
        rows: [
          boardRow(id: "run-1"), boardRow(id: "run-2", kind: "zed", label: "Zed"),
          boardRow(id: "run-3", kind: "acp", label: "ACP"),
        ]),
    ]))
}

/// The golden as the door answers a PHONE: the rows whose `surfaces.phone` is
/// not false — what fieldd's `visible("phone")` sends (its own test pins that
/// the protocol row never reaches a phone).
private func phoneCatalog(_ golden: JSONValue) -> JSONValue {
  guard case .object(var fields) = golden, case .array(let rows)? = fields["catalog"] else {
    return golden
  }
  fields["catalog"] = .array(
    rows.filter { row in
      guard case .object(let r) = row, case .object(let s)? = r["surfaces"],
        case .bool(false)? = s["phone"]
      else { return true }
      return false
    })
  return .object(fields)
}

/// Generous ceilings: these rows wait on real socket turns, and a host at a
/// load average in the hundreds has timed out the 5 s default on main's own
/// tree. Each wait still returns the moment its condition holds.
private let catalogWait: Duration = .seconds(20)

@MainActor
@Suite struct FieldLinkCatalogTests {
  /// AC-D9 whole: the link asks the door for the catalog AS A PHONE once the
  /// hello lands, the phone's lists read it, and the field is named by it — a
  /// row the catalog decided on by its label, one it did not (or one the door
  /// keeps off the phone: ACP) by the label its field row carries.
  @Test func theDoorsCatalogNamesTheField() async throws {
    let golden = try MeshFixture.json("agent-catalog.valid")
    let (link, _, door, _) = await countedLink(script: { method, id, params in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog":
        #expect(params == .object(["surface": .string("phone")]))
        return [frame(id: id, phoneCatalog(golden))]
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the named field", timeout: catalogWait) {
      link.agents.count == 3 && link.agents.first?.catalogEntry != nil
    }
    #expect(link.agents.map { $0.catalogEntry?.label } == ["Claude Code", nil, nil])
    #expect(
      link.agents.compactMap { fieldBubble(from: $0)?.agent?.providerName } == [
        "Claude Code", "Zed", "ACP",
      ])
    // The door answered the phone WITHOUT the protocol row (AC-D7): the
    // phone's lists never offer it, and the desktop's ACP session still drew,
    // named by the label its row carries.
    #expect(link.catalog.entries.count == 9)
    #expect(link.catalog.phoneRoster.count == 9)
    #expect(!link.catalog.phoneRoster.contains { $0.id.rawValue == "acp" })
    #expect(await door.latest?.methods.filter { $0 == "agent.catalog" }.count == 1)
  }

  /// A catalog that lands AFTER the board renames the bodies already drawn:
  /// the answer refolds the field, whichever arrived first.
  @Test func aCatalogThatLandsAfterTheBoardRenamesTheBodies() async throws {
    let golden = try MeshFixture.json("agent-catalog.valid")
    let tally = CatalogTally()
    let (link, _, door, _) = await countedLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog":
        _ = tally.record(id)
        return []  // held back; answered by hand below
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("an unnamed field and the ask", timeout: catalogWait) {
      link.agents.count == 3 && tally.asks == 1
    }
    // PIN THE PRECONDITION: the bodies are on the field and nothing names them.
    #expect(link.agents.allSatisfy { $0.catalogEntry == nil })

    await door.latest?.deliver(frame(id: try #require(tally.last), golden))
    try await waitUntil("the field renamed", timeout: catalogWait) {
      link.agents.first?.catalogEntry?.label == "Claude Code"
    }
    #expect(tally.asks == 1)
  }

  /// A desktop from before the door answers NOT_FOUND. NOTHING breaks: the
  /// catalog stays empty, every body draws by its raw id, the desktop stays
  /// ready and connected — and the door is not asked again on this connection.
  @Test func aDesktopWithoutTheDoorLeavesTheFieldAsItWas() async throws {
    let tally = CatalogTally()
    let (link, mesh, door, counter) = await countedLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog":
        _ = tally.record(id)
        return [failureFrame(id: id, kind: "NOT_FOUND", message: "method not found")]
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the fallback note", timeout: catalogWait) {
      link.notes.contains { $0.contains("has no agent catalog for this phone") }
    }
    try await waitUntil("the bodies", timeout: catalogWait) { link.agents.count == 3 }
    #expect(link.catalog.isEmpty)
    #expect(link.agents.allSatisfy { $0.catalogEntry == nil })
    // named by the word each row carries — such a desktop stamps its
    // adapter's own — never blanked to the raw id
    #expect(
      link.agents.compactMap { fieldBubble(from: $0)?.agent?.providerName } == [
        "Claude Code", "Zed", "ACP",
      ])
    #expect(link.desktops.first?.state == .ready)
    #expect(link.desktops.first?.feed == .door)

    // PIN THE PRECONDITION: two passes RAN with the door open and chose not to
    // ask — without them, "asked once" is equally true of a sweep that had not
    // happened yet.
    try await sweepNow(mesh, counter)
    try await sweepNow(mesh, counter)
    #expect(tally.asks == 1)
    #expect(await door.latest?.methods.filter { $0 == "agent.catalog" }.count == 1)
  }

  /// A failure that asking again could fix — the door's own `retryable` — is
  /// asked again on the sweep's clock, and the second answer names the field.
  @Test func aRetryableFailureIsAskedAgainOnTheSweepsClock() async throws {
    let golden = try MeshFixture.json("agent-catalog.valid")
    let tally = CatalogTally()
    let (link, mesh, _, counter) = await countedLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog":
        return tally.record(id) == 1
          ? [
            failureFrame(
              id: id, kind: "UNAVAILABLE", message: "fieldd is still adopting", retryable: true)
          ]
          : [frame(id: id, golden)]
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the weather note", timeout: catalogWait) {
      link.notes.contains { $0.contains("asking again") }
    }
    try await sweepNow(mesh, counter)
    try await waitUntil("the catalog, second time", timeout: catalogWait) {
      !link.catalog.isEmpty
    }
    #expect(tally.asks == 2)
    #expect(link.agents.first?.catalogEntry?.label == "Claude Code")
  }

  /// Cached PER CONNECTION: the answer holds for the life of a socket, and a
  /// new socket — a re-dial after a drop — is asked afresh, because the desktop
  /// may have been upgraded while it was gone.
  ///
  /// On a sweep that will not come round for two minutes, so the second ask can
  /// only come from the client's own hello — the path a real phone takes, whose
  /// sweep is ten seconds away.
  @Test func aNewConnectionIsAskedAfreshAtItsHello() async throws {
    let golden = try MeshFixture.json("agent-catalog.valid")
    let tally = CatalogTally()
    let (link, _, door, _) = await countedLink(schedule: idleSchedule, script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog":
        _ = tally.record(id)
        return [frame(id: id, golden)]
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the first answer", timeout: catalogWait) { !link.catalog.isEmpty }
    #expect(tally.asks == 1)
    #expect(await door.dials == 1)

    await door.latest?.drop()
    try await waitUntil("a second connection's ask", timeout: catalogWait) {
      await door.dials >= 2 && tally.asks >= 2
    }
    #expect(await door.latest?.methods.filter { $0 == "agent.catalog" }.count == 1)
    #expect(link.catalog.entries.count == 10)
  }

  /// A door that goes takes its catalog with it: a phone must not keep naming
  /// agents by a desktop that is no longer on its field.
  @Test func aPeerThatLeavesTakesItsCatalogWithIt() async throws {
    let golden = try MeshFixture.json("agent-catalog.valid")
    let (link, mesh, _, _) = await countedLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog": return [frame(id: id, golden)]
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the catalog", timeout: catalogWait) { !link.catalog.isEmpty }
    await mesh.set(peers: [])
    await mesh.emit(.left(studio))
    try await waitUntil("the catalog gone", timeout: catalogWait) { link.catalog.isEmpty }
    #expect(link.desktops.isEmpty)
  }

  /// A HOME that drops off the ONLINE list (a sleep: truffle keeps the peer in
  /// its snapshot as `online: false` and never says `left`) is forgotten — its
  /// row and its catalog with it, the sweep refolding at once — and its bodies
  /// STAY, GREYED: asleep is a state, not an absence (DS-L8), and with no home
  /// answering nothing on the field is live. REWRITTEN 2026-10-01 (DS-8): the
  /// row used to empty the field. The review's finding behind it was bodies
  /// that stayed UNGREYED, named by a catalog the link no longer held; the
  /// copy now says what it is, and each body is named by the word its row
  /// carries once the catalog has gone.
  @Test func theHomeGoingOfflineGreysItsBodiesAndForgetsItsCatalog() async throws {
    let golden = try MeshFixture.json("agent-catalog.valid")
    let (link, mesh, _, _) = await countedLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.catalog": return [frame(id: id, golden)]
      case "agent.subscribe": return [catalogBoard(id)]
      default: return []
      }
    })
    defer { link.stop() }

    try await waitUntil("the named field", timeout: catalogWait) {
      link.agents.count == 3 && !link.catalog.isEmpty
    }
    await mesh.set(peers: [asleepCopy(studio)])
    await mesh.emit(.upsert(asleepCopy(studio)))
    try await waitUntil("the field greyed", timeout: catalogWait) {
      link.agents.count == 3 && link.agents.allSatisfy { $0.join?.deviceLive == false }
    }
    #expect(link.home == nil)
    #expect(link.desktops.isEmpty)
    #expect(link.catalog.isEmpty)
    #expect(
      link.agents.compactMap { fieldBubble(from: $0)?.agent?.providerName } == [
        "Claude Code", "Zed", "ACP",
      ])
  }
}

// MARK: - SP-2 (d): the roster is asked before every dial

@MainActor
@Suite struct FieldLinkRosterDialTests {
  /// The tailnet says the HOME went to sleep: its socket drops, the re-dial
  /// asks the roster and parks instead of climbing the backoff ladder against
  /// a machine that is not there, and the pass the drop asked for lets the home
  /// go — the tailnet no longer lists it, and no other desktop takes the field.
  /// When the roster says it woke, the phone homes to it again: one fresh dial,
  /// never a ladder. (REWRITTEN for DS-8: the row waited for the desktop to
  /// read `reconnecting`; a home the tailnet stops listing is let go instead.)
  @Test func aHomeTheTailnetCallsAsleepIsNotDialledAgainUntilItWakes() async throws {
    let mesh = MeshRehearsal()
    await mesh.set(peers: [studio])
    let door = LinkDoor(script: selfDoor)
    let link = FieldLink(
      storeDoors: await mesh.doors(), transport: door, probe: LinkProbe(),
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
      magicDNSSuffix: rehearsalSuffix,
      schedule: FieldDiscoverySchedule(
        notThisAccount: .seconds(300), unreachable: .seconds(30), tick: .seconds(60)),
      now: { Date(timeIntervalSince1970: 1_757_808_001) })
    link.start()
    defer { link.stop() }
    try await waitUntil("the door ready") { link.desktops.first?.state == .ready }

    await mesh.set(peers: [asleepCopy(studio)])
    await door.latest?.drop()
    try await waitUntil("the home let go") { link.home == nil }
    try await Task.sleep(for: .milliseconds(150))  // thirty 5 ms rungs of the ladder
    #expect(await door.dials == 1)

    await mesh.set(peers: [studio])
    await mesh.emit(.upsert(studio))
    try await waitUntil("a dial after the wake") { await door.dials == 2 }
    try await waitUntil("ready again") { link.desktops.first?.state == .ready }
    #expect(link.home == "dev-studio")
  }
}

// MARK: - SP-2 (e): the stuck client is retried while its peer stays online

/// Whether the door refuses hello right now — flipped by the test, read by the
/// script on whatever thread the door answers on.
private final class HelloVerdict: @unchecked Sendable {
  private let lock = NSLock()
  private var refusing = true
  func fix() { lock.withLock { refusing = false } }
  var refuses: Bool { lock.withLock { refusing } }
}

@MainActor
private func stuckLink(
  clock: MovableClock, verdict: HelloVerdict
) async -> (FieldLink, MeshRehearsal, SweepCounter, LinkDoor) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: [studio])
  let counter = SweepCounter()
  var doors = await mesh.doors()
  let peers = doors.onlinePeers
  doors.onlinePeers = {
    await counter.bump()
    return await peers()
  }
  let door = LinkDoor { method, id, params in
    if method == "system.hello", verdict.refuses {
      return [
        failureFrame(id: id, kind: "INCOMPATIBLE", message: "contracts 0.1.0 vs 0.2.0")
      ]
    }
    return selfDoor(method, id, params)
  }
  let link = FieldLink(
    storeDoors: doors, transport: door, probe: LinkProbe(),
    options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
    magicDNSSuffix: rehearsalSuffix, schedule: briskSchedule, storeBus: false,
    now: { clock.now })
  link.start()
  return (link, mesh, counter, door)
}

@MainActor
@Suite struct FieldLinkStuckClientTests {
  /// A door that refused this client for good — INCOMPATIBLE here; UNAUTHORIZED
  /// and PRECONDITION_FAILED stop it the same way — used to leave the client
  /// failed for the life of the link while its peer stayed online, because the
  /// sweep never replaces an open client. Those refusals can change (a desktop
  /// upgraded, a login linked), so the sweep REPLACES a stopped client on a
  /// backoff: the refused one is closed, the door asked again, a fresh client
  /// dialled.
  @Test func aClientTheDoorStoppedIsReplacedOnABackoffWhileItsPeerStaysOnline() async throws {
    let clock = MovableClock(Date(timeIntervalSince1970: 1_757_808_001))
    let verdict = HelloVerdict()
    let (link, mesh, counter, door) = await stuckLink(clock: clock, verdict: verdict)
    defer { link.stop() }

    try await waitUntil("the door's refusal") {
      if case .failed = link.desktops.first?.state { true } else { false }
    }
    #expect(await door.dials == 1)
    verdict.fix()  // the desktop was upgraded

    // PIN THE PRECONDITION: a pass RAN inside the backoff and did not replace it.
    clock.advance(20)
    try await sweepNow(mesh, counter)
    try await sweepNow(mesh, counter)
    #expect(await door.dials == 1, "not inside the backoff")

    clock.advance(15)  // past thirty seconds
    try await sweepNow(mesh, counter)
    try await waitUntil("a fresh client dialled") { await door.dials == 2 }
    try await waitUntil("the desktop ready again") { link.desktops.first?.state == .ready }
  }

  /// The backoff: the unreachable window doubling, capped at the refusal
  /// window — a stopped client is weather that changes in minutes, never in
  /// seconds, and never "not at all".
  @Test func theStuckClientsBackoffDoublesUpToTheRefusalWindow() {
    let schedule = FieldDiscoverySchedule()
    let ladder = (0..<7).map { schedule.stuckClientRetry(after: $0) }
    #expect(
      ladder == [
        .seconds(30), .seconds(60), .seconds(120), .seconds(240), .seconds(300), .seconds(300),
        .seconds(300),
      ])
  }
}

// RETIRED 2026-10-01 (DS-D14): SP-2 (f)'s `FieldLinkDoorOutranksSliceTests`
// (`aHelloedDoorOutranksALiveSlice`) — there is no slice left to outrank. The
// field is the home's mesh board alone, and a gated link never listens for
// the agents slice (`FieldStoreBusTests.aGatedLinkReadsPresenceAndNeverTheBoard`).

// MARK: - SP-2 (g): every door the link opens counts against the budget

@MainActor
@Suite struct FieldLinkBudgetTests {
  /// One door per self desktop, held in the phone's ledger from the dial to the
  /// close — so a replacement door (a moved address, a stopped client retried)
  /// waits for its predecessor's socket.
  @Test func eachDoorTheLinkOpensHoldsItsDesktopsSlot() async throws {
    let ledger = PhoneConnectionBudget()
    let mesh = MeshRehearsal()
    await mesh.set(peers: [studio])
    let link = FieldLink(
      storeDoors: await mesh.doors(), transport: LinkDoor(script: selfDoor), probe: LinkProbe(),
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
      magicDNSSuffix: rehearsalSuffix, schedule: briskSchedule, budget: ledger,
      now: { Date(timeIntervalSince1970: 1_757_808_001) })
    link.start()
    try await waitUntil("the door ready") { link.desktops.first?.state == .ready }
    #expect(ledger.inUse(.door(desktop: "dev-studio")) == 1)
    link.stop()
    try await waitUntil("the slot back") { ledger.inUse(.door(desktop: "dev-studio")) == 0 }
  }
}

// MARK: - SP-2 (c): back from the background, staggered across desktops

/// The resume stagger's waits, held by the test: each `sleep` parks until the
/// test wakes the SHORTEST one — the next slot.
private final class ResumeGate: @unchecked Sendable {
  private let lock = NSLock()
  private var waiting: [(delay: Duration, wake: CheckedContinuation<Void, Never>)] = []
  private var asked: [Duration] = []

  var sleep: @Sendable (Duration) async -> Void {
    { [self] delay in
      await withCheckedContinuation { wake in
        lock.withLock {
          asked.append(delay)
          waiting.append((delay, wake))
        }
      }
    }
  }

  var parked: Int { lock.withLock { waiting.count } }
  var delays: [Duration] { lock.withLock { asked } }

  func releaseNext() {
    let next: CheckedContinuation<Void, Never>? = lock.withLock {
      guard let index = waiting.indices.min(by: { waiting[$0].delay < waiting[$1].delay })
      else { return nil }
      return waiting.remove(at: index).wake
    }
    next?.resume()
  }

  func releaseAll() {
    let all = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
      defer { waiting = [] }
      return waiting.map(\.wake)
    }
    for wake in all { wake.resume() }
  }
}

@MainActor
@Suite struct FieldLinkResumeStaggerTests {
  /// SP-L7: subscriptions pause in the background and resnapshot on return,
  /// never in a herd. DS-8 makes the herd structural: a phone with three
  /// desktops holds ONE door — the home's — so coming back is one window, one
  /// re-subscribe, and nothing for the other two desktops to bring back; the
  /// sweep the resume starts holds the home until its window opens.
  /// (REWRITTEN for DS-8: the row staggered three doors, one per desktop.)
  @Test func comingBackIsOneWindowForTheOneDoorNeverAHerd() async throws {
    let mesh = MeshRehearsal()
    await mesh.set(peers: [studio, laptop, mini])
    let board = meshOpen([
      MeshEntry(device: "dev-laptop"), MeshEntry(device: "dev-mini"),
      MeshEntry(device: "dev-studio"),
    ])
    let door = LinkDoor { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s\(id)"), "snapshot": board]))]
      default: return []
      }
    }
    let gate = ResumeGate()
    let link = FieldLink(
      storeDoors: await mesh.doors(), transport: door, probe: LinkProbe(),
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
      magicDNSSuffix: rehearsalSuffix,
      schedule: FieldDiscoverySchedule(
        notThisAccount: .seconds(300), unreachable: .seconds(30), tick: .milliseconds(20),
        resumeStagger: .milliseconds(400)),
      resumeTiming: FieldResumeTiming(jitter: { 0.5 }, sleep: gate.sleep),
      now: { Date(timeIntervalSince1970: 1_757_808_001) })
    link.start()
    defer {
      link.stop()
      gate.releaseAll()
    }
    // Three desktops' boards, over ONE door: the first that answers, in device
    // order, is the home.
    try await waitUntil("three boards on the field") {
      link.desktops.count == 3 && link.desktops.allSatisfy { $0.feed == .door }
    }
    #expect(link.home == "dev-laptop")
    #expect(await door.dials == 1)
    #expect(await door.subscribes() == 1)

    link.pause()
    link.resume()
    try await waitUntil("one resume window") { gate.parked == 1 }
    #expect(gate.delays == [.milliseconds(200)])
    try await Task.sleep(for: .milliseconds(80))  // the resumed sweep runs on its 20 ms tick
    #expect(await door.subscribes() == 1, "nobody came back before its window")

    gate.releaseNext()
    try await waitUntil("the home back") { await door.subscribes() == 2 }
    try await Task.sleep(for: .milliseconds(40))
    #expect(await door.subscribes() == 2, "one door, one re-subscribe")
    #expect(await door.dials == 1)
  }

  /// The windows, pure: slot `i` comes back at (i + jitter) × the stagger, so a
  /// window never overlaps the next, whatever the jitter draws.
  @Test func eachDesktopHasItsOwnWindow() {
    let schedule = FieldDiscoverySchedule(resumeStagger: .milliseconds(400))
    #expect(schedule.resumeDelay(slot: 0, jitter: 0) == .zero)
    #expect(schedule.resumeDelay(slot: 0, jitter: 0.5) == .milliseconds(200))
    #expect(schedule.resumeDelay(slot: 2, jitter: 0.25) == .milliseconds(900))
    #expect(schedule.resumeDelay(slot: 1, jitter: 0.999) < schedule.resumeDelay(slot: 2, jitter: 0))
    // A jitter source that misbehaves stays inside its own window.
    #expect(schedule.resumeDelay(slot: 1, jitter: 7) < schedule.resumeDelay(slot: 2, jitter: 0))
    #expect(schedule.resumeDelay(slot: 1, jitter: -3) == .milliseconds(400))
  }
}


// MARK: - A subscribe in flight at pause does not survive it (found by SP-2 c)

@MainActor
@Suite struct FieldLinkPauseRaceTests {
  /// The race the stagger row found under load: a subscribe ASKED before the
  /// app went away and ANSWERED after it. The arm re-checked its slot after the
  /// await but not the pause, and the late snapshot was applied to a paused
  /// link — so a backgrounded phone kept a live subscription (bytes it had just
  /// promised not to spend), and the resume could not re-arm it (the slot was
  /// already full) and kept a board from before the pause.
  @Test func aSubscribeInFlightAtPauseDoesNotSurviveIt() async throws {
    let snapshot = snapshotFrame(revision: 1, rows: [boardRow(id: "run-1")])
    let (link, _, door, _) = try await standingLink(
      answerDelay: .milliseconds(150),
      script: { method, id, _ in
        switch method {
        case "system.hello": return [frame(id: id, ack)]
        case "agent.subscribe":
          return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
        default: return []
        }
      })
    defer { link.stop() }
    try await waitUntil("the subscribe in flight") {
      await door.latest?.methods.contains("agent.subscribe") == true
    }
    link.pause()
    try await waitUntil("the late answer let go") {
      await door.latest?.methods.contains("system.unsubscribe") == true
    }
    #expect(link.agents.isEmpty, "a paused link applies nothing the door sends")

    link.resume()
    try await waitUntil("a fresh subscribe on the way back") {
      await (door.latest?.methods.filter { $0 == "agent.subscribe" }.count ?? 0) == 2
    }
    try await waitUntil("the board back") { link.agents.map(\.id) == ["run-1"] }
  }

  /// The same race with the pause AND the resume inside the window — an app
  /// switch quicker than the door's answer. A pause check after the await
  /// cannot see a pause that has already been undone, so the pre-pause
  /// subscription was KEPT, and the resume's own window then found the slot
  /// full: the board stayed on its pre-pause chain and nothing came back
  /// fresh. Nothing armed before a pause is kept after it, however quickly the
  /// phone came back. Deterministic: the window opens only after the pre-pause
  /// answer has landed — the order a loaded scheduler produced in the stagger
  /// row's bundle runs.
  @Test func aPauseAndResumeInsideTheAnswerStillComeBackFresh() async throws {
    let snapshot = snapshotFrame(revision: 1, rows: [boardRow(id: "run-1")])
    let mesh = MeshRehearsal()
    await mesh.set(peers: [studio])
    let door = LinkDoor(answerDelay: .milliseconds(150)) { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s\(id)"), "snapshot": snapshot]))]
      default: return []
      }
    }
    let gate = ResumeGate()
    let link = FieldLink(
      storeDoors: await mesh.doors(), transport: door, probe: LinkProbe(),
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
      magicDNSSuffix: rehearsalSuffix, schedule: briskSchedule,
      resumeTiming: FieldResumeTiming(jitter: { 0.5 }, sleep: gate.sleep),
      now: { Date(timeIntervalSince1970: 1_757_808_001) })
    link.start()
    defer {
      link.stop()
      gate.releaseAll()
    }
    let first = try await settledRequest(door, "agent.subscribe")
    link.pause()
    link.resume()
    try await waitUntil("the window parked") { gate.parked == 1 }
    try await waitUntil("the pre-pause answer landed") { link.agents.map(\.id) == ["run-1"] }
    try await Task.sleep(for: .milliseconds(60))  // its arm's continuation has run

    gate.releaseNext()
    try await waitUntil("a fresh subscribe in the window") {
      await (door.latest?.methods.filter { $0 == "agent.subscribe" }.count ?? 0) == 2
    }
    try await waitUntil("the pre-pause subscription let go") {
      await door.latest?.requests.contains {
        $0.method == "system.unsubscribe" && $0.params["subId"]?.stringValue == "s\(first.id)"
      } == true
    }
  }
}
