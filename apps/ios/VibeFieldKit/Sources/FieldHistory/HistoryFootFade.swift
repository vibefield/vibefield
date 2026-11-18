import FieldDesign
import SwiftUI

// Item 391 (asked for 2026-11-13, of a session's document on a phone, the area over its foot marked: the messages
// begin to fade, blur and dim in the marked area, as they do at the top
// edge) — THE BAND OVER A SESSION'S DOCUMENT'S FOOT. At the head the system softens what scrolls under its own
// navigation bar. The bar at the foot and the slot above it are the home screen's overlay, so the system gives the
// foot nothing, and the document draws its own band there. DESIGN.md §8 "The phone's session document", "Its foot
// fades as its head does".
//
// The rule is pure: the band's height and its two ramps. The view under it draws what the rule answers.
//
// It is not the system's effect, and does not pass for it. SwiftUI has no public blur whose radius changes down
// its height, so the blur is one system material brought in by a mask: it arrives down the band, it does not grow.
// The dim is the page's own paper over it.

/// The band over the foot of a session's document: how tall it stands, and how it deepens down its height.
enum HistoryFootFade {
  /// One stop of a ramp down the band: how strong the effect is (0 none, 1 whole) at a point down the band (0 its
  /// top, 1 the screen's bottom edge).
  struct Stop: Equatable, Sendable {
    let strength: Double
    let at: Double
  }

  /// How far above the top of what stands over the foot the band begins. It is under the 32 pt the document's last
  /// row rests above that top at its end (items 387 and 389), so the newest row stands whole above the band.
  static let lead: CGFloat = 24
  /// Where down the band the blur is whole.
  static let blurWholeAt: Double = 0.5
  /// How much of the page's paper stands over the rows at the screen's bottom edge. Never the whole of it: the
  /// rows are dimmed toward the page, not painted out.
  static let dimAtEdge: Double = 0.9

  /// The air the bar's clearance keeps over the bar (`AppBar.clearance`'s 8 pt, FieldHome). A page's `RootHead.foot`
  /// is that clearance on the home indicator's inset, so `foot` less this is the top of what stands over the foot,
  /// measured from the screen's bottom edge.
  static let clearanceAir: CGFloat = 8

  /// The band's height where the home screen's measure of the foot is `foot` (`RootHead.foot`: the home indicator's
  /// inset and the bar's clearance, with the slot's when one stands). It follows that measure as the document's end
  /// does, so it reaches the slot's top while a session has an act and the bar's while it has none.
  static func height(foot: CGFloat) -> CGFloat {
    height(over: foot - clearanceAir)
  }

  /// The band's height, from the screen's bottom edge, where the top of what stands over the foot (the bar, or the
  /// slot above it) is `over` points above that edge: to that top and `lead` beyond it. Where nothing stands over
  /// the foot there is no band.
  static func height(over: CGFloat) -> CGFloat {
    over > 0 ? over + lead : 0
  }

  /// The blur down the band: none at its top, whole from `blurWholeAt` to the screen's edge.
  static let blur: [Stop] = [
    Stop(strength: 0, at: 0), Stop(strength: 1, at: blurWholeAt), Stop(strength: 1, at: 1),
  ]

  /// The dim down the band: none at its top, `dimAtEdge` at the screen's edge.
  static let dim: [Stop] = [Stop(strength: 0, at: 0), Stop(strength: dimAtEdge, at: 1)]
}

extension View {
  /// Item 391 — on a session's document: the band over its foot, `height` tall from the screen's bottom edge
  /// (`HistoryFootFade.height(over:)`). It lies over the rows and takes no touch. Whatever is laid over the page
  /// after it (the document's pill) stands above it, sharp.
  func historyFootFade(height: CGFloat) -> some View {
    modifier(HistoryFootFadeModifier(height: height))
  }
}

/// The band placed: at the page's foot and down to the screen's bottom edge whatever the safe area says, because
/// the height it is handed is measured from that edge.
private struct HistoryFootFadeModifier: ViewModifier {
  let height: CGFloat

  func body(content: Content) -> some View {
    content.overlay {
      if height > 0 {
        HistoryFootFadeBand()
          .frame(height: height)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
          .ignoresSafeArea(edges: .bottom)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
    }
  }
}

/// The band drawn, down whatever height it is given: the material under its mask, and the page's paper over it.
/// With Reduce Transparency on the system draws a material solid, and a solid band would hide the rows outright,
/// so the material is left out and the dim stands alone.
private struct HistoryFootFadeBand: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  var body: some View {
    ZStack {
      if !reduceTransparency {
        Rectangle()
          .fill(.ultraThinMaterial)
          .mask { ramp(HistoryFootFade.blur, of: .black) }
      }
      ramp(HistoryFootFade.dim, of: ChromePalette.paper)
    }
  }

  /// One ramp as a gradient down the band: `color` at each stop's strength.
  private func ramp(_ stops: [HistoryFootFade.Stop], of color: Color) -> LinearGradient {
    LinearGradient(
      stops: stops.map { stop in Gradient.Stop(color: color.opacity(stop.strength), location: stop.at) },
      startPoint: .top, endPoint: .bottom)
  }
}
