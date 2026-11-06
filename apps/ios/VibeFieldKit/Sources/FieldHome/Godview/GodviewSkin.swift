import SwiftUI

// PG-4t — THE PHONE'S MONITOR SKIN (DESIGN.md §8 "The monitor view owns its drawing", §2.7): the nine colours of
// puppeteer-view-sdk's `MONITOR_SKIN` a view draws with, resolved for the phone's look and carried to every view on
// `GodviewStageInput.skin`. No `#if`: Release compiles it, and it is SwiftUI alone, so the host loop builds it.
//
// The skin's other four names are not colours, and the kit names them already: `--vf-ease-island` is
// `FieldMotion.island(_:)`, `--vf-ease-pop` is `FieldMotion.popCurve`, `--vf-ease-lift` is `FieldMotion.lift(_:)`
// (the swarm's bloom and the held face read it; until UM-4's review the bloom spelled it inline, and this said so),
// and `--vf-font-sans` is `ChromeType.sans(_:_:)`, the system's face.

/// The skin, resolved for one look. A view reads a colour by the SDK's own name (`--panel-bg` is `panelBg`), never
/// a literal.
struct GodviewSkin: Equatable, Sendable {
  /// A colour of the skin: the raw value is the SDK's name without its `--` (field-app's phone-parity row holds the
  /// nine to `MONITOR_SKIN`'s colours, so an SDK upgrade that adds one reds by name).
  enum Key: String, CaseIterable, Sendable {
    case monitorBg = "monitor-bg"
    case panelBg = "panel-bg"
    case panelBorder = "panel-border"
    case textMain = "text-main"
    case textMuted = "text-muted"
    case textFaint = "text-faint"
    case controlHoverBorder = "control-hover-border"
    case controlHoverBg = "control-hover-bg"
    case idleBg = "idle-bg"
  }

  /// Each colour, light and dark: DESIGN.md §2.7's instrument palette, one line each in `Key`'s order. `pnpm
  /// check:ios-fixtures` reads every line against tokens.css's `--vf-godview-{light,dark}-<key>`, so keep the shape.
  static let table: [(key: Key, light: UInt32, dark: UInt32)] = [
    (.monitorBg, 0xF7F7F7, 0x0A0A0A),
    (.panelBg, 0xFFFFFF, 0x111111),
    (.panelBorder, 0xE0E0E0, 0x333333),
    (.textMain, 0x111111, 0xFFFFFF),
    (.textMuted, 0x888888, 0x777777),
    (.textFaint, 0xB8B8B8, 0x555555),
    (.controlHoverBorder, 0x777777, 0xA8A8A8),
    (.controlHoverBg, 0xF2F2F2, 0x242424),
    (.idleBg, 0xE5E5E5, 0x2A2A2A),
  ]

  /// The look it is resolved for (HS's `colorScheme`, which follows the phone's Appearance through the window). A
  /// change of look is a new skin, so every view redraws.
  let scheme: ColorScheme

  init(scheme: ColorScheme) {
    self.scheme = scheme
  }

  /// The key's colour in this look, as `0xRRGGBB` (what a host row compares, and what a Canvas view builds from).
  func rgb(_ key: Key) -> UInt32 {
    guard let line = Self.table.first(where: { $0.key == key }) else { return 0 }
    return scheme == .dark ? line.dark : line.light
  }

  /// The key's colour in this look: opaque sRGB.
  subscript(key: Key) -> Color {
    let value = rgb(key)
    return Color(
      .sRGB, red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255, opacity: 1)
  }

  var monitorBg: Color { self[.monitorBg] }
  var panelBg: Color { self[.panelBg] }
  var panelBorder: Color { self[.panelBorder] }
  var textMain: Color { self[.textMain] }
  var textMuted: Color { self[.textMuted] }
  var textFaint: Color { self[.textFaint] }
  var controlHoverBorder: Color { self[.controlHoverBorder] }
  var controlHoverBg: Color { self[.controlHoverBg] }
  var idleBg: Color { self[.idleBg] }
}
