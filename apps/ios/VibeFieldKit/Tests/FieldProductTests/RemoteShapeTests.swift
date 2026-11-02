import Foundation
import Testing

@testable import FieldProduct

// PG-3c — the remote cut, read on the phone. `agent-remote-*.json` and `monitor-agent-row.valid.json` under
// `Fixtures/` are the contracts' own goldens, and the three `*.witness`/`*.resync` files are PG-3a's, which the
// home's window and the kit's fold (3d) are both held to — byte for byte, in the named set "remote"
// (`pnpm check:ios-fixtures`).
//
// No golden carries an unknown key, a refused row, `incompatible`, `branch: null` or a row without `writable`, so
// those cases are an EDIT of a golden's JSON (`edited`). Every refusal row first reads its unedited baseline: a
// reader that refused everything would otherwise pass every refusal row.

// MARK: - Editing a golden

/// One step of a path into a golden: an object key, an array index, or the row of an array keyed by `runtimeRunId`.
enum Step: Sendable, Equatable, CustomStringConvertible {
  case key(String)
  case index(Int)
  case row(String)

  var description: String {
    switch self {
    case .key(let key): ".\(key)"
    case .index(let index): "[\(index)]"
    case .row(let key): "[\(key)]"
    }
  }
}

/// The JSON at `path`, or nil.
func at(_ json: JSONValue, _ path: [Step]) -> JSONValue? {
  var here = json
  for step in path {
    switch (step, here) {
    case (.key(let key), .object(let fields)):
      guard let next = fields[key] else { return nil }
      here = next
    case (.index(let index), .array(let items)) where items.indices.contains(index):
      here = items[index]
    case (.row(let key), .array(let items)):
      guard let next = items.first(where: { $0["runtimeRunId"]?.stringValue == key }) else { return nil }
      here = next
    default:
      return nil
    }
  }
  return here
}

/// `json` with the value at `path` set — or, for nil, removed. A missing object on the way is made.
func edited(_ json: JSONValue, _ path: [Step], _ value: JSONValue?) -> JSONValue {
  guard let step = path.first else { return value ?? .null }
  let rest = Array(path.dropFirst())
  switch (step, json) {
  case (.key(let key), .object(var fields)):
    if rest.isEmpty, value == nil {
      fields.removeValue(forKey: key)
    } else {
      fields[key] = edited(fields[key] ?? .object([:]), rest, value)
    }
    return .object(fields)
  case (.index(let index), .array(let items)):
    return .array(replacing(items, items.indices.contains(index) ? index : nil, step, rest, value))
  case (.row(let key), .array(let items)):
    let index = items.firstIndex { $0["runtimeRunId"]?.stringValue == key }
    return .array(replacing(items, index, step, rest, value))
  default:
    Issue.record("the path \(path) does not fit the golden")
    return json
  }
}

private func replacing(
  _ items: [JSONValue], _ index: Int?, _ step: Step, _ rest: [Step], _ value: JSONValue?
) -> [JSONValue] {
  guard let index else {
    Issue.record("no \(step) in the golden")
    return items
  }
  var items = items
  if rest.isEmpty, value == nil {
    items.remove(at: index)
  } else {
    items[index] = edited(items[index], rest, value)
  }
  return items
}

enum Remote {
  static let home = "dev-01HQ9S7UD1"
  static let loft = "dev-01HQ9S7XZ2"
  static let air = "dev-01HQ9S7Y44"
  /// The home's rows in the witness open.
  static let homeRows: [Step] = [.key("devices"), .index(0), .key("snapshot"), .key("rows")]

  static func witnessOpen() throws -> JSONValue { try Fixture.json("agent-remote-mesh-open.witness") }

  /// `run-h-turn`, the witness's idle agent: every part of a model row but a wait.
  static func turnRow() throws -> JSONValue {
    try #require(at(try witnessOpen(), homeRows + [.row("run-h-turn")]))
  }

  static func frames(_ name: String) throws -> [JSONValue] {
    try #require(try Fixture.json(name).arrayValue)
  }

  /// Every `unknownFields` under a row, by where it was found.
  static func unknowns(_ row: AgentRemoteRow) -> [String: [String]] {
    let monitor = row.monitorRow
    let levels: [(String, [String]?)] = [
      ("row", row.unknownFields), ("terminal", row.terminal?.unknownFields), ("stop", row.stop?.unknownFields),
      ("monitorRow", monitor.unknownFields), ("activity", monitor.activity?.unknownFields),
      ("project", monitor.project.unknownFields), ("provider", monitor.provider?.unknownFields),
      ("effort", monitor.effort?.unknownFields), ("context", monitor.context?.unknownFields),
      ("wait", monitor.wait?.unknownFields), ("reply", monitor.reply?.unknownFields),
      ("cost", monitor.cost?.unknownFields), ("series", monitor.cost?.series?.unknownFields),
      ("tokens", monitor.tokens?.unknownFields), ("device", monitor.device.unknownFields),
    ]
    var found: [String: [String]] = [:]
    for (level, fields) in levels { if let fields, !fields.isEmpty { found["\(row.runtimeRunId).\(level)"] = fields } }
    return found
  }

