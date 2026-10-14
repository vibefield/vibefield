import SwiftUI

/// PJ-7 — A DEVICE IS ITS OPERATING SYSTEM'S MARK (`thinking-project-places.md`
/// §6.0, PJ-D24; DESIGN.md §8 "The phone's History is one ledger of projects").
/// The marks are the desktop's own — Simple Icons, kept exact (§13), copied as
/// template SVGs into `OSMarks.xcassets` from `os-marks.tsx` and held to it by
/// `pnpm check:ios-fixtures` — drawn in the text's ink, never a hue of their
/// own. A desktop whose platform is not said yet is a plain screen, never a
/// guess.
public struct DeviceMark: View {
  public enum OS: String, Sendable, CaseIterable {
    case macos, windows, linux, unknown

    /// `DeviceSlice.platform` is the publishing daemon's `process.platform`.
    public init(platform: String?) {
      switch platform?.lowercased() {
      case "darwin", "macos": self = .macos
      case "win32", "windows": self = .windows
      case "linux": self = .linux
      default: self = .unknown
      }
    }

    /// The OS's own name, for a screen reader (never drawn as words).
    public var label: String {
      switch self {
      case .macos: "macOS"
      case .windows: "Windows"
      case .linux: "Linux"
      case .unknown: "a desktop"
      }
    }
  }

  public let os: OS
  public let size: CGFloat

  public init(platform: String?, size: CGFloat) {
    self.os = OS(platform: platform)
    self.size = size
  }

  public init(os: OS, size: CGFloat) {
    self.os = os
    self.size = size
  }

  public var body: some View {
    Image("os-\(os.rawValue)", bundle: .module)
      .renderingMode(.template)
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}
