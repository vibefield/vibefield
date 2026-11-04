import FieldAgents
import FieldSwarm
import SwiftUI
import Testing

@testable import FieldHome

// PG-6 — T10 and T11, KIT ONLY: the phone's own inks are the desktop's. `TimelineInks(theme:skin:)` over SwarmTheme
// (FieldPalette resolved through UIKit) and PG-4t's GodviewSkin (`GodviewSkin(scheme:)`, its colours by `rgb(_:)`),
// each ink printed as the 2D context takes it (`css`, the toolkit's rgbaCss), against `phone-timeline.golden.json`'s
// inks (resolveTimelineInks over the desktop Godview's own tokens). Compared as css, so a channel the platform carries
// as a float32 still reads as its byte. This ties FieldPalette's godview rows and the skin to tokens.css through the
// timeline's own resolver. T11 then paints the open's wakes with those inks, call for call against the golden's
// stream: the mixes and alphas a channel feeds, not only the channel. It needs UIKit, so the host loop does not build
// it (its T11 paints with the golden's inks); the kit's slot runs it.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-6 — the timeline's inks on the phone")
@MainActor
struct TimelineInksKitTests {
  /// T10 — each ink, light and dark.
  @Test(arguments: ["light", "dark"])
  func theInksAreTheDesktops(theme: String) throws {
    let scheme: ColorScheme = theme == "dark" ? .dark : .light
    let mine = Self.phoneInks(scheme)
    let open = try TimelineGolden.open()
    let golden = try TimelinePaintParityTests.inks(open, theme: theme)
    #expect(mine.dark == golden.dark, "\(theme): dark")
    let pairs: [(String, SwarmColor, SwarmColor)] = [
      ("ground", mine.ground, golden.ground), ("ink", mine.ink, golden.ink), ("muted", mine.muted, golden.muted),
      ("faint", mine.faint, golden.faint), ("border", mine.border, golden.border), ("grid", mine.grid, golden.grid),
      ("orange", mine.orange, golden.orange), ("blue", mine.blue, golden.blue),
      ("orangeInk", mine.orangeInk, golden.orangeInk), ("blueInk", mine.blueInk, golden.blueInk),
      ("orangeGround", mine.orangeGround, golden.orangeGround), ("blueGround", mine.blueGround, golden.blueGround),
    ]
    for (name, phone, desktop) in pairs {
      let phoneCss = TimelineInks.css(phone)
      let desktopCss = TimelineInks.css(desktop)
      #expect(phoneCss == desktopCss, "\(theme): \(name)")
    }
  }

  /// T11 — `paintWakes`' stream over the open's lanes, painted with the phone's own inks.
  @Test(arguments: ["light", "dark"])
  func theWakesPaintWithThePhonesInks(theme: String) throws {
    let scheme: ColorScheme = theme == "dark" ? .dark : .light
    try TimelinePaintParityTests.wakesPaint(theme: theme, inks: Self.phoneInks(scheme))
  }

  /// The inks the view paints with: `GodviewTimelineView`'s own `TimelineInks(theme:skin:)`.
  static func phoneInks(_ scheme: ColorScheme) -> TimelineInks {
    TimelineInks(theme: SwarmTheme.resolve(scheme), skin: GodviewSkin(scheme: scheme))
  }
}
