import UIKit

/// The card's four taps, felt.
///
/// A sticky modifier is the one control on this rail whose whole state is a
/// fill: armed and locked look alike at arm's length, and a key that changed
/// what the NEXT key means has to be felt to be trusted. So each transition
/// gets its own texture — light to arm, medium to lock, soft to release, rigid
/// for a chord out of the fan.
///
/// Called from the VIEW, never the model. Haptics are presentation: the model
/// is a pure state machine tested with no device under it, and a generator
/// firing inside `tapControl` would be a UIKit dependency in the one type that
/// deliberately has none.
///
/// Reduce Motion (and the accessibility setting that silences haptics with it)
/// is IOS-5e, with Dynamic Type and the VoiceOver announcements.
@MainActor
public enum InputHaptics {

  /// Ctrl armed for one key.
  public static func arm() { impact(.light) }

  /// Ctrl locked until released — the heavier of the two, because it is the
  /// heavier promise.
  public static func lock() { impact(.medium) }

  /// Ctrl released.
  public static func release() { impact(.soft) }

  /// A chord picked out of a long-press fan.
  public static func chord() { impact(.rigid) }

  /// One generator per texture, made on first use and kept.
  ///
  /// `prepare()` before each use is what buys the sub-frame latency: the Taptic
  /// engine idles otherwise, and a cold generator fires late enough that the
  /// tap and the feeling come apart.
  private static var generators: [UIImpactFeedbackGenerator.FeedbackStyle:
    UIImpactFeedbackGenerator] = [:]

  private static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
    let generator: UIImpactFeedbackGenerator
    if let existing = generators[style] {
      generator = existing
    } else {
      generator = UIImpactFeedbackGenerator(style: style)
      generators[style] = generator
    }
    generator.prepare()
    generator.impactOccurred()
  }
}
