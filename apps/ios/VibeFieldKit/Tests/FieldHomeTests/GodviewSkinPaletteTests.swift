import FieldDesign
import SwiftUI
import Testing
import UIKit

@testable import FieldHome

// PG-4t — THE SKIN AND THE SWARM'S PALETTE AGREE (kit only: `FieldPalette` is UIKit's). Seven of the skin's colours
// are `FieldPalette`'s too, which governs the swarm and the deck (DESIGN.md §2.7's one table); the skin is held to
// tokens.css by `pnpm check:ios-fixtures`, and this row holds the palette's copies to the skin, light and dark.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4t — the skin and FieldPalette agree")
struct GodviewSkinPaletteTests {
  /// K4 — the seven colours both carry are one value in each look.
  @Test func theSevenSharedColoursAreOneValue() {
    let shared: [(GodviewSkin.Key, Color)] = [
      (.monitorBg, FieldPalette.monitorBackground), (.panelBg, FieldPalette.panelBackground),
      (.panelBorder, FieldPalette.panelBorder), (.textMain, FieldPalette.textMain),
      (.textMuted, FieldPalette.textMuted), (.textFaint, FieldPalette.textFaint), (.idleBg, FieldPalette.bodySurface),
    ]
    for (style, scheme) in [(UIUserInterfaceStyle.light, ColorScheme.light), (.dark, .dark)] {
      let skin = GodviewSkin(scheme: scheme)
      let traits = UITraitCollection(userInterfaceStyle: style)
      for (key, palette) in shared {
        let resolved = UIColor(palette).resolvedColor(with: traits)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        let read = resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        #expect(read, "\(key) \(scheme): an RGB colour")
        let value =
          UInt32((red * 255).rounded()) << 16 | UInt32((green * 255).rounded()) << 8 | UInt32((blue * 255).rounded())
        let expected = skin.rgb(key)
        #expect(value == expected, "\(key) \(scheme): FieldPalette \(String(value, radix: 16))")
        #expect(alpha == 1, "\(key) \(scheme): opaque")
      }
    }
  }
}
