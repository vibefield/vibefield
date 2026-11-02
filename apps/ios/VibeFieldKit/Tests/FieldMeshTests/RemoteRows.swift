import Foundation
import Testing

@testable import FieldProduct

// PG-3e — the remote cut's rows for FieldMeshTests, built from PG-3a's witness in THIS bundle (the v2 check's S8: 3d's
// `Witness`/`edited` live in FieldProductTests, and a test target cannot import another). A drawn row is either the
// copy's own (`drawn`, the witness through `RemoteMeshCopy` as FieldLink drives it) or one built by hand from an edited
// witness row (`fieldRow`), through `@testable import FieldProduct` for 3d's memberwise `RemoteFieldRow`.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum RemoteRows {
  static let now = "2026-11-01T00:00:00.000Z"
  static let home = "dev-01HQ9S7UD1"
  static let loft = "dev-01HQ9S7XZ2"
  static let attic = "dev-01HQ9S7Y44"
  static let homeEpoch = "fieldd-9b04c1e27a6d5f30.13"
  static let loftEpoch = "fieldd-5d2c8f1a0b7e4c93.4"
  static let loftReattached = "fieldd-5d2c8f1a0b7e4c93.5"
  /// The witness open's board revision on each live desktop.
  static let homeRevision: Int64 = 80

  static func openJSON() throws -> JSONValue { try MeshFixture.json("agent-remote-mesh-open.witness") }
  static func open() throws -> AgentRemoteMeshOpen { try AgentRemoteMeshOpen(json: try openJSON()) }
  static func frames() throws -> [AgentRemoteMeshFrame] {
    let list = try MeshFixture.json("agent-remote-mesh-frames.witness").arrayValue ?? []
    return try list.map(AgentRemoteMeshFrame.init(json:))
  }
  static func resync() throws -> AgentRemoteMeshOpen {
    try AgentRemoteMeshOpen(json: try MeshFixture.json("agent-remote-mesh-open.resync"))
  }

  /// A row of the witness open, by its board key, on whichever desktop holds it.
  static func row(_ key: String) throws -> JSONValue {
    let devices = try openJSON()["devices"]?.arrayValue ?? []
    let rows = devices.flatMap { $0["snapshot"]?["rows"]?.arrayValue ?? [] }
    let found = rows.first { $0["runtimeRunId"]?.stringValue == key }
    return try #require(found, "no witness row \(key)")
  }

  /// `json` with the value at the key path set — or, for nil, removed. A missing object on the way is made.
  static func edited(_ json: JSONValue, _ path: [String], _ value: JSONValue?) -> JSONValue {
    guard let key = path.first else { return value ?? .null }
    guard case .object(var fields) = json else {
      Issue.record("the path \(path) does not fit")
      return json
    }
    if path.count == 1, value == nil {
      fields.removeValue(forKey: key)
    } else {
      fields[key] = edited(fields[key] ?? .object([:]), Array(path.dropFirst()), value)
    }
    return .object(fields)
  }

  /// `json`'s `monitorRow` with the value at the key path set (or removed).
  static func monitor(_ json: JSONValue, _ path: [String], _ value: JSONValue?) -> JSONValue {
    edited(json, ["monitorRow"] + path, value)
  }

  /// `row` under another key, and (each when given) another model id, owner and birth.
  static func moved(
    _ row: JSONValue, key: String, id: String? = nil, device: String? = nil, createdAt: Int64? = nil
  ) -> JSONValue {
    var json = edited(row, ["runtimeRunId"], .string(key))
    if let id { json = monitor(json, ["id"], .string(id)) }
    if let device {
      json = edited(json, ["device"], .string(device))
      json = monitor(json, ["device", "id"], .string(device))
    }
    if let createdAt { json = monitor(json, ["createdAt"], .int(createdAt)) }
    return json
  }

  /// A drawn row built by hand from a board row's JSON, as the window would draw it on the home `here`: a home row's
  /// `stale` is its owner's, a peer's its standing (live unless said).
  static func fieldRow(
    _ json: JSONValue, here: String = home, standingLive: Bool = true, visualId: String? = nil
  ) throws -> RemoteFieldRow {
    let board = try AgentRemoteRow(json: json)
    let row = RemoteModelRow(board.monitorRow, here: here)
    let stale = row.isSelf ? row.monitor.stale : !standingLive
    return RemoteFieldRow(row: row, board: board, stale: stale, visualId: visualId ?? row.id)
  }

  static func delta(
    _ device: String, epoch: String, since: Int64, revision: Int64, upserts: [JSONValue] = [], removed: [String] = []
  ) throws -> AgentRemoteMeshFrame {
    try AgentRemoteMeshFrame(json: deltaJSON(device, epoch: epoch, since: since, revision: revision, upserts: upserts,
      removed: removed))
  }

  static func deltaJSON(
    _ device: String, epoch: String, since: Int64, revision: Int64, upserts: [JSONValue] = [], removed: [String] = []
  ) -> JSONValue {
    .object([
      "device": .string(device),
      "delta": .object([
        "epoch": .string(epoch), "since": .int(since), "revision": .int(revision), "upserts": .array(upserts),
        "removed": .array(removed.map(JSONValue.string)),
      ]),
    ])
  }

  /// The witness open's drawn rows, through the copy as FieldLink drives it.
  static func drawn() throws -> [RemoteFieldRow] {
    var copy = RemoteMeshCopy()
    copy.open(try open(), now: now)
    _ = copy.publish()
    return copy.drawn()
  }

  /// 3d's V1: a launched agent `run-h-launch` takes over the home shell `pty-h2`'s body while the shell's row is still
  /// here — model id `run-h-launch`, key `run-h-launch-key`, visual id `pty-h2`, three ids that differ.
  static func launchJSON() throws -> JSONValue {
    var launch = moved(try row("run-h-turn"), key: "run-h-launch-key", id: "run-h-launch", createdAt: 1_790_800_700_000)
    launch = edited(launch, ["terminal", "runtimeSessionId"], .string("pty-h2"))
    return launch
  }

  static func handOff() throws -> [RemoteFieldRow] {
    var copy = RemoteMeshCopy()
    copy.open(try open(), now: now)
    _ = copy.publish()
    let frame = try delta(home, epoch: homeEpoch, since: homeRevision, revision: homeRevision + 1,
      upserts: [try launchJSON()])
    _ = copy.frame(frame, now: now)
    _ = copy.publish()
    return copy.drawn()
  }
}
