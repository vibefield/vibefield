import Foundation
import os

/// Item 477 (2026-11-18) — the one line the client writes when a re-dial's
/// replay of a subscription is refused for good and that subscription ends on
/// this client.
///
/// Its owner is not told (item 540), so the view it fed stops moving with
/// nothing on its screen to say why: this line is what diagnoses it. It names
/// the subscribe method and the refusal's kind, and nothing else: never the
/// params (they name a person's sessions and desktops), never a payload, never
/// the door's path, which is a capability.
public enum ReplayEnded {
  public static func line(method: String, kind: String) -> String {
    "\(method) ended: its replay was refused \(kind)"
  }

  /// The default sink: the unified log at NOTICE, which the phone keeps, and in
  /// a DEBUG build the console line a `devicectl` capture carries (the `[door]`
  /// lines' rule).
  public static let log: @Sendable (String) -> Void = { text in
    DoorRoundTrip.logger.notice("\(text, privacy: .public)")
    #if DEBUG
      print("[door] \(text)")
    #endif
  }
}
