import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// The join, driven headless: a rehearsed mesh under the stores and a scripted
// door under the clients. No simulator network, no tailnet, no desktop — and
// every rule the join has is a rule about what arrives, so none of them needs
// one.

private let devicesNamespace = FieldStore.namespace(for: FieldStoreID.devices)
private let agentsNamespace = FieldStore.namespace(for: FieldStoreID.agents)

/// A desktop's `field.devices.v1` slice.
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

private func boardRow(id: String, status: String = "working", kind: String = "claude") -> JSONValue
{
  .object([
    "runtimeRunId": .string(id), "revision": .int(1), "kind": .string(kind),
    "label": .string("Claude Code"), "tier": .string("managed"),
    "device": .string("dev-studio"), "status": .string(status),
    "statusSince": .string("2026-09-13T18:42:11.000Z"),
    "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
    "createdAt": .string("2026-09-13T18:03:52.000Z"),
    "alive": .bool(true), "blockers": .array([]),
    "project": .object(["cwd": .string("/Users/j/Projects/vibe-field")]),
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

// MARK: - A scripted door

private actor LinkDoor: ProductTransport {
  typealias Script = @Sendable (_ method: String, _ id: Int64, _ params: JSONValue) -> [String]

  private let script: Script
  private let answerDelay: Duration
  private var connections: [LinkConnection] = []

  init(answerDelay: Duration = .zero, script: @escaping Script) {
    self.script = script
    self.answerDelay = answerDelay
  }

  func connect(to url: URL) async throws -> any ProductConnection {
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

private let ack = JSONValue.object([
  "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
  "grantedScopes": .array([.string("agent.read"), .string("terminal.attach")]),
])

// MARK: - The rig

@MainActor
private func standingLink(
  now: Date = Date(timeIntervalSince1970: 1_757_808_001),
  answerDelay: Duration = .zero,
  script: @escaping LinkDoor.Script = { method, id, _ in
    method == "system.hello" ? [frame(id: id, ack)] : []
  }
) async throws -> (FieldLink, MeshRehearsal, LinkDoor) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: [studio])
  let door = LinkDoor(answerDelay: answerDelay, script: script)
  let link = FieldLink(
    storeDoors: await mesh.doors(), transport: door,
    options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
    magicDNSSuffix: rehearsalSuffix,
    now: { now })
  link.start()
  try await waitUntil("both stores listening") {
    let devicesUp = await mesh.isListening(to: devicesNamespace)
    let agentsUp = await mesh.isListening(to: agentsNamespace)
    return devicesUp && agentsUp
  }
  return (link, mesh, door)
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

// MARK: - The join

@MainActor
@Suite struct FieldLinkJoinTests {
  @Test func aDesktopThatNamesADoorIsDialedAndSaysSo() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("the door to be ready") {
      link.desktops.first?.state == .ready
    }
    #expect(await door.dials == 1)
    #expect(link.desktops.map(\.name) == ["studio"])
    #expect(await door.latest?.methods.first == "system.hello")
  }

  /// The brief's own question: what does the join do on a desktop that
  /// publishes nothing? It says so, and it dials nothing — "on the mesh, not
  /// serving its product surface" is a STATE, not a failure and not a blank.
  @Test func aDesktopWithNoDoorIsNamedAndNotDialed() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    try await waitUntil("the desktop to appear") { !link.desktops.isEmpty }
    #expect(link.desktops.first?.state == .noDoor)
    #expect(link.desktops.first?.feed == FieldFeedSource.none)
    #expect(await door.dials == 0)
    #expect(link.agents.isEmpty)
    #expect(!link.isHearing)
    #expect(MeshDisplay.linkLabel(desktops: link.desktops) == "NO DOOR")
    #expect(
      MeshDisplay.linkLine(desktop: try #require(link.desktops.first))
        == "studio — on the mesh, not serving its product surface")
  }

  /// A desktop that serves a NEW capability path is a new door: a path is
  /// minted per serve, and dialing the old one would be dialing a path that no
  /// longer exists.
  @Test func aNewCapabilityUrlIsANewDoor() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/first", version: 1)
    try await waitUntil("the first dial") { await door.dials == 1 }
    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/second", version: 2)
    try await waitUntil("the second dial") { await door.dials == 2 }
  }

  @Test func aDesktopThatLeavesTheStoreTakesItsDoorWithIt() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "clear",
        payload: clearFrame(deviceId: "dev-studio")),
      to: devicesNamespace)
    try await waitUntil("the desktop to go") { link.desktops.isEmpty }
    #expect(link.client(for: "dev-studio") == nil)
    _ = door
  }
}

