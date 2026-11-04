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

/// PG-3e — a row of the REMOTE cut (`AgentRemoteRow`), as the home's mesh board carries it since 3e: the board key,
/// the owner, the pane join and the owner's `monitorRow` (a minimal valid one, modelled on
/// `monitor-agent-row.valid.json`). `key` is the board key (`runtimeRunId`), `id` the model id (the key unless said).
/// `kind: "terminal"` is a bare terminal: the root's `kind`, a pane join (its own session unless said), no provider.
func remoteBoardRow(
  key: String, id: String? = nil, device: String = "dev-studio", deviceName: String? = nil,
  status: String = "working", kind: String = "agent", terminal: JSONValue? = nil, unread: Bool = false,
  stale: Bool = false, observed: Bool = true, alive: Bool = true, pending: Bool? = nil,
  createdAt: Int64 = 1_790_800_000_000, provider: String = "claude", label: String = "Claude Code",
  project: String = "vibe-field", nativeSessionId: String? = nil, wait: JSONValue? = nil, cost: JSONValue? = nil,
  reply: String? = nil, revision: Int64 = 1
) -> JSONValue {
  let isTerminal = kind == "terminal"
  var monitor: [String: JSONValue] = [
    "id": .string(id ?? key), "kind": .string(isTerminal ? "terminal" : "agent"), "createdAt": .int(createdAt),
    "status": .string(status), "statusSince": .int(createdAt + 60_000), "stale": .bool(stale), "alive": .bool(alive),
    "observed": .bool(observed), "detail": .string(isTerminal ? project : "working on it"),
    "project": .object(["name": .string(project)]), "unread": .bool(unread),
    "device": .object(["id": .string(device), "name": .string(deviceName ?? device)]), "attachable": .bool(true),
  ]
  if !isTerminal { monitor["provider"] = .object(["id": .string(provider), "label": .string(label)]) }
  if let pending { monitor["pending"] = .bool(pending) }
  if let wait { monitor["wait"] = wait }
  if let cost { monitor["cost"] = cost }
  if let reply { monitor["reply"] = .object(["text": .string(reply)]) }
  var row: [String: JSONValue] = [
    "runtimeRunId": .string(key), "revision": .int(revision), "device": .string(device),
    "monitorRow": .object(monitor),
  ]
  if isTerminal {
    row["kind"] = .string("terminal")
    row["terminal"] = terminal ?? .object(["hosted": .string("local"), "runtimeSessionId": .string(id ?? key)])
  } else if let terminal {
    row["terminal"] = terminal
  }
  if let nativeSessionId { row["nativeSessionId"] = .string(nativeSessionId) }
  return .object(row)
}

/// PG-3e — the subscribe answer that carries a whole open as JSON (the witness's own, or one edited from it).
func remoteSubscribed(id: Int64, subId: String = "m1", _ open: JSONValue) -> String {
  frame(id: id, .object(["subId": .string(subId), "snapshot": open]))
}

