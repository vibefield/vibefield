import Foundation

/// Item 532 (asked for 2026-11-18) — the process's launch arguments, as the kit's demo and fixture paths read them:
/// the arguments themselves in a development build, and none in any other. A launch argument is set by a developer's
/// tooling, so a TestFlight build and the build App Review sees answer only to their own controls. A demo stands
/// there by the Developer page's choices alone, wearing its Demo tag, and no fixture's variant is reached.
///
/// `LaunchArgumentsTests` holds that no line a TestFlight build or the review build compiles reads the arguments.
public enum LaunchArguments {
  /// Whether this is a development build, the one kind that reads its launch arguments.
  public static var development: Bool {
    #if DEBUG
      return true
    #else
      return false
    #endif
  }

  /// This process's launch arguments in a development build; none in any other, read from nowhere.
  public static var current: [String] {
    #if DEBUG
      return ProcessInfo.processInfo.arguments
    #else
      return []
    #endif
  }

  /// The same rule as a value, for the rows: they read a TestFlight build's answer through it, since the kit's tests
  /// run in a development build. Red: it passes the arguments in every build yet, and no read goes through the seam.
  public static func of(_ arguments: [String], development: Bool) -> [String] {
    arguments
  }
}
