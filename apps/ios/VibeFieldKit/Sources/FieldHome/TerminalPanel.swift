import FieldDesign
import SwiftUI

/// A pull on a card's panel, as its handle reports it, in the screen's space.
enum PanelPull: Equatable {
  /// The finger is this far below where it began (above it, when negative).
  case moved(CGFloat)
  /// Let go this far down, and thrown so that it would come to rest `predicted` down.
  case ended(translation: CGFloat, predicted: CGFloat)

  /// The pull, read in the screen's space: its handle moves with the panel it
  /// moves, and a translation read in the handle's own space would chase itself.
  @MainActor
  static func gesture(_ report: @escaping (PanelPull) -> Void) -> some Gesture {
    DragGesture(minimumDistance: 10, coordinateSpace: .global)
      .onChanged { report(.moved($0.translation.height)) }
      .onEnded {
        report(.ended(translation: $0.translation.height, predicted: $0.predictedEndTranslation.height))
      }
  }
}

/// A session's card as the phone's own panel (PF-9, 2026-11-22; DESIGN.md §8
/// "The card's glass is the field").
///
/// It is no sheet of the system's. Under full height the system floats a sheet
/// 8pt in from the sides and the foot and draws it at about 95%; at full height
/// it backs the sheet opaque. So this panel is drawn in the home's own window,
/// over the home: it bleeds to the left, right and bottom edges, a terminal's
/// card stands with its top edge at the top safe area's foot, and what shows
/// through the terminal's ground is the home itself, which the host blurs and
/// stills while the panel stands.
///
/// The panel owns its shape, its grabber, the touch that closes a short card
/// from above it, and what a screen reader is told. The host owns where it
/// stands (`top`, `pull`), its coming and going, and the card.
struct TerminalPanel<Card: View>: View {
  /// The card is its terminal: it paints its own ground at its own opacity,
  /// and anything under it here would double a translucent ground. Any other
  /// card (a run with no terminal to offer, a session that left the field)
  /// paints none, and stands on the chrome's material.
  let isTerminal: Bool
  /// How far under the top safe area's foot the top edge stands
  /// (`FieldHomeModel.livePanelTop`).
  let top: CGFloat
  /// How far the handle's pull has moved the panel down.
  let pull: CGFloat
  /// The scheme the surface under the grabber asks of ink drawn on it.
  let inkScheme: ColorScheme
  /// The motion its top edge travels on when the card becomes its terminal.
  let motion: Animation
  let onPull: (PanelPull) -> Void
  let onClose: () -> Void
  @ViewBuilder let card: () -> Card

  @Environment(\.colorScheme) private var scheme

  var body: some View {
    ZStack(alignment: .top) {
      // The home above a short card closes it at a touch, as the dimmed room
      // above a sheet does. A terminal's card leaves only the status bar's
      // strip above it, and a touch there closes nothing.
      Color.clear
        .contentShape(Rectangle())
        .ignoresSafeArea()
        .onTapGesture(perform: onClose)
        .allowsHitTesting(!isTerminal)
        .accessibilityHidden(true)

      panel
        .padding(.top, top)
        .animation(motion, value: isTerminal)
    }
  }

  private var panel: some View {
    card()
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        if !isTerminal {
          Rectangle().fill(.regularMaterial).ignoresSafeArea(.all, edges: .bottom)
        }
      }
      // A terminal's card is pulled by its band, which reports to the host
      // itself: its grid keeps every drag below the band. A card on the
      // material has nothing a drag would move, so the whole of it is the handle.
      .simultaneousGesture(PanelPull.gesture(onPull), including: isTerminal ? .subviews : .all)
      .overlay(alignment: .top) { grabber }
      // The shape runs under the keyboard and the home indicator to the
      // screen's foot, where the display's own corners finish it. Its top
      // corners are the frame line's (`FieldHomeModel.liveCardOutline`).
      .mask {
        UnevenRoundedRectangle(
          topLeadingRadius: FieldHomeModel.livePanelCorner, topTrailingRadius: FieldHomeModel.livePanelCorner
        )
        .ignoresSafeArea(.all, edges: .bottom)
      }
      .offset(y: pull)
      .accessibilityElement(children: .contain)
      .accessibilityAddTraits(.isModal)
      .accessibilityAction(.escape) { onClose() }
  }

  /// 36 by 5, 6 under the top edge, as the system draws a sheet's. It takes no
  /// touch (the handle under it does); a screen reader finds it as the way out.
  private var grabber: some View {
    Capsule()
      .fill(Color.primary.opacity(FieldHomeModel.livePanelGrabberInk))
      .frame(width: FieldHomeModel.livePanelGrabber.width, height: FieldHomeModel.livePanelGrabber.height)
      .padding(.top, FieldHomeModel.livePanelGrabberTop)
      .environment(\.colorScheme, isTerminal ? inkScheme : scheme)
      .allowsHitTesting(false)
      .accessibilityElement()
      .accessibilityLabel("Close")
      .accessibilityAddTraits(.isButton)
      .accessibilityAction { onClose() }
  }
}

/// The home under a card's panel (PF-9): one blurred picture that takes no
/// touch and that a screen reader does not find. One modifier, always applied,
/// so the home under it is the same view whether a panel stands or not.
struct UnderCardPanel: ViewModifier {
  /// `FieldHomeModel.livePanelBlur(full:standing:pull:height:)`: nothing while no panel stands.
  let blur: CGFloat
  /// A panel stands, or is on its way out.
  let covered: Bool

  func body(content: Content) -> some View {
    content
      // The plain blur, never the opaque one. The home's bounds end at the
      // safe area and its field runs past them, under the status bar and the
      // home indicator. An opaque blur cuts the picture at those bounds: a
      // hard edge at the status bar's foot, and with the bounds padded out to
      // the screen's, black bled in from the strips it had cut (both seen
      // 2026-11-22 on the simulator). The plain blur takes the whole picture.
      // At a radius of nothing it adds no layer and no filter (read the same
      // day from the window's layer tree: the home carries a `gaussianBlur`
      // only while a panel stands).
      .blur(radius: blur)
      .allowsHitTesting(!covered)
      .accessibilityHidden(covered)
  }
}
