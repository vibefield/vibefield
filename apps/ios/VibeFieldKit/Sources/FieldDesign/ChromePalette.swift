import SwiftUI
import UIKit

/// The chrome family's color, in both themes.
///
/// **Where the numbers come from.** The KeyboardLab canvas is a dark phone, so
/// every DARK value below is transcribed from its stylesheet and the class is
/// named. The LIGHT value is derived by DESIGN.md rather than invented:
///
/// - §2.2 — chrome material is `white` in light, `#1C1C1E` in dark. A
///   translucent white-on-dark fill becomes a translucent BLACK-on-light one.
/// - §2.3 — hairlines are `black/5` light, `white/10` dark.
/// - §2.4 — text is surface color plus opacity: primary black, secondary
///   `black/70`, captions `black/50` on light chrome; the same ramp in white on
///   dark.
/// - §2.5 — the only hues chrome may use, one meaning each. Nothing on this
///   card is hued by default; `attention` exists for a permission that is
///   waiting and for nothing else.
///
/// The alphas below are a little heavier in light than the dark ones are,
/// because a black veil on white reads stronger than a white veil on black at
/// the same number — the pairs are matched by eye in the simulator, which is
/// the only honest way to match them.
///
/// `FieldPalette` is untouched and still governs the swarm field and the
/// terminal deck (DESIGN.md §1.1, §2.7). The two languages do not mix on one
/// surface.
public enum ChromePalette {

  // MARK: - Ink (§2.4's ramp)

  /// Primary: the draft, a menu item, a chip's word. `.field` / `.mi` / `.chip`.
  public static let ink = dynamic(light: 0x000000, lightAlpha: 0.92, dark: 0xFFFFFF)
  /// Secondary: a nav key's arrow, a strip's hint at rest. `.key.nav`.
  public static let inkSecondary = dynamic(
    light: 0x000000, lightAlpha: 0.62, dark: 0xFFFFFF, darkAlpha: 0.72)
  /// Tertiary: a fan key's subtitle, a row's summary. `.pk small` / `.srow .sum`.
  public static let inkTertiary = dynamic(
    light: 0x000000, lightAlpha: 0.50, dark: 0xFFFFFF, darkAlpha: 0.55)
  /// The placeholder, and the one step below tertiary. `.field .ph`.
  public static let placeholder = dynamic(
    light: 0x000000, lightAlpha: 0.40, dark: 0xFFFFFF, darkAlpha: 0.42)
  /// A hint set beside something louder. `.strip .hint`.
  public static let inkHint = dynamic(
    light: 0x000000, lightAlpha: 0.48, dark: 0xFFFFFF, darkAlpha: 0.50)
  /// §3's eyebrow, at 60%. Sheets only — the card has none.
  public static let eyebrow = dynamic(
    light: 0x000000, lightAlpha: 0.55, dark: 0xFFFFFF, darkAlpha: 0.60)
  /// The strip's own sentence — 92%, a shade under primary. `.strip`.
  public static let inkStrip = dynamic(
    light: 0x000000, lightAlpha: 0.88, dark: 0xFFFFFF, darkAlpha: 0.92)

  // MARK: - The glass card (`.glass.card`)

