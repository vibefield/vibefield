import FieldAgents
import FieldSwarm
import SwiftUI
import Testing

@testable import FieldHome

// PG-6 — T10, KIT ONLY: the phone's own inks are the desktop's. `TimelineInks(theme:skin:)` over SwarmTheme (FieldPalette
// resolved through UIKit) and PG-4t's GodviewSkin, each ink printed as the 2D context takes it (`css`, the toolkit's
// rgbaCss), against `phone-timeline.golden.json`'s inks (resolveTimelineInks over the desktop Godview's own tokens).
// Compared as css, so a channel the platform carries as a float32 still reads as its byte. This ties FieldPalette's
// godview rows and the skin to tokens.css through the timeline's own resolver. It needs UIKit, so the host loop does not
// build it; the kit's slot runs it.
//
// PG-4t's skin accessor for a scheme is not landed yet: `GodviewSkin.resolve(_:)` is this file's assumption, adjusted to
// 4t's exact signature at its C3 step end.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-6 — the timeline's inks on the phone")
@MainActor
struct TimelineInksKitTests {
  /// T10 — each ink, light and dark.
  @Test(arguments: ["light", "dark"])
  func theInksAreTheDesktops(theme: String) throws {
    let scheme: ColorScheme = theme == "dark" ? .dark : .light
    let mine = TimelineInks(theme: SwarmTheme.resolve(scheme), skin: GodviewSkin.resolve(scheme))
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
}
