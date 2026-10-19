import Foundation

/// item 42 (DESIGN.md §8 "A session another device is driving") — ONE
/// SESSION'S GEOMETRY SEAT as this client last heard it: who holds it (this
/// client, another, or nobody), the revision, and the PTY's committed size.
/// The cell announces it (`RoutedGeometryState`, behind the negotiated
/// `geometry-events`) to the control leg of every activation of the session;
/// the client adds the one fact only it holds — whether the holder is THIS
/// client — and keeps the newest on the session (`RoutedSessionState.seat`),
/// folded here. The desktop's `session-seat.ts` keeps the same rule.
///
/// A face reads it; no verb is built on it. The take's own belief
/// (`RoutedSessionState.geometryHolder`) is still fed by its verbs' answers
/// alone, so the lease logic (DS-4b) is exactly what it was.
public struct RoutedSessionSeat: Sendable, Equatable {
  /// Who drives the session.
  public enum Driver: Sendable, Equatable {
    /// THIS client holds the seat: the holder's client is one this client's
    /// grants for the session named. Any of its views counts, because the
    /// question a face asks is whether it is this device — and a lane's view
    /// id is new each time the lane opens, while the cell may still hold the
    /// seat for the view before.
    case mine(RoutedGeometryStateHolder)
    /// Another client holds it: a window, a peer's window, another phone.
    case another(RoutedGeometryStateHolder)
    /// Nobody holds it. `letGo` is the OTHER client that held it before it
    /// emptied — nil when this client let go itself, or never heard it held.
    case nobody(letGo: RoutedGeometryStateHolder?)
  }

  public let driver: Driver
  /// The cell's `geometryRevision`.
  public let revision: Int64
  /// The PTY's committed size: the holder's, or on an empty seat the last one
  /// committed, which is the size the pane goes on drawing.
  public let cols: Int
  public let rows: Int

  public init(driver: Driver, revision: Int64, cols: Int, rows: Int) {
    self.driver = driver
    self.revision = revision
    self.cols = cols
    self.rows = rows
  }

  /// Fold one announcement onto the seat held (nil: none yet). The receiver's
  /// rule, as the contract states it (`GeometryState`, 2026-10-19):
  /// - a revision strictly BELOW the one held is stale — the cell announces
  ///   outside its lock, so two announcements of one session can cross — and
  ///   changes nothing;
  /// - an equal or newer one REPLACES the seat, in arrival order: one cell path
  ///   (DS-4d's `DESTINATION_INELIGIBLE` on an empty seat) resizes the PTY
  ///   without moving the revision, so an equal one must replace.
  ///
  /// `mine` is the client's fact, not the cell's: whether the holder's client
  /// is one of this client's own.
  static func fold(_ held: RoutedSessionSeat?, _ state: RoutedGeometryState, mine isMine: Bool)
    -> RoutedSessionSeat
  {
    if let held, state.geometryRevision < held.revision { return held }
    let driver: Driver
    if let holder = state.holder {
      driver = isMine ? .mine(holder) : .another(holder)
    } else {
      driver = .nobody(letGo: whoLetGo(held))
    }
    return RoutedSessionSeat(
      driver: driver, revision: state.geometryRevision, cols: state.cols, rows: state.rows)
  }

  /// Who let the seat go, as an empty seat remembers it: the holder before it,
  /// when that was another client's; whoever an already-empty seat remembered;
  /// nobody when this client let go, or never heard the seat held.
  private static func whoLetGo(_ held: RoutedSessionSeat?) -> RoutedGeometryStateHolder? {
    switch held?.driver {
    case .another(let holder)?: return holder
    case .nobody(let letGo)?: return letGo
    case .mine?, nil: return nil
    }
  }
}

extension RoutedSessionSeat: CustomStringConvertible {
  /// The seat in a log line's words: who holds it, never by name or id (a
  /// face's name is a person's device, which `TerminalAttachLog` never
  /// carries), the size and the revision.
  public var description: String {
    let who =
      switch driver {
      case .mine: "this client holds it"
      case .another: "another client holds it"
      case .nobody(let letGo): letGo == nil ? "nobody holds it" : "another client let it go"
      }
    return "\(who) at \(cols)×\(rows), r\(revision)"
  }
}
