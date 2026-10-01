import Foundation
import os

/// SP-2 (h) — one subscription's bytes over one window: the facts behind the
/// debug line the client writes at most once per `window` per subscription.
///
/// What it is for: SP-2's device witness reads the phone's own log for the
/// bytes per second a live board costs at five agents (`thinking-sync-planes.md`
/// §6), so the number has to be measured where the bytes land — here, per
/// subscription, open answer and every frame after it. It names a method, a
/// subscription id and a label the owner chose; never a URL (the door's path
/// is a capability) and never a payload.
public struct SubscriptionTraffic: Sendable, Equatable {
  /// What the owner calls this door — FieldLink passes the desktop's id.
  public let label: String?
  public let method: String
  public let subId: String?
  /// UTF-8 bytes of every frame the subscription received in the window: its
  /// open answer, its deltas, its snapshots.
  public let bytes: Int
  public let frames: Int
  public let window: Duration

  public init(
    label: String?, method: String, subId: String?, bytes: Int, frames: Int, window: Duration
  ) {
    self.label = label
    self.method = method
    self.subId = subId
    self.bytes = bytes
    self.frames = frames
    self.window = window
  }

  public var bytesPerSecond: Double {
    let parts = window.components
    let seconds = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
    return seconds > 0 ? Double(bytes) / seconds : 0
  }

  /// The debug line, as the device log will show it.
  public var line: String {
    let door = label.map { "door[\($0)]" } ?? "door"
    let rate = Int(bytesPerSecond.rounded())
    return "\(door) \(method) \(subId ?? "-"): \(rate) B/s over \(window.components.seconds) s "
      + "(\(frames) frames, \(bytes) B)"
  }

  /// One window's length: one line per this long per subscription, at most.
  public static let window: Duration = .seconds(10)

  /// Where the line goes on a phone: the unified log at DEBUG — not persisted
  /// unless someone is streaming it, which is the point of a measuring line.
  public static let logger = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "door")

  /// The default sink.
  public static let log: @Sendable (SubscriptionTraffic) -> Void = { traffic in
    logger.debug("\(traffic.line, privacy: .public)")
  }
}
