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

private let devicesNamespace = FieldStore.namespace(for: FieldStoreID.devices)
private let agentsNamespace = FieldStore.namespace(for: FieldStoreID.agents)

/// The desktop's own row, as `device.list` answers it.
private func deviceRow(
  name: String, deviceId: String = "dev-studio", terminalMesh: Bool = true
) -> JSONValue {
  .object([
    "deviceId": .string(deviceId),
    "name": .string(name),
    "platform": .string("darwin"),
    "self": .bool(true),
    "online": .bool(true),
    "capabilities": .object([
      "terminalHost": .bool(true), "terminalMesh": .bool(terminalMesh),
      "docHost": .bool(true), "push": .bool(false),
    ]),
  ])
}

private func deviceListResult(_ rows: [JSONValue]) -> JSONValue {
  .object(["devices": .array(rows)])
}

/// A desktop's `field.devices.v1` slice — the DORMANT leg (UA-P-1b), kept for
/// the rows that exercise the reader deliberately.
private func deviceSlice(name: String, url: String?) -> JSONValue {
  var fields: [String: JSONValue] = [
    "deviceId": .string("dev-studio"),
    "name": .string(name),
    "platform": .string("darwin"),
    "headless": .bool(false),
    "fielddVersion": .string("0.1.0"),
    "contractsVersion": .string("0.1.0"),
    "capabilities": .object([
      "terminalHost": .bool(true), "docHost": .bool(true), "push": .bool(false),
    ]),
    "bootId": .string("fieldd-a1b2"),
    "publishedAt": .int(1_757_808_000_000),
  ]
  if let url {
    fields["productEndpoint"] = .object(["serve": .string("product"), "url": .string(url)])
  }
  return .object(fields)
}

private func boardRow(
  id: String, status: String = "working", kind: String = "claude", label: String = "Claude Code"
) -> JSONValue {
  .object([
    "runtimeRunId": .string(id), "revision": .int(1), "kind": .string(kind),
    "label": .string(label), "tier": .string("managed"),
    "device": .string("dev-studio"), "status": .string(status),
    "statusSince": .string("2026-09-13T18:42:11.000Z"),
    "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
    "createdAt": .string("2026-09-13T18:03:52.000Z"),
    "alive": .bool(true), "blockers": .array([]),
    "project": .object(["name": .string("vibe-field")]),
  ])
}

private func board(
  rows: [JSONValue], device: String = "dev-studio", revision: Int64 = 1,
  published: Int64 = 1_757_808_000_000, expires: Int64 = 1_757_808_030_000
) -> JSONValue {
  .object([
    "v": .int(1), "deviceId": .string(device),
    "publishedAt": .int(published), "expiresAt": .int(expires),
    "revision": .int(revision), "rows": .array(rows),
  ])
}

private func snapshotFrame(revision: Int64, rows: [JSONValue]) -> JSONValue {
  .object(["revision": .int(revision), "rows": .array(rows)])
}

private func deltaFrame(
  since: Int64, revision: Int64, upserts: [JSONValue], removed: [String]
) -> JSONValue {
  .object([
    "since": .int(since), "revision": .int(revision),
    "upserts": .array(upserts), "removed": .array(removed.map(JSONValue.string)),
  ])
}

// MARK: - A scripted probe

/// The door's HTTP half, scripted per host.
///
/// It records every URL it was asked, which is how the rows below prove WHAT
/// the phone dialed — the registry port and the peer's own fully-qualified
/// name, built here rather than read from anybody's slice.
private actor LinkProbe: ProductDoorProbe {
  private var answers: [String: DoorProbeOutcome]
  private let fallback: DoorProbeOutcome
  private(set) var asked: [URL] = []

  init(
    answers: [String: DoorProbeOutcome] = [:],
    fallback: DoorProbeOutcome = .status(400)
  ) {
    self.answers = answers
    self.fallback = fallback
  }

  func probe(_ url: URL) async -> DoorProbeOutcome {
    asked.append(url)
    return answers[url.host ?? ""] ?? fallback
  }

  var asks: Int { asked.count }
}

// MARK: - A scripted door