// MARK: - The two legs

@MainActor
@Suite struct FieldLinkFeedTests {
  /// The first leg: the floor publishes its board and the phone draws it
  /// without dialing anything at all.
  @Test func theStoreAloneDrawsAField() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(mesh, board(rows: [boardRow(id: "run-1"), boardRow(id: "run-2")]))
    try await waitUntil("two bodies") { link.agents.count == 2 }
    #expect(link.agents.map(\.id) == ["run-1", "run-2"])
    #expect(link.agents.first?.project == "vibe-field")
    #expect(classifyAgentStatus(link.agents.first?.state) == .working)
    #expect(await door.dials == 0)
    #expect(link.desktops.first?.feed == .store)
  }

  /// The second leg (§5's hybrid): the floor is not publishing, so the door is
  /// asked instead — which is the case that matters, because both native mesh
  /// flags default OFF.
  @Test func theDoorAnswersWhenTheStoreDoesNot() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-door")])
    let (link, mesh, _) = try await standingLink(script: { method, id, params in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        #expect(params["projection"]?.stringValue == "field")
        #expect(params["minIntervalMs"] == .int(250))
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("a body over the door") { link.agents.count == 1 }
    #expect(link.agents.first?.id == "run-door")
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
    let (link, mesh, door) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
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
    let (link, mesh, door) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("the first board") { link.agents.count == 1 }

    // A delta that applies on top of a revision we never saw.
    await door.latest?.deliver(
      event(
        method: "agent.subscribe.delta", subId: "s1",
        payload: deltaFrame(since: 99, revision: 100, upserts: [], removed: [])))
    try await waitUntil("a second subscribe") {
      await (door.latest?.methods.filter { $0 == "agent.subscribe" }.count ?? 0) >= 2
    }
    #expect(link.notes.contains { $0.contains("re-subscribing") })
  }

  /// The store WINS: it is the floor's own publication, needs no connection,
  /// and one desktop publishing it tells every phone at once.
  @Test func theStoreOutranksTheDoorWhenBothHaveABoard() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-from-door")])
    let (link, mesh, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("the door's board") { link.agents.map(\.id) == ["run-from-door"] }

    await publishBoard(mesh, board(rows: [boardRow(id: "run-from-store")]))
    try await waitUntil("the store's board") { link.agents.map(\.id) == ["run-from-store"] }
    #expect(link.desktops.first?.feed == .store)
  }

  /// A desktop that stopped refreshing its slice stops drawing. The board says
  /// how old it is and the phone's own clock decides.
  @Test func aBoardPastItsExpiryLeavesTheField() async throws {
    let published: Int64 = 1_757_808_000_000
    let (link, mesh, _) = try await standingLink(
      now: Date(timeIntervalSince1970: Double(published + 31_000) / 1000))
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(
      mesh,
      board(
        rows: [boardRow(id: "run-1")], published: published, expires: published + 30_000))
    // Give the fold a beat; nothing should arrive.
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.agents.isEmpty)
  }

  /// Every row on a live board reaches the field, whatever vendor it names.
  @Test func anUnfamiliarProviderStillReachesTheField() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(
      mesh, board(rows: [boardRow(id: "a"), boardRow(id: "b", kind: "hermes")]))
    try await waitUntil("both bodies") { link.agents.count == 2 }
    #expect(link.agents.map(\.provider.rawValue) == ["claude", "hermes"])
  }
}

// MARK: - Background

@MainActor
@Suite struct FieldLinkBackgroundTests {
  /// §5: the door's subscription goes and the stores stop listening, but the
  /// slices STAND. Forgetting them would empty the field on a two-second app
  /// switch, which is a worse lie than a board that says how old it is.
  @Test func pausingDropsTheSubscriptionAndKeepsWhatWasHeard() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(mesh, board(rows: [boardRow(id: "run-1")]))
    try await waitUntil("a body") { link.agents.count == 1 }

    link.pause()
    #expect(link.isPaused)
    #expect(link.boards.isPaused)
    #expect(link.devices.isPaused)
    #expect(link.agents.count == 1)
    #expect(link.boards.slices["dev-studio"] != nil)