  /// The card's fill gradient, top and bottom, drawn OVER `.ultraThinMaterial`.
  ///
  /// **Why these are a dark scrim in dark mode when the canvas's are white.**
  /// The canvas lays `white 13.5% → 8.5%` over a BLURRED backdrop, and a CSS
  /// blur changes nothing but sharpness: over its `#0B0B0B` terminal the card
  /// resolves to `#2C2C2C → #1F1F1F`. SwiftUI's `.ultraThinMaterial` is not a
  /// blur, it is a blur PLUS a vibrancy layer, and in dark mode it lands near
  /// `#3C3C3C` on its own — so adding the canvas's white on top gave a milky
  /// panel, which is what the first build of this looked like in the simulator.
  /// These numbers put the material back on the canvas's own two values while
  /// keeping the live blur, and they keep its direction: lighter at the top,
  /// where the light is. They were set by MEASURING — the canvas render's card
  /// is `#2C2C2C` at the composer row and `#262626` at the rail, and the
  /// simulator's is within a point of both.
  public static let glassTop = dynamic(
    light: 0x000000, lightAlpha: 0.04, dark: 0x000000, darkAlpha: 0.03)
  public static let glassBottom = dynamic(
    light: 0x000000, lightAlpha: 0.09, dark: 0x000000, darkAlpha: 0.16)
  /// The card's hairline (§2.3). `.glass` `border`.
  public static let cardHairline = dynamic(
    light: 0x000000, lightAlpha: 0.08, dark: 0xFFFFFF, darkAlpha: 0.12)
  /// The inset top highlight. Dark only: `inset 0 0.5px 0 rgba(255,255,255,0.16)`
  /// is a specular line that exists because the material is dark, and the same
  /// line on white chrome is invisible at best and a seam at worst.
  public static let cardHighlight = dynamic(
    light: 0xFFFFFF, lightAlpha: 0, dark: 0xFFFFFF, darkAlpha: 0.16)

  // MARK: - Keys (`.key`)

  public static let keyFill = dynamic(
    light: 0x000000, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.085)
  /// `.key.nav` — the four arrows sit one step quieter than the named keys.
  public static let keyFillNav = dynamic(
    light: 0x000000, lightAlpha: 0.045, dark: 0xFFFFFF, darkAlpha: 0.07)
  public static let keyHairline = dynamic(
    light: 0x000000, lightAlpha: 0.08, dark: 0xFFFFFF, darkAlpha: 0.09)
  public static let keyHairlineNav = dynamic(
    light: 0x000000, lightAlpha: 0.07, dark: 0xFFFFFF, darkAlpha: 0.10)
  /// A key's ink: 90% in both themes, which is §2.4's primary minus the
  /// hardness of pure black on a pale cap.
  public static let keyInk = dynamic(
    light: 0x000000, lightAlpha: 0.90, dark: 0xFFFFFF, darkAlpha: 0.90)
  public static let keyInkNav = inkSecondary

  /// `.key.armed` — Ctrl armed, Meta armed on Esc. A bright cap with dark ink:
  /// the inversion swaps whole in light mode (§2.4).
  public static let keyArmedFill = dynamic(
    light: 0x000000, lightAlpha: 0.75, dark: 0xFFFFFF, darkAlpha: 0.68)
  public static let keyArmedInk = dynamic(light: 0xFFFFFF, dark: 0x000000)
  public static let keyArmedBorder = dynamic(
    light: 0x000000, lightAlpha: 0.35, dark: 0xFFFFFF, darkAlpha: 0.35)
  /// `.key.locked` — one step past armed, plus the dot.
  public static let keyLockedFill = dynamic(
    light: 0x000000, lightAlpha: 0.90, dark: 0xFFFFFF, darkAlpha: 0.95)
  /// `.key.on` — the mode key in Live, `⋯` with the keypad up.
  public static let keyOnFill = dynamic(light: 0x000000, dark: 0xFFFFFF)
  public static let keyOnInk = dynamic(light: 0xFFFFFF, dark: 0x000000)
  /// `.key.pressed` — a veil over whatever the key already is.
  public static let keyPressedFill = dynamic(
    light: 0x000000, lightAlpha: 0.18, dark: 0xFFFFFF, darkAlpha: 0.30)

  // MARK: - The round controls (`.circle`)

  public static let circleFill = dynamic(
    light: 0x000000, lightAlpha: 0.08, dark: 0xFFFFFF, darkAlpha: 0.12)
  public static let circleHairline = dynamic(
    light: 0x000000, lightAlpha: 0.10, dark: 0xFFFFFF, darkAlpha: 0.14)
  /// `.circle.quiet` — the mic at rest, and Send with an empty draft.
  public static let circleQuietFill = dynamic(
    light: 0x000000, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.10)
  public static let circleQuietInk = dynamic(
    light: 0x000000, lightAlpha: 0.70, dark: 0xFFFFFF, darkAlpha: 0.80)
  /// `.circle.open` — `+` while its menu is up.
  public static let circleOpenFill = dynamic(
    light: 0x000000, lightAlpha: 0.16, dark: 0xFFFFFF, darkAlpha: 0.26)
  /// `.circle.prominent` — Send with something to send, and the mic listening.
  public static let circleProminentFill = keyOnFill
  public static let circleProminentInk = keyOnInk

