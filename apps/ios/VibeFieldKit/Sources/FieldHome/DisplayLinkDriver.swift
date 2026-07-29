import Observation
import QuartzCore
import UIKit

/// Drives the simulation at display cadence. Each vsync it hands the
/// timestamp to `onTick` (which steps the physics world) and then bumps
/// `frame`, which is the single observed value the field view reads — one
/// invalidation per frame, however many bodies move.
@MainActor
@Observable
public final class DisplayLinkDriver {
  public private(set) var frame: UInt64 = 0

  @ObservationIgnored public var onTick: ((TimeInterval) -> Void)?
  @ObservationIgnored private var link: CADisplayLink?

  public init() {}

  public var isRunning: Bool { link != nil }

  public func start() {
    guard link == nil else { return }
    let link = CADisplayLink(target: WeakProxy(self), selector: #selector(WeakProxy.fire))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  public func stop() {
    link?.invalidate()
    link = nil
  }

  fileprivate func tick(timestamp: TimeInterval) {
    onTick?(timestamp)
    frame &+= 1
  }

  /// CADisplayLink retains its target; the proxy breaks the cycle. The link
  /// is scheduled on the main run loop, so the selector always fires on the
  /// main actor — isolating the proxy makes that assumption the type's law.
  @MainActor
  private final class WeakProxy: NSObject {
    weak var driver: DisplayLinkDriver?
    init(_ driver: DisplayLinkDriver) { self.driver = driver }

    @objc func fire(_ link: CADisplayLink) {
      driver?.tick(timestamp: link.timestamp)
    }
  }
}
