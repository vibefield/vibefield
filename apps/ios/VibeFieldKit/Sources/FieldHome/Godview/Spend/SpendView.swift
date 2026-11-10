import FieldAgents
import FieldDesign
import FieldProduct
import FieldSwarm
import SwiftUI
import UIKit

// PG-7 — SPEND, DRAWN (kit-only: the swarm's theme, its sprites and the words' measure are UIKit's). puppeteer-views
// 0.3.3's spend (`52d09c8e`, the spend module `5abe8f75`: `SpendView.js` :116-644 and `spend.css`), with 0.4.0's
// narrow hero at `e6e4753de` (#101: `measure` in the hero's two faces; its caption stays undrawn at narrow, below),
// on the phone, over
// `SpendModel` (what it lays out), `SpendScene` (what the canvas draws) and `SpendPaint` (the canvas). The view
// stands in `GodviewStage.framed`, a FLOW stage (PG-4t: from the screen's top to the band's top). Its ground fills the
// stage, and its own box starts below the Stories row's reserve (`input.insets(.flow).top`; insets are data,
// DESIGN.md "Stage insets replace host padding rules"). It draws no scanlines, no vignette and no dissolve: those
// are the stage's (J-S3, PG-4t).
//
// The DOM is laid as the window lays it, every element absolutely placed at the model's own numbers (P7 holds them
// to the shipping view's DOM). Its typography and inks are spend.css's, and the paint is by eye on the stills (Q2).
// Where the phone differs:
// - Touch is the pointer (fd's Q3, held by H9 on the acts and H14 on the list). A finger on the chart is the
//   pointer. A lift within 4 pt of its press is the click: it opens a line in reach, else sets the moment, else lets
//   it go within 8 pt of it. A drag sets nothing, and a cancelled touch taps nothing. A finger on the list holds its
//   order and lights its row; a drag on the list steps it a whole row at a time, and a tap opens a row. There are no
//   keys, no hover and no focus ring. A gesture's end comes twice, its lift and its state's reset, in either order;
//   every act names its touch by token, so either order is the same one tap (H15, H16).
// - The words name no key, hover or pane (fd's words rule; the four named deviations are `SpendModel.Dropped`).
// - SwiftUI names no 450, 550 or 650 weight, so each is the named weight at or below it (`SpendType.weight`). The
//   Now pill's backdrop blur is not drawn: its ground is the panel at 88 %, as the window's is under the blur.

struct SpendView: View {
  let input: GodviewStageInput

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var state = SpendModel.State()
  /// The finger on the chart: where it came down (a new start is a new touch) and its press's token, which its lift
  /// and its reset name.
  @State private var chartDown: CGPoint?
  @State private var chartToken: Int?
  /// The finger on the list: the same two.
  @State private var listDown: CGPoint?
  @State private var listToken: Int?
  @GestureState private var chartTouching = false
  @GestureState private var listTouching = false

  /// What lets a set moment go or the top ease: the frame's target and whether a held moment has slid out.
  private struct Settle: Equatable {
    let target: Double
    let release: Bool
  }

  private static let space = "spend.box"

  /// The host's animations switch and the person's reduced-motion preference (the window's `motion`): a still has
  /// neither a transition nor a loop.
  private var motion: Bool { !input.isStill && !reduceMotion }
  /// Whether the clock and the waves run: the field on screen, and no still.
  private var live: Bool { input.isActive && !input.isStill }

  var body: some View {
    GeometryReader { proxy in
      let size = proxy.size
      let g = Self.geometry(input, size: size)
      // The clock (:405-410): now moves about a pixel at a time.
      TimelineView(.animation(minimumInterval: SpendModel.clockEveryMs(g) / 1000, paused: !live)) { _ in
        box(Self.modelInput(input, size: size))
      }
      .frame(width: size.width, height: size.height, alignment: .topLeading)
    }
    .background(input.skin.monitorBg)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(SpendModel.viewLabel)
  }

