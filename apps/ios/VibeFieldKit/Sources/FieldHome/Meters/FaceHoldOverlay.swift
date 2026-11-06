import FieldDesign
import FieldProduct
import SwiftUI

// UM-4 (UM-D24 A; DESIGN.md §8 "The phone's corner": "Held", "With one profile", "With several", "Reduced motion") —
// THE HELD FACE, DRAWN: one layer over the whole screen, above the tabs and never clipped to the corner. The veil (the
// ground at 82%, fading in over 180 ms); the huge words 112 from the top (52/800, tracked −0.045 em, a verb at 40%)
// over the mono line (11/700 capitals, tracked 0.08 em, the tertiary ink); the circle at 206 on a disc of the ground
// (the one profile's; the reached profile's, or every plan's on the hub; none on open ground); the face drawn again in
// its 62 glass where the corner stands, held, wearing the Bands ring (96, the hole 34, the band 8); and with several
// profiles, the buds (54, ringed by the ink at 14%) at `FaceHold.spots`, each labelled along its spoke. A reached bud
// grows to 1.16 with a drop shadow and its neighbours shrink to 0.94 on §6's lift (180 ms). The haptics are the spawn
// bloom's (`BloomHost`: a soft impact as it opens, a selection tick at each new reach). Reduced motion: the buds stand
// at their size behind a 90 ms fade, with no pop and no reach growth; the veil and the words fade. What it shows is
// `FaceHold`'s.

/// What the corner hands its face for the hold: where the face stands, the hold's moments, and VoiceOver's acts.
struct FaceHoldActs {
  /// the face's centre in the window, whenever it moves
  let place: (CGPoint) -> Void
  /// the hold completed: the held face opens
  let begin: () -> Void
  /// the finger, in the window
  let move: (CGPoint) -> Void
  /// let go
  let end: () -> Void
  /// the hold was taken away before a let-go (a call, Control Center, the system taking the touch, the face
  /// replaced): the held face closes and nothing is let go
  let cancel: () -> Void
  /// what VoiceOver offers in place of the hold
  let actions: [FaceHold.Action]
  let perform: (FaceHold.Act) -> Void
}

struct FaceHoldOverlay: View {
  let held: FaceHold.Held
  let reading: MetersReading
  let now: Date
  /// the home's name in the words ("studio doesn't share usage yet")
  let home: String
  let face: FieldHomeModel.AccountFace
  let seed: String

  /// §6's lift (`--vf-ease-lift`, 180 ms), as the spawn bloom's buds take it.
  static let lift = FieldMotion.lift(0.18)
  static let veil = 0.82
  static let wordsTop: CGFloat = 112
  static let circle: Double = 206
  static let ring: Double = 96

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shown = false

  var body: some View {
    let profiles = reading.profiles
    let several = profiles.count > 1
    let mark = MeterCatalog(rows: reading.catalog).mark
    ZStack(alignment: .topLeading) {
      FieldPalette.panelBackground.opacity(Self.veil)
      VStack(spacing: 18) {
        wordsView(FaceHold.words(reading, reach: held.reach, home: home, now: now))
        if let whose = circleMeters(several) {
          circleView(whose.meters, every: whose.every, mark: mark)
        }
      }
      .frame(maxWidth: .infinity)
      .padding(.top, Self.wordsTop)
      heldFace(several: several, mark: mark)
      if several {
        ForEach(Array(FaceHold.spots(profiles.count, face: held.face).enumerated()), id: \.offset) { index, spot in
          bud(profiles[index], spot: spot, mark: mark)
        }
      }
    }
    .ignoresSafeArea()
    .opacity(shown ? 1 : 0)
    .allowsHitTesting(false)
    .sensoryFeedback(.impact(flexibility: .soft), trigger: shown) { _, opened in opened }
    .sensoryFeedback(.selection, trigger: held.reach)
    .onAppear {
      withAnimation(FieldMotion.plainEase(reduceMotion ? 0.09 : 0.18)) { shown = true }
    }
  }

  // MARK: - The words, and the circle under them

