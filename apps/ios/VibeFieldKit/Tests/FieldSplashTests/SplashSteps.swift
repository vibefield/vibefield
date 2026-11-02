import Foundation

@testable import FieldSplash

/// The splash's timer, stepped by hand (WI-1's review): nothing falls due until a row says the time has passed, so
/// no row waits on the wall clock and none fails for a loaded host (item 157's lesson).
@MainActor
final class SplashSteps: SplashTimer {
  private(set) var now: Duration = .zero
  private var calls: [(at: Duration, order: Int, call: SteppedCall)] = []
  private var order = 0

  @discardableResult
  func after(_ delay: Duration, _ body: @escaping @MainActor () -> Void) -> any SplashDue {
    order += 1
    let call = SteppedCall(body)
    calls.append((now + delay, order, call))
    return call
  }

  /// Moves the clock on by `step`, running every call that falls due on the way, in the order it falls due (a
  /// call scheduled by another runs too, if it falls due before the end).
  func advance(by step: Duration) {
    let end = now + step
    while let next = calls.filter({ $0.at <= end }).min(by: { ($0.at, $0.order) < ($1.at, $1.order) }) {
      calls.removeAll { $0.call === next.call }
      now = next.at
      next.call.run()
    }
    now = end
  }
}

/// One scheduled call: cancelled, it never runs.
@MainActor
final class SteppedCall: SplashDue {
  private let body: @MainActor () -> Void
  private(set) var cancelled = false

  init(_ body: @escaping @MainActor () -> Void) {
    self.body = body
  }

  func cancel() {
    cancelled = true
  }

  func run() {
    guard !cancelled else { return }
    body()
  }
}

/// The content's steadiness, said by hand: what the display link would report once six frames came on time.
@MainActor
final class SteadyByHand: SplashSteadiness {
  private var onSteady: (@MainActor () -> Void)?

  /// Whether the gate is watching the content.
  var watching: Bool { onSteady != nil }

  func start(_ onSteady: @escaping @MainActor () -> Void) {
    self.onSteady = onSteady
  }

  func stop() {
    onSteady = nil
  }

  /// The content drew on time: the watch stops and says so, as `FrameWatch` does.
  func steady() {
    let call = onSteady
    onSteady = nil
    call?()
  }
}
