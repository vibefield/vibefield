import FieldDesign
import FieldProduct
import SwiftUI

// ES-5c (track ES; ES-D1…D7 A; DESIGN.md §8 "The phone's Chat", Empty: the night; §2.4 "On the night, the night's ink"; §5
// night glass) — CHAT, EMPTY, ON THE PHONE: the hatch's night full bleed under the large title, and on it, in the night's
// ink, the Mac's words at touch pitch: the headline, the sentence, New spark as a wide pill, and under "Or give it a first
// job" the hello's three starters in night glass. While the starters are read they hold their places, wordless. With no
// agent at the home that can be a spark, New spark is Off and the sentence under it names the ones that can; no job is
// offered, and no settings button stands, for the phone has no such door. A panel too short for the jobs lets them go.
// The close onto the sheet's sky is ES-5e: until then the system sheet rises over the night.

struct ChatNightView: View {
  let agents: ChatNight.Agents
  let starters: ChatStarters.Reading
  let homeName: String
  let onNewSpark: () -> Void
  let onJob: (ChatStarter) -> Void

  /// §8's measures at touch pitch; the gaps are the Mac's (§8 "Chat's list", Empty: the night).
  static let headline: CGFloat = 30
  static let sentence: CGFloat = 15
  static let label: CGFloat = 13
  static let starterHeight: CGFloat = 48
  static let starterGap: CGFloat = 10
  static let column: CGFloat = 420

  @State private var night = HatchNightHandle()
  @State private var arrived = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      HatchNightView(handle: night)
        .ignoresSafeArea()
      hush
      ViewThatFits(in: .vertical) {
        column(jobs: true)
        column(jobs: false)
      }
      .padding(.horizontal, 24)
    }
    .contentShape(Rectangle())
    .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in night.wake() })
    .onAppear { arrived = true }
  }

  /// §5: behind the words a hush of the night, so no star crosses them.
  private var hush: some View {
    EllipticalGradient(
      colors: [ChromePalette.nightHush, ChromePalette.nightHush.opacity(0)], center: .center, startRadiusFraction: 0,
      endRadiusFraction: 0.72
    )
    .frame(maxWidth: .infinity)
    .frame(height: 440)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func column(jobs: Bool) -> some View {
    let off = ChatNight.offNames(agents)
    return VStack(spacing: 0) {
      Text(ChatNightWords.headline)
        .font(ChromeType.sans(Self.headline, .light))
        .tracking(-0.6)
        .foregroundStyle(ChromePalette.nightInkPrimary)
        .multilineTextAlignment(.center)
        .accessibilityAddTraits(.isHeader)
      Text(ChatNightWords.sentence)
        .font(ChromeType.sans(Self.sentence))
        .foregroundStyle(ChromePalette.nightInkSecondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 12)
      Button(action: onNewSpark) {
        HStack(spacing: 8) {
          FieldGlyph(.sparkle, size: 18)
          Text(NewSparkWords.title)
        }
      }
      .buttonStyle(NightPillStyle())
      .disabled(off != nil)
      .padding(.top, 26)
      if let off {
        Text(ChatNight.offWords(off, home: homeName))
          .font(ChromeType.sans(Self.sentence))
          .foregroundStyle(ChromePalette.nightInkSecondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 14)
      } else if jobs {
        Text(ChatNightWords.jobs)
          .font(ChromeType.sans(Self.label, .medium))
          .foregroundStyle(ChromePalette.nightInkTertiary)
          .padding(.top, 30)
        VStack(spacing: Self.starterGap) {
          ForEach(Array(starters.starters.enumerated()), id: \.element.glyph) { index, starter in
            job(starter, at: index)
          }
        }
        .padding(.top, 12)
      }
    }
    .frame(maxWidth: Self.column)
  }

  /// One starter in night glass: as wide as its words, which it wraps as the hello's do. Held, it keeps its place,
  /// wordless; read, its words come in over 420ms.
  private func job(_ starter: ChatStarter, at index: Int) -> some View {
    let held = starters.isHeld
    return Button {
      onJob(starter)
    } label: {
      HStack(spacing: 8) {
        FieldGlyph(ChatThreadView.glyph(starter.glyph), size: 16)
          .foregroundStyle(ChromePalette.nightInkSecondary)
        Text(starter.words)
          .font(ChromeType.sans(Self.sentence, .medium))
          .foregroundStyle(ChromePalette.nightInkPrimary)
          .multilineTextAlignment(.leading)
          .fixedSize(horizontal: false, vertical: true)
      }
      .opacity(held ? 0 : 1)
      .animation(.easeInOut(duration: 0.42), value: held)
    }
    .buttonStyle(NightGlassStyle(height: Self.starterHeight))
    .disabled(held)
    .accessibilityHidden(held)
    .opacity(arrived ? 1 : 0)
    .offset(y: arrived || reduceMotion ? 0 : 8)
    .animation(
      reduceMotion ? Animation.easeOut(duration: 0.12) : FieldMotion.ease(0.24).delay(Double(index) * 0.026),
      value: arrived)
  }
}

/// The kit's primary in its night look (§2.4): the foreground's fill under the inverse ink, a wide pill. Off, it wears
/// §7's Off in the night's ramp, which is the quiet glass and its words in t4, never the live pill faded.
private struct NightPillStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(ChromeType.sans(16, .semibold))
      .lineLimit(1)
      .padding(.horizontal, 18)
      .frame(maxWidth: .infinity)
      .frame(height: ChromePillStyle.wideHeight)
      .contentShape(Capsule())
      .modifier(NightPillPaint(pressed: configuration.isPressed))
  }
}

/// A modifier, because a style is no view and only a view reads `isEnabled`.
private struct NightPillPaint: ViewModifier {
  let pressed: Bool
  @Environment(\.isEnabled) private var isEnabled

  func body(content: Content) -> some View {
    content
      .foregroundStyle(isEnabled ? ChromePalette.nightForegroundInverse : ChromePalette.nightInkFaint)
      .background {
        Capsule()
          .fill(isEnabled ? ChromePalette.nightForeground : ChromePalette.nightGlass)
          .overlay {
            if !isEnabled { Capsule().strokeBorder(ChromePalette.nightGlassRing, lineWidth: 1) }
          }
      }
      .overlay {
        Capsule()
          .fill(ChromePalette.keyPressedFill)
          .opacity(pressed ? 1 : 0)
      }
      .animation(FieldMotion.ease(0.08), value: pressed)
  }
}

/// §5's night glass: white at 7% ringed by white at 14%, 12% while pressed, where the Mac's pointer would lean on it. The
/// system's thin material in its dark look stands for the Mac's 16 blur (`ChromePalette.nightGlassBlur`).
private struct NightGlassStyle: ButtonStyle {
  let height: CGFloat

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .padding(.horizontal, 16)
      .frame(minHeight: height)
      .contentShape(Capsule())
      .background {
        Capsule()
          .fill(.ultraThinMaterial)
          .environment(\.colorScheme, .dark)
      }
      .overlay {
        Capsule().fill(configuration.isPressed ? ChromePalette.nightGlassPressed : ChromePalette.nightGlass)
      }
      .overlay {
        Capsule().strokeBorder(ChromePalette.nightGlassRing, lineWidth: 1)
      }
      .animation(FieldMotion.ease(0.08), value: configuration.isPressed)
  }
}