  private func wordsView(_ words: FaceHold.Words) -> some View {
    VStack(spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 0) {
        if let verb = words.verb {
          Text("\(verb) ")
            .foregroundStyle(ChromePalette.ink.opacity(0.4))
        }
        Text(words.rest)
          .foregroundStyle(ChromePalette.ink)
      }
      .font(.system(size: 52, weight: .heavy))
      .tracking(-0.045 * 52)
      .lineLimit(1)
      .minimumScaleFactor(0.5)
      Text(words.line)
        .font(.system(size: 11, weight: .bold, design: .monospaced))
        .textCase(.uppercase)
        .tracking(0.08 * 11)
        .foregroundStyle(ChromePalette.inkTertiary)
    }
    .padding(.horizontal, 16)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.updatesFrequently)
  }

  /// The circle under the words: the one profile's; with several, the reached profile's, or every plan's on the hub;
  /// none on open ground.
  private func circleMeters(_ several: Bool) -> (meters: ProfileMeters, every: Bool)? {
    guard several else { return (reading.meters(of: reading.profiles.first?.id, now: now), false) }
    switch held.reach {
    case .hub: return (reading.meters(of: nil, now: now), true)
    case .bud(let id): return (reading.meters(of: id, now: now), false)
    case .open: return nil
    }
  }

  private func circleView(_ meters: ProfileMeters, every: Bool, mark: @escaping (String) -> String) -> some View {
    BandsDial(
      geometry: BandsLayout.geometry(Self.circle, meters.entries, .held(every: every)),
      ground: FieldPalette.panelBackground, mark: mark
    )
    .padding(12)
    .background(Circle().fill(FieldPalette.panelBackground))
  }

  // MARK: - The face, held

  /// The face in its 62 glass where the corner stands, held, wearing the ring of its plans or the reached profile's.
  private func heldFace(several: Bool, mark: @escaping (String) -> String) -> some View {
    let reached: String? = {
      if case .bud(let id) = held.reach { return id }
      return several ? nil : reading.profiles.first?.id
    }()
    let ring = BandsLayout.geometry(
      Self.ring, reading.meters(of: reached, now: now).entries, .faceRing(every: reached == nil))
    return ZStack {
      BandsDial(geometry: ring, ground: FieldPalette.panelBackground, mark: mark)
      Color.clear
        .frame(width: AccountCornerView.circle, height: AccountCornerView.circle)
        .liquidGlassCircle()
      faceView
    }
    .position(held.face)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private var faceView: some View {
    switch face.control {
    case .face(let userFace):
      UserFaceView(face: userFace, size: AccountCornerView.faceSize, seed: seed, held: true)
    case .blank, .signIn:
      Image(systemName: "person")
        .font(.system(size: 24, weight: .regular))
        .foregroundStyle(ChromePalette.inkSecondary)
    }
  }

  // MARK: - The buds

  private func bud(_ set: AgentProfileSet, spot: FaceHold.Spot, mark: @escaping (String) -> String) -> some View {
    let reached: String? = {
      if case .bud(let id) = held.reach { return id }
      return nil
    }()
    let on = reached == set.id
    let scale: CGFloat = reduceMotion ? 1 : on ? 1.16 : reached != nil ? 0.94 : 1
    let label = FaceHold.budLabel(set, reading: reading, now: now)
    let out = FaceHold.labelRadius(spot, letters: set.label.count, reached: on)
    let a = spot.angle * Double.pi / 180
    let shadow = on ? ChromeShadow.menu : ChromeShadow.card
    return ZStack(alignment: .topLeading) {
      BandsDial(
        geometry: BandsLayout.geometry(
          FaceHold.bud, reading.meters(of: set.id, now: now).entries, .bud),
        profile: MeterModel.profileOf(set), ground: ChromePalette.menuSurface, mark: mark
      )
      .background {
        Circle()
          .fill(ChromePalette.menuSurface)
          .overlay { Circle().strokeBorder(ChromePalette.ink.opacity(0.14), lineWidth: 1) }
          .shadow(color: shadow.color, radius: shadow.radius, y: shadow.y)
      }
      .scaleEffect(reduceMotion ? 1 : shown ? scale : 0.6)
      .animation(reduceMotion ? nil : Self.lift, value: scale)
      .animation(reduceMotion ? nil : .timingCurve(FieldMotion.popCurve, duration: 0.36), value: shown)
      .position(x: spot.x, y: spot.y)
      VStack(spacing: 1) {
        Text(label.name)
          .font(.system(size: 9.5, weight: .bold, design: .monospaced))
          .textCase(.uppercase)
          .foregroundStyle(ChromePalette.ink)
        Text(label.state)
          .font(.system(size: 7.5, weight: .heavy, design: .monospaced))
          .foregroundStyle(label.hot ? ChromePalette.attention : ChromePalette.inkTertiary)
      }
      .fixedSize()
      .position(x: Double(held.face.x) + out * cos(a), y: Double(held.face.y) + out * sin(a))
    }
    .accessibilityHidden(true)
  }
}
