import Foundation

/// SP-2 — the door client's sense of time, injected.
///
/// The keepalive is a statement about MINUTES — a door silent for two and a
/// half tick intervals is gone, and a phone that sends nothing for ten minutes
/// has its half of the socket reaped by the sidecar — and a test that waited
/// minutes of wall time would be a test nobody runs. So every keepalive timer
/// reads this protocol, and the tests drive a manual one: a twelve-minute idle
/// soak is a loop that advances it, never wall time.
///
/// Monotonic, from an arbitrary origin: `now()` is a `Duration` since the
/// clock was made and never a date, because a wall clock a person sets back
/// must not resurrect a dead door or kill a live one.
public protocol ProductClock: Sendable {
  func now() -> Duration
  /// Suspends until `deadline` on this clock's own timeline. Throws when the
  /// task is cancelled: a timer that was cancelled must never fire late.
  func sleep(until deadline: Duration) async throws
}

/// The real one: `ContinuousClock`, which keeps counting while the device
/// sleeps — a socket that sat through a sleep has been silent for all of it.
public struct SystemProductClock: ProductClock {
  private let origin: ContinuousClock.Instant

  public init() {
    origin = ContinuousClock.now
  }

  public func now() -> Duration {
    origin.duration(to: ContinuousClock.now)
  }

  public func sleep(until deadline: Duration) async throws {
    try await Task.sleep(until: origin.advanced(by: deadline), clock: .continuous)
  }
}
