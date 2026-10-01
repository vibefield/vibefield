import Foundation

/// SP-2 (b) — how a quiet door is kept open, and how a dead one is noticed.
///
/// TWO halves, because the sidecar that serves a desktop's door reaps EACH
/// DIRECTION of a served WebSocket on its own clock — a read deadline per
/// direction, ten minutes, fixed for served sockets (truffle
/// `packages/sidecar-slim/main.go`, `idleCopy`). An idle board sends nothing
/// by design, so without both halves a quiet phone's door died silently and
/// surfaced only as the next call's transport error (`thinking-sync-planes.md`
/// §1.9 item 1).
///
/// - **The receive deadline.** No inbound frame for `deadlineFactor` × the
///   door's tick interval — `system.tick`'s `intervalMs`, `defaultIntervalMs`
///   until the first tick — means the door is gone: the client closes and dials
///   again, by the roster. ANY frame resets it: a result, a subscription event,
///   a notification this build has never heard of, a pong. 2.5 intervals is two
///   lost ticks and half of a third, so one late tick is never a verdict.
/// - **The send half.** After `pingAfter` with nothing SENT, one WebSocket
///   protocol ping. fieldd's server answers every ping itself, so a ping keeps
///   BOTH directions under the reap, needs no new method on the door, and keeps
///   a door from before the tick alive too — its pong is the frame the receive
///   deadline needed.
public struct ProductKeepalive: Sendable, Equatable {
  public var defaultIntervalMs: Int64
  public var deadlineFactor: Double
  public var pingAfter: Duration

  public init(
    defaultIntervalMs: Int64 = FieldProductContract.doorTickIntervalMs,
    deadlineFactor: Double = 2.5,
    pingAfter: Duration = .seconds(120)
  ) {
    self.defaultIntervalMs = defaultIntervalMs
    self.deadlineFactor = deadlineFactor
    self.pingAfter = pingAfter
  }

  /// The receive deadline for a door that ticks every `intervalMs` (`nil`: it
  /// has not ticked yet, so the registry's interval stands in). Pure, pinned by
  /// tests.
  public func receiveDeadline(intervalMs: Int64?) -> Duration {
    let interval = Double(intervalMs ?? defaultIntervalMs)
    return .milliseconds(Int64((interval * deadlineFactor).rounded()))
  }

  /// How long the phone stays silent before it pings a door that ticks every
  /// `intervalMs`: the door's OWN interval, capped at `pingAfter` (DS wave 2
  /// landing, 2026-10-01). A door that announces a short tick and then stops is
  /// dead to the receive deadline at 2.5 of ITS intervals — a ping fixed at two
  /// minutes would come too late, and the client would close a door whose pong
  /// could have kept it. The cap stays so a long announced interval can never
  /// outlast the sidecar's ten minutes; `nil` (no tick yet) is the cap.
  public func pingAfter(intervalMs: Int64?) -> Duration {
    guard let intervalMs else { return pingAfter }
    return min(pingAfter, .milliseconds(intervalMs))
  }

  /// The interval a `system.tick` may set. Outside it the tick is NOTED and not
  /// applied — a door that says it ticks every millisecond, or every day, is
  /// saying something this client cannot measure a deadline in.
  public static let acceptedIntervalsMs: ClosedRange<Int64> = 1_000...3_600_000
}
