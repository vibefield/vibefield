import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// The join's rehearsal kit, shared by `FieldLinkTests` and `FieldLinkHomeTests`:
// a rehearsed mesh under discovery, a scripted probe at each peer's door and a
// scripted door behind it. No simulator network, no tailnet, no desktop — and
// every rule the join has is a rule about what arrives, so none of them needs
// one.
//
// DS-8 (2026-10-01) widened the door: it can answer each desktop's host with a
// script of its own (`route`) and refuse a host's dials (`refuse`), because a
// phone that HOMES to one desktop is a phone whose rows are about which door it
// dialled — the home's, an owner's on demand, or none.

// MARK: - Rows and roster, as the wire carries them

/// A desktop's row, as `device.list` answers it.
func deviceRow(
  name: String, deviceId: String = "dev-studio", terminalMesh: Bool = true, isSelf: Bool = true
) -> JSONValue {
  .object([
    "deviceId": .string(deviceId),
    "name": .string(name),
    "platform": .string("darwin"),
    "self": .bool(isSelf),
    "online": .bool(true),
    "capabilities": .object([
      "terminalHost": .bool(true), "terminalMesh": .bool(terminalMesh),
      "docHost": .bool(true), "push": .bool(false),
    ]),
  ])
}

func deviceListResult(_ rows: [JSONValue]) -> JSONValue {
  .object(["devices": .array(rows)])
}

