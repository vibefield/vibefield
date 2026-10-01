import Foundation
import Testing

@testable import FieldProduct

/// A clock the test moves (SP-2). Every keepalive timer in the client sleeps on
/// it, so twelve minutes of a door's life is a loop of `advance` calls that
/// runs in milliseconds — never wall time.
///
/// Sleepers wake in DEADLINE order when time passes them, and a cancelled
/// sleeper is woken with `CancellationError` at once, whichever of the
/// cancellation and the registration came first (both take the lock).
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

/// Let whatever an `advance` woke run until `count` timers are parked again —
/// the client's keepalive owns two (the receive deadline and the ping), so a
/// settled client is one whose two timers are asleep in the future.
///
/// BEST EFFORT, deliberately: it returns whether the count was reached, and
/// never records an issue. The assertions that matter (dials, pings, the
/// state) are made by the caller, so a build with no timers at all fails on
/// THOSE — what the door saw — rather than on a wait for timers that do not
/// exist.
@MainActor
@discardableResult
func settle(
  _ clock: ManualProductClock, parked count: Int, timeout: Duration = .milliseconds(250)
) async -> Bool {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    // A real millisecond even when the count already matches: a woken timer
    // may still be on its way back to sleep.
    try? await Task.sleep(for: .milliseconds(1))
    if clock.parked == count { return true }
  }
  return false
}