  // MARK: - Chips (`.chip`)

  /// `.chip .n` — the reply number's own circle inside the pill.
  public static let chipNumberFill = dynamic(
    light: 0x000000, lightAlpha: 0.10, dark: 0xFFFFFF, darkAlpha: 0.16)

  /// `.chip.paste` — the one chip we do not draw. `UIPasteControl` takes a
  /// `baseBackgroundColor` and nothing else: no gradient, no blur, no border,
  /// and a translucent color there is ignored outright (witnessed — the control
  /// fell back to a system gray). So the glass pill beside it is approximated
  /// by a SOLID at its own resolved value: the card's material over a dark
  /// terminal, and §2.2's `--vf-fill` on the light side.
  public static let pasteChipFill = dynamic(light: 0xF2F2F7, dark: 0x2D2D31)

  // MARK: - Floating surfaces

  /// `.menu` and `.pop` — `#3A3A3E` in the canvas, white in light per §2.2's
  /// solid chrome. Solid rather than glass on purpose: both are drawn OVER the
  /// card, which is already glass over a glass sheet, and a third translucent
  /// layer is mud rather than depth.
  public static let menuSurface = dynamic(light: 0xFFFFFF, dark: 0x3A3A3E)
  public static let menuHairline = cardHairline
  /// `.mi + .mi` — the hairline between two menu items.
  public static let menuSeparator = dynamic(
    light: 0x000000, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.08)
  /// `.msep` — the heavier gap between a menu's two sections.
  public static let menuSectionGap = dynamic(
    light: 0x000000, lightAlpha: 0.05, dark: 0x000000, darkAlpha: 0.28)
  /// `.pk` — a fan key on the menu surface.
  public static let fanKeyFill = dynamic(
    light: 0x000000, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.10)
  /// `--vf-search-scrim` (§5, *Search scrim*): the Peek's dim, `black/16` by
  /// day and `black/46` by night. The phone wears it, its dim alone, between
  /// the field and the bar while a door stands over a live field (§9, TS-D22).
  /// Held to the token by `pnpm check:ios-fixtures`.
  public static let searchScrim = dynamic(
    light: 0x000000, lightAlpha: 0.16, dark: 0x000000, darkAlpha: 0.46)

  // MARK: - The keypad (`.kb.keypad`)

  /// The ground. These are the system keyboard's own grays, because a keypad
  /// that replaces the keyboard should read as a keyboard and not as a panel.
  public static let keypadGround = dynamic(light: 0xD1D3D9, dark: 0x1F1F21)
  /// `.kb.keypad .key` — a plain key: white caps in light, a light veil in dark.
  public static let keypadKeyFill = dynamic(light: 0xFFFFFF, dark: 0xFFFFFF, darkAlpha: 0.16)
  /// `.kb.keypad .key.special` — the darker half of a system keyboard.
  public static let keypadSpecialFill = dynamic(
    light: 0x000000, lightAlpha: 0.10, dark: 0xFFFFFF, darkAlpha: 0.09)
  public static let keypadKeyHairline = dynamic(
    light: 0x000000, lightAlpha: 0.05, dark: 0xFFFFFF, darkAlpha: 0.06)
  public static let keypadKeyInk = dynamic(
    light: 0x000000, lightAlpha: 0.90, dark: 0xFFFFFF, darkAlpha: 0.95)
  /// `.kb.keypad .key.armed`.
  public static let keypadArmedFill = dynamic(
    light: 0x000000, lightAlpha: 0.75, dark: 0xFFFFFF, darkAlpha: 0.72)
  public static let keypadArmedInk = keyArmedInk

  // MARK: - The segmented control (`.seg`)

