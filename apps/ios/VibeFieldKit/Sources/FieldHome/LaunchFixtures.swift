import Foundation

#if DEBUG || VF_TESTFLIGHT
  import FieldSettings
#endif

/// RB-2 (DESIGN.md §8 "The phone's Settings", amended 2026-11-12) — the demo this open stands in, read once for the
/// whole launch: Demo field, an account state, or neither. The home and the way in's acts read the SAME value, so a
/// view cannot be under a demo while its acts think it is not. In the build submitted for App Review there is never a
/// demo, and its reader is not compiled.
struct LaunchFixtures: Equatable, Sendable {
  /// Demo field: a made-up field in place of yours (`-vf-mock` for a scripted run).
  var demoField: Bool
  /// An account state, by `AccountFixtures`' name (`-vf-demo-account=<state>`), or nil for your own.
  var account: String?

  /// No demo: your own account and your own field.
  static let off = LaunchFixtures(demoField: false, account: nil)

  /// Whether a demo stands: the one answer the home and the way in's acts both read.
  var demoStands: Bool { demoField || account != nil }

  #if DEBUG || VF_TESTFLIGHT
    /// The launch arguments first, so a scripted run is what it asks for and leaves the page's choices as they were;
    /// the page's own choices second (`DeveloperChoices`). An account state is let go in the same step that reads it,
    /// so it stands for one open, and an open that fails cannot keep the phone in it.
    static func read(arguments: [String], defaults: UserDefaults) -> LaunchFixtures {
      // RB-2b (red): a stub, one fixed answer that reads nothing and lets nothing go. RB-2c reads.
      LaunchFixtures(demoField: false, account: "signedin")
    }
  #endif
}