/// PG-3e — a whole-mesh resync (PG-1c) on the stream: an open delivered as the subscription's `.snapshot` event.
func meshResync(subId: String = "m1", _ open: JSONValue) -> String {
  event(method: "agent.subscribe.snapshot", subId: subId, payload: open)
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

/// `AgentRemoteMeshOpen`, as the home's door answers `agent.subscribe {projection: "remote", scope: "mesh"}`.
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

/// A self desktop serving as a HOME: hello, its roster, its mesh board and — PG-3f — its answers to
/// `agent.reportShown` (`reports`, ok for every device unless the row scripts otherwise).
func homeDoor(
  _ entries: [MeshEntry], subId: String = "m1", roster: [JSONValue] = [],
  reports: ReportScript = ReportScript()
) -> LinkDoor.Script {
  { method, id, params in
    switch method {
    case "system.hello": return [frame(id: id, ack)]
    case "device.list": return [frame(id: id, deviceListResult(roster))]
    case "agent.subscribe": return [meshSubscribed(id: id, subId: subId, entries)]
    case "agent.reportShown": return reports.answer(id: id, params: params)
    default: return []
    }
  }
}

/// PG-3f (design v2 §4.5) — how a home answers `agent.reportShown`, per device the report names: each device's queued
/// answers first, in order, then its standing answer (`ok` unless set). The refusals are fieldd's own shapes
/// (`agent-screens.ts`, `product-api.ts`): the sender reads their `details`, never their kind.
final class ReportScript: @unchecked Sendable {
  enum Answer: Sendable {
    /// `{reported: true}`.
    case ok
    /// `{state: "no-screen"}` and no reason: no board open for this reader yet. Transient.
    case noScreen
    /// `{state: "no-screen", reason: "carried-cap"}`: the owner's bound. Lasting.
    case carriedCap
    /// `{method, locality: "local"}`: an owner, or a home, without PG-3b. Lasting.
    case localityLocal
    /// NOT_FOUND with no details (a door that does not know the method). Transient.
    case noDetails
    /// UNAVAILABLE, retryable. Transient.
    case unavailable
    /// No answer at all: the call stands until the socket goes (S14's report in flight).
    case silent
  }

  private let lock = NSLock()
  private var queued: [String: [Answer]] = [:]
  private var standing: [String: Answer] = [:]

  init() {}

  /// The device's next answers, in order, before its standing one.
  func queue(_ device: String, _ answers: Answer...) {
    lock.withLock { queued[device, default: []] += answers }
  }

  /// The device's answer from now on.
  func set(_ device: String, _ answer: Answer) { lock.withLock { standing[device] = answer } }

  func answer(id: Int64, params: JSONValue) -> [String] {
    let device = params["device"]?.stringValue ?? ""
    let next: Answer = lock.withLock {
      if var list = queued[device], !list.isEmpty {
        let first = list.removeFirst()
        queued[device] = list
        return first
      }
      return standing[device] ?? .ok
    }
    switch next {
    case .silent:
      return []
    case .ok:
      return [frame(id: id, .object(["reported": .bool(true)]))]
    case .noScreen:
      return [failureFrame(
        id: id, kind: "PRECONDITION_FAILED", message: "no board is open on this connection",
        details: .object(["state": .string("no-screen")]))]
    case .carriedCap:
      return [failureFrame(
        id: id, kind: "PRECONDITION_FAILED", message: "this peer connection carries 8 readers' screens already",
        details: .object(["state": .string("no-screen"), "reason": .string("carried-cap")]))]
    case .localityLocal:
      return [failureFrame(
        id: id, kind: "NOT_FOUND", message: "agent.reportShown is local to its desktop",
        details: .object(["method": .string("agent.reportShown"), "locality": .string("local")]))]
    case .noDetails:
      return [failureFrame(id: id, kind: "NOT_FOUND", message: "unknown method agent.reportShown")]
    case .unavailable:
      return [failureFrame(
        id: id, kind: "UNAVAILABLE", message: "the owner is not answering", retryable: true,
        details: .object(["service": .string("fieldd"), "state": .string("offline")]))]
    }
  }
}

/// PG-3f — the params of every `agent.reportShown` the door received, connection by connection, in order.
func reportsSent(_ door: LinkDoor) async -> [JSONValue] {
  await door.requests("agent.reportShown")
}

/// One report's params, as the phone must send them.
func report(_ ids: [String], _ device: String) -> JSONValue {
  .object(["ids": .array(ids.map(JSONValue.string)), "device": .string(device)])
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

  /// `agent.subscribe` requests across every connection to `host` (PG-3e's old-home rows: a home that moves opens a
  /// new client, so a desktop's asks are its connections' together).
  func subscribes(to host: String) async -> Int {
    var total = 0
    for (dialed, connection) in connections where dialed == host {
      total += await connection.methods.filter { $0 == "agent.subscribe" }.count
    }
    return total
  }

  /// The params of every `method` request across every connection this door served, in connection order.
  func requests(_ method: String) async -> [JSONValue] {
    var sent: [JSONValue] = []
    for (_, connection) in connections {
      sent += await connection.requests.filter { $0.method == method }.map(\.params)
    }
    return sent
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

// The contracts' own bytes, in this bundle: `MeshFixture` (MeshFixture.swift, its own file since PG-3e, so the host
// inner loop's scratch target can read the body golden without this harness, which builds on iOS alone).