  // MARK: - What the view reads from the stage

  /// What the view lays out from, read from the stage: the rows as spend reads them, its clock (a still's frozen
  /// one), its box under the reserve, and the words' measure. Held by K3 (and by H7, H11 and H12 on its parts).
  static func modelInput(_ input: GodviewStageInput, size: CGSize) -> SpendModel.Input {
    let box = SpendModel.box(width: size.width, height: size.height, topInset: input.insets(.flow).top)
    return SpendModel.Input(
      agents: SpendModel.agents(input.rows, unreadIds: input.unreadIds, activeId: input.activeId),
      nowMs: SpendModel.nowMs(input.now()), width: box.width, height: box.height, timeZone: .current,
      measure: Self.measure)
  }

  private static func geometry(_ input: GodviewStageInput, size: CGSize) -> SpendModel.Geometry {
    let box = SpendModel.box(width: size.width, height: size.height, topInset: input.insets(.flow).top)
    return SpendModel.geometryFor(width: box.width, height: box.height)
  }

  /// The window's `measure` (a canvas's `measureText`), in the system's sans: the state words at `600 12px`, a task
  /// (and a narrow hero's caption) at `400 12px`, the narrow hero's number at `300 20px` and its burn at `550 13px`
  /// (550 as `SpendType.weight` maps it: medium). No tracking and no tabular figures, as the window's canvas has none.
  nonisolated static func measure(_ text: String, _ style: SpendModel.TextStyle) -> Double {
    let font: UIFont =
      switch style {
      case .state: UIFont.systemFont(ofSize: 12, weight: .semibold)
      case .row: UIFont.systemFont(ofSize: 12, weight: .regular)
      case .heroFigure: UIFont.systemFont(ofSize: 20, weight: .light)
      case .heroRate: UIFont.systemFont(ofSize: 13, weight: .medium)
      }
    return Double((text as NSString).size(withAttributes: [.font: font]).width)
  }

  // MARK: - The box

  @ViewBuilder
  private func box(_ model: SpendModel.Input) -> some View {
    let frame = SpendModel.frame(model, state)
    let g = frame.g
    let inks = SpendInks(theme: SwarmTheme.resolve(input.skin.scheme), skin: input.skin)
    let drawn = Dictionary(input.rows.map { ($0.id, $0) }) { first, _ in first }
    let colours = SpendScene.colours(frame.lines, sib: frame.sib, dark: inks.dark) { meter in
      inks.base(drawn[meter.id].flatMap(input.colour))
    }
    let scene = SpendScene.scene(model, state, frame, colours: colours)
    let easing = state.yShown != nil && state.yShown != frame.target.max
    ZStack(alignment: .topLeading) {
      // The canvas, and the frames its waves and the easing top run on (`requestAnimationFrame`).
      TimelineView(.animation(paused: !(live && motion && (easing || SpendScene.moves(scene))))) { timeline in
        Canvas { context, _ in
          SpendPaint.paint(
            &context, scene, inks, time: timeline.date.timeIntervalSinceReferenceDate * 1000, waves: motion)
        }
        .frame(width: g.width, height: g.height)
        .onChange(of: timeline.date) {
          if easing { settle(model) }
        }
      }
      .accessibilityHidden(true)

      chartHit(g, model)
      words(frame, inks, colours)
      list(frame, model, inks, colours)
      if frame.empty { empty(inks) }
    }
    .frame(width: g.width, height: g.height, alignment: .topLeading)
    .clipped()
    .coordinateSpace(name: Self.space)
    .padding(.top, input.insets(.flow).top)
    .onChange(of: Settle(target: frame.target.max, release: state.held != nil && frame.pinned == nil), initial: true) {
      settle(model)
    }
  }