    // And a message sent to a paused reader lands nowhere.
    await publishBoard(
      mesh, board(rows: [boardRow(id: "run-1"), boardRow(id: "run-2")]), version: 2)
    try await Task.sleep(for: .milliseconds(80))
    #expect(link.agents.count == 1)
  }

  /// Back: every store re-`request`s its peers, so a board that changed while
  /// nobody was listening is replaced rather than waited for.
  @Test func resumingAsksEveryPeerAgain() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    try await waitUntil("the first asks") {
      let devices = await mesh.requests(to: "node-studio", on: devicesNamespace)
      let agents = await mesh.requests(to: "node-studio", on: agentsNamespace)
      return devices == 1 && agents == 1
    }

    link.pause()
    link.resume()
    #expect(!link.isPaused)
    try await waitUntil("a second ask on both stores") {
      let devices = await mesh.requests(to: "node-studio", on: devicesNamespace)
      let agents = await mesh.requests(to: "node-studio", on: agentsNamespace)
      return devices == 2 && agents == 2
    }
  }

  @Test func pausingIsIdempotentAndSoIsResuming() async throws {
    let (link, _, _) = try await standingLink()
    defer { link.stop() }
    link.pause()
    link.pause()
    #expect(link.isPaused)
    link.resume()
    link.resume()
    #expect(!link.isPaused)
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
    let (link, mesh, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.list": return [frame(id: id, sessions)]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let reply = try await link.latestReply(runtimeRunId: "run-1", on: "dev-studio")
    #expect(reply == "the gate is green")
  }

  /// A desktop with no door cannot be asked, and says that rather than
  /// answering nothing.
  @Test func askingADesktopWithNoDoorIsAnHonestRefusal() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }
    await publishDevice(mesh, url: nil)
    try await waitUntil("the desktop") { !link.desktops.isEmpty }

    await #expect(throws: FieldProductError.self) {
      _ = try await link.latestReply(runtimeRunId: "run-1", on: "dev-studio")
    }
  }
}

