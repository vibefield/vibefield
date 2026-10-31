import SwiftUI

/// TS-7 — Tailscale's logomark on the phone's sign-in, kept exact (DESIGN.md
/// §13, TS-D4): the desktop's `account/tailscale-mark.tsx`, drawn from the
/// same constants and held to them by `pnpm check:ios-fixtures`. The geometry
/// is the media kit's: a 169-unit box, nine dots of radius 18 at 30.5 · 84.5 ·
/// 138.5, the middle row and the bottom centre solid, the other five at 40%.
/// It is drawn in its own ink (`ChromePalette.tailscaleInk`), never in one
/// colour and never under the toolkit's 48 × 48 floor; the default 56 puts the
/// dots themselves at 48. "Tailscale is a registered trademark of Tailscale
/// Inc." — the phone says so at the foot of its settings.
public struct TailscaleMark: View {
  /// The box's side, in the media kit's units.
  static let box: CGFloat = 169
  /// The dots' centres, on both axes.
  static let at: [CGFloat] = [30.5, 84.5, 138.5]
  static let radius: CGFloat = 18
  /// The solid dots, as "column,row": the middle row and the bottom centre.
  static let solid: Set<String> = ["0,1", "1,1", "2,1", "1,2"]
  static let faintOpacity: Double = 0.4
  /// The Brand Toolkit's floor: the mark is never drawn smaller than this.
  public static let minimum: CGFloat = 48

  public let size: CGFloat

  public init(size: CGFloat = 56) {
    self.size = size
  }

  /// The side it is drawn at: anything under the floor is drawn at the floor.
  var drawn: CGFloat { max(size, Self.minimum) }

  public var body: some View {
    Canvas { context, canvas in
      let scale = canvas.width / Self.box
      for (row, cy) in Self.at.enumerated() {
        for (column, cx) in Self.at.enumerated() {
          let r = Self.radius * scale
          let dot = Path(ellipseIn: CGRect(x: cx * scale - r, y: cy * scale - r, width: 2 * r, height: 2 * r))
          let opacity = Self.solid.contains("\(column),\(row)") ? 1 : Self.faintOpacity
          context.fill(dot, with: .color(ChromePalette.tailscaleInk.opacity(opacity)))
        }
      }
    }
    .frame(width: drawn, height: drawn)
    .accessibilityElement()
    .accessibilityLabel("Tailscale")
    .accessibilityAddTraits(.isImage)
  }
}
