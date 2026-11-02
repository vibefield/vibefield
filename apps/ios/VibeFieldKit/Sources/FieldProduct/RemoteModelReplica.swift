import Foundation

// PG-3d — the phone's REPLICA of the home's model (`createMonitorReplica`, puppeteer-monitor 0.3.2
// `dist/replica/replica.js`), on the remote cut: the backend's rows held at one revision chain, published a frame at a
// time — an equal row is no change, the order is the contract's, a change off the chain is a gap held for the
// snapshot that heals it. A value with no clock, no scheduler and no listener: `flush()` IS the frame, and the caller
// decides when it runs (`RemoteMeshCopy.publish`).
//
// What the window's replica does that this one does not, because the phone has nothing to join: a theme's colours
// (the phone's colour is ProjectLedger's), panes, attachments, the active pane, spawn hints, a terminal's window-joined
// activity and visual ids. So a published row is the backend's row with the reader's one fact (`isSelf`), and the
// window's `hidden` map (a re-shown row keeps its view OBJECT) is not needed: equality does that work.

/// One row of the model as the phone's replica holds it: the backend's `MonitorAgentRow`, as the remote cut carried
/// it, with the reader's one fact joined — whether the row lives on the home (`modelRowFrom`, `model-board.ts`).
///
/// Equality is the synthesized `==`, where the window asks `sameJson`. Three divergences, each of which costs at
/// most one `updated` more or less on a wire that carries such a row, and none of which changes what is drawn
/// (VF-PM, Q-D3 (a)):
/// - `unknownFields` keeps a key's NAME, not its value: a change in an unknown value is not seen here;
/// - `writable` is compared as it came (`writable?`), where the window fills it from `attachable` before comparing;
/// - an unrecognized `device.os` is kept (`.unrecognized`), where the window drops it before comparing.
public struct RemoteModelRow: Sendable, Equatable, Identifiable {
  public let monitor: MonitorAgentRow
  /// The row lives on the home: its OWNER's device is the answering desktop (`device.self`, `model-board.ts:121`).
  public let isSelf: Bool

  public init(_ monitor: MonitorAgentRow, here: String?) {
    self.monitor = monitor
    isSelf = monitor.device.id == here
  }

  /// The model id: stable across a terminal's promotion and a run's resume. Not the board key.
  public var id: String { monitor.id }
  /// M41 — the write policy, filled from `attachable` for an older peer, as the window's fold fills it.
  public var isWritable: Bool { monitor.isWritable }
  /// The SDK's OS mark: kept only when it is one of the SDK's words (`sdkOsMark`).
  public var os: MonitorDeviceOS? {
    if case .unrecognized = monitor.device.os { return nil }
    return monitor.device.os
  }
}

/// The contract's order, every snapshot's (`compareMonitorRows`, puppeteer-view-sdk `model.js`): agents before
/// terminals, then by birth, then by id. The id tie-break compares UTF-16 code units, as JavaScript's `<` does —
/// Swift's `String <` compares by Unicode scalars, which differs above the Basic Multilingual Plane.
public func compareMonitorRows(_ left: RemoteModelRow, _ right: RemoteModelRow) -> Bool {
  false  // PG-3d (red): the skeleton orders nothing
}

/// One step of the fold's chain (`MonitorModelChange`): applies on top of `since`.
public struct RemoteModelChange: Sendable, Equatable {
  public let since: Int64
  public let revision: Int64
  public let upserts: [RemoteModelRow]
  /// Model ids.
  public let removed: [String]

  public init(since: Int64, revision: Int64, upserts: [RemoteModelRow], removed: [String]) {
    self.since = since
    self.revision = revision
    self.upserts = upserts
    self.removed = removed
  }
}

/// What the fold hands the replica: the whole model at a revision, or one change on its chain.
public enum RemoteModelUpdate: Sendable, Equatable {
  case snapshot(revision: Int64, rows: [RemoteModelRow])
  case change(RemoteModelChange)

  public var revision: Int64 {
    switch self {
    case .snapshot(let revision, _): revision
    case .change(let change): change.revision
    }
  }
}

/// The model as published: its revision, every shown row in the contract's order, and the same rows by id.
public struct RemoteModel: Sendable, Equatable {
  public let revision: Int64
  public let agents: [RemoteModelRow]
  public let byId: [String: RemoteModelRow]

  public static let empty = RemoteModel(revision: 0, agents: [])

  init(revision: Int64, agents: [RemoteModelRow]) {
    self.revision = revision
    self.agents = agents
    byId = Dictionary(agents.map { ($0.id, $0) }) { first, _ in first }
  }
}

/// One frame's publication, by model id: `added` and `updated` in the new order, `removed` in the old.
public struct RemotePublication: Sendable, Equatable {
  public let added: [String]
  public let updated: [String]
  public let removed: [String]

  public init(added: [String], updated: [String], removed: [String]) {
    self.added = added
    self.updated = updated
    self.removed = removed
  }
}

/// The phone's visibility, the window's rule (`useMonitorAgents`, Q06; `phoneVisible`): a row is shown while it is
/// alive, or while it is a crashed agent's failure that the home holds a terminal join for — its pane, the one thing a
/// failure can be seen in (`keepsFailure` over `boardJoins(...).sessionByRow`, `failed-bodies.ts`). Data, never a
/// closure, so the replica stays a value and a re-join is an equality.
///
/// The replica's DEFAULT is this rule with no joins: alive rows only. The TS replica's default shows every row (no
/// predicate set); the window hands its rule before the first frame, so the phone's default is where the window
/// always is.
public struct RemoteVisibility: Sendable, Equatable {
  /// The floor session each of the HOME's rows stands for, by model id (`BoardJoins.sessionByRow`).
  public let sessionByRow: [String: String]

  public init(sessionByRow: [String: String] = [:]) {
    self.sessionByRow = sessionByRow
  }

  public func shows(_ row: RemoteModelRow) -> Bool {
    false  // PG-3d (red): the skeleton shows nothing
  }
}

public struct RemoteModelReplica: Sendable {
  /// The changes a gap holds by default (`DEFAULT_GAP_BUFFER`).
  public static let defaultGapBuffer = 256

  public let gapBuffer: Int
  /// The model as last published.
  public private(set) var model = RemoteModel.empty
  /// How many times the chain has broken.
  public private(set) var gapsHeard = 0
  /// The visibility the replica publishes under.
  public private(set) var visibility = RemoteVisibility()

  public init(gapBuffer: Int = Self.defaultGapBuffer) {
    self.gapBuffer = max(0, gapBuffer)
  }

  /// PG-3d (red): the skeleton takes every update and holds nothing.
  @discardableResult
  public mutating func apply(_ update: RemoteModelUpdate) -> Bool { true }

  /// PG-3d (red): the skeleton's visibility never moves.
  @discardableResult
  public mutating func setVisibility(_ next: RemoteVisibility) -> Bool { false }

  /// PG-3d (red): the skeleton publishes nothing.
  public mutating func flush() -> RemotePublication? { nil }
}