@MainActor
@Suite struct FieldLinkChipTests {
  @Test func theChipSaysNothingWhenTheFieldIsSimplyArriving() {
    let ready = FieldDesktop(
      deviceId: "d", name: "studio", platform: "darwin", state: .ready, feed: .store)
    #expect(MeshDisplay.linkLabel(desktops: [ready]) == nil)
    #expect(!MeshDisplay.chipWantsAttention(desktops: [ready]))
    #expect(MeshDisplay.linkLine(desktop: ready) == "studio — connected · field from the mesh")
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

// MARK: - IOS-4c/4d: the acts over the door

@MainActor
@Suite struct FieldLinkActTests {
  /// RESUME goes to the desktop that owns the run, and the answer is handed
  /// back whole. The new run is NOT put on the field here: the board is the
  /// fold's to publish, and a row invented on the phone would be a body the
  /// desktop has not agreed exists.
  @Test func resumeCallsTheDoorAndDoesNotInventARow() async throws {
    let (link, mesh, door) = try await standingLink(script: { method, id, params in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.resume":
        #expect(params["runtimeRunId"]?.stringValue == "run-exited")
        return [frame(id: id, .object(["runtimeRunId": .string("run-new")]))]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let answer = try await link.resume(runtimeRunId: "run-exited", on: "dev-studio")
    #expect(answer["runtimeRunId"]?.stringValue == "run-new")
    #expect(link.agents.isEmpty)
    #expect(await door.latest?.methods.contains("agent.resume") == true)
  }

  @Test func resumingADesktopWithNoDoorIsAnHonestRefusal() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }
    await publishDevice(mesh, url: nil)
    try await waitUntil("the desktop") { !link.desktops.isEmpty }

    await #expect(throws: FieldProductError.self) {
      _ = try await link.resume(runtimeRunId: "run-1", on: "dev-studio")
    }
  }

  /// G4: the capability arrives over the door instead of being pasted.
  @Test func theGrantIsAskedForOnceAndCarriesTheCapability() async throws {
    let granted = JSONValue.object([
      "capability": .string("mw_EXAMPLE_not_a_real_capability_0000"),
      "deviceId": .string("dev-studio"),
      "issuedAt": .int(1_789_671_899_000),
    ])
    let (link, mesh, door) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "terminal.mirrorWriteGrant": return [frame(id: id, granted)]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let outcome = await link.requestMirrorWriteGrant(on: "dev-studio")
    guard case .granted(let grant) = outcome else {
      Issue.record("expected a grant, got \(outcome)")
      return
    }
    #expect(grant.capability == "mw_EXAMPLE_not_a_real_capability_0000")
    #expect(grant.deviceId == "dev-studio")
    #expect(link.hasAskedForGrant(on: "dev-studio"))

    // ONCE, automatically. A refusal is audited on the desktop, and a phone
    // that asked again on every reconnect would fill a person's grants ledger
    // with its own impatience. The second ask never reaches the wire.
    let again = await link.requestMirrorWriteGrant(on: "dev-studio")
    #expect(again == .alreadyAsked)
    let asks = await door.latest?.methods.filter { $0 == "terminal.mirrorWriteGrant" }.count
    #expect(asks == 1)

    // But a PERSON pressing "get it from studio" goes through: "do not retry"
    // is a rule about the phone's impatience, and somebody asking again is not
    // the phone retrying — they have usually just changed something on the
    // desktop and want to see whether it took.
    let deliberate = await link.requestMirrorWriteGrant(on: "dev-studio", asker: .deliberate)
    guard case .granted = deliberate else {
      Issue.record("a deliberate ask must reach the door, got \(deliberate)")
      return
    }
    let afterButton = await door.latest?.methods.filter {
      $0 == "terminal.mirrorWriteGrant"
    }.count
    #expect(afterButton == 2)
  }

  /// A guest peer is refused by the door's own preset. That is a sentence for
  /// the sheet, never a loop.
  @Test func aRefusedGrantIsASentenceAndNotARetry() async throws {
    let (link, mesh, door) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      default:
        return [
          failureFrame(
            id: id, kind: "FORBIDDEN_SCOPE", message: "terminal.attach")
        ]
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let outcome = await link.requestMirrorWriteGrant(on: "dev-studio")
    #expect(outcome == .refused("terminal.attach"))
    #expect(outcome.note == "this desktop refused: terminal.attach")

    let again = await link.requestMirrorWriteGrant(on: "dev-studio")
    #expect(again == .alreadyAsked)
    let asks = await door.latest?.methods.filter { $0 == "terminal.mirrorWriteGrant" }.count
    #expect(asks == 1)
  }

  /// A desktop whose terminal mesh is off mints no key. Nothing is wrong —
  /// there is simply nothing to grant — and the paste path stands.
  @Test func aDesktopThatMintsNoKeySaysSoAndKeepsThePastePath() async throws {
    let (link, mesh, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      default:
        return [
          failureFrame(
            id: id, kind: "UNAVAILABLE", message: "no mirror-write capability",
            retryable: false,
            details: .object([
              "service": .string("terminal"), "state": .string("no-mirror-write"),
            ]))
        ]
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let outcome = await link.requestMirrorWriteGrant(on: "dev-studio")
    #expect(outcome == .notMinted)
    #expect(outcome.note.contains("FIELD_NATIVE_TERMINAL_MESH"))
    #expect(outcome.note.contains("paste one instead"))
  }

  @Test func askingADesktopWithNoDoorSaysThatRatherThanFailing() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }
    await publishDevice(mesh, url: nil)
    try await waitUntil("the desktop") { !link.desktops.isEmpty }

    #expect(await link.requestMirrorWriteGrant(on: "dev-studio") == .noDoor)
    #expect(!link.hasAskedForGrant(on: "dev-studio"))
  }

  /// The outcome never renders the secret. `FieldLink.MirrorWriteGrant` is
  /// Equatable, so a failing `#expect` prints one — and a grant's own
  /// description redacts it.
  @Test func noOutcomeEverPrintsTheCapability() async throws {
    let granted = JSONValue.object([
      "capability": .string("mw_EXAMPLE_not_a_real_capability_0000"),
      "deviceId": .string("dev-studio"), "issuedAt": .int(1_789_671_899_000),
    ])
    let (link, mesh, _) = try await standingLink(script: { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "terminal.mirrorWriteGrant": return [frame(id: id, granted)]
      default: return []
      }
    })
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    let outcome = await link.requestMirrorWriteGrant(on: "dev-studio")
    #expect(!outcome.note.contains("mw_EXAMPLE"))
    #expect(!String(describing: outcome).contains("mw_EXAMPLE"))
  }
}