  static func unknowns(_ snapshot: AgentRemoteMeshSnapshot) -> [String: [String]] {
    var found = snapshot.unknownFields.isEmpty ? [:] : ["snapshot": snapshot.unknownFields]
    for row in snapshot.rows { found.merge(unknowns(row)) { $1 } }
    return found
  }

  static func unknowns(_ open: AgentRemoteMeshOpen) -> [String: [String]] {
    var found = open.unknownFields.isEmpty ? [:] : ["open": open.unknownFields]
    for entry in open.devices {
      if !entry.unknownFields.isEmpty { found[entry.device] = entry.unknownFields }
      if let snapshot = entry.snapshot { found.merge(unknowns(snapshot)) { $1 } }
    }
    return found
  }
}

// MARK: - The goldens, whole

@Suite struct RemoteGoldenTests {
  static let goldens = [
    "agent-remote-row.valid", "agent-remote-row.terminal", "agent-remote-mesh-open.valid",
    "agent-remote-mesh-frames.valid", "agent-remote-mesh-open.witness", "agent-remote-mesh-frames.witness",
    "agent-remote-mesh-open.resync",
  ]

  /// T1r (PG-3e) — 3b's routed report is in this bundle, beside the encoder that is held to it: the shown row's
  /// MODEL id, routed by the desktop that owns it. Read as JSON: the golden is matched by value (it is pretty-printed).
  @Test func theRoutedReportIsInThisBundle() throws {
    let json = try Fixture.json("agent-report-shown.routed")
    let ids = json["ids"]?.arrayValue?.compactMap { $0.stringValue } ?? []
    #expect(ids == ["run-studio-q"])
    #expect(json["device"]?.stringValue == "dev-desktop-b")
    let keys = json.objectValue.map { Set($0.keys) } ?? []
    #expect(keys == ["ids", "device"])
  }