private actor LinkDoor: ProductTransport {
  typealias Script = @Sendable (_ method: String, _ id: Int64, _ params: JSONValue) -> [String]

  private let script: Script
  private let answerDelay: Duration
  private var connections: [LinkConnection] = []
  private(set) var dialed: [URL] = []

  init(answerDelay: Duration = .zero, script: @escaping Script) {
    self.script = script
    self.answerDelay = answerDelay
  }

  func connect(to url: URL) async throws -> any ProductConnection {
    dialed.append(url)
    let connection = LinkConnection(script: script, answerDelay: answerDelay)
    connections.append(connection)
    return connection
  }

  var latest: LinkConnection? { connections.last }
  var dials: Int { connections.count }
}

private actor LinkConnection: ProductConnection {
  private let script: LinkDoor.Script
  private let answerDelay: Duration
  private var queue: [String] = []
  private var waiter: CheckedContinuation<String, any Error>?
  private var failure: (any Error)?
  private var sentMethods: [String] = []

  init(script: @escaping LinkDoor.Script, answerDelay: Duration = .zero) {
    self.script = script
    self.answerDelay = answerDelay
  }

  func send(_ text: String) async throws {
    if let failure { throw failure }
    guard let value = try? JSONValue.parse(Data(text.utf8)),
      let method = value["method"]?.stringValue
    else { return }
    sentMethods.append(method)
    let id = value["id"]?.intValue ?? -1
    // A door that answers a SUBSCRIBE slowly. The arming window is between the
    // ask and the answer, and a door that replies instantly closes it before a
    // burst can walk through — which is how a storm test passes without the
    // latch it was written for.
    if answerDelay > .zero, method == "agent.subscribe" {
      try? await Task.sleep(for: answerDelay)
    }
    for frame in script(method, id, value["params"] ?? .null) { deliver(frame) }
  }

  func receive() async throws -> String {
    if let failure, queue.isEmpty { throw failure }
    if !queue.isEmpty { return queue.removeFirst() }
    return try await withCheckedThrowingContinuation { waiter = $0 }
  }

  func close() { failure = failure ?? LinkDoorError.closed }

  /// The socket DROPS under a read in flight, as a dead radio's does: the
  /// pending receive fails, so the client sees it and re-dials. `close()`
  /// alone leaves a suspended read waiting forever.
  func drop() {
    failure = LinkDoorError.closed
    if let waiter {
      self.waiter = nil
      waiter.resume(throwing: LinkDoorError.closed)
    }
  }

  func deliver(_ text: String) {
    if let waiter {
      self.waiter = nil
      waiter.resume(returning: text)
    } else {
      queue.append(text)
    }
  }

  var methods: [String] { sentMethods }
}

private enum LinkDoorError: Error { case closed }

private func frame(id: Int64, _ result: JSONValue) -> String {
  let value = JSONValue.object([
    "jsonrpc": .string("2.0"), "id": .int(id), "result": result,
  ])
  return String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
}

private func failureFrame(
  id: Int64, kind: String, message: String, retryable: Bool = false, details: JSONValue? = nil
) -> String {
  var data: [String: JSONValue] = ["kind": .string(kind), "retryable": .bool(retryable)]
  if let details { data["details"] = details }
  let value = JSONValue.object([
    "jsonrpc": .string("2.0"), "id": .int(id),
    "error": .object([
      "code": .int(-32000), "message": .string(message), "data": .object(data),
    ]),
  ])
  return String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
}

private func event(method: String, subId: String, payload: JSONValue) -> String {
  let value = JSONValue.object([
    "jsonrpc": .string("2.0"), "method": .string(method),
    "params": .object(["subId": .string(subId), "payload": payload]),
  ])
  return String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
}

/// A SELF desktop's hello: a login the door's stored link names, so the preset
/// grants something.
private let ack = JSONValue.object([
  "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
  "grantedScopes": .array([.string("agent.read"), .string("terminal.attach")]),
])

/// fieldd's `tailnet-guest`: the hello SUCCEEDS and grants nothing. The desktop
/// lane is removing this case under the same ruling; the phone reads it anyway.
private let guestAck = JSONValue.object([
  "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
  "grantedScopes": .array([]),
])

/// The door a self desktop answers with: hello, its own row, and nothing else
/// unless a row scripts more.
private let selfDoor: LinkDoor.Script = { method, id, _ in
  switch method {
  case "system.hello": return [frame(id: id, ack)]
  case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
  default: return []
  }
}

// MARK: - The rig

