import Foundation
import os

/// F0 (the freeway, 2026-10-16; `draft/thinking-freeway.md` §11) — how far the
/// door is, measured: one RFC 6455 ping on the open door, timed to its pong.
///
/// The phone's first attaches spent 115–176 ms on a ticket round trip while the
/// OS tailnet pinged this desktop at 11 ms direct, and nothing on either side
/// could say whether VibeField's own path was direct, relayed, or slow inside
/// the stack. This is the number that says so, at hello and every `every` after.
/// It is a measurement, not a keepalive: the keepalive pings only after silence
/// (`ProductKeepalive`), and a dead socket stays the keepalive's to judge.
public enum DoorRoundTrip {
  /// How often an open door is measured again.
  public static let every: Duration = .seconds(30)

  public static func line(label: String?, _ took: Duration) -> String {
    let door = label.map { "door[\($0)]" } ?? "door"
    let parts = took.components
    let ms = parts.seconds * 1000 + parts.attoseconds / 1_000_000_000_000_000
    return "\(door) round trip \(ms) ms"
  }

  public static let logger = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "door")

  /// The default sink: the unified log, and in a DEBUG build the console line a
  /// `devicectl` capture carries (the `[attach]` lines' rule).
  public static let log: @Sendable (String?, Duration) -> Void = { label, took in
    let text = line(label: label, took)
    logger.info("\(text, privacy: .public)")
    #if DEBUG
      print("[door] \(text)")
    #endif
  }
}