  /// T1 — every remote golden reads whole: no row refused, no key unknown at any level.
  @Test(arguments: goldens) func everyRemoteGoldenDecodes(name: String) throws {
    let json = try Fixture.json(name)
    if name.contains("-row.") {
      #expect(Remote.unknowns(try AgentRemoteRow(json: json)) == [:])
    } else if name.contains("-open.") {
      let open = try AgentRemoteMeshOpen(json: json)
      #expect(!open.devices.isEmpty)
      #expect(open.devices.compactMap(\.snapshot).allSatisfy { $0.refused.isEmpty })
      #expect(Remote.unknowns(open) == [:])
    } else {
      let frames = try #require(json.arrayValue).map(AgentRemoteMeshFrame.init(json:))
      #expect(!frames.isEmpty)
      for frame in frames {
        switch frame {
        case .delta(_, let delta):
          #expect(delta.refused.isEmpty)
          #expect(delta.unknownFields.isEmpty)
          for row in delta.upserts { #expect(Remote.unknowns(row) == [:]) }
        case .snapshot(_, let snapshot):
          #expect(snapshot.refused.isEmpty)
          #expect(Remote.unknowns(snapshot) == [:])
        case .state: break
        }
      }
    }
  }

  /// T2 — the witness open: three desktops, each on its own chain, keys that are not the model's ids.
  @Test func theWitnessOpenReadsEveryDesktopOnItsChain() throws {
    let open = try AgentRemoteMeshOpen(json: try Remote.witnessOpen())
    #expect(open.devices.map(\.device) == [Remote.home, Remote.loft, Remote.air])
    #expect(open.devices.map(\.state) == [.live, .live, .asleep])
    let snapshots = open.devices.compactMap(\.snapshot)
    #expect(snapshots.map { $0.epoch.split(separator: ".").last } == ["13", "4", "2"])
    #expect(snapshots.map(\.rows.count) == [7, 3, 1])
    let rows = snapshots.flatMap(\.rows)
    let byKey = Dictionary(uniqueKeysWithValues: rows.map { ($0.runtimeRunId, $0) })
    #expect(byKey["run-h-crash"]?.monitorRow.id == "pty-h3")
    #expect(byKey["run-h-turn"]?.monitorRow.id == "pty-h1")
    #expect(byKey["run-p-ask"]?.monitorRow.id == "pty-p3")
    #expect(rows.filter(\.isTerminal).map(\.runtimeRunId) == ["pty-h2", "pty-p1"])
    #expect(byKey["pty-h2"]?.monitorRow.kind == .terminal)
    #expect(byKey["run-h-partial"]?.monitorRow.cost?.coverage == .partial)
    #expect(byKey["run-h-quiet"]?.monitorRow.cost?.coverage == .unavailable)
    #expect(byKey["run-a-idle"]?.monitorRow.device.os == .windows)
    #expect(byKey["run-a-idle"]?.device == Remote.air)
  }

  /// T3 — the witness frames, in order, read as written: nothing here judges a chain (the last delta is on the old
  /// `.4` chain — a gap, and the gap is the fold's).
  @Test func theWitnessFramesReadInOrder() throws {
    let frames = try Remote.frames("agent-remote-mesh-frames.witness").map(AgentRemoteMeshFrame.init(json:))
    let arms = frames.map { frame -> String in
      switch frame {
      case .delta: "delta"
      case .snapshot: "snapshot"
      case .state(_, let state, _): "state(\(state.wire))"
      }
    }
    #expect(arms == [
      "delta", "delta", "snapshot", "state(stale)", "snapshot", "state(live)", "delta", "delta", "delta",
    ])
    guard case .delta(let device, let first) = frames[0] else { Issue.record("frame 0 is not a delta"); return }
    #expect(device == Remote.home)
    #expect(first.upserts.map(\.runtimeRunId) == ["run-h-typed"])
    #expect(first.removed == ["pty-h2"])
    guard case .snapshot(_, let reset) = frames[4] else { Issue.record("frame 4 is not a snapshot"); return }
    #expect(reset.epoch.hasSuffix(".5"))
    guard case .delta(let late, let old) = frames[8] else { Issue.record("frame 8 is not a delta"); return }
    #expect(late == Remote.loft)
    #expect(old.epoch.hasSuffix(".4"))
    #expect(old.since == 30)
    #expect(old.revision == 31)
  }

  /// T4 — the resync open replaces every desktop: the peer on its new `.5` chain.
  @Test func theResyncReplacesEveryDesktop() throws {
    let open = try AgentRemoteMeshOpen(json: try Fixture.json("agent-remote-mesh-open.resync"))
    #expect(open.devices.compactMap(\.snapshot).map(\.revision) == [84, 4, 9])
    let loft = try #require(open.devices.first { $0.device == Remote.loft })
    #expect(loft.snapshot?.epoch.hasSuffix(".5") == true)
    #expect(loft.asOf == "2026-09-30T21:20:14.000Z")
  }

  /// T5 — the row goldens, field for field where the cut differs.
  @Test func theRowGoldensReadWhole() throws {
    let agent = try AgentRemoteRow(json: try Fixture.json("agent-remote-row.valid"))
    #expect(agent.runtimeRunId == "run-studio-q")
    #expect(!agent.isTerminal)
    #expect(agent.terminal?.hosted == "local")
    #expect(agent.terminal?.hostedValue == .local)
    #expect(agent.nativeSessionId == "5f0d2c4e-8a1b-4e6f-9c3d-2b7a1e0f4d68")
    #expect(agent.monitorRow.project.seq == nil)
    #expect(agent.monitorRow.project.branch == .named("ds/c"))
    #expect(agent.monitorRow.writable == true)

    let terminal = try AgentRemoteRow(json: try Fixture.json("agent-remote-row.terminal"))
    #expect(terminal.isTerminal)
    #expect(terminal.terminal?.workloadClass == "interactive")
    #expect(terminal.monitorRow.cost == nil)
    #expect(terminal.monitorRow.tier == nil)
    #expect(terminal.monitorRow.project.branch == .notLooked)

    let model = try MonitorAgentRow(json: try Fixture.json("monitor-agent-row.valid"))
    #expect(model.project.seq == 2)
    #expect(model.status == .blocked)
    #expect(model.wait?.kind == "question")
    #expect(model.cost?.coverage == .complete)
    #expect(model.cost?.series?.stepMs == 30000)
    #expect(model.cost?.series?.steps.count == 20)
    #expect(model.device.os == .mac)
    #expect(model.tier == .managed)
    #expect(model.effort?.intent == .observed)
    #expect(model.reply?.final == true)
    #expect(model.unknownFields.isEmpty)

    let frames = try Remote.frames("agent-remote-mesh-frames.valid").map(AgentRemoteMeshFrame.init(json:))
    guard case .delta(_, let delta) = frames[0] else { Issue.record("frame 0 is not a delta"); return }
    let stop = try #require(delta.upserts.first?.stop)
    #expect(stop.stage == "heard")
    #expect(stop.heardBy == "status")
    #expect(stop.sentAt == "2026-09-30T21:14:30.000Z")
  }

  /// T6 — a key a peer added later survives at every level: named, never fatal, nothing refused.
  @Test func anUnknownFieldSurvivesAtEveryLevel() throws {
    let added = "somethingAPeerAddedLater"
    let turn = Remote.homeRows + [.row("run-h-turn")]
    let levels: [[Step]] = [
      [], [.key("devices"), .index(0)], [.key("devices"), .index(0), .key("snapshot")], turn,
      turn + [.key("monitorRow")], turn + [.key("monitorRow"), .key("cost")],
      turn + [.key("monitorRow"), .key("cost"), .key("series")], turn + [.key("monitorRow"), .key("device")],
      turn + [.key("monitorRow"), .key("project")],
    ]
    var json = try Remote.witnessOpen()
    for level in levels { json = edited(json, level + [.key(added)], .bool(true)) }
    let open = try AgentRemoteMeshOpen(json: json)
    let home = try #require(open.devices.first?.snapshot)
    #expect(home.refused.isEmpty)
    #expect(home.rows.count == 7)
    let row = try #require(home.rows.first { $0.runtimeRunId == "run-h-turn" })
    #expect(open.unknownFields == [added])
    #expect(open.devices[0].unknownFields == [added])
    #expect(home.unknownFields == [added])
    #expect(row.unknownFields == [added])
    #expect(row.monitorRow.unknownFields == [added])
    #expect(row.monitorRow.cost?.unknownFields == [added])
    #expect(row.monitorRow.cost?.series?.unknownFields == [added])
    #expect(row.monitorRow.device.unknownFields == [added])
    #expect(row.monitorRow.project.unknownFields == [added])
    #expect(Remote.unknowns(open).count == levels.count)
  }

  /// T7 — an OPEN word this build has never heard is kept as it came, and the row reads; so does a Stop sent at "".
  @Test func anUnknownOpenWordIsKeptNotRefused() throws {
    var json = try Remote.turnRow()
    json = edited(json, [.key("monitorRow"), .key("cost"), .key("coverage")], .string("estimated"))
    json = edited(json, [.key("monitorRow"), .key("device"), .key("os")], .string("haiku"))
    json = edited(
      json, [.key("monitorRow"), .key("wait")],
      .object(["kind": .string("elicitation"), "since": .int(1_790_803_150_000)]))
    json = edited(json, [.key("monitorRow"), .key("activity"), .key("kind")], .string("compacting"))
    json = edited(json, [.key("stop")], .object(["sentAt": .string(""), "stage": .string("draining")]))
    json = edited(json, [.key("monitorRow"), .key("project"), .key("branch")], .null)
    let row = try AgentRemoteRow(json: json)
    #expect(row.monitorRow.cost?.coverage == .unrecognized("estimated"))
    #expect(row.monitorRow.cost?.coverage.wire == "estimated")
    #expect(row.monitorRow.device.os == .unrecognized("haiku"))
    #expect(row.monitorRow.device.os?.wire == "haiku")
    #expect(row.monitorRow.wait?.kind == "elicitation")
    #expect(row.monitorRow.wait?.count == nil)
    #expect(row.monitorRow.activity?.kind == "compacting")
    #expect(row.stop?.stage == "draining")
    #expect(row.stop?.sentAt == "")
    // `null` is the one value `branch` may be: looked, and there is no branch — never an unknown field
    #expect(row.monitorRow.project.branch == .noBranch)
    #expect(Remote.unknowns(row) == [:])
  }

  /// A length bound counts UTF-16 code units, as zod's `.max` does: 128 emoji are 256 units and read; 129 are 258
  /// and refuse, though they are 129 characters.
  @Test func aLengthBoundCountsUTF16Units() throws {
    let row = try Remote.turnRow()
    let fits = String(repeating: "😀", count: 128)
    #expect(try AgentRemoteRow(json: edited(row, [.key("nativeSessionId")], .string(fits))).nativeSessionId == fits)
    let over = String(repeating: "😀", count: 129)
    #expect(over.count <= 256)
    #expect(throws: WireDecodeError.self) {
      try AgentRemoteRow(json: edited(row, [.key("nativeSessionId")], .string(over)))
    }
  }

  /// One edit of `run-h-turn` that the window refuses.
  struct RowEdit: Sendable, CustomTestStringConvertible {
    let name: String
    let path: [Step]
    let value: JSONValue?
    var testDescription: String { name }

    static func monitor(_ name: String, _ path: [Step], _ value: JSONValue?) -> RowEdit {
      RowEdit(name: name, path: [.key("monitorRow")] + path, value: value)
    }
  }

  static let refusals: [RowEdit] = [
    .monitor("status `sleeping`", [.key("status")], .string("sleeping")),
    .monitor("monitorRow.kind `pane`", [.key("kind")], .string("pane")),
    .monitor("tier `borrowed`", [.key("tier")], .string("borrowed")),
    .monitor("effort.intent `guessed`", [.key("effort"), .key("intent")], .string("guessed")),
    RowEdit(name: "terminal.hosted `elsewhere`", path: [.key("terminal"), .key("hosted")], value: .string("elsewhere")),
    RowEdit(name: "root kind `agent`", path: [.key("kind")], value: .string("agent")),
    RowEdit(name: "monitorRow removed", path: [.key("monitorRow")], value: nil),
    .monitor("createdAt 1.5", [.key("createdAt")], .double(1.5)),
    .monitor("model 5", [.key("model")], .int(5)),
    RowEdit(
      name: "nativeSessionId of 257", path: [.key("nativeSessionId")],
      value: .string(String(repeating: "a", count: 257))),
    RowEdit(
      name: "stop.stage \"\"", path: [.key("stop")],
      value: .object(["sentAt": .string("2026-09-30T21:20:00.000Z"), "stage": .string("")])),
    .monitor(
      "wait.count 0", [.key("wait")],
      .object(["kind": .string("permission"), "since": .int(1_790_803_150_000), "count": .int(0)])),
    .monitor("project.seq -1", [.key("project"), .key("seq")], .int(-1)),
    .monitor("device.name \"\"", [.key("device"), .key("name")], .string("")),
    // zod's `.optional()` refuses `null`, where WireObject reads it as absent
    .monitor("model null", [.key("model")], .null),
    .monitor("cost null", [.key("cost")], .null),
    RowEdit(name: "stop null", path: [.key("stop")], value: .null),
    RowEdit(name: "root kind null", path: [.key("kind")], value: .null),
    .monitor("steps hold a word", [.key("cost"), .key("series"), .key("steps"), .index(0)], .string("zero")),
  ]

  /// T8 — each edit refuses the row, named by its key; its unedited baseline reads first.
  @Test(arguments: refusals) func aRowThisBuildCannotReadIsRefusedByKey(edit: RowEdit) throws {
    let row = try Remote.turnRow()
    let baseline = AgentRemoteRow.split([row])
    try #require(baseline.rows.map(\.runtimeRunId) == ["run-h-turn"] && baseline.refused.isEmpty)
    let split = AgentRemoteRow.split([edited(row, edit.path, edit.value)])
    #expect(split.rows.isEmpty)
    #expect(split.refused.map(\.key) == ["run-h-turn"])
  }

  /// T8 — a row with no key, or `""` for one, is refused KEYLESS (Q-C3).
  @Test(arguments: [nil, JSONValue.string("")]) func aRowWithNoKeyIsRefusedKeyless(key: JSONValue?) throws {
    let row = try Remote.turnRow()
    try #require(AgentRemoteRow.split([row]).refused.isEmpty)
    let split = AgentRemoteRow.split([edited(row, [.key("runtimeRunId")], key)])
    #expect(split.rows.isEmpty)
    #expect(split.refused.count == 1)
    #expect(split.refused.first?.key == nil)
  }

  /// T8's counter-row — the window reads a bare terminal with a pane join as `AgentDeskTerminalRow`, which does not
  /// look at `nativeSessionId` or `stop`: such a row is KEPT, the unreadable key named unknown. Without its pane join
  /// it is a remote row only, and refused.
  @Test func aBareTerminalKeepsWhatTheWindowsUnionDoesNotRead() throws {
    let terminal = try #require(at(try Remote.witnessOpen(), Remote.homeRows + [.row("pty-h2")]))
    let baseline = try AgentRemoteRow(json: terminal)
    try #require(baseline.isTerminal && baseline.terminal != nil)

    let blankId = try AgentRemoteRow(json: edited(terminal, [.key("nativeSessionId")], .string("")))
    #expect(blankId.nativeSessionId == nil)
    #expect(blankId.unknownFields == ["nativeSessionId"])
    let badStop = try AgentRemoteRow(json: edited(terminal, [.key("stop")], .object(["stage": .string("")])))
    #expect(badStop.stop == nil)
    #expect(badStop.unknownFields == ["stop"])
    let goodStop = try AgentRemoteRow(
      json: edited(terminal, [.key("stop")], .object(["sentAt": .string(""), "stage": .string("sent")])))
    #expect(goodStop.stop?.stage == "sent")
    #expect(goodStop.unknownFields.isEmpty)

    let paneless = edited(edited(terminal, [.key("terminal")], nil), [.key("nativeSessionId")], .string(""))
    #expect(AgentRemoteRow.split([paneless]).refused.map(\.key) == ["pty-h2"])
  }

  /// T9 — a refused row costs only itself: its desktop keeps every other row, and the others are untouched.
  @Test func aRefusedRowCostsOnlyItself() throws {
    let witness = try Remote.witnessOpen()
    try #require(try AgentRemoteMeshOpen(json: witness).devices.first?.snapshot?.rows.count == 7)
    let json = edited(
      witness, Remote.homeRows + [.row("run-h-turn"), .key("monitorRow"), .key("status")], .string("sleeping"))
    let open = try AgentRemoteMeshOpen(json: json)
    let home = try #require(open.devices[0].snapshot)
    #expect(home.rows.count == 6)
    #expect(!home.rows.contains { $0.runtimeRunId == "run-h-turn" })
    #expect(home.refused.map(\.key) == ["run-h-turn"])
    #expect(open.devices[1].snapshot?.rows.count == 3)
    #expect(open.devices[2].snapshot?.rows.count == 1)
    #expect(open.devices.dropFirst().allSatisfy { $0.snapshot?.refused.isEmpty == true })
    #expect(open.devices.map(\.state) == [.live, .live, .asleep])
  }

  /// T10 — the device `asOf` is the wire's ISO, kept as written.
  @Test func theDeviceAsOfIsTheWiresISO() throws {
    let open = try AgentRemoteMeshOpen(json: try Fixture.json("agent-remote-mesh-open.valid"))
    #expect(open.devices.map(\.asOf) == [
      "2026-09-30T21:14:02.000Z", "2026-09-30T21:15:41.000Z", "2026-09-29T07:02:10.000Z",
    ])
    let frames = try Remote.frames("agent-remote-mesh-frames.valid").map(AgentRemoteMeshFrame.init(json:))
    #expect(frames[2] == .state(device: Remote.loft, .stale, asOf: "2026-09-30T21:16:03.000Z"))
  }

  /// One edit of a valid golden's ENVELOPE, which throws the whole envelope (as zod does).
  struct EnvelopeEdit: Sendable, CustomTestStringConvertible {
    enum Target: Sendable { case open, frame(Int) }
    let name: String
    let target: Target
    let path: [Step]
    let value: JSONValue?
    var testDescription: String { name }
  }

  static let envelopeFaults: [EnvelopeEdit] = [
    EnvelopeEdit(name: "a state arm with no asOf", target: .frame(2), path: [.key("asOf")], value: nil),
    EnvelopeEdit(name: "a state arm with asOf \"\"", target: .frame(2), path: [.key("asOf")], value: .string("")),
    EnvelopeEdit(
      name: "a device entry with no asOf", target: .open, path: [.key("devices"), .index(1), .key("asOf")], value: nil),
    EnvelopeEdit(
      name: "a malformed device entry", target: .open, path: [.key("devices"), .index(2), .key("device")],
      value: .int(7)),
    EnvelopeEdit(
      name: "a snapshot with no epoch", target: .frame(1), path: [.key("snapshot"), .key("epoch")], value: nil),
    EnvelopeEdit(
      name: "an epoch of 129", target: .frame(1), path: [.key("snapshot"), .key("epoch")],
      value: .string(String(repeating: "e", count: 129))),
    EnvelopeEdit(
      name: "revision -1", target: .frame(1), path: [.key("snapshot"), .key("revision")], value: .int(-1)),
    EnvelopeEdit(
      name: "a delta's since -1", target: .frame(0), path: [.key("delta"), .key("since")], value: .int(-1)),
    EnvelopeEdit(
      name: "removed [\"\"]", target: .frame(0), path: [.key("delta"), .key("removed")], value: .array([.string("")])),
    EnvelopeEdit(
      name: "an open's snapshot null", target: .open, path: [.key("devices"), .index(0), .key("snapshot")],
      value: .null),
  ]

  /// T10 — each envelope fault throws; its unedited baseline reads first.
  @Test(arguments: envelopeFaults) func anEnvelopeFaultThrowsTheEnvelope(edit: EnvelopeEdit) throws {
    switch edit.target {
    case .open:
      let open = try Fixture.json("agent-remote-mesh-open.valid")
      _ = try AgentRemoteMeshOpen(json: open)
      #expect(throws: WireDecodeError.self) { try AgentRemoteMeshOpen(json: edited(open, edit.path, edit.value)) }
    case .frame(let index):
      let frame = try Remote.frames("agent-remote-mesh-frames.valid")[index]
      _ = try AgentRemoteMeshFrame(json: frame)
      #expect(throws: WireDecodeError.self) { try AgentRemoteMeshFrame(json: edited(frame, edit.path, edit.value)) }
    }
  }

  /// T10 — an unknown device STATE is kept, not refused (Q-C2: the phone is more tolerant than the window here).
  @Test func anUnknownDeviceStateIsKept() throws {
    let open = try Fixture.json("agent-remote-mesh-open.valid")
    let read = try AgentRemoteMeshOpen(
      json: edited(open, [.key("devices"), .index(2), .key("state")], .string("hibernating")))
    #expect(read.devices[2].state == .unrecognized("hibernating"))
  }

  /// T10w — `writable` absent: the reader fills it from `attachable`, the rule an older peer applied.
  @Test func writableFillsFromAttachable() throws {
    let row = edited(try Remote.turnRow(), [.key("monitorRow"), .key("writable")], nil)
    let read = try AgentRemoteRow(json: row)
    #expect(read.monitorRow.writable == nil)
    #expect(read.monitorRow.isWritable == read.monitorRow.attachable)
    #expect(read.monitorRow.isWritable)
    let shut = try AgentRemoteRow(json: edited(row, [.key("monitorRow"), .key("attachable")], .bool(false)))
    #expect(!shut.monitorRow.isWritable)
  }
}