  public static let segTrack = dynamic(
    light: 0x000000, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.07)
  public static let segSelected = dynamic(light: 0xFFFFFF, dark: 0xFFFFFF, darkAlpha: 0.16)
  /// An unselected item: 60%, which is §2.4's eyebrow step.
  public static let segInk = dynamic(
    light: 0x000000, lightAlpha: 0.55, dark: 0xFFFFFF, darkAlpha: 0.60)
  public static let segSelectedInk = dynamic(light: 0x000000, lightAlpha: 0.92, dark: 0xFFFFFF)

  // MARK: - Sheets

  /// `.srow.sel` — a selected row in a list on glass.
  public static let rowSelected = dynamic(
    light: 0x000000, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.10)
  /// A text well: the snippet editor's body, a search field.
  public static let wellFill = dynamic(
    light: 0x000000, lightAlpha: 0.04, dark: 0xFFFFFF, darkAlpha: 0.08)
  public static let wellHairline = dynamic(
    light: 0x000000, lightAlpha: 0.08, dark: 0xFFFFFF, darkAlpha: 0.10)
  /// A hairline between rows in a list.
  public static let separator = menuSeparator

  // MARK: - State (§2.5 — the only color chrome may use)

  /// `--vf-orange`: needs attention, and nothing else. Approvals only.
  public static let attention = solid(0xFF9F0A)
  /// `--vf-green`: working / healthy.
  public static let green = solid(0x30D158)
  /// `--vf-red`: failed / destructive.
  public static let red = solid(0xFF453A)

  // MARK: - Paper (the History tab, IOS-9b)

  /// The record's `--vf-chrome-solid`: the History screens' ground — white
  /// paper, `#1C1C1E` at night (§2.2's chrome material, opaque here because a
  /// reading surface is a page, not a pane of glass).
  public static let paper = dynamic(light: 0xFFFFFF, dark: 0x1C1C1E)
  /// `--vf-fill`: the prompt panel, a stat card, a live row, a pressed row.
  public static let fill = dynamic(light: 0xF2F2F7, dark: 0xFFFFFF, darkAlpha: 0.08)
  /// `--vf-text-faint` — the ramp's last step (30% light, 32% dark): a path,
  /// a time, a group head.
  public static let inkFaint = dynamic(light: 0x1C1C1E, lightAlpha: 0.30, dark: 0xFFFFFF, darkAlpha: 0.32)
  /// `--vf-hairline-strong`: the rules between turns.
  public static let ruleStrong = dynamic(light: 0x000000, lightAlpha: 0.10, dark: 0xFFFFFF, darkAlpha: 0.14)
  /// A search hit's mark: the term, on a wash of the select hue.
  public static let markWash = dynamic(light: 0x4A90D9, lightAlpha: 0.18, dark: 0x4A90D9, darkAlpha: 0.30)

  // MARK: - The bar (IOS-9e)

  /// The selected tab's pill inside the bar's capsule — measured off iOS 26's
  /// own tab bar on the simulator: the pill reads black/7% over the light
  /// glass (251 → 233) and white/14% over the dark (22 → 55).
  public static let tabPill = dynamic(light: 0x000000, lightAlpha: 0.07, dark: 0xFFFFFF, darkAlpha: 0.14)

  // MARK: - Vendor marks (§13)

  /// `--vf-tailscale-ink`: Tailscale's own two inks for its logomark, and for
  /// nothing else (TS-7, `TailscaleMark`). Held to the token by
  /// `pnpm check:ios-fixtures`.
  public static let tailscaleInk = dynamic(light: 0x1E1E1F, dark: 0xFFFFFF)

  // MARK: - Construction

  private static func dynamic(
    light: UInt32, lightAlpha: CGFloat = 1, dark: UInt32, darkAlpha: CGFloat = 1
  ) -> Color {
    Color(
      UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(chromeRGB: dark, alpha: darkAlpha) : UIColor(chromeRGB: light, alpha: lightAlpha)
      })
  }

  private static func solid(_ rgb: UInt32) -> Color {
    Color(UIColor(chromeRGB: rgb, alpha: 1))
  }
}

extension UIColor {
  fileprivate convenience init(chromeRGB rgb: UInt32, alpha: CGFloat) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
      green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
      blue: CGFloat(rgb & 0xFF) / 255.0,
      alpha: alpha)
  }
}
