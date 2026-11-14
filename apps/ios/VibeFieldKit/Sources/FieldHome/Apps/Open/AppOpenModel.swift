import FieldProduct
import FieldWeb
import Foundation
import Observation

// MA-5a (red) — one app opening on the phone. A stub: an open does nothing.

@MainActor
@Observable
final class AppOpenModel {
  enum Phase: Equatable {
    case idle
    case opening(appKey: String, desktop: String, late: Bool)
    case serving(appKey: String, url: URL, policy: WebNavigationPolicy)
    case refused(appKey: String, honest: AppsHonest)
  }

  private(set) var phase: Phase = .idle
  private(set) var warm = AppWarm()

  @ObservationIgnored var sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  @ObservationIgnored var now: @Sendable () -> ContinuousClock.Instant = { ContinuousClock().now }
  @ObservationIgnored var opensApps = WebShipGate.opensApps

  func open(_ app: IndexAppRow, sources: [IndexAppsSource], here: String, door: (any ChatDoor)?) async {}

  func left() {}
}