// MARK: - The per-row tolerance rule

/// T9b — PG-1b's screen on the phone (`board-screen.ts`): a refused row is dropped and its desktop reads
/// `incompatible` while it holds one; the envelope stays whole; the wire's own word comes back after.
@Suite struct RemoteBoardScreenTests {
  static let now = "2026-11-01T00:00:00.000Z"

  static func open(_ json: JSONValue) throws -> AgentRemoteMeshOpen { try AgentRemoteMeshOpen(json: json) }

  static func frame(_ json: JSONValue) throws -> AgentRemoteMeshFrame { try AgentRemoteMeshFrame(json: json) }

  static func witnessFrame(_ index: Int) throws -> JSONValue {
    try Remote.frames("agent-remote-mesh-frames.witness")[index]
  }

  /// The witness open with one row of `device` (0 home, 1 loft) made unreadable by `edit`.
  static func openRefusing(_ device: Int, _ key: String, _ path: [Step], _ value: JSONValue?) throws -> JSONValue {
    let rows: [Step] = [.key("devices"), .index(device), .key("snapshot"), .key("rows"), .row(key)]
    return edited(try Remote.witnessOpen(), rows + path, value)
  }

  static let sleeping: ([Step], JSONValue?) = ([.key("monitorRow"), .key("status")], .string("sleeping"))

