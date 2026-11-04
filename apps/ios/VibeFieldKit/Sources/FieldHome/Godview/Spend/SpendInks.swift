import FieldAgents
import FieldSwarm
import SwiftUI

// PG-7 — THE SPEND VIEW'S INKS ON THE PHONE (kit-only: the swarm's resolved theme is UIKit's). The window's
// `resolveSpendInks` (`spend-paint.js` :8) reads the swarm's palette through the toolkit's light rules: the
// instrument ink, the state lights at full chroma, and the same lights fit to be read as words. The phone's swarm
// resolves the same rules once, in `SwarmTheme.resolve` (its `ink`, `orange`, `blue` and `stateInk`), so spend reads
// them from there and never resolves them a second time. Its ground and its words' greys come from the stage's skin
// (`GodviewStageInput.skin`, by the SDK's names). Held by SpendParityTests K2.

struct SpendInks: Equatable, Sendable {
  /// `!isLightTheme(ink)`: a light ink means a dark ground.
  let dark: Bool
  /// `palette.timeline.ground`, the monitor's ground (`--monitor-bg`).
  let ground: SwarmColor
  let ink: SwarmColor
  let orange: SwarmColor
  let blue: SwarmColor
  let orangeInk: SwarmColor
  let blueInk: SwarmColor
  let greenInk: SwarmColor
  /// The words' ink and ramp (`--text-main`; t1/t2/t3 are it at 88/68/52 %), and the surfaces and greys the
  /// stylesheet reads by the skin's names (`--panel-bg`, `--text-muted`, `--text-faint`).
  let main: SwarmColor
  let panel: SwarmColor
  let muted: SwarmColor
  let faint: SwarmColor

  /// The moment tag's words (`.vf-monitor-spend-tag`, spend.css:234-235): `--vf-card-deep` at 92 %, the deep card ink
  /// (tokens.css:52, `#000000`), in both looks. The stage's skin names no such ink, so DESIGN.md §2.2's
  /// `--vf-card-deep` row says the phone's spend tag reads it here (fd's Q5).
  static let deep = SwarmColor(r: 0, g: 0, b: 0, a: 0.92)

  init(theme: SwarmTheme, skin: GodviewSkin) {
    func colour(_ key: GodviewSkin.Key) -> SwarmColor {
      let value = skin.rgb(key)
      return SwarmColor(
        r: Double((value >> 16) & 255) / 255, g: Double((value >> 8) & 255) / 255, b: Double(value & 255) / 255)
    }
    dark = !(theme.ink.luminance < 0.5)
    ground = colour(.monitorBg)
    ink = theme.ink
    orange = theme.orange
    blue = theme.blue
    orangeInk = theme.stateInk.orange
    blueInk = theme.stateInk.blue
    greenInk = theme.stateInk.green
    main = colour(.textMain)
    panel = colour(.panelBg)
    muted = colour(.textMuted)
    faint = colour(.textFaint)
  }

  /// A row's colour before its sibling's tone (Q11). It is the stage's deal (`GodviewStageInput.colour`); a project
  /// the stage has not dealt gets what the window's host deals one, `palette.neutral`: the scoped `--text-faint` (the
  /// SDK's `colour.js` :111-112), which on the phone is the skin's faint ink. Spend's own grey (`SpendScene.grey`) is
  /// kept for a colour that does not resolve, and a `SwarmColor` always resolves.
  func base(_ dealt: SwarmColor?) -> SwarmColor { dealt ?? faint }
}

extension SwarmColor {
  /// The colour as SwiftUI's: sRGB, with its own alpha.
  var spendColor: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
}
