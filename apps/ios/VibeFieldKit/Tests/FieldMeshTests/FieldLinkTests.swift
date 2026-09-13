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
  private var connections: [LinkConnection] = []

  init(script: @escaping Script) { self.script = script }

  func connect(to url: URL) async throws -> any ProductConnection {
    let connection = LinkConnection(script: script)
    connections.append(connection)
    return connection
  }

  var latest: LinkConnection? { connections.last }
  var dials: Int { connections.count }
}

private actor LinkConnection: ProductConnection {
  private let script: LinkDoor.Script
  private var queue: [String] = []
  private var waiter: CheckedContinuation<String, any Error>?
  private var failure: (any Error)?
  private var sentMethods: [String] = []

  init(script: @escaping LinkDoor.Script) { self.script = script }

  func send(_ text: String) async throws {
    if let failure { throw failure }
    guard let value = try? JSONValue.parse(Data(text.utf8)),
      let method = value["method"]?.stringValue
    else { return }
    sentMethods.append(method)
    let id = value["id"]?.intValue ?? -1
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
  script: @escaping LinkDoor.Script = { method, id, _ in
    method == "system.hello" ? [frame(id: id, ack)] : []
  }
) async throws -> (FieldLink, MeshRehearsal, LinkDoor) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: [studio])
  let door = LinkDoor(script: script)
  let link = FieldLink(
    storeDoors: await mesh.doors(), transport: door,
    options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
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

  @Test func anUndrawableProviderIsCountedOnTheLink() async throws {
    let (link, mesh, _) = try await standingLink()
    defer { link.stop() }

    await publishDevice(mesh, url: nil)
    await publishBoard(
      mesh, board(rows: [boardRow(id: "a"), boardRow(id: "b", kind: "hermes")]))
    try await waitUntil("one body and one count") {
      link.agents.count == 1 && link.undrawable["hermes"] == 1
    }
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
