import FieldProduct
import SwiftUI

// PG-8 — THE RAIN VIEW: puppeteer-views 0.3.3's `rain` on the phone's Godview stage, `case .rain:
// framed(RainView(input: input))` (PG-4t's arm). A `.flow` stage: it runs from the screen's top to the band's top, and
// the rain paints ALL of it — its black ground and its streams from y 0 — while 4t's dissolve masks it under the
// Stories row (DESIGN.md §8 "The phone's Stories row"; never a fade of the rain's own). Its own words, the empty
// stage's, stand below the reserve (`input.insets(.flow).top`). No scanlines and no vignette over it (J-S3, drop).
// The desktop's touch tooltip is James's to pick (`RainTouchPeek`); a tap opens the card, as the click selects.

struct RainView: View {
  let input: GodviewStageInput
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      RainSurface(
        rows: input.rows, activeId: input.activeId, isActive: input.isActive,
        moving: !input.isStill && !reduceMotion, onOpen: input.onOpen)
      if input.rows.isEmpty {
        RainEmpty(skin: input.skin)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(.top, input.insets(.flow).top)
      }
    }
    .background(RainPalette.rain.colour(RainPalette.rain.stage))
  }
}

/// The empty stage (RainView.js:261, `rain.css:173-200`): the desktop's two lines (fd's Q8; the second in the phone's
/// words, `RainField.emptyLine`), in the rain's type — the stream's green at 65%, Courier New, centred; the line below
/// in the skin's faint text.
struct RainEmpty: View {
  let skin: GodviewSkin

  var body: some View {
    let palette = RainPalette.rain
    VStack(spacing: 6) {
      // 800 asks for more than Courier New has: the browser draws its bold, so the bold face, by name
      Text(RainField.emptyTitle)
        .font(.custom(RainAtlas.fontName, size: 11))
        .tracking(11 * 0.18)
        .foregroundStyle(palette.colour(palette.inkWorking, opacity: palette.emptyInkOpacity))
      // the container's `letter-spacing: 0.08em` is computed at ITS 10px and inherited as that length
      Text(RainField.emptyLine)
        .font(.custom("CourierNewPSMT", size: 9))
        .tracking(10 * 0.08)
        .foregroundStyle(skin.textFaint)
    }
    .multilineTextAlignment(.center)
    .accessibilityElement(children: .combine)
  }
}

extension RainPalette {
  /// A palette head (`#rrggbb`) as SwiftUI's colour, gamma-encoded as the canvas reads it.
  func colour(_ hex: String, opacity: Double = 1) -> Color {
    let rgba = RainRenderer.colour(hex, opacity: opacity)
    return Color(.sRGB, red: Double(rgba.x), green: Double(rgba.y), blue: Double(rgba.z), opacity: Double(rgba.w))
  }
}