  /// The view's effects after a frame (`SpendModel.settle`): a set moment the window has slid past lets go, and the
  /// top eases a frame at a time (still, it lands at once).
  private func settle(_ model: SpendModel.Input) {
    var next = state
    SpendModel.settle(SpendModel.frame(model, state), &next, motion: motion)
    if next != state { state = next }
  }

  // MARK: - The chart's touch (fd's Q3)

  private func chartHit(_ g: SpendModel.Geometry, _ model: SpendModel.Input) -> some View {
    Color.clear
      .frame(width: g.x1 - g.x0 + 14, height: g.y1 - g.y0 + 22)
      .contentShape(Rectangle())
      .gesture(chartTouch(model))
      .accessibilityHidden(true)
      .placedAt(g.x0 - 6, g.y0 - 14)
      .onChange(of: chartTouching) { _, touching in
        // the gesture's reset, before or after its lift: the finger is gone (its press stays for its own lift)
        guard !touching, let token = chartToken else { return }
        chartDown = nil
        SpendModel.cancel(&state, token: token)
      }
  }

  private func chartTouch(_ model: SpendModel.Input) -> some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
      .updating($chartTouching) { _, touching, _ in touching = true }
      .onChanged { value in
        if chartDown != value.startLocation {
          chartDown = value.startLocation
          let start = value.startLocation
          let frame = SpendModel.frame(model, state)
          SpendModel.point(frame, &state, x: start.x, y: start.y)
          chartToken = SpendModel.press(&state, x: start.x, y: start.y)
        }
        let frame = SpendModel.frame(model, state)
        SpendModel.point(frame, &state, x: value.location.x, y: value.location.y)
      }
      .onEnded { value in
        // its lift, before or after the reset: the press it began, once
        guard let token = chartToken else { return }
        chartDown = nil
        chartToken = nil
        let frame = SpendModel.frame(model, state)
        let opened = SpendModel.lift(frame, &state, x: value.location.x, y: value.location.y, token: token)
        SpendModel.leave(&state)
        if let opened { open(opened) }
      }
  }

  /// The window's `select`: the row's card (HS's `onOpen`).
  private func open(_ id: String) {
    if let row = input.rows.first(where: { $0.id == id }) { input.onOpen(row) }
  }

  // MARK: - The words around the chart

  @ViewBuilder
  private func words(
    _ frame: SpendModel.Frame, _ inks: SpendInks, _ colours: [String: SpendScene.Colour]
  ) -> some View {
    let t3 = inks.main.withAlpha(0.52).spendColor
    // the caption over the chart: what the lines are (`.vf-monitor-spend-colcap`, 600 10px/1, caps, 0.07em)
    Text(frame.colcap.text)
      .font(SpendType.font(10, 600))
      .tracking(0.07 * 10)
      .textCase(.uppercase)
      .foregroundStyle(t3)
      .frame(height: 10)
      .placedAt(frame.colcap.left, frame.colcap.top)
      .accessibilityHidden(true)
    // the axes (`.vf-monitor-spend-y`, `-x`: 450 11px/14px, tabular), the times centred on their x
    ForEach(Array(frame.yTicks.enumerated()), id: \.offset) { _, tick in
      Self.axis(tick.text, t3).placedAt(tick.left, tick.top)
    }
    ForEach(Array(frame.xTicks.enumerated()), id: \.offset) { _, tick in
      Self.axis(tick.text, t3).placedAt(tick.left, tick.top, .top)
    }
    hero(frame.hero, inks)
    // the chips over the time axis: now, and the moment (z 2 and 3)
    ForEach(Array(frame.chips.enumerated()), id: \.offset) { _, chip in
      chipView(chip, inks).placedAt(chip.left, chip.top, .top).zIndex(chip.moment ? 3 : 2)
    }
    if let now = frame.now {
      nowPill(inks).placedAt(frame.g.width - now.right, now.top, .topTrailing).zIndex(3)
    }
    if let tag = frame.tag {
      let fill = colours[tag.id].flatMap { SwarmColor(hex: $0.fill) } ?? .transparent
      tagView(tag, fill: fill, inks).placedAt(tag.x, tag.y, tag.trailing ? .topTrailing : .topLeading).zIndex(2)
    }
  }

  private static func axis(_ text: String, _ colour: Color) -> some View {
    Text(text)
      .font(SpendType.font(11, 450).monospacedDigit())
      .foregroundStyle(colour)
      .frame(height: 14)
      .accessibilityHidden(true)
  }

  /// The hero (`.vf-monitor-spend-hero`): what was spent, its rate and what the figure counts. Compact on a short or
  /// narrow stage (its words on one baseline); narrow, the figure smaller and its caption undrawn. The model carries
  /// 0.4.0's short narrow caption (`heroCaption`: who the total leaves out, cut to its room); the phone does not draw
  /// it until James rules on the words the phone's own fonts leave (VF-PM 2026-11-09; DESIGN.md, Godview's spend view;
  /// the mint prints them, `SpendParityTests.thePhonesNarrowHeroWordsAreRead`).
  @ViewBuilder
  private func hero(_ hero: SpendModel.Hero, _ inks: SpendInks) -> some View {
    let t1 = inks.main.withAlpha(0.88).spendColor
    let t3 = inks.main.withAlpha(0.52).spendColor
    let size: Double = hero.narrow ? 20 : hero.compact ? 22 : 34
    let big = Text(hero.big)
      .font(SpendType.font(size, 300).monospacedDigit())
      .tracking(-0.02 * size)
      .foregroundStyle(t1)
    let rate = Text(hero.rate).font(SpendType.font(13, 550).monospacedDigit()).foregroundStyle(t1)
    // a wide or compact hero always has its caption; only a narrow one with nobody left out has none
    let what = Text(hero.what ?? "").font(SpendType.font(12, 400)).foregroundStyle(t3)
    Group {
      if hero.compact {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          big
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            rate
            if !hero.narrow { what }
          }
        }
      } else {
        HStack(alignment: .bottom, spacing: 14) {
          big.frame(height: size)
          VStack(alignment: .leading, spacing: 3) {
            rate.frame(height: 13 * 1.1)
            what.frame(height: 12 * 1.1)
          }
          .padding(.bottom, 2)
        }
      }
    }
    .lineLimit(1)
    .allowsHitTesting(false)
    .placedAt(hero.left, hero.compact ? 10 : 12)
  }

  /// A chip on the time axis (`.vf-monitor-spend-chip`): now in the ink, the moment lighter, a held moment ringed.
  private func chipView(_ chip: SpendModel.Chip, _ inks: SpendInks) -> some View {
    let t1 = inks.main.withAlpha(0.88).spendColor
    let fill = chip.moment && !chip.held ? inks.main.withAlpha(0.62).spendColor : t1
    let shape = RoundedRectangle(cornerRadius: 5)
    return Text(chip.text)
      .font(SpendType.font(11, 650).monospacedDigit())
      .foregroundStyle(inks.ground.spendColor)
      .frame(height: 14)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(shape.fill(fill))
      .background {
        if chip.held {
          ZStack {
            shape.inset(by: -3).fill(t1)
            shape.inset(by: -2).fill(inks.ground.spendColor)
          }
        }
      }
      .accessibilityHidden(true)
  }

  /// The Now pill (`.vf-monitor-spend-back`): back to now, its mark over the legend the window prints under it.
  private func nowPill(_ inks: SpendInks) -> some View {
    let t1 = inks.main.withAlpha(0.88).spendColor
    let shape = RoundedRectangle(cornerRadius: 17)
    return Button {
      SpendModel.release(&state)
    } label: {
      HStack(spacing: 6) {
        VStack(spacing: 3) {
          SpendMark(path: SpendMark.now, colour: t1, size: 14)
          Text(SpendModel.nowLegend)
            .font(SpendType.font(9, 600))
            .tracking(0.02 * 9)
            .foregroundStyle(inks.main.withAlpha(0.68).spendColor)
        }
        Text(SpendModel.nowWords).font(SpendType.font(12, 600)).foregroundStyle(t1)
      }
      .padding(.leading, 9)
      .padding(.trailing, 12)
      .frame(height: 34)
      .background(shape.fill(inks.panel.withAlpha(0.88).spendColor))
      .overlay(shape.inset(by: -0.5).stroke(inks.main.withAlpha(0.1).spendColor, lineWidth: 1))
      .shadow(color: inks.main.withAlpha(0.08).spendColor, radius: 15, x: 0, y: 8)
      .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(SpendModel.nowLabel)
  }

  /// The tag at the pointed line's head (`.vf-monitor-spend-tag`): on its line's lifted fill (the colours the
  /// canvas draws with), in the deep ink, ringed in the ground.
  private func tagView(_ tag: SpendModel.Tag, fill: SwarmColor, _ inks: SpendInks) -> some View {
    let shape = RoundedRectangle(cornerRadius: 6)
    return Text(tag.text)
      .font(SpendType.font(12, 650).monospacedDigit())
      .foregroundStyle(SpendInks.deep.spendColor)
      .padding(.horizontal, 8)
      .frame(height: 22)
      .background(shape.fill(fill.spendColor))
      .background(shape.inset(by: -2).fill(inks.ground.spendColor))
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }

  // MARK: - The list

  private func list(
    _ frame: SpendModel.Frame, _ model: SpendModel.Input, _ inks: SpendInks, _ colours: [String: SpendScene.Colour]
  ) -> some View {
    let g = frame.g
    let shown = frame.rows.filter { !$0.hidden }
    return ZStack(alignment: .topLeading) {
      head(frame.head, inks).placedAt(frame.head.x - g.lx0, frame.head.y - g.ly0)
      ForEach(shown, id: \.id) { row in
        SpendRowView(row: row, key: colours[row.id]?.ink, inks: inks, motion: motion)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(row.label)
          .accessibilityAddTraits(.isButton)
          .accessibilityAction { open(row.id) }
          .placedAt(row.x - g.lx0, row.top - g.ly0)
          .animation(motion ? FieldMotion.island(0.32) : nil, value: row.top)
      }
      if let more = frame.more {
        SpendMoreRow(more: more, width: g.listW, height: g.rowH - 2, inks: inks)
          .placedAt(0, more.top - g.ly0)
      }
    }
    .frame(width: g.listW, height: Swift.max(0, g.height - g.ly0), alignment: .topLeading)
    .contentShape(Rectangle())
    .gesture(listTouch(model))
    .onChange(of: listTouching) { _, touching in
      // the gesture's reset, before or after its lift: the list lets go (the touch stays for its own lift)
      guard !touching, let token = listToken else { return }
      listDown = nil
      SpendModel.cancelList(&state, token: token)
    }
    .placedAt(g.lx0, g.ly0)
  }

  /// The list's head (`.vf-monitor-spend-head`): who had started, and what the money column means.
  private func head(_ head: SpendModel.Head, _ inks: SpendInks) -> some View {
    let size = head.slim ? 9.5 : 10.5
    return HStack(spacing: 0) {
      Text(head.a)
      Spacer(minLength: 0)
      Text(head.b)
    }
    .font(SpendType.font(size, 600))
    .tracking(0.06 * size)
    .textCase(.uppercase)
    .lineLimit(1)
    .foregroundStyle(inks.main.withAlpha(0.52).spendColor)
    .padding(.horizontal, 10)
    .frame(width: head.width, height: head.slim ? 14 : 22)
  }

  /// A finger on the list (in the box's own space, as the model's rows are): it holds the order and lights its row;
  /// a drag steps whole rows; a tap opens the row it came down on.
  private func listTouch(_ model: SpendModel.Input) -> some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
      .updating($listTouching) { _, touching, _ in touching = true }
      .onChanged { value in
        if listDown != value.startLocation {
          listDown = value.startLocation
          let frame = SpendModel.frame(model, state)
          listToken = SpendModel.touchList(frame, &state, x: value.startLocation.x, y: value.startLocation.y)
        }
        guard let token = listToken else { return }
        SpendModel.dragList(model, &state, token: token, y: value.location.y)
      }
      .onEnded { value in
        // its lift, before or after the reset: the touch it began, once
        guard let token = listToken else { return }
        listDown = nil
        listToken = nil
        let tapped = SpendModel.liftList(&state, token: token, x: value.location.x, y: value.location.y)
        if let tapped { open(tapped) }
      }
  }

  /// No agents (`.vf-monitor-spend-empty`): its title and its hint, centred in the box.
  private func empty(_ inks: SpendInks) -> some View {
    VStack(spacing: 7) {
      Text(SpendModel.emptyTitle)
        .font(SpendType.font(11, 800))
        .tracking(0.18 * 11)
        .foregroundStyle(inks.muted.spendColor)
      Text(SpendModel.emptyHint)
        .font(SpendType.font(9, 400))
        .foregroundStyle(inks.faint.spendColor)
    }
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .allowsHitTesting(false)
    .zIndex(6)
  }
}

