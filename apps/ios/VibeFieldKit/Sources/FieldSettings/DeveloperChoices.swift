#if DEBUG || VF_TESTFLIGHT
  import Foundation

  /// RB-2 (DESIGN.md §8 "The phone's Settings", amended 2026-11-12) — what the Developer page has chosen: Demo field,
  /// and an account state or your own. This phone's own, kept beside Appearance in its defaults, never synced and
  /// never sent. Off and Your own remove the key, so nothing chosen is nothing stored.
  public struct DeveloperChoices: Equatable, Sendable {
    public var demoField: Bool
    /// An account state, by its key in `DeveloperWords.accountStates`, or nil for your own.
    public var account: String?

    public init(demoField: Bool = false, account: String? = nil) {
      self.demoField = demoField
      self.account = account
    }

    public static let demoFieldKey = "vibefield.developer.demo-field"
    public static let accountKey = "vibefield.developer.account"

    /// The choices as kept.
    public static func read(_ defaults: UserDefaults) -> DeveloperChoices {
      // RB-2b (red): a stub that reads nothing. RB-2c reads the two keys.
      DeveloperChoices()
    }

    /// Demo field, on or off. Off removes the key.
    public static func setDemoField(_ on: Bool, in defaults: UserDefaults) {
      // RB-2b (red): a stub that keeps nothing. RB-2c writes or removes the key.
    }

    /// An account state, or nil for your own. Your own removes the key.
    public static func setAccount(_ name: String?, in defaults: UserDefaults) {
      // RB-2b (red): a stub that keeps nothing. RB-2c writes or removes the key.
    }
  }
#endif
