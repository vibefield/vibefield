import FieldProduct
import FieldWeb
import Foundation
import Observation

// MA-5a — one app opening on the phone, over the home's door (MA §5.5, §5.7, §5.8): asked, late, starting,
// serving or refused, and the warm app. No view: the open screen (5b) draws `phase`. A Release build opens nothing
// until SP-4d's relay lands (item 373, `WebShipGate`).

@MainActor
@Observable
final class AppOpenModel {
  enum Phase: Equatable {
    case idle
    /// Asked; `late` once `AppOpen.lateAfter` has passed with no answer ("Opening on ‹desktop›…").
    case opening(appKey: String, desktop: String, late: Bool)
    /// The URL to load and the rule its page lives by.
    case serving(appKey: String, url: URL, policy: WebNavigationPolicy)
    /// Why it cannot open, as the honest screen says it.
    case refused(appKey: String, honest: AppsHonest)
  }

  private(set) var phase: Phase = .idle
  private(set) var warm = AppWarm()

  /// Waits; tests hand in their own.
  @ObservationIgnored var sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  /// Now; tests hand in their own.
  @ObservationIgnored var now: @Sendable () -> ContinuousClock.Instant = { ContinuousClock().now }
  /// Whether this build makes app web views (`WebShipGate.opensApps`); a test may hold it shut.
  @ObservationIgnored var opensApps = WebShipGate.opensApps

  /// Each open's number: an answer to an earlier open is never drawn.
  @ObservationIgnored private var generation = 0
  /// The warm app's answer, so it reopens without asking.
  @ObservationIgnored private var kept: (appKey: String, url: URL, policy: WebNavigationPolicy)?

  /// Opens `app`, as the home's door answers for it.
  func open(_ app: IndexAppRow, sources: [IndexAppsSource], here: String, door: (any ChatDoor)?) async {
    generation += 1
    let mine = generation
    let source = MadeAppFacts.source(of: app, in: sources)
    let desktop = MadeAppFacts.desktop(source, here: here)
    warm.expire(now: now())
    if warm.isWarm(app.appKey, now: now()), let kept, kept.appKey == app.appKey {
      warm.opened(app.appKey)
      phase = .serving(appKey: app.appKey, url: kept.url, policy: kept.policy)
      return
    }
    guard opensApps else { return refuse(app, AppOpen.cannotRun) }
    let state = MadeAppFacts.state(app, source: source, desktop: desktop)
    guard state.opens else { return refuse(app, state.why ?? AppOpen.cannotRun) }
    guard let door else { return refuse(app, AppOpen.cantReach(desktop)) }

    phase = .opening(appKey: app.appKey, desktop: desktop, late: false)
    let sleep = self.sleep
    Task { [weak self] in
      try? await sleep(AppOpen.lateAfter)
      guard let self, self.generation == mine,
        case .opening(appKey: let key, desktop: let name, late: false) = self.phase
      else { return }
      self.phase = .opening(appKey: key, desktop: name, late: true)
    }

    let params = AppOpen.params(app, sources: sources).json
    var asks = 0
    while true {
      asks += 1
      let answer: AppOpen.Answer
      do {
        let json = try await door.call("artifact.open", params: params)
        answer = AppOpen.answer(try ArtifactOpenResult(json: json))
      } catch {
        guard generation == mine else { return }
        return refuse(app, AppOpen.refused(error, desktop: desktop))
      }
      guard generation == mine else { return }
      switch answer {
      case .serving(let url, let policy):
        kept = (app.appKey, url, policy)
        warm.opened(app.appKey)
        phase = .serving(appKey: app.appKey, url: url, policy: policy)
        return
      case .noRoot:
        return refuse(app, AppOpen.cannotRun)
      case .starting:
        guard asks < AppOpen.maxAsks else { return refuse(app, AppOpen.didNotStart(desktop)) }
        try? await sleep(AppOpen.askAgainAfter)
        guard generation == mine else { return }
      }
    }
  }

  /// The person left the open app (✕, the edge): it stays warm for `AppWarm.keep`.
  func left() {
    generation += 1
    warm.left(at: now())
    phase = .idle
  }

  /// MA-5b-1 — the serving page fell (`AppsPageFall`): the honest screen says why, and the app's next open asks its
  /// desktop again instead of reopening the answer it kept. Nothing, unless `app`'s page is the one serving.
  func pageFell(_ app: IndexAppRow, _ fall: AppsPageFall, desktop: String) {
    guard case .serving(let key, _, _) = phase, key == app.appKey else { return }
    generation += 1
    kept = nil
    refuse(app, fall.why(desktop: desktop))
  }

  private func refuse(_ app: IndexAppRow, _ why: MadeAppFacts.Why) {
    phase = .refused(appKey: app.appKey, honest: AppOpen.honest(why, app: app))
  }
}
