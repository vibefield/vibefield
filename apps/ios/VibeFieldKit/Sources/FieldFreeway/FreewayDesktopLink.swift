import FieldProduct
import Foundation

// F1 (thinking-freeway.md v0.3 §3, Note 17) — one desktop's link, KEPT. A tap on a desktop the phone
// already links to never dials; the first tap dials, and the link is kept warm after it:
// - dialed with a fresh approval from the phone's home (`freeway.approve`), over a raw tailnet
//   stream to the desktop's freeway serve;
// - its approval renewed at `approvalRenewMs` (`Renew` on the link), well before it lapses;
// - redialed when it ends: at once on a foreground or a network change (`wake()`), otherwise on a
//   backoff from 0.25 s doubling to 4 s with jitter — after a `Restarting` waits out its `ttlMs`
//   first, since the host said when it would be back.

/// Where a desktop's link is.
public enum FreewayLinkState: Sendable, Equatable {
  case idle
  case dialing
  case up(FreewayWelcome)
  /// Ended; the next dial is due at `until` (epoch ms), and `after` is why.
  case waiting(until: Int64, after: FreewayLinkEnd?)
  case stopped
}

public actor FreewayDesktopLink {
  /// How this desktop is reached, and who approves the phone for it.
  public struct Dialing: Sendable {
    /// A raw stream to the desktop's freeway serve (`MeshNode.dial(to:port:)` on the mesh leg).
    public var dial: @Sendable () async throws -> any FreewayByteStream
    /// The desktop's tailnet name, for the handshake's `Host`.
    public var host: String
    /// The desktop's roster id, the welcome's consistency check (FW-L9).
    public var deviceId: String
    /// A fresh approval from the phone's home desktop: `freeway.approve` → `{approval, expiresAt}`.
    public var approve: @Sendable () async throws -> JSONValue
    public var deviceName: String?

    public init(
      dial: @escaping @Sendable () async throws -> any FreewayByteStream, host: String,
      deviceId: String, approve: @escaping @Sendable () async throws -> JSONValue,
      deviceName: String? = nil
    ) {
      self.dial = dial
      self.host = host
      self.deviceId = deviceId
      self.approve = approve
      self.deviceName = deviceName
    }
  }

  /// The supervisor's clocks: the backoff's floor and ceiling and the renewal point, the contract's
  /// unless a test says otherwise.
  public struct Timing: Sendable {
    public var backoffFloorMs: Int64 = 250
    public var backoffCeilingMs: Int64 = 4_000
    public var renewAfterMs: Int64 = Int64(FreewayContract.approvalRenewMs)
    /// From the dial to the welcome, at most: a desktop whose serve takes the connection and never
    /// answers is a failed dial, not a wait.
    public var connectDeadlineMs: Int64 = 10_000
    public var now: @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1_000) }
    public var jitter: @Sendable (Int64) -> Int64 = { span in span > 0 ? Int64.random(in: 0...span) : 0 }

    public init() {}
  }

  private let dialing: Dialing
  private let timing: Timing
  public private(set) var state: FreewayLinkState = .idle
  private var current: FreewayLink?
  private var inFlight: Task<FreewayLink, any Error>?
  private var redial: Task<Void, Never>?
  private var renewal: Task<Void, Never>?
  private var watcher: Task<Void, Never>?
  private var failures = 0

  public init(_ dialing: Dialing, timing: Timing = Timing()) {
    self.dialing = dialing
    self.timing = timing
  }

  /// The standing link, or one dialed for this ask — a tap is the user's word, so it dials now
  /// rather than waiting out a backoff. Throws when no link can be had right now.
  public func link() async throws -> FreewayLink {
    if case .stopped = state { throw CancellationError() }
    if let current { return current }
    if let inFlight { return try await inFlight.value }
    redial?.cancel()
    redial = nil
    return try await dial().value
  }

  /// The phone came to the foreground, or its network changed: a link that ended redials now.
  public func wake() {
    guard case .waiting = state else { return }
    redial?.cancel()
    redial = nil
    _ = dial()
  }

  /// Stop keeping the link: no redial, no renewal, and the link closed.
  public func stop() async {
    state = .stopped
    for task in [redial, renewal, watcher] { task?.cancel() }
    inFlight?.cancel()
    redial = nil
    renewal = nil
    watcher = nil
    inFlight = nil
    let link = current
    current = nil
    await link?.close()
  }

  // MARK: - The dial, the watch, the renewal

  private func dial() -> Task<FreewayLink, any Error> {
    if let inFlight { return inFlight }
    state = .dialing
    let dialing = self.dialing
    let deadline = timing.connectDeadlineMs
    let task = Task { () throws -> FreewayLink in
      let approved = try await dialing.approve()
      let stream = try await dialing.dial()
      // The deadline ends the stream under the handshake, so its pending read returns.
      let expiry = Task {
        try await Task.sleep(nanoseconds: UInt64(deadline) * 1_000_000)
        await stream.close()
      }
      defer { expiry.cancel() }
      return try await FreewayLink.connect(
        over: stream, host: dialing.host, approval: approved["approval"] ?? approved,
        deviceName: dialing.deviceName, expect: dialing.deviceId)
    }
    inFlight = task
    Task { await self.settle(task) }
    return task
  }

  /// A dial's outcome: up, watched and renewed — or a failure, and the next dial scheduled.
  private func settle(_ task: Task<FreewayLink, any Error>) async {
    let result = await task.result
    guard inFlight == task else { return }
    inFlight = nil
    if case .stopped = state {
      if case .success(let link) = result { await link.close() }
      return
    }
    switch result {
    case .success(let link):
      failures = 0
      current = link
      state = .up(link.welcome)
      watcher = Task { await self.watch(link) }
      renewal = Task { await self.renew(link) }
    case .failure(let error):
      schedule(after: error as? FreewayLinkEnd)
    }
  }

  private func watch(_ link: FreewayLink) async {
    guard let end = try? await link.ended() else { return }
    guard current === link else { return }
    current = nil
    renewal?.cancel()
    renewal = nil
    schedule(after: end)
  }

  /// The next dial: a `Restarting`'s own wait, else the backoff, doubling from its floor to its
  /// ceiling with jitter up to the step.
  private func schedule(after end: FreewayLinkEnd?) {
    if case .stopped = state { return }
    let wait: Int64
    if case .restarting(let ttlMs, _) = end {
      wait = max(ttlMs, timing.backoffFloorMs)
    } else {
      let step = min(timing.backoffCeilingMs, timing.backoffFloorMs << min(failures, 16))
      wait = step + timing.jitter(step / 2)
      failures += 1
    }
    state = .waiting(until: timing.now() + wait, after: end)
    redial = Task {
      try? await Task.sleep(nanoseconds: UInt64(wait) * 1_000_000)
      guard !Task.isCancelled else { return }
      await self.redialNow()
    }
  }

  private func redialNow() {
    guard case .waiting = state else { return }
    redial = nil
    _ = dial()
  }

  /// A fresh approval at `renewAfterMs`, handed to the link (`Renew`); a refused or failed one is
  /// tried again on the backoff while the old approval still stands.
  private func renew(_ link: FreewayLink) async {
    var wait = timing.renewAfterMs
    while !Task.isCancelled {
      try? await Task.sleep(nanoseconds: UInt64(max(wait, 1)) * 1_000_000)
      guard !Task.isCancelled, current === link else { return }
      do {
        let approved = try await dialing.approve()
        _ = try await link.renew(approval: approved["approval"] ?? approved)
        wait = timing.renewAfterMs
      } catch is CancellationError {
        return
      } catch {
        wait = timing.backoffCeilingMs
      }
    }
  }
}