@MainActor
@Suite struct FieldLinkEndpointTests {
  /// EL7 M1 end to end: a desktop that publishes a door on somebody else's
  /// machine is never dialed, and the link says why.
  @Test func aDoorPointingElsewhereIsNeverDialed() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://attacker.example/t/secret")
    try await waitUntil("the refusal") { !link.endpointRefusals.isEmpty }
    #expect(await door.dials == 0)
    #expect(
      link.desktops.first?.state
        == .refusedDoor("the published door points somewhere this desktop is not"))
    #expect(
      link.endpointRefusals["dev-studio"]
        == "the published door points somewhere this desktop is not")
    #expect(link.notes.contains { $0.contains("refused studio's door") })
    // The chip says so, because a desktop naming somebody else's machine is a
    // thing to look at rather than a thing to wait out.
    #expect(MeshDisplay.linkLabel(desktops: link.desktops) == "DOOR")
    #expect(MeshDisplay.chipWantsAttention(desktops: link.desktops))
  }

  /// And the desktop's own door still opens, so the check is not simply off.
  @Test func theDesktopsOwnDoorStillOpens() async throws {
    let (link, mesh, door) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(await door.dials == 1)
    #expect(link.endpointRefusals.isEmpty)
  }
}

// MARK: - The IOS-4b review's plumbing rows

/// A clock a test can move. The expiry rule is about TIME, so proving it needs
/// a clock that is not the wall's.
@MainActor
private final class MovableClock {
  private(set) var now: Date
  init(_ start: Date) { now = start }
  func advance(_ seconds: TimeInterval) { now = now.addingTimeInterval(seconds) }
}

@MainActor
@Suite struct FieldLinkPlumbingTests {
  /// THE TRAP. Two `field.devices.v1` slices, under two envelope keys, whose
  /// payloads both name one id — `Dictionary(uniqueKeysWithValues:)` killed
  /// the process. Any tailnet peer could do that to the app. The attribution
  /// refusal makes it unreachable from the network now, but a trap that is
  /// only unreachable is still a trap.
  @Test func twoSlicesNamingOneDeviceDoNotKillTheProcess() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }

    // Each slice is correctly attributed to its own sender; both PAYLOADS name
    // the same device id, which is the shape that used to trap.
    for sender in ["dev-studio", "dev-laptop"] {
      await mesh.deliver(
        inbound(
          from: "node-\(sender)", deviceId: sender, msgType: "full",
          payload: sliceFrame(
            "full", deviceId: sender, version: 1,
            data: deviceSlice(name: "twin", url: nil))),
        to: devicesNamespace)
    }
    try await waitUntil("both rows") { link.desktops.count == 2 }
    // Keyed by the STORE, so two senders are two desktops whatever their
    // payloads claim.
    #expect(link.desktops.map(\.deviceId) == ["dev-laptop", "dev-studio"])
  }

  /// ONE KEY. A slice filed under one id whose payload names another used to
  /// open a door under the envelope key while every row and lookup used the
  /// payload's: the door ready, the row "dialing" forever, `client(for:)` nil.
  @Test func theStoreKeyIsTheOnlyKey() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }

    // `deviceSlice` always claims `dev-studio` in its payload; this one is
    // filed under `dev-studio` too (anything else is refused now), so the two
    // agree — and the row, the client and the lookup must all use that string.
    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    try await waitUntil("ready") { link.desktops.first?.state == .ready }
    #expect(link.desktops.first?.deviceId == "dev-studio")
    #expect(link.client(for: "dev-studio") != nil)
  }

  /// EXPIRY IS TIME. The reconcile is edge-triggered on store mutations, and a
  /// publisher that goes quiet sends no edge — so the board sat on the field
  /// past its own expiry, `feed` still said `.store`, and the door was never
  /// asked. A timer at the board's own `expiresAt` is what notices.
  @Test func anExpiringBoardHandsOverToTheDoor() async throws {
    let published = Date(timeIntervalSince1970: 1_757_808_000)
    let clock = MovableClock(published)
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-door")])
    let mesh = MeshRehearsal()
    await mesh.set(peers: [studio])
    let door = LinkDoor { method, id, _ in
      switch method {
      case "system.hello": return [frame(id: id, ack)]
      case "agent.subscribe":
        return [frame(id: id, .object(["subId": .string("s1"), "snapshot": snapshot]))]
      default: return []
      }
    }
    let link = FieldLink(
      storeDoors: await mesh.doors(), transport: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
      magicDNSSuffix: rehearsalSuffix,
      now: { clock.now })
    defer { link.stop() }
    link.start()
    try await waitUntil("both stores listening") {
      let devicesUp = await mesh.isListening(to: devicesNamespace)
      let agentsUp = await mesh.isListening(to: agentsNamespace)
      return devicesUp && agentsUp
    }

    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret")
    // FIRST let the door's own board land and be folded. Without this the test
    // passes on a RACE — the door's snapshot arriving after the clock moves
    // calls a refold of its own, and the timer is never what was proved.
    try await waitUntil("the door's board") { link.agents.map(\.id) == ["run-door"] }

    // Now the store's, which outranks it.
    let publishedMs = Int64(published.timeIntervalSince1970 * 1000)
    await publishBoard(
      mesh,
      board(
        rows: [boardRow(id: "run-store")], published: publishedMs,
        expires: publishedMs + 200))
    try await waitUntil("the store's board") { link.agents.map(\.id) == ["run-store"] }
    #expect(link.desktops.first?.feed == .store)

    // Both boards are in hand and NOTHING further arrives: no message, no
    // mutation, no edge for an edge-triggered reconcile to notice, and no
    // frame to call a refold. Time is the only thing that changes, so the
    // timer is the only thing that can answer.
    clock.advance(1)
    try await waitUntil("the door takes over") { link.agents.map(\.id) == ["run-door"] }
    #expect(link.desktops.first?.feed == .door)
  }

  /// THE STORM. A burst of devices-store updates around hello opened four
  /// subscriptions on one door; each streamed at 250 ms and fought over one
  /// revision, so every frame disagreed and triggered a resubscribe.
  @Test func aBurstOfUpdatesOpensOneSubscription() async throws {
    let snapshot = snapshotFrame(revision: 5, rows: [boardRow(id: "run-1")])
    // The door answers a subscribe SLOWLY, which is what leaves the arming
    // window open — a door that replies instantly closes it before a burst can
    // walk through, and the test would pass without the latch it is about.
    let (link, mesh, door) = try await standingLink(
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
    // the only moment the slot is empty and the client is ready. So: let the
    // door come up (that arms the first, slow subscribe), then burst.
    await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret", version: 1)
    try await waitUntil("ready") { link.desktops.first?.state == .ready }

    // Seven more updates while the first subscribe is still in flight —
    // exactly the shape a desktop coming up produces.
    for version in Int64(2)...8 {
      await publishDevice(mesh, url: "ws://studio.tail.ts.net/t/secret", version: version)
    }
    try await waitUntil("a board") { link.agents.count == 1 }
    try await Task.sleep(for: .milliseconds(200))

    let subscribes = await door.latest?.methods.filter { $0 == "agent.subscribe" }.count
    #expect(subscribes == 1, "one door, one subscription")
    #expect(!link.notes.contains { $0.contains("re-subscribing") })
  }
}

