import Foundation

/// SP-2 (a) — what a subscription's frames ARE, so the client's subscription
/// table can keep a cursor for it. The three kinds are SP-1's descriptor
/// (`subscription.shape` in `contracts/src/methods.ts`), read from the phone's
/// side of the wire.
public struct SubscriptionShape: Sendable, Equatable {
  public enum Kind: String, Sendable, Equatable {
    /// `agent-field.ts`'s pair: the open answer `{epoch?, revision, rows}`,
    /// later frames `{epoch?, since, revision, upserts, removed}` (a `.snapshot`
    /// frame mid-stream replaces the board). The field board.
    case snapshotDelta = "snapshot-delta"
    /// `rows.ts`: the open answer `{resumed: {epoch, revision}}` (the kept copy
    /// stands) or `{snapshot: {epoch, revision, rows, more?}}`, later frames a
    /// delta `{epoch, since, revision, upserts, removed}` or a snapshot page (a
    /// reset). A paged snapshot is assembled and handed over ONCE.
    case rows
    /// Whole values, no cursor: every frame is passed through as it comes. A
    /// subscription that names no shape is this, which is today's behaviour.
    case stream
  }

  public var kind: Kind
  /// The per-subscriber cadence floor this subscription asks the door for —
  /// `minIntervalMs` in its params, carried on EVERY subscribe it sends: the
  /// first, a re-subscribe after a gap, a replay after a re-dial. Nil: the
  /// door's own default.
  public var minIntervalMs: Int?

  public init(kind: Kind, minIntervalMs: Int? = nil) {
    self.kind = kind
    self.minIntervalMs = minIntervalMs
  }

  public static let stream = SubscriptionShape(kind: .stream)
  public static func snapshotDelta(minIntervalMs: Int? = nil) -> SubscriptionShape {
    SubscriptionShape(kind: .snapshotDelta, minIntervalMs: minIntervalMs)
  }
  public static func rows(minIntervalMs: Int? = nil) -> SubscriptionShape {
    SubscriptionShape(kind: .rows, minIntervalMs: minIntervalMs)
  }
}

/// The last frame a subscription APPLIED: its chain's epoch, when the source
/// names one, and the revision. `rows.ts`'s cursor, and the field board's.
public struct SubscriptionCursor: Sendable, Equatable {
  public let epoch: String?
  public let revision: Int64

  public init(epoch: String?, revision: Int64) {
    self.epoch = epoch
    self.revision = revision
  }

  /// A snapshot's own cursor: `{epoch?, revision}` at its top level. Nil for a
  /// payload that names no revision — nothing can be continued from it.
  public static func of(snapshot payload: JSONValue) -> SubscriptionCursor? {
    guard let revision = payload["revision"]?.intValue else { return nil }
    return SubscriptionCursor(epoch: payload["epoch"]?.stringValue, revision: revision)
  }

  /// The cursor a delta leaves behind when it CONTINUES this one, or nil when
  /// it does not — a gap, and the only repair is a fresh snapshot.
  ///
  /// It continues when its `since` is this revision and its chain is this
  /// chain. The field board's epoch is OPTIONAL on the wire (DS-3: phones that
  /// shipped parse frames without it), so `snapshotDelta` compares epochs only
  /// when both sides name one; `rows` requires them equal, because a rows
  /// table's epoch is its identity (`rows.ts`). A delta that names no `since`
  /// or `revision` continues nothing.
  public func after(delta payload: JSONValue, kind: SubscriptionShape.Kind) -> SubscriptionCursor? {
    guard let since = payload["since"]?.intValue, let revision = payload["revision"]?.intValue
    else { return nil }
    let epoch = payload["epoch"]?.stringValue
    switch kind {
    case .rows:
      guard epoch == self.epoch, epoch != nil else { return nil }
    case .snapshotDelta, .stream:
      if let epoch, let held = self.epoch, epoch != held { return nil }
    }
    guard since == self.revision else { return nil }
    return SubscriptionCursor(epoch: epoch ?? self.epoch, revision: revision)
  }

  /// The wire spelling of a kept cursor, for `rows.ts`'s `since`.
  public var json: JSONValue? {
    guard let epoch else { return nil }
    return .object(["epoch": .string(epoch), "revision": .int(revision)])
  }
}