  /// (a) an open with a refused row: that desktop is `incompatible` now, with its readable rows; the rest as on the wire.
  @Test func anOpenWithARefusedRowGreysOnlyItsDesktop() throws {
    let wire = try Self.open(try Self.openRefusing(0, "run-h-turn", Self.sleeping.0, Self.sleeping.1))
    try #require(wire.devices[0].snapshot?.refused.count == 1)
    var screen = RemoteBoardScreen()
    let screened = screen.open(wire, now: Self.now)
    #expect(screened.devices[0].state == .incompatible)
    #expect(screened.devices[0].asOf == Self.now)
    #expect(screened.devices[0].snapshot?.rows.count == 6)
    #expect(screened.devices[0].snapshot?.refused.isEmpty == true)
    #expect(screened.devices[0].snapshot?.epoch == wire.devices[0].snapshot?.epoch)
    #expect(Array(screened.devices.dropFirst()) == Array(wire.devices.dropFirst()))
    #expect(screen.holds(Remote.home))
    #expect(!screen.holds(Remote.loft))
  }

  /// (b) the held row comes back readable: the delta as it came, then the wire's last word for the desktop.
  @Test func aReadableUpsertReleasesTheDesktopToTheWiresWord() throws {
    var screen = RemoteBoardScreen()
    _ = screen.open(
      try Self.open(try Self.openRefusing(0, "run-h-turn", Self.sleeping.0, Self.sleeping.1)), now: Self.now)
    try #require(screen.holds(Remote.home))
    let upsert = edited(try Self.witnessFrame(0), [.key("delta"), .key("upserts")], .array([try Remote.turnRow()]))
    let delta = try Self.frame(upsert)
    #expect(screen.frame(delta, now: Self.now) == [
      delta, .state(device: Remote.home, .live, asOf: "2026-09-30T21:20:00.000Z"),
    ])
    #expect(!screen.holds(Remote.home))
  }

  /// (c) a held READABLE key arrives refused: it leaves the fold (`removed`), and the desktop greys now.
  @Test func aRefusedUpsertOfAKnownRowRemovesItAndGreys() throws {
    var screen = RemoteBoardScreen()
    _ = screen.open(try Self.open(try Remote.witnessOpen()), now: Self.now)
    try #require(!screen.holds(Remote.home))
    let refusedTurn = edited(try Remote.turnRow(), Self.sleeping.0, Self.sleeping.1)
    let wire = try Self.witnessFrame(0)
    let typed = try #require(at(wire, [.key("delta"), .key("upserts"), .index(0)]))
    let json = edited(wire, [.key("delta"), .key("upserts")], .array([typed, refusedTurn]))
    let out = screen.frame(try Self.frame(json), now: Self.now)
    try #require(out.count == 2)
    guard case .delta(let device, let delta) = out[0] else { Issue.record("not a delta: \(out[0])"); return }
    #expect(device == Remote.home)
    #expect(delta.upserts.map(\.runtimeRunId) == ["run-h-typed"])
    #expect(delta.refused.isEmpty)
    #expect(delta.removed == ["pty-h2", "run-h-turn"])
    #expect((delta.since, delta.revision) == (80, 81))
    #expect(out[1] == .state(device: Remote.home, .incompatible, asOf: Self.now))
    #expect(screen.holds(Remote.home))
  }

  /// (d) a state arm while the desktop holds reads `incompatible` at the WIRE's asOf; the word is kept, and a clean
  /// reset gives it back.
  @Test func aStateWordWhileHeldReadsIncompatibleAndIsKept() throws {
    var screen = RemoteBoardScreen()
    _ = screen.open(
      try Self.open(try Self.openRefusing(1, "run-p-ask", Self.sleeping.0, Self.sleeping.1)), now: Self.now)
    try #require(screen.holds(Remote.loft))
    let stale = try Self.frame(try Self.witnessFrame(3))
    try #require(stale == .state(device: Remote.loft, .stale, asOf: "2026-09-30T21:20:09.000Z"))
    #expect(screen.frame(stale, now: Self.now) == [
      .state(device: Remote.loft, .incompatible, asOf: "2026-09-30T21:20:09.000Z"),
    ])
    let reset = try Self.frame(try Self.witnessFrame(4))
    #expect(screen.frame(reset, now: Self.now) == [
      reset, .state(device: Remote.loft, .stale, asOf: "2026-09-30T21:20:09.000Z"),
    ])
    #expect(!screen.holds(Remote.loft))
  }

  /// (e) a keyless refused row holds its desktop until the next snapshot, and its stand-in key is never a removal.
  @Test func aKeylessRefusedRowHoldsUntilTheNextSnapshot() throws {
    var screen = RemoteBoardScreen()
    _ = screen.open(try Self.open(try Self.openRefusing(0, "run-h-quiet", [.key("runtimeRunId")], nil)), now: Self.now)
    #expect(screen.holds(Remote.home))
    // a readable delta does not release a row with no key
    let readable = try Self.frame(try Self.witnessFrame(1))
    #expect(screen.frame(readable, now: Self.now) == [readable])
    #expect(screen.holds(Remote.home))
    // another keyless refusal: nothing is removed for it
    let keyless = edited(edited(try Remote.turnRow(), [.key("runtimeRunId")], nil), Self.sleeping.0, Self.sleeping.1)
    let json = edited(try Self.witnessFrame(1), [.key("delta"), .key("upserts")], .array([keyless]))
    let out = screen.frame(try Self.frame(json), now: Self.now)
    guard case .delta(_, let delta) = out.first else { Issue.record("not a delta"); return }
    #expect(delta.removed.isEmpty)
    #expect(!delta.removed.contains(RemoteBoardScreen.noKey))
    #expect(out.count == 1)
    // the desktop's reset clears it, and the wire's word comes back
    let home = try #require(at(try Remote.witnessOpen(), [.key("devices"), .index(0), .key("snapshot")]))
    let reset = try Self.frame(.object(["device": .string(Remote.home), "snapshot": home]))
    #expect(screen.frame(reset, now: Self.now) == [
      reset, .state(device: Remote.home, .live, asOf: "2026-09-30T21:20:00.000Z"),
    ])
    #expect(!screen.holds(Remote.home))
  }
}

// PG-3f — the phone's report, held to 3b's routed golden.
@Suite struct AgentReportShownTests {
  /// E1 — the shown row's MODEL id, routed by the desktop that owns it, encodes as the contracts' golden, by value.
  @Test func theRoutedReportEncodesAsTheGolden() throws {
    let golden = try Fixture.json("agent-report-shown.routed")
    let encoded = AgentReportShownParams(ids: ["run-studio-q"], device: "dev-desktop-b").json
    #expect(encoded == golden)
    // an empty list clears the report: the same shape, no ids
    let cleared = AgentReportShownParams(ids: [], device: "dev-desktop-b").json
    #expect(cleared == .object(["ids": .array([]), "device": .string("dev-desktop-b")]))
    #expect(AgentReportShownParams.method == "agent.reportShown")
  }
}
