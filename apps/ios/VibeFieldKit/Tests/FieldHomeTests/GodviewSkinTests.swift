import CoreGraphics
import SwiftUI
import Testing

@testable import FieldHome

// PG-4t — THE PHONE'S MONITOR SKIN (host + kit): the table is whole, the two looks differ, a skin reads its look's
// column, and every accessor is its key's colour. The values themselves are held to tokens.css by `pnpm
// check:ios-fixtures` (all 18), the key names to the SDK's `MONITOR_SKIN` by field-app's phone-parity row, and the
// seven the swarm's `FieldPalette` repeats by the kit's `GodviewSkinPaletteTests`.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4t — the phone's monitor skin")
struct GodviewSkinTests {
  /// K1 — one line per colour, in `Key`'s order: none missing, none twice.
  @Test func theTableHasOneLinePerColour() {
    let keys = GodviewSkin.table.map { $0.key }
    #expect(keys == GodviewSkin.Key.allCases)
    #expect(GodviewSkin.Key.allCases.count == 9)
  }

  /// K2 — the light look and the dark one differ in every colour (§2.7's two columns).
  @Test func theTwoLooksDifferInEveryColour() {
    for line in GodviewSkin.table {
      #expect(line.light != line.dark, "\(line.key)")
    }
  }

  /// K3 — a skin reads its own look's column, and every value is a colour (no alpha byte).
  @Test func aSkinReadsItsLooksColumn() {
    let light = GodviewSkin(scheme: .light)
    let dark = GodviewSkin(scheme: .dark)
    for line in GodviewSkin.table {
      let lightValue = light.rgb(line.key)
      let darkValue = dark.rgb(line.key)
      #expect(lightValue == line.light, "\(line.key) light")
      #expect(darkValue == line.dark, "\(line.key) dark")
      #expect(lightValue <= 0xFF_FFFF && darkValue <= 0xFF_FFFF, "\(line.key): 0xRRGGBB")
    }
    #expect(light != dark)
    #expect(light == GodviewSkin(scheme: .light))
  }

  /// K5 — each accessor is its key's colour, opaque sRGB, in both looks.
  @Test func everyAccessorIsItsKeysColour() {
    let accessors: [(KeyPath<GodviewSkin, Color>, GodviewSkin.Key)] = [
      (\.monitorBg, .monitorBg), (\.panelBg, .panelBg), (\.panelBorder, .panelBorder), (\.textMain, .textMain),
      (\.textMuted, .textMuted), (\.textFaint, .textFaint), (\.controlHoverBorder, .controlHoverBorder),
      (\.controlHoverBg, .controlHoverBg), (\.idleBg, .idleBg),
    ]
    #expect(accessors.count == GodviewSkin.Key.allCases.count)
    for scheme in [ColorScheme.light, .dark] {
      let skin = GodviewSkin(scheme: scheme)
      for (path, key) in accessors {
        let colour = skin[keyPath: path]
        let components = SkinColours.srgb(colour)
        let expected = SkinColours.components(skin.rgb(key))
        #expect(components.count == 4, "\(key) \(scheme)")
        for (got, want) in zip(components, expected) {
          #expect(abs(got - want) < 0.5 / 255, "\(key) \(scheme): \(components) vs \(expected)")
        }
      }
    }
  }
}

/// A colour's sRGB components, resolved the way a view's draw resolves it.
enum SkinColours {
  static func srgb(_ colour: Color) -> [CGFloat] {
    let resolved = colour.resolve(in: EnvironmentValues())
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let converted = resolved.cgColor.converted(to: space, intent: .defaultIntent, options: nil)
    else { return [] }
    return converted.components ?? []
  }

  static func components(_ rgb: UInt32) -> [CGFloat] {
    [CGFloat((rgb >> 16) & 0xFF) / 255, CGFloat((rgb >> 8) & 0xFF) / 255, CGFloat(rgb & 0xFF) / 255, 1]
  }
}
