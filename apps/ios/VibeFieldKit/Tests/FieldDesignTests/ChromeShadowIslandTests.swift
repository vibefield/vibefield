import FieldDesign
import SwiftUI
import Testing
import UIKit

// PG-4t — THE ISLAND SHADOW (kit only: the shadow's colour is UIKit's dynamic colour). DESIGN.md §5's island recipe,
// `--vf-shadow-island` (tokens.css: `0 8px 30px`, black at 8%, and 40% by night), as the chrome family's other
// shadows are converted: CSS blur is about twice SwiftUI's radius.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4t — the island shadow")
struct ChromeShadowIslandTests {
  /// K1 — radius 15, 8 down, black at 8% by day and 40% by night.
  @Test func theIslandShadowIsSectionFivesRecipe() {
    let island = ChromeShadow.island
    #expect(island.radius == 15)
    #expect(island.y == 8)
    for (style, expected) in [(UIUserInterfaceStyle.light, 0.08), (.dark, 0.40)] {
      let resolved = UIColor(island.color).resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
      var white: CGFloat = -1
      var alpha: CGFloat = -1
      let read = resolved.getWhite(&white, alpha: &alpha)
      #expect(read, "\(style.rawValue): a grey")
      #expect(white == 0, "\(style.rawValue): black")
      #expect(abs(alpha - expected) < 0.001, "\(style.rawValue): \(alpha)")
    }
  }
}