@MainActor
@Suite struct GoldenFixtureStageTests {
  /// `-vf-demo-field-slice` stages THREE desktops so every face the phone can
  /// draw has something to draw it from, with no listener anywhere: the
  /// board's own device serving a door at a dead port, a desktop with no
  /// endpoint at all, and one with an endpoint and no board.
  ///
  /// Witnessed here rather than in a screenshot because the desktops have no
  /// chrome yet — that is the faces lane's half, and this is the fixture it
  /// draws from.
  @Test func theFixtureStagesThreeHonestDesktops() async throws {
    let doors = try #require(FieldStoreDoors.goldenBoard())
    let link = FieldLink(
      storeDoors: doors,
      options: .init(maxBackoff: .milliseconds(20), callTimeout: .milliseconds(400)))
    defer { link.stop() }
    link.start()

    try await waitUntil("three desktops") { link.desktops.count == 3 }
    #expect(link.desktops.map(\.name).sorted() == ["laptop", "mini", "studio"])

    // The golden board, through the real reader and the real fold: five rows
    // in, four bodies out.
    try await waitUntil("the golden board") { link.agents.count == 4 }

    // D1 feeds its field from the STORE even though its door is dead.
    let boardDevice = try #require(link.desktops.first { $0.name == "studio" })
    #expect(boardDevice.feed == .store)

    // D2 published no endpoint: on the mesh, not serving. Not a failure.
    let quiet = try #require(link.desktops.first { $0.name == "laptop" })
    #expect(quiet.state == .noDoor)
    #expect(quiet.feed == FieldFeedSource.none)

    // D3 has an endpoint and nothing behind it, so it dials and fails — which
    // is the face a desktop that went away wears.
    try await waitUntil("the dead door gives up") {
      guard let mini = link.desktops.first(where: { $0.name == "mini" }) else { return false }
      switch mini.state {
      case .connecting, .reconnecting, .failed: return true
      default: return false
      }
    }
    // And nothing was refused: every published door names its own device, so
    // the fixture passes the same endpoint pin a real desktop must.
    #expect(link.endpointRefusals.isEmpty)
  }
}
