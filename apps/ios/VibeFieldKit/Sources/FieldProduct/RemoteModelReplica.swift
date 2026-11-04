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
/// Equality is the synthesized `==`, where the window asks `sameJson`. Four divergences (VF-PM, Q-D3 (a); the fourth
/// the review's [0]):
/// - `unknownFields` keeps a key's NAME, not its value: a change in an unknown value is not seen here;
/// - `writable` is compared as it came (`writable?`), where the window fills it from `attachable` before comparing;
/// - an unrecognized `device.os` is kept (`.unrecognized`), where the window drops it before comparing;
/// - Swift's `String ==` and its hashing use canonical equivalence, where JavaScript's `===` and `Map` compare UTF-16
///   code units: text that differs only in its normalization (NFC against NFD) is one value here. In a row's text
///   that costs at most one missing `updated`, with the same glyphs drawn; in an id it would fold two rows into one,
///   which is latent, since every id is a generated ASCII run or session id.
/// The first three cost at most one `updated` more or less on a wire that carries such a row; none changes the glyphs
/// drawn.
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
/// Swift's `String <` orders by canonical equivalence, which differs above the Basic Multilingual Plane (a surrogate
/// pair against a high BMP unit) and inside it for text not in NFC, so the code units are compared directly.
public func compareMonitorRows(_ left: RemoteModelRow, _ right: RemoteModelRow) -> Bool {
  let a = left.monitor
  let b = right.monitor
  if a.kind != b.kind { return a.kind == .agent }
  if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
  return Array(a.id.utf16).lexicographicallyPrecedes(Array(b.id.utf16))
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
    let monitor = row.monitor
    if monitor.alive { return true }
    // `isFailedRow`: a crashed agent's row — dead, its wait the runtime's failure
    return monitor.kind == .agent && monitor.wait?.kind == "failure" && sessionByRow[monitor.id] != nil
  }
}

public struct RemoteModelReplica: Sendable {
  /// The changes a gap holds by default (`DEFAULT_GAP_BUFFER`).
  public static let defaultGapBuffer = 256

  public let gapBuffer: Int
  /// The model as last published.
  public private(set) var model = RemoteModel.empty
  /// How many times the chain has broken: once per break, as the window's `onGap` is heard. A snapshot's replay can
  /// break it again while `apply` answers true, so a caller reads this after a snapshot (`RemoteMeshCopy.open`).
  public private(set) var gapsHeard = 0
  /// The visibility the replica publishes under.
  public private(set) var visibility = RemoteVisibility()

  /// The backend's rows at the held revision.
  private var rows: [String: RemoteModelRow] = [:]
  /// The published rows, by id.
  private var joined: [String: RemoteModelRow] = [:]
  /// Rows whose published form may differ from the held one.
  private var dirty: Set<String> = []
  private var revision: Int64?
  private var gapped = false
  /// The changes heard since the chain broke, for the snapshot that heals it; dropped whole past `gapBuffer`.
  private var held: [RemoteModelChange] = []
  private var overflowed = false

  /// `gapBuffer`: how many changes a gap holds for its snapshot, zero or more — a negative bound traps, as
  /// `createMonitorReplica` throws a RangeError for one (the review's [1]).
  public init(gapBuffer: Int = Self.defaultGapBuffer) {
    precondition(gapBuffer >= 0, "gapBuffer must be zero or more")
    self.gapBuffer = gapBuffer
  }

  /// A snapshot replaces the rows and heals a gap, replaying what the gap held that it does not; a change on the
  /// chain applies. False: a change the replica cannot follow (off the chain, or while the chain is broken), held.
  @discardableResult
  public mutating func apply(_ update: RemoteModelUpdate) -> Bool {
    switch update {
    case .snapshot(let revision, let rows):
      self.revision = revision
      gapped = false
      var present: Set<String> = []
      for row in rows {
        present.insert(row.id)
        take(row)
      }
      for id in self.rows.keys where !present.contains(id) {
        self.rows.removeValue(forKey: id)
        dirty.insert(id)
      }
      // the changes heard during the gap that the snapshot does not hold, in order; a link missing among them is a
      // new gap, and what follows it is held for the next snapshot
      let replay = held.filter { $0.since >= revision }
      held = []
      overflowed = false
      for change in replay { applyChange(change) }
      return true
    case .change(let change):
      return applyChange(change)
    }
  }

  /// A different visibility re-reads every row at the next frame. True when it moved.
  @discardableResult
  public mutating func setVisibility(_ next: RemoteVisibility) -> Bool {
    guard next != visibility else { return false }
    visibility = next
    dirty.formUnion(rows.keys)
    return true
  }

  /// The frame: publishes what moved since the last one, or nil when nothing did (`flush`, `replica.js`). The order
  /// is sorted on every publication (VF-PM, Q-D5 (a)): the window sorts only when a sort key, a birth or a death
  /// moved, and between those its order is already sorted, so the two orders are the same.
  public mutating func flush() -> RemotePublication? {
    var shown: [String: RemoteModelRow] = [:]
    var hidden: Set<String> = []
    for id in dirty {
      let was = joined[id]
      guard let row = rows[id], visibility.shows(row) else {
        if was != nil { hidden.insert(id) }
        continue
      }
      if row != was { shown[id] = row }
    }
    dirty.removeAll()
    guard !shown.isEmpty || !hidden.isEmpty else { return nil }
    var added: Set<String> = []
    var updated: Set<String> = []
    for id in hidden { joined.removeValue(forKey: id) }
    for (id, row) in shown {
      if joined[id] == nil { added.insert(id) } else { updated.insert(id) }
      joined[id] = row
    }
    let before = model.agents
    let views = joined.values.sorted(by: compareMonitorRows)
    model = RemoteModel(revision: revision ?? 0, agents: views)
    return RemotePublication(
      added: views.filter { added.contains($0.id) }.map { $0.id },
      updated: views.filter { updated.contains($0.id) }.map { $0.id },
      removed: before.filter { hidden.contains($0.id) }.map { $0.id })
  }

  private mutating func take(_ incoming: RemoteModelRow) {
    if let row = rows[incoming.id], row == incoming { return }
    rows[incoming.id] = incoming
    dirty.insert(incoming.id)
  }

  /// A change on the chain applies; off it, or while the chain is broken, it is held and the gap heard once.
  @discardableResult
  private mutating func applyChange(_ change: RemoteModelChange) -> Bool {
    if !gapped, revision == nil || change.since != revision { gap() }
    if gapped {
      hold(change)
      return false
    }
    revision = change.revision
    for row in change.upserts { take(row) }
    for id in change.removed where rows.removeValue(forKey: id) != nil { dirty.insert(id) }
    return true
  }

  private mutating func gap() {
    guard !gapped else { return }
    gapped = true
    gapsHeard += 1
  }

  /// Held for the healing snapshot; past the bound everything held goes, and the snapshot alone heals.
  private mutating func hold(_ change: RemoteModelChange) {
    guard !overflowed else { return }
    if held.count >= gapBuffer {
      held = []
      overflowed = true
      return
    }
    held.append(change)
  }
}