/// A desktop's `field.devices.v1` slice — the presence leg, read on a gated
/// node only.
func deviceSlice(name: String, url: String?) -> JSONValue {
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

func boardRow(
  id: String, status: String = "working", kind: String = "claude", label: String = "Claude Code",
  device: String = "dev-studio"
) -> JSONValue {
  .object([
    "runtimeRunId": .string(id), "revision": .int(1), "kind": .string(kind),
    "label": .string(label), "tier": .string("managed"),
    "device": .string(device), "status": .string(status),
    "statusSince": .string("2026-09-13T18:42:11.000Z"),
    "stateChangedAt": .string("2026-09-13T18:42:11.000Z"),
    "createdAt": .string("2026-09-13T18:03:52.000Z"),
    "alive": .bool(true), "blockers": .array([]),
    "project": .object(["name": .string("vibe-field")]),
  ])
}

// MARK: - The home's mesh board (DS-8)

/// One desktop's entry in a mesh open, as a row writes it. `rows: nil` is a
/// desktop the home lists with no board.
struct MeshEntry {
  var device: String
  var state: String = "live"
  var rows: [JSONValue]? = []
  var epoch: String? = nil
  var revision: Int64 = 1

  /// The chain a delta on this entry's board must name.
  var chain: String { epoch ?? "\(device).1" }
}

/// `AgentMeshOpen`, as the home's door answers `agent.subscribe {scope: "mesh"}`.
func meshOpen(_ entries: [MeshEntry]) -> JSONValue {
  .object([
    "devices": .array(
      entries.map { entry in
        var fields: [String: JSONValue] = [
          "device": .string(entry.device), "state": .string(entry.state),
          "asOf": .string("2026-10-01T12:00:00.000Z"),
        ]
        if let rows = entry.rows {
          fields["snapshot"] = .object([
            "epoch": .string(entry.chain), "revision": .int(entry.revision),
            "rows": .array(rows),
          ])
        }
        return .object(fields)
      })
  ])
}

/// The subscribe answer that carries a mesh open.
func meshSubscribed(id: Int64, subId: String = "m1", _ entries: [MeshEntry]) -> String {
  frame(id: id, .object(["subId": .string(subId), "snapshot": meshOpen(entries)]))
}

/// One desktop's delta on its own chain.
func meshDelta(
  _ device: String, since: Int64, revision: Int64, upserts: [JSONValue] = [],
  removed: [String] = [], epoch: String? = nil
) -> JSONValue {
  .object([
    "device": .string(device),
    "delta": .object([
      "epoch": .string(epoch ?? "\(device).1"), "since": .int(since), "revision": .int(revision),
      "upserts": .array(upserts), "removed": .array(removed.map(JSONValue.string)),
    ]),
  ])
}

/// One desktop's standing changing.
func meshState(_ device: String, _ state: String) -> JSONValue {
  .object([
    "device": .string(device), "state": .string(state),
    "asOf": .string("2026-10-01T12:05:00.000Z"),
  ])
}

/// A later frame of the mesh board — every one rides `.delta` on the wire
/// (`daemon.ts`: the open is the `.snapshot`, every per-device frame a delta).
func meshFrame(subId: String = "m1", _ payload: JSONValue) -> String {
  event(method: "agent.subscribe.delta", subId: subId, payload: payload)
}

/// A self desktop serving as a HOME: hello, its roster, and its mesh board.
func homeDoor(
  _ entries: [MeshEntry], subId: String = "m1", roster: [JSONValue] = []
) -> LinkDoor.Script {
  { method, id, _ in
    switch method {
    case "system.hello": return [frame(id: id, ack)]
    case "device.list": return [frame(id: id, deviceListResult(roster))]
    case "agent.subscribe": return [meshSubscribed(id: id, subId: subId, entries)]
    default: return []
    }
  }
}

// MARK: - A scripted probe

/// The door's HTTP half, scripted per host.
///
/// It records every URL it was asked, which is how the rows prove WHAT the
/// phone dialed — the registry port and the peer's own fully-qualified name,
/// built here rather than read from anybody's slice.
actor LinkProbe: ProductDoorProbe {
  private var answers: [String: DoorProbeOutcome]
  private let fallback: DoorProbeOutcome
  /// How long an answer takes after the ask is RECORDED — a radio's round
  /// trip. The gap between "asked" and "the verdict applied" is real, and a row
  /// that moves a clock inside it is measuring the wrong instant.
  private let answerDelay: Duration
  private(set) var asked: [URL] = []

  init(
    answers: [String: DoorProbeOutcome] = [:],
    fallback: DoorProbeOutcome = .status(400),
    answerDelay: Duration = .zero
  ) {
    self.answers = answers
    self.fallback = fallback
    self.answerDelay = answerDelay
  }

  func probe(_ url: URL) async -> DoorProbeOutcome {
    asked.append(url)
    if answerDelay > .zero { try? await Task.sleep(for: answerDelay) }
    return answers[url.host ?? ""] ?? fallback
  }

  func answer(_ host: String, _ outcome: DoorProbeOutcome) { answers[host] = outcome }

  var asks: Int { asked.count }
  func asks(of host: String) -> Int { asked.filter { $0.host == host }.count }
}

// MARK: - A scripted door

actor LinkDoor: ProductTransport {
  typealias Script = @Sendable (_ method: String, _ id: Int64, _ params: JSONValue) -> [String]

  private let script: Script
  private let answerDelay: Duration
  private var routes: [String: Script] = [:]
  private var refused: Set<String> = []
  private var connections: [(host: String, connection: LinkConnection)] = []
  private(set) var dialed: [URL] = []

  init(answerDelay: Duration = .zero, script: @escaping Script) {
    self.script = script
    self.answerDelay = answerDelay
  }

  /// DS-8 — one desktop's own door: dials to `host` are answered by `script`.
  func route(_ host: String, _ script: @escaping Script) { routes[host] = script }
  /// The door at `host` stops answering: every later dial THROWS, as a dial to
  /// a desktop whose fieldd has gone does.
  func refuse(_ host: String) { refused.insert(host) }

  func connect(to url: URL) async throws -> any ProductConnection {
    dialed.append(url)
    let host = url.host ?? ""
    if refused.contains(host) { throw LinkDoorError.refused }
    let connection = LinkConnection(script: routes[host] ?? script, answerDelay: answerDelay)
    connections.append((host, connection))
    return connection
  }

  var latest: LinkConnection? { connections.last?.connection }
  /// Connections opened (a refused dial opens none).
  var dials: Int { connections.count }
  func dials(to host: String) -> Int { connections.filter { $0.host == host }.count }
  func latest(to host: String) -> LinkConnection? {
    connections.last { $0.host == host }?.connection
  }

  /// `agent.subscribe` requests across every connection this door served.
  func subscribes() async -> Int {
    var total = 0
    for (_, connection) in connections {
      total += await connection.methods.filter { $0 == "agent.subscribe" }.count
    }
    return total
  }
}

actor LinkConnection: ProductConnection {
  private let script: LinkDoor.Script
  private let answerDelay: Duration
  private var queue: [String] = []
  private var waiter: CheckedContinuation<String, any Error>?
  private var failure: (any Error)?
  private var sentMethods: [String] = []
  /// Every request, as `(method, id, params)` — for the rows that must name
  /// WHICH subscription a later frame was about.
  private(set) var requests: [(method: String, id: Int64, params: JSONValue)] = []
  private(set) var closed = false

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
    requests.append((method, id, value["params"] ?? .null))
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

  func close() {
    closed = true
    failure = failure ?? LinkDoorError.closed
  }

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

enum LinkDoorError: Error {
  case closed
  case refused
}

func frame(id: Int64, _ result: JSONValue) -> String {
  let value = JSONValue.object([
    "jsonrpc": .string("2.0"), "id": .int(id), "result": result,
  ])
  return String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
}

func failureFrame(
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

func event(method: String, subId: String, payload: JSONValue) -> String {
  let value = JSONValue.object([
    "jsonrpc": .string("2.0"), "method": .string(method),
    "params": .object(["subId": .string(subId), "payload": payload]),
  ])
  return String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
}

/// A SELF desktop's hello: a login the door's stored link names, so the preset
/// grants something.
let ack = JSONValue.object([
  "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
  "grantedScopes": .array([.string("agent.read"), .string("terminal.attach")]),
])

/// fieldd's `tailnet-guest`: the hello SUCCEEDS and grants nothing. The desktop
/// lane is removing this case under the same ruling; the phone reads it anyway.
let guestAck = JSONValue.object([
  "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
  "grantedScopes": .array([]),
])

/// The door a self desktop answers with: hello, its own row, and nothing else
/// unless a row scripts more.
let selfDoor: LinkDoor.Script = { method, id, _ in
  switch method {
  case "system.hello": return [frame(id: id, ack)]
  case "device.list": return [frame(id: id, deviceListResult([deviceRow(name: "studio")]))]
  default: return []
  }
}

// MARK: - The rig

/// The tailnet's own spelling of each peer's door, as the phone must build it:
/// the peer's fully-qualified MagicDNS name and the registry port.
let studioDoorHost = "studio.\(rehearsalSuffix)"
let laptopDoorHost = "laptop.\(rehearsalSuffix)"
let miniDoorHost = "mini.\(rehearsalSuffix)"

let mini = FieldStorePeer(
  id: "node-mini", deviceId: "dev-mini", online: true, hostname: "mini",
  tailnetIPs: ["100.64.0.4"])

/// A schedule with a fast tick, so a rehearsal does not wait ten seconds to
/// see a sweep. The two WINDOWS keep their real lengths — they are what the
/// schedule rows are about, and shortening them would prove a different rule.
let briskSchedule = FieldDiscoverySchedule(
  notThisAccount: .seconds(300), unreachable: .seconds(30), tick: .milliseconds(20))

/// A sweep that does not come round again inside any row's wait: after the
/// first passes settle, only an EDGE (a peer event, a door's loss) sweeps.
let idleSchedule = FieldDiscoverySchedule(
  notThisAccount: .seconds(300), unreachable: .seconds(30), tick: .seconds(120))

@MainActor
func standingLink(
  now: Date = Date(timeIntervalSince1970: 1_757_808_001),
  peers: [FieldStorePeer] = [studio],
  answerDelay: Duration = .zero,
  probe: LinkProbe = LinkProbe(),
  storeBus: Bool = false,
  selfLogin: String? = nil,
  script: @escaping LinkDoor.Script = selfDoor,
  door: LinkDoor? = nil,
  homeMemory: HomeMemory? = nil,
  schedule: FieldDiscoverySchedule = briskSchedule,
  options: FieldProductClient.Options = .init(
    maxBackoff: .milliseconds(5), callTimeout: .seconds(5)),
  budget: PhoneConnectionBudget? = nil,
  counter: SweepCounter? = nil,
  clock: MovableClock? = nil
) async throws -> (FieldLink, MeshRehearsal, LinkDoor, LinkProbe) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: peers)
  let door = door ?? LinkDoor(answerDelay: answerDelay, script: script)
  var doors = await mesh.doors()
  if let counter {
    let read = doors.onlinePeers
    doors.onlinePeers = {
      await counter.bump()
      return await read()
    }
  }
  let link = FieldLink(
    storeDoors: doors, transport: door, probe: probe,
    options: options,
    magicDNSSuffix: rehearsalSuffix,
    schedule: schedule,
    storeBus: storeBus,
    selfLogin: selfLogin,
    budget: budget,
    homeMemory: homeMemory,
    now: { clock?.now ?? now })
  link.start()
  return (link, mesh, door, probe)
}

/// One peer, with a login on it. Layer 3 carries this now (RFC 025 §3.6, D7)
/// and it is the account boundary itself.
func peer(_ base: FieldStorePeer, login: String?) -> FieldStorePeer {
  FieldStorePeer(
    id: base.id, deviceId: base.deviceId, online: base.online, hostname: base.hostname,
    tailnetIPs: base.tailnetIPs, loginName: login)
}

/// The same peer, gone to sleep: truffle keeps it in its snapshot as
/// `online: false` and never says `left`.
func asleepCopy(_ base: FieldStorePeer) -> FieldStorePeer {
  FieldStorePeer(
    id: base.id, deviceId: base.deviceId, online: false, hostname: base.hostname,
    tailnetIPs: base.tailnetIPs, loginName: base.loginName)
}

/// A scratch defaults suite, so no row can touch what a real phone remembers.
func scratchHomeMemory() -> HomeMemory {
  let name = "vf.test.home-memory." + UUID().uuidString
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return HomeMemory(defaults: defaults)
}

// MARK: - Clocks and passes

/// A clock a test can move. Both re-ask windows are about TIME, so proving them
/// needs a clock that is not the wall's.
@MainActor
final class MovableClock {
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
actor SweepCounter {
  private(set) var count = 0
  func bump() { count += 1 }
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
func sweepNow(
  _ mesh: MeshRehearsal, _ counter: SweepCounter, peer: FieldStorePeer = studio,
  file: String = #function
) async throws {
  let before = await counter.count
  await mesh.emit(.upsert(peer))
  try await waitUntil("a discovery pass") { await counter.count > before }
}

/// The first request of `method` a door's latest connection received — the
/// latest connection to `host`, when one is named.
@MainActor
func settledRequest(_ door: LinkDoor, _ method: String, host: String? = nil) async throws
  -> (method: String, id: Int64, params: JSONValue)
{
  let deadline = ContinuousClock.now.advanced(by: .seconds(5))
  while ContinuousClock.now < deadline {
    let connection: LinkConnection?
    if let host {
      connection = await door.latest(to: host)
    } else {
      connection = await door.latest
    }
    if let found = await connection?.requests.first(where: { $0.method == method }) {
      return found
    }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for a \(method) request")
  throw CancellationError()
}

/// A clock the test moves (SP-2's, mirrored from `FieldProductTests`). Every
/// keepalive timer in a door's client sleeps on it, so a door's five silent
/// minutes are an `advance` that runs in milliseconds — never wall time.
final class ManualProductClock: ProductClock, @unchecked Sendable {
  private let lock = NSLock()
  private var current: Duration = .zero
  private var sleepers: [UUID: (deadline: Duration, wake: CheckedContinuation<Void, any Error>)] =
    [:]

  func now() -> Duration { lock.withLock { current } }

  func sleep(until deadline: Duration) async throws {
    let id = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (wake: CheckedContinuation<Void, any Error>) in
        enum Outcome { case cancelled, due, parked }
        let outcome: Outcome = lock.withLock {
          if Task.isCancelled { return .cancelled }
          if deadline <= current { return .due }
          sleepers[id] = (deadline, wake)
          return .parked
        }
        switch outcome {
        case .cancelled: wake.resume(throwing: CancellationError())
        case .due: wake.resume()
        case .parked: break
        }
      }
    } onCancel: {
      let parked = lock.withLock { sleepers.removeValue(forKey: id) }
      parked?.wake.resume(throwing: CancellationError())
    }
  }

  /// Move time on, waking every sleeper whose deadline has come.
  func advance(by step: Duration) {
    let due: [CheckedContinuation<Void, any Error>] = lock.withLock {
      current += step
      let ready = sleepers.filter { $0.value.deadline <= current }
        .sorted { $0.value.deadline < $1.value.deadline }
      for (id, _) in ready { sleepers.removeValue(forKey: id) }
      return ready.map(\.value.wake)
    }
    for wake in due { wake.resume() }
  }

  /// How many timers are parked on this clock right now.
  var parked: Int { lock.withLock { sleepers.count } }
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