// MARK: - A row

/// One row (`rowElement`, :564-619): its key, its name, a peer's mark, its glyph and figure; in the two-line form, its
/// task and its state.
private struct SpendRowView: View {
  let row: SpendModel.Row
  /// Its line's ink (`--mv-spend-key`); nil for a row with no line (`is-none`, a ring instead).
  let key: SwarmColor?
  let inks: SpendInks
  /// Its ground and its weight fade (120 ms, CSS's `ease`) unless the view is still.
  let motion: Bool

  private func has(_ flag: SpendModel.Flag) -> Bool { row.flags.contains(flag) }

  var body: some View {
    let one = has(.one)
    let shape = RoundedRectangle(cornerRadius: 12)
    VStack(alignment: .leading, spacing: 4) {
      first(one: one)
      if !one { second }
    }
    .padding(.horizontal, 10)
    .frame(width: row.width, height: row.height, alignment: .leading)
    .background {
      if has(.hot) {
        shape.fill(inks.panel.withAlpha(0.92).spendColor)
        shape.inset(by: -0.5).stroke(inks.main.withAlpha(0.1).spendColor, lineWidth: 1)
      }
    }
    .overlay(alignment: .top) {
      // the hairline over the first row docked at the foot (`::before`)
      if has(.dockFirst) {
        Rectangle()
          .fill(inks.main.withAlpha(0.1).spendColor)
          .frame(height: 1)
          .padding(.horizontal, 10)
          .offset(y: -2)
      }
    }
    .opacity(opacity)
    .animation(motion ? FieldMotion.plainEase(0.12) : nil, value: row.flags)
  }

