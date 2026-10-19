import FieldDesign
import FieldInput
import SwiftUI

/// Item 42 — the readout a live card stands in its empty rows while another
/// client drives its session (DESIGN.md §8, "A live card another client is
/// driving"; Phone A, ruled 2026-10-19 21:38Z). The desktop's held-edge figure
/// at the phone's scale: the holder's name huge and "is driving" at 40%, one
/// caption line under them, over a veil of the terminal's ground at 62%, the
/// content dimmed beneath it and never hidden. The light is text main, so the
/// host hands this view the ground's ramp: a glow inside the sheet's edge and a
/// bloom behind the words, the desktop's recipe in that ink.
///
/// It fills the live card. The words stand in the card's empty rows
/// (`FieldHomeModel.seatWordsCentre`); the veil covers the card and the glow
/// the sheet. The entrance plays once, as the readout first stands, after the
/// 400ms wait (`FieldHomeModel.SeatEntrance`), then holds still; the readout
/// leaves at once, with the view. None of it takes a touch: one on the grid
/// goes through and takes the seat back (DS-D5).
struct SeatReadoutView: View {
  let readout: FieldHomeModel.SeatReadout
  let ground: CardGround

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// For the floating input row's footprint, which the words keep above.
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  /// Set once, as the readout first stands: every part's entrance hangs off it.
  @State private var entered = false

  private typealias Entrance = FieldHomeModel.SeatEntrance

  init(readout: FieldHomeModel.SeatReadout, ground: CardGround) {
    self.readout = readout
    self.ground = ground
  }

  var body: some View {
    ZStack {
      ground.color.opacity(FieldHomeModel.liveCardHeldVeil)
        .opacity(shown ? 1 : 0)
        .animation(entrance(Entrance.veil, FieldMotion.plainEase), value: entered)
      glow
      GeometryReader { proxy in
        let band = FieldHomeModel.liveCardBand
        let centre = FieldHomeModel.seatWordsCentre(
          grid: proxy.size.height - band, heldRows: readout.heldRows,
          lineHeight: readout.lineHeight, footReserve: ClosedRow.footprint(for: dynamicTypeSize))
        ZStack {
          bloom
          words
        }
        .position(x: proxy.size.width / 2, y: band + centre)
      }
    }
    // M6: under reduced motion the whole of it fades in over 100ms, after the
    // same wait, and nothing in it moves.
    .opacity(reduceMotion && !entered ? 0 : 1)
    .animation(
      reduceMotion
        ? FieldMotion.plainEase(Entrance.reduced.duration).delay(FieldHomeModel.seatVeilWait) : nil,
      value: entered)
    .allowsHitTesting(false)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "\(readout.name) \(FieldHomeModel.SeatReadout.verb). Touch the terminal to take it back.")
    .onAppear { entered = true }
  }

  /// Whether the parts stand where they end: once entered, and always under
  /// reduced motion, where the readout fades in whole instead.
  private var shown: Bool { entered || reduceMotion }

  /// A part's own animation, after the wait; none under reduced motion.
  private func entrance(
    _ part: FieldHomeModel.EntrancePart, _ curve: (Double) -> Animation
  ) -> Animation? {
    guard !reduceMotion else { return nil }
    return curve(part.duration).delay(FieldHomeModel.seatVeilWait + part.delay)
  }

  /// The light at the sheet's edge: `inset 0 0 30px 2px` at 74% and `inset 0 0
  /// 130px 18px` at 30%, following the sheet's corners to its foot.
  private var glow: some View {
    let outline = FieldHomeModel.liveCardOutline
    return ZStack {
      outline.insetGlow(FieldPalette.textMain.opacity(0.74), blur: 30, spread: 2)
      outline.insetGlow(FieldPalette.textMain.opacity(0.3), blur: 130, spread: 18)
    }
    .opacity(shown ? 1 : 0)
    .animation(entrance(Entrance.glow, FieldMotion.island), value: entered)
    .ignoresSafeArea(edges: .bottom)
  }

  /// The bloom behind the words: a 600 × 380 ellipse, 50% at its heart through
  /// 16% at 52% to clear, growing from 0.4 as it comes in.
  private var bloom: some View {
    EllipticalGradient(
      stops: [
        .init(color: FieldPalette.textMain.opacity(0.5), location: 0),
        .init(color: FieldPalette.textMain.opacity(0.16), location: 0.52),
        .init(color: FieldPalette.textMain.opacity(0), location: 1),
      ],
      center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5
    )
    .frame(width: 600, height: 380)
    .opacity(shown ? 1 : 0)
    .scaleEffect(shown ? 1 : Entrance.bloomScaleFrom)
    .animation(entrance(Entrance.bloom, FieldMotion.island), value: entered)
  }

  /// The name, the verb at 40% under it, and the caption line, 72%, rising 8pt
  /// as it comes in, haloed in the ground (the canvas's 12 and 6).
  private var words: some View {
    VStack(spacing: FieldHomeModel.seatVerbGap) {
      line(readout.name, figure: .name, ink: FieldPalette.textMain)
      line(FieldHomeModel.SeatReadout.verb, figure: .verb, ink: FieldPalette.textMain.opacity(0.4))
      Text(FieldHomeModel.SeatReadout.caption)
        .font(ChromeType.sans(FieldHomeModel.seatCaptionSize, .semibold))
        .foregroundStyle(FieldPalette.textMain.opacity(0.72))
        .lineLimit(1)
        .shadow(color: ground.solid, radius: 6)
        .shadow(color: ground.solid, radius: 3)
        .padding(.top, FieldHomeModel.seatCaptionGap - FieldHomeModel.seatVerbGap)
        .opacity(shown ? 1 : 0)
        .offset(y: shown ? 0 : Entrance.captionRise)
        .animation(entrance(Entrance.caption, FieldMotion.island), value: entered)
    }
    .padding(.horizontal, 24)
  }

  /// One line of the huge words: 800 at 56pt with a line height of 1 — the
  /// line's box is the size and the glyphs overflow it, as CSS's do — at
  /// −0.04em, a long name scaled to the card's width and never cut. Haloed in
  /// the ground (the desktop's 40 and 18: CSS blurs, half each as SwiftUI's
  /// radius, as the kit's shadows convert them) and drawn letter by letter on
  /// the entrance's clock (`SeatLetters`).
  private func line(_ text: String, figure: SeatLetters.Figure, ink: Color) -> some View {
    let size = FieldHomeModel.seatWordsSize
    return Text(text)
      .font(ChromeType.sans(size, .heavy))
      .tracking(FieldHomeModel.seatWordsTracking * size)
      .foregroundStyle(ink)
      .lineLimit(1)
      .minimumScaleFactor(0.4)
      .textRenderer(SeatLetters(clock: shown ? Entrance.length : 0, figure: figure, size: size))
      .animation(
        reduceMotion ? nil : .linear(duration: Entrance.length).delay(FieldHomeModel.seatVeilWait),
        value: entered)
      .fixedSize(horizontal: false, vertical: true)
      .frame(height: size)
      .shadow(color: ground.solid, radius: 20)
      .shadow(color: ground.solid, radius: 9)
  }
}