/// The tailnet's own spelling of the studio peer's door, as the phone must
/// build it: the peer's fully-qualified MagicDNS name and the registry port.
private let studioDoorHost = "studio.\(rehearsalSuffix)"

/// A schedule with a fast tick, so a rehearsal does not wait ten seconds to
/// see a sweep. The two WINDOWS keep their real lengths — they are what the
/// schedule rows are about, and shortening them would prove a different rule.
private let briskSchedule = FieldDiscoverySchedule(
  notThisAccount: .seconds(300), unreachable: .seconds(30), tick: .milliseconds(20))

@MainActor
private func standingLink(
  now: Date = Date(timeIntervalSince1970: 1_757_808_001),
  peers: [FieldStorePeer] = [studio],
  answerDelay: Duration = .zero,
  probe: LinkProbe = LinkProbe(),
  storeBus: Bool = false,
  selfLogin: String? = nil,
  script: @escaping LinkDoor.Script = selfDoor
) async throws -> (FieldLink, MeshRehearsal, LinkDoor, LinkProbe) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: peers)
  let door = LinkDoor(answerDelay: answerDelay, script: script)
  let link = FieldLink(
    storeDoors: await mesh.doors(), transport: door, probe: probe,
    options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
    magicDNSSuffix: rehearsalSuffix,
    schedule: briskSchedule,
    storeBus: storeBus,
    selfLogin: selfLogin,
    now: { now })
  link.start()
  return (link, mesh, door, probe)
}