  private var opacity: Double {
    if has(.before) { return has(.hot) ? 0.85 : 0.34 }
    return has(.dim) ? 0.55 : 1
  }

  private func first(one: Bool) -> some View {
    let quiet = has(.before) || has(.unrecorded) || has(.none)
    return HStack(spacing: 7) {
      HStack(spacing: 7) {
        keyMark
        HStack(spacing: 5) {
          Text(row.name)
            .font(SpendType.font(one ? 13 : 13.5, 650))
            .foregroundStyle(inks.main.withAlpha(has(.none) ? 0.68 : 0.88).spendColor)
            .truncationMode(.tail)
          if let dir = row.dir {
            Text(dir == .down ? "↓" : "↑")
              .font(SpendType.font(one ? 13 : 13.5, 500))
              .foregroundStyle(t3)
              .fixedSize()
          }
        }
        if row.peer != nil {
          // another desktop's agent (`PeerMark`); its desktop's name is in the window's title alone
          SpendMark(path: SpendMark.peer, colour: t3, size: 11)
        }
        if let stg = row.stg {
          SpendGlyph(glyph: stg.glyph, colour: tone(stg.tone, state: false))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Text(row.figure)
        .font(SpendType.font(one ? 13 : 13.5, quiet ? 500 : 550).monospacedDigit())
        .foregroundStyle(quiet ? t3 : inks.main.withAlpha(0.88).spendColor)
        .fixedSize()
    }
    .lineLimit(1)
    .frame(height: 17)
  }

  private var second: some View {
    HStack(spacing: 7) {
      Text(row.task ?? "")
        .foregroundStyle(t3)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let text = row.stateText {
        let tone = row.stateTone ?? .muted
        HStack(spacing: 4) {
          if let glyph = row.glyph { SpendGlyph(glyph: glyph, colour: self.tone(tone, state: true)) }
          Text(text)
            .font(SpendType.font(12, stateWeight(tone)).monospacedDigit())
            .foregroundStyle(self.tone(tone, state: true).spendColor)
        }
        .fixedSize()
      }
    }
    .font(SpendType.font(12, 400))
    .lineLimit(1)
    .padding(.leading, 15)
    .frame(height: 15)
  }

  private var t3: Color { inks.main.withAlpha(0.52).spendColor }

  /// A tone's ink: live in the green ink (the state words only), attention in the orange, info in the blue, else t3.
  private func tone(_ tone: SpendWords.Tone, state: Bool) -> SwarmColor {
    switch tone {
    case .live: state ? inks.greenInk : inks.main.withAlpha(0.52)
    case .attention: inks.orangeInk
    case .info: inks.blueInk
    case .muted: inks.main.withAlpha(0.52)
    }
  }

  private func stateWeight(_ tone: SpendWords.Tone) -> Int {
    switch tone {
    case .live: 550
    case .attention, .info: 600
    case .muted: has(.none) ? 450 : 400
    }
  }

  /// The key (`.vf-monitor-spend-key`, 10 × 3): the line's ink; hollow for an idle row; a ring for a row with no
  /// line, ringed again in blue or orange while it waits on the person.
  @ViewBuilder
  private var keyMark: some View {
    let shape = RoundedRectangle(cornerRadius: 2)
    let none = has(.none)
    let ink = (none ? inks.main.withAlpha(0.52) : key ?? inks.main.withAlpha(0.88)).spendColor
    let ringed = none || row.hollow
    ZStack {
      if ringed {
        shape.inset(by: 0.75).stroke(ink, lineWidth: 1.5)
      } else {
        shape.fill(ink)
      }
    }
    .frame(width: 10, height: 3)
    .background {
      if none, row.state.key == .unseen || row.state.key == .blocked {
        ZStack {
          shape.inset(by: -3).fill((row.state.key == .blocked ? inks.orange : inks.blue).spendColor)
          shape.inset(by: -1.5).fill(inks.ground.spendColor)
        }
      }
    }
  }
}

/// The "more" row (`is-one is-rest`): how many more, and how many of them wait.
private struct SpendMoreRow: View {
  let more: SpendModel.More
  let width: Double
  let height: Double
  let inks: SpendInks

  var body: some View {
    HStack(spacing: 7) {
      Text(more.words)
        .font(SpendType.font(13, 500))
        .foregroundStyle(inks.main.withAlpha(0.52).spendColor)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
      Text(more.waiting)
        .font(SpendType.font(more.attention ? 12 : 13, more.attention ? 600 : 550).monospacedDigit())
        .foregroundStyle((more.attention ? inks.orangeInk : inks.main.withAlpha(0.88)).spendColor)
        .fixedSize()
    }
    .lineLimit(1)
    .frame(height: 17)
    .padding(.horizontal, 10)
    .frame(width: width, height: height, alignment: .leading)
    .allowsHitTesting(false)
  }
}

// MARK: - The marks

/// A state glyph (`Glyph`, 11 px of a 24 box): the swarm's own sprites, which are spend's drawings (`SwarmSprites`;
/// spend's `reply` is the swarm's `message`), in the glyph's ink.
private struct SpendGlyph: View {
  let glyph: SpendWords.Glyph
  let colour: SwarmColor

  var body: some View {
    Canvas { context, size in
      context.withCGContext { cg in
        cg.scaleBy(x: size.width / 24, y: size.height / 24)
        let ink = CGColor(srgbRed: colour.r, green: colour.g, blue: colour.b, alpha: colour.a)
        cg.setStrokeColor(ink)
        cg.setFillColor(ink)
        switch glyph {
        case .question: SwarmSprites.question(cg)
        case .failure: SwarmSprites.failure(cg)
        case .permission: SwarmSprites.permission(cg)
        case .reply: SwarmSprites.message(cg)
        }
      }
    }
    .frame(width: 11, height: 11)
    .accessibilityHidden(true)
  }
}

/// A line mark in a 24 box, stroked 2 wide with round caps and joins: another desktop's (`PeerMark`) and Now's
/// (`NowMark`).
private struct SpendMark: View {
  let path: Path
  let colour: Color
  let size: Double

  /// A desktop: `M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1
  /// 4.5 5ZM9 20.5h6M12 17v3.5`.
  static var peer: Path {
    var path = Path(roundedRect: CGRect(x: 3, y: 5, width: 18, height: 12), cornerRadius: 1.5)
    path.move(to: CGPoint(x: 9, y: 20.5))
    path.addLine(to: CGPoint(x: 15, y: 20.5))
    path.move(to: CGPoint(x: 12, y: 17))
    path.addLine(to: CGPoint(x: 12, y: 20.5))
    return path
  }

  /// `M4 12h10.5M11 8.5l3.5 3.5-3.5 3.5M19.5 4.5v15`: to the end.
  static var now: Path {
    var path = Path()
    path.move(to: CGPoint(x: 4, y: 12))
    path.addLine(to: CGPoint(x: 14.5, y: 12))
    path.move(to: CGPoint(x: 11, y: 8.5))
    path.addLine(to: CGPoint(x: 14.5, y: 12))
    path.addLine(to: CGPoint(x: 11, y: 15.5))
    path.move(to: CGPoint(x: 19.5, y: 4.5))
    path.addLine(to: CGPoint(x: 19.5, y: 19.5))
    return path
  }

  var body: some View {
    Canvas { context, box in
      context.scaleBy(x: box.width / 24, y: box.height / 24)
      context.stroke(path, with: .color(colour), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }
    .frame(width: size, height: size)
  }
}

// MARK: - Type and placement

/// spend.css's type in the system's sans (`--vf-font-sans` is `ChromeType.sans`): a CSS weight as the named weight
/// at or below it, for SwiftUI names no 450, 550 or 650.
enum SpendType {
  static func font(_ size: Double, _ css: Int) -> Font { ChromeType.sans(size, weight(css)) }

  static func weight(_ css: Int) -> Font.Weight {
    switch css {
    case ..<400: .light
    case ..<500: .regular
    case ..<600: .medium
    case ..<700: .semibold
    case ..<800: .bold
    default: .heavy
    }
  }
}

private extension View {
  /// The element at (x, y) of its box, by the corner or edge the stylesheet anchors it on (`left`/`top`, a centred
  /// `translateX(-50%)`, a tag's `- 100%`, the Now pill's `right`): a zero-size anchor at the box's origin with the
  /// element laid over it, then moved, so no element's own size moves another (absolute positioning).
  func placedAt(_ x: Double, _ y: Double, _ anchor: Alignment = .topLeading) -> some View {
    Color.clear
      .frame(width: 0, height: 0)
      .overlay(alignment: anchor) { self.fixedSize() }
      .offset(x: x, y: y)
  }
}