/// The readout's huge words, drawn glyph by glyph on one clock: `clock` seconds
/// into the entrance (`FieldHomeModel.SeatEntrance`). The name's letters rise
/// half an em on the pop, each in its turn; the verb tracks in from .34em on
/// the island curve, about its own middle. The layout is the text's own, at
/// its final tracking: this only moves and fades what it draws.
private struct SeatLetters: TextRenderer {
  enum Figure {
    case name
    case verb
  }

  var clock: Double
  let figure: Figure
  /// The words' size, which an em of motion is measured in.
  let size: CGFloat

  var animatableData: Double {
    get { clock }
    set { clock = newValue }
  }

  func draw(layout: Text.Layout, in context: inout GraphicsContext) {
    let glyphs = layout.flatMap { line in line }.flatMap { run in run }
    switch figure {
    case .name:
      for (index, glyph) in glyphs.enumerated() {
        let pop = FieldMotion.popCurve.value(
          at: FieldHomeModel.SeatEntrance.letter(index).progress(at: clock))
        var letter = context
        letter.opacity = min(max(pop, 0), 1)
        letter.translateBy(x: 0, y: (1 - pop) * FieldHomeModel.SeatEntrance.letterRise * size)
        letter.draw(glyph)
      }
    case .verb:
      let island = FieldMotion.islandCurve.value(
        at: FieldHomeModel.SeatEntrance.verb.progress(at: clock))
      let spacing =
        (FieldHomeModel.SeatEntrance.verbTrackingFrom - FieldHomeModel.seatWordsTracking) * size
        * (1 - island)
      let middle = Double(glyphs.count - 1) / 2
      for (index, glyph) in glyphs.enumerated() {
        var letter = context
        letter.opacity = min(max(island, 0), 1)
        letter.translateBy(x: (Double(index) - middle) * spacing, y: 0)
        letter.draw(glyph)
      }
    }
  }
}
