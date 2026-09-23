import SwiftUI
import UIKit

/// The ONE drawing of a user, for every surface that shows one (DESIGN.md
/// §2.8): the account corner, its menu's rows, a sheet's head. The desktop's
/// `UserFaceView` (design-kit `./face`), transcribed.
///
/// Two frames. The STICKER (the default) is the emoji as its own frame — a
/// die-cut paper edge (`StickerRenderer`), a stable per-user tilt, a soft
/// shadow, and a lift while held. The COIN (a user's own choice) mints the
/// same emoji in pewter, and its detail switches on by size. A user is known
/// by form, never by hue: nothing here takes a colour but the emoji.
public struct UserFaceView: View {
  private let face: UserFace
  private let size: CGFloat
  private let seed: String
  private let held: Bool
  private let label: String?

  /// - Parameters:
  ///   - face: the emoji and its frame.
  ///   - size: the rendered edge, in points.
  ///   - seed: what the sticker's tilt is dealt from — the user id, so a user
  ///     sits at one angle everywhere they appear.
  ///   - held: the lifted pose — the corner's face while its menu is open.
  ///   - label: the accessible name ("James, 🦊"). Omit it where the face sits
  ///     beside the name already; a decorative face is hidden from assistive
  ///     tech (I-4).
  public init(face: UserFace, size: CGFloat, seed: String, held: Bool = false, label: String? = nil) {
    self.face = face
    self.size = size
    self.seed = seed
    self.held = held
    self.label = label
  }

  public var body: some View {
    Group {
      switch face.frame {
      case .sticker: StickerFace(emoji: face.emoji, size: size, seed: seed, held: held)
      case .coin: CoinFace(emoji: face.emoji, size: size, held: held)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(label == nil)
    .accessibilityLabel(label ?? "")
  }
}

// MARK: - The sticker

private struct StickerFace: View {
  let emoji: String
  let size: CGFloat
  let seed: String
  let held: Bool
  @Environment(\.displayScale) private var displayScale
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let tilt = FaceDeck.tilt(seed: seed, size: size)
    let lifts = size >= FaceDeck.Threshold.lift && held
    let canvas = StickerRenderer.canvas(for: size)
    Group {
      if let image = StickerRenderer.image(emoji: emoji, size: size, scale: displayScale) {
        Image(uiImage: image)
          .resizable()
          .frame(width: canvas, height: canvas)
      } else {
        // No Core Image on this host: the bare emoji, honest and unframed.
        Text(emoji)
          .font(.system(size: size * StickerRenderer.figureRatio))
          .lineLimit(1)
      }
    }
    // Held, like a card (§7): the tilt relaxes to 35 % and the figure lifts
    // 1.07×; the shadow rises from `0 3% 4.5%` to `0 7% 9%`.
    .rotationEffect(.degrees(lifts ? (tilt * 35).rounded() / 100 : tilt))
    .scaleEffect(lifts ? 1.07 : 1)
    .shadow(
      color: FaceTokens.stickerShadow,
      radius: size * (lifts ? 0.09 : 0.045) / 2,
      x: 0, y: size * (lifts ? 0.07 : 0.03))
    // M6: the same lift in 90 ms, ease-out, under reduced motion.
    .animation(reduceMotion ? .easeOut(duration: 0.09) : FieldMotion.ease(0.18), value: held)
    .frame(width: size, height: size)
  }
}

// MARK: - The coin

private struct CoinFace: View {
  let emoji: String
  let size: CGFloat
  let held: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let rim = size * 0.085
    let figure = size * (size <= 20 ? 0.66 : 0.58)
    ZStack {
      // The rim: a conic gradient from 210°, bevelled light above and dark below.
      Circle()
        .fill(AngularGradient(stops: FaceTokens.coinRimStops, center: .center, angle: .degrees(210)))
        .overlay {
          Circle().strokeBorder(
            LinearGradient(
              colors: [FaceTokens.coinBevelLight, .clear, FaceTokens.coinBevelDark],
              startPoint: .top, endPoint: .bottom),
            lineWidth: 1)
        }
      // The field, sunk by an inset shadow.
      Circle()
        .fill(
          RadialGradient(
            stops: FaceTokens.coinFieldStops, center: UnitPoint(x: 0.34, y: 0.28),
            startRadius: 0, endRadius: size * 0.6))
        .overlay {
          Circle()
            .strokeBorder(FaceTokens.coinInset, lineWidth: size * 0.06)
            .blur(radius: size * 0.03)
            .offset(y: size * 0.02)
            .mask(Circle())
        }
        .padding(rim)
      // Beading from 44 pt: the §2.1 dots, in the coin's ink at 70 %.
      if size >= FaceDeck.Threshold.beading {
        Canvas { context, _ in
          let center = CGPoint(x: size / 2, y: size / 2)
          let ring = size / 2 - rim - size * 0.04
          let count = max(12, Int((2 * .pi * ring / (size * 0.045)).rounded()))
          let radius = max(0.55, size * 0.0095)
          for index in 0..<count {
            let angle = Double(index) / Double(count) * 2 * .pi
            let point = CGPoint(x: center.x + ring * cos(angle), y: center.y + ring * sin(angle))
            let dot = CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
            context.fill(Path(ellipseIn: dot), with: .color(FaceTokens.coinInk.opacity(0.7)))
          }
        }
      }
      // The figure, raised off the field by a small drop.
      Text(emoji)
        .font(.system(size: figure))
        .lineLimit(1)
        .shadow(color: FaceTokens.coinRelief, radius: max(0.5, size * 0.02) / 2, x: 0, y: max(0.5, size * 0.014))
      // The light it catches.
      Circle()
        .fill(
          RadialGradient(
            colors: [FaceTokens.coinSheen, .clear], center: UnitPoint(x: 0.5, y: 0.06),
            startRadius: 0, endRadius: size * 0.55))
        .allowsHitTesting(false)
    }
    .frame(width: size, height: size)
    .shadow(color: FaceTokens.coinShadow, radius: size * 0.12 / 2, x: 0, y: size * 0.05)
    .shadow(color: FaceTokens.coinShadowContact, radius: size * 0.025 / 2, x: 0, y: size * 0.012)
    // A coin neither tilts nor lifts; its host's hold scales it 1.05×.
    .scaleEffect(held ? 1.05 : 1)
    .animation(reduceMotion ? .easeOut(duration: 0.09) : FieldMotion.ease(0.18), value: held)
  }
}