/// The dormant reader's rig: the same link with the bus ON, for the rows that
/// exercise `FieldStore` deliberately (UA-P-1b).
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
  try await waitUntil("both stores listening") {
    let devicesUp = await rig.1.isListening(to: devicesNamespace)
    let agentsUp = await rig.1.isListening(to: agentsNamespace)
    return devicesUp && agentsUp
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

@MainActor
private func publishBoard(_ mesh: MeshRehearsal, _ value: JSONValue, version: Int64 = 1) async {
  await mesh.deliver(
    inbound(
      from: "node-studio", deviceId: "dev-studio", msgType: "update",
      payload: sliceFrame("update", deviceId: "dev-studio", version: version, data: value)),
    to: agentsNamespace)
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

/// A clock a test can move. Both windows are about TIME, so proving them needs
/// a clock that is not the wall's.
@MainActor
private final class MovableClock {
  private(set) var now: Date
  init(_ start: Date) { now = start }
  func advance(_ seconds: TimeInterval) { now = now.addingTimeInterval(seconds) }
}

/// How many discovery passes have run.
///
/// The schedule rows need it to PIN THEIR PRECONDITION. "the probe was not
/// asked again" is only evidence about the window if a sweep actually happened
/// and chose not to ask — otherwise a sweep that simply had not run yet passes
/// the same assertion, and the test proves nothing. Every pass reads the peer
/// list exactly once, so counting that read counts passes.
private actor SweepCounter {
  private(set) var count = 0
  func bump() { count += 1 }
}

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

/// Ask for a pass NOW rather than waiting on the ticker, and return once one
/// has finished.
///
/// The rules these rows are about are the two WINDOWS, not the ticker's
/// cadence. Leaning on the cadence made them fail under a loaded full-suite run
/// and pass eight times out of eight alone — a timing dependency the rule does
/// not have. A peer event is the same edge a live tailnet delivers, and it
/// drives a pass directly.
@MainActor
private func sweepNow(
  _ mesh: MeshRehearsal, _ counter: SweepCounter, file: String = #function
) async throws {
  let before = await counter.count
  await mesh.emit(.upsert(studio))
  try await waitUntil("a discovery pass") { await counter.count > before }
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
  /// Since UA-P-1b the door is the ONLY leg, and it carries everything the
  /// fold used to draw from the store.
  @Test func theDoorCarriesTheField() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-door")])
    let (link, _, _, _) = try await standingLink(script: { method, id, params in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
      case "agent.subscribe":
        #expect(params["projection"]?.stringValue == "field")
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
    #expect(link.notes.contains { $0.contains("re-subscribing") })
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
    #expect(await mesh.isListening(to: agentsNamespace) == false)
    #expect(link.devices.storeId == nil)
    #expect(link.boards.storeId == nil)
  }

  /// And a slice delivered to an UNGATED link changes nothing: the field is
  /// the door's until the node can name the account it is on.
  @Test func aSliceOnAnUngatedLinkDrawsNothing() async throws {
    let (link, mesh, _, _) = try await standingLink()
    defer { link.stop() }
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    await publishBoard(mesh, board(rows: [boardRow(id: "run-from-store")]))
    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await Task.sleep(for: .milliseconds(120))
    #expect(link.agents.isEmpty)
    #expect(link.boards.slices.isEmpty)
    #expect(link.desktops.first?.feed == FieldFeedSource.none)
  }

  /// THE READER, BACK. Everything the fold drew from the store draws again on
  /// a gated link — which is what UA-P-1b's "dormant rather than deleted" was
  /// for: turning it on is a one-word event and not an archaeology.
  @Test func theReaderWorksAgainOnAGatedLink() async throws {
    let (link, mesh, _, _) = try await storeBusLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(mesh, board(rows: [boardRow(id: "run-1"), boardRow(id: "run-2")]))
    try await waitUntil("two bodies from the store") { link.agents.count == 2 }
    #expect(link.agents.map(\.id) == ["run-1", "run-2"])
    #expect(link.desktops.first?.feed == .store)
    // And the slice's own name reaches the row, as it always did.
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

  /// A board past its own expiry never reaches the field.
  @Test func anExpiredBoardStaysOffTheField() async throws {
    let published: Int64 = 1_757_808_000_000
    let (link, mesh, _, _) = try await storeBusLink(
      now: Date(timeIntervalSince1970: Double(published + 31_000) / 1000))
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(
      mesh,
      board(rows: [boardRow(id: "run-1")], published: published, expires: published + 30_000))
    try await Task.sleep(for: .milliseconds(120))
    #expect(link.agents.isEmpty)
  }
}

// MARK: - The golden fixture

@MainActor
@Suite struct GoldenFixtureStageTests {
  /// `-vf-demo-field-slice` stages three desktops so the faces lane has
  /// something to draw from, with no listener anywhere.
  ///
  /// **What it stages CHANGED at UA-P-1a**, and honestly so: the fixture's
  /// published `productEndpoint.url`s are no longer what the phone dials —
  /// nothing publishes one — so all three peers are probed at the registry
  /// port with nothing behind it and all three wear `noDoor`. The BOARD still
  /// arrives, over the dormant reader with the switch on, which is what this
  /// row is really for: the fold, the projection and every face below them are
  /// unchanged by the discovery rewrite.
  @Test func theFixtureStagesItsDesktopsAndItsBoard() async throws {
    let doors = try #require(FieldStoreDoors.goldenBoard())
    let link = FieldLink(
      storeDoors: doors,
      probe: LinkProbe(fallback: .unreachable("nothing is listening")),
      options: .init(maxBackoff: .milliseconds(20), callTimeout: .milliseconds(400)),
      schedule: briskSchedule,
      storeBus: true)
    defer { link.stop() }
    link.start()

    // The peers arrive on the first sweep and their NAMES a beat later, over
    // the store — so the wait is for the names, not the count. A count that
    // passed while a row still read `127.0.0.1` would be asserting the fixture
    // had staged a desktop it has not finished staging.
    try await waitUntil("three named desktops") {
      link.desktops.map(\.name).sorted() == ["laptop", "mini", "studio"]
    }

    // The golden board, through the real reader and the real fold: five rows
    // in, four bodies out.
    try await waitUntil("the golden board") { link.agents.count == 4 }

    // D1 feeds its field from the store — the leg UA-P-4 brings back.
    let boardDevice = try #require(link.desktops.first { $0.name == "studio" })
    #expect(boardDevice.feed == .store)

    // Nothing answered at any door, which is a state and never a refusal.
    let quiet = try #require(link.desktops.first { $0.name == "laptop" })
    #expect(quiet.state == .noDoor)
    #expect(quiet.feed == FieldFeedSource.none)
    #expect(link.endpointRefusals.isEmpty)
    #expect(link.foreignDoors.isEmpty)
  }
}

// MARK: - Self and guest, by login (UA-P-5)

/// The tailnet's own spelling of the laptop peer's door.
private let laptopDoorHost = "laptop.\(rehearsalSuffix)"

/// One peer, with a login on it. Layer 3 carries this now (RFC 025 §3.6, D7)
/// and it is the account boundary itself.
private func peer(
  _ base: FieldStorePeer, login: String?
) -> FieldStorePeer {
  FieldStorePeer(
    id: base.id, deviceId: base.deviceId, online: base.online, hostname: base.hostname,
    tailnetIPs: base.tailnetIPs, loginName: login)
}

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
  /// **THE HOLE THIS CLOSES.** `refold` folds a board for every device id it
  /// knows, while `refreshDesktops` drops a peer the door refused — so with
  /// the bus on, a FOREIGN desktop's board put bodies on this person's field
  /// while its own row was correctly hidden. Bodies with no desktop, from a
  /// machine the phone had already established is somebody else's.
  @Test func aRefusedPeersBoardIsHeldOffTheField() async throws {
    // Neither door answers — the contrast this row is about is the VERDICT,
    // not the socket: `studio` is asleep (this account's, drawable) and
    // `laptop` refused (somebody else's, held).
    let probe = LinkProbe(
      answers: [laptopDoorHost: .status(403)], fallback: .unreachable("nothing there"))
    let (link, mesh, _, _) = try await storeBusLink(peers: [studio, laptop], probe: probe)
    defer { link.stop() }

    try await waitUntil("the laptop refused") { link.foreignDoors["dev-laptop"] != nil }

    // The refused peer publishes a board anyway. Nothing on this bus is
    // forged — truffle authenticated the sender — and it is still not this
    // phone's to draw.
    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "update",
        payload: sliceFrame(
          "update", deviceId: "dev-laptop", version: 1,
          data: board(rows: [boardRow(id: "run-not-mine")], device: "dev-laptop"))),
      to: agentsNamespace)

    // And this account's desktop publishes one at the same time, so the row is
    // about the FILTER and not about a fold that draws nothing.
    await publishBoard(mesh, board(rows: [boardRow(id: "run-mine")]))

    try await waitUntil("this account's body") { link.agents.map(\.id) == ["run-mine"] }
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.agents.map(\.id) == ["run-mine"])
    #expect(!link.desktops.contains { $0.deviceId == "dev-laptop" })
  }

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

  /// A SLEEPING door is not a refusal. The peer is one truffle's gate admitted,
  /// so its slice is this account's by construction (RFC 025 §3.1) and the
  /// board arrives with no connection open — which is the whole of what §5's
  /// hybrid buys. Holding here would make the store leg a slower door.
  @Test func aBoardStillArrivesWhileTheDoorIsAsleep() async throws {
    let (link, mesh, door, _) = try await storeBusLink()
    defer { link.stop() }

    await publishBoard(mesh, board(rows: [boardRow(id: "run-1")]))
    try await waitUntil("the body over the store") { link.agents.map(\.id) == ["run-1"] }
    #expect(link.desktops.first?.feed == .store)
    #expect(link.desktops.first?.state == .noDoor)
    #expect(await door.dials == 0)
  }

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

// MARK: - The contracts' own bytes, in this bundle

enum MeshFixture {
  static func json(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw MissingFixture(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  struct MissingFixture: Error, CustomStringConvertible {
    let name: String
    var description: String { "fixture `\(name).json` is not in the FieldMeshTests bundle" }
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

/// A sweep that does not come round again inside any row's wait: after the
/// first passes settle, nothing but the CLIENT's own state can ask the door.
private let idleSchedule = FieldDiscoverySchedule(
  notThisAccount: .seconds(300), unreachable: .seconds(30), tick: .seconds(120))

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

  /// A desktop that drops off the ONLINE list (a sleep: truffle keeps the peer
  /// in its snapshot as `online: false` and never says `left`) takes its
  /// bodies off the field too — the sweep that forgets it refolds, not only
  /// the `.left` path (the review's finding: the sweep returned before its
  /// refold when nothing else was due, and the vanished desktop's bodies
  /// stayed, named by a catalog the link no longer held).
  @Test func aDesktopThatGoesOfflineTakesItsBodiesOffTheField() async throws {
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
    let asleepStudio = FieldStorePeer(
      id: studio.id, deviceId: studio.deviceId, online: false, hostname: studio.hostname,
      tailnetIPs: studio.tailnetIPs)
    await mesh.set(peers: [asleepStudio])
    await mesh.emit(.upsert(asleepStudio))
    try await waitUntil("the field emptied", timeout: catalogWait) { link.agents.isEmpty }
    #expect(link.desktops.isEmpty)
    #expect(link.catalog.isEmpty)
  }
}
