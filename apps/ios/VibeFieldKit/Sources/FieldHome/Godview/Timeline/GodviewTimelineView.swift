import FieldAgents
import FieldDesign
import FieldMesh
import FieldProduct
import FieldSwarm
import SwiftUI

// PG-6 — THE TIMELINE ON THE PHONE'S STAGE: puppeteer-views 0.3.3's `TimelineView` (lock `52d09c8e`; the timeline is
// byte-identical to 0.3.2's `95a70aa7`, its last change `5abe8f75`; dist `TimelineView.js:123-888`) as a SwiftUI view.
// Named `GodviewTimelineView`, never `TimelineView`: that is SwiftUI's schedule view, which this one runs on.
//
// What it is made of, and from where:
// - the lanes (`timelineLanes`, TV:166) from the stage's rows joined as the swarm joins them (its unread, the ledger's
//   colour; J-S4's active), the layout (`TimelineLayout`), the scale and its tweens (`TimelineScale`, TV:272-330);
// - the draw (TV:389-583): the wakes (`TimelinePaint.wakes` replayed into a Canvas, TV:450-472), the axis's ticks and
//   the clock chip (TV:474-496), the map and its lens (`TimelineMapStrip`, TV:497-532), the bodies' readouts
//   (TV:540-568);
// - the empty stage (TV:882) and the reader's list (TV:882-887), which are the lanes' accessibility elements here.
//
// THE CLOCK (the read's §1): now is `input.now()` (live, or frozen under `-vf-godview-now=`); a tween's progress reads
// the frame's own time, never now; the local zone is `TimeZone.current`, handed to every word that reads one. The
// schedule (`schedule(isStill:tweening:reduceMotion:)`, H6b): a still (`input.isStill`) draws ONCE at its frozen clock,
// with no TimelineView at all (the still law, GodviewViewChoice.swift:25: one frame, no loop, no transition, no
// timer); live, a tween landing with motion allowed redraws every frame, and anything else once a second, as the
// desktop's still view keeps time (TV:600-615). Motion is off under Reduce Motion and in a still: tweens land at once
// and no ring plays.
//
// THE STAGE (J-S1 A, J-S2 (ii), J-S3 drop; names-4t): the view stands in `GodviewStage.framed` (a `.flow` stage, the
// band below it) and runs from the screen's top; its words start at `input.insets(.flow).top` (the Stories row's
// reserve), and its ground fills the stage. It draws no scanlines, no vignette and no dissolve (the stage's).
//
// TOUCH (the read's §5, fd's Q12): a tap opens a lane's card (`input.onOpen`); a horizontal drag in the track pans; a
// pinch zooms about its centre (240 ms, island); the map is pressed or dragged to put the head there. No hover, no
// keys, no focus ring (fd's Q2), so no lane is ever lit (`lit` −1).
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): no history is lent, so nothing of the record is drawn — the ended runs'
// rows and pointer (TV:344-355, :821-855), the record's sentence (TV:859-861), the tall canvas (TV:427-445).

/// How the stage redraws.
enum TimelineSchedule: Equatable, Sendable {
  /// Once, at the frozen clock: a still runs no timer.
  case still
  /// Every frame, while a tween lands with motion allowed.
  case everyFrame
  /// Once a second, keeping time.
  case perSecond
}

struct GodviewTimelineView: View {
  let input: GodviewStageInput

  /// How the stage redraws: a still once, whatever else holds; live, every frame while a tween lands with motion
  /// allowed, else once a second.
  static func schedule(isStill: Bool, tweening: Bool, reduceMotion: Bool) -> TimelineSchedule {
    if isStill { return .still }
    return tweening && !reduceMotion ? .everyFrame : .perSecond
  }

  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The scale a move starts from (nil: the default hour, following now); a following scale's end is now at every
  /// draw (`followNow`).
  @State private var scale: TimelineScale?
  /// The move landing now, if any (`tweenRef`).
  @State private var tween: TimelineTween?
  /// A horizontal drag's last translation, while it pans.
  @State private var panned: Double?
  /// A pinch's last magnification, while it zooms.
  @State private var pinched: Double?

  private var motion: Bool { !reduceMotion && !input.isStill }
  private var timeZone: TimeZone { .current }

  var body: some View {
    GeometryReader { proxy in
      switch Self.schedule(isStill: input.isStill, tweening: tween != nil, reduceMotion: reduceMotion) {
      case .still:
        stage(size: proxy.size, frame: input.now())
      case .everyFrame:
        TimelineView(.animation) { context in stage(size: proxy.size, frame: context.date) }
      case .perSecond:
        TimelineView(.periodic(from: .now, by: 1)) { context in stage(size: proxy.size, frame: context.date) }
      }
    }
    .background(TimelineCanvasReplay.color(input.skin.ink(.monitorBg)))
  }

  // MARK: - One draw

  /// Everything one draw reads, computed once from the stage, the clock and the scale.
  private struct Draw {
    let nowMs: Double
    let set: TimelineLaneSet
    let columns: TimelineLayout.Columns
    let placement: TimelineLayout.Placement
    let bodyHeight: Double
    let scale: TimelineScale
    let following: Bool
    let inks: TimelineInks

    var t1: Double { scale.endMs }
    var t0: Double { scale.endMs - scale.spanMs }
    /// px per ms along the track.
    var k: Double { columns.x1 / scale.spanMs }
    var rowsHeight: Double { max(placement.height, bodyHeight) }
    /// The bodies relight to the head's moment; following now they are now (TL-D13).
    var at: Double { following ? nowMs : t1 }
  }

  private func draw(size: CGSize, frame: Date) -> Draw {
    let nowMs = Self.ms(input.now())
    let set = laneSet(nowMs: nowMs)
    let bodyHeight = max(0, size.height - top - TimelineLayout.mapStrip - TimelineLayout.axis)
    let (scale, following) = current(nowMs: nowMs, frameMs: Self.frameMs(frame))
    return Draw(
      nowMs: nowMs, set: set, columns: TimelineLayout.columns(width: size.width),
      placement: TimelineLayout.lanes(set, bodyHeight: bodyHeight, laneMax: TimelineParameters.defaults.laneMax),
      bodyHeight: bodyHeight, scale: scale, following: following,
      inks: TimelineInks(theme: SwarmTheme.resolve(scheme), skin: input.skin))
  }

  /// Where the words start: the stage's top inset as a `.flow` stage takes it (the band is `framed`'s, so the bottom
  /// is 0 here).
  private var top: CGFloat { input.insets(.flow).top }

  @ViewBuilder private func stage(size: CGSize, frame: Date) -> some View {
    let draw = draw(size: size, frame: frame)
    VStack(alignment: .leading, spacing: 0) {
      map(draw)
      axis(draw)
      lanes(draw)
    }
    .padding(.top, top)
    .frame(width: size.width, height: size.height, alignment: .topLeading)
    .overlay {
      if draw.placement.placed.isEmpty { empty.padding(.top, top) }
    }
  }

  // MARK: - The map of the day (TV:497-532)

  private func map(_ draw: Draw) -> some View {
    let width = max(1, draw.columns.x1 - TimelineLayout.mapLeft)
    let start = TimelineLanes.dayStart(draw.set, spanMs: draw.scale.spanMs, nowMs: draw.nowMs)
    let pulse = PulseMap(
      PulseMap.rows(draw.set.agents, nowMs: draw.nowMs), startMs: start, nowMs: draw.nowMs,
      geometry: PulseGeometry(width: width))
    let layers = TimelinePaint.pulse(
      pulse,
      paint: TimelineMapPaint(
        width: width, height: PulseGeometry(width: width).height, ratio: 1, startMs: start, nowMs: draw.nowMs),
      inks: draw.inks, timeZone: timeZone)
    let span = (draw.scale.spanMs / 1000).rounded() * 1000
    let value =
      draw.following
      ? TimelineWords.nowValue(GodviewFormat.formatClock(ms: draw.nowMs, timeZone: timeZone))
      : TimelineWords.pastValue(
        GodviewFormat.formatClock(ms: draw.t1, timeZone: timeZone),
        ago: GodviewFormat.formatWords(ms: draw.nowMs - draw.t1))
    let x1 = draw.columns.x1
    return TimelineMapStrip(
      columns: draw.columns, layers: layers, startMs: start, nowMs: draw.nowMs, t0: draw.t0, t1: draw.t1,
      following: draw.following, inks: draw.inks, skin: input.skin, timeZone: timeZone,
      preset: TimelineScale.presets.first { abs($0.spanMs - span) < 1000 }, valueText: value,
      onScrub: { fraction, width in scrub(to: fraction, width: width, startMs: start) },
      onSpan: { zoom(to: $0, x1: x1) }, onNow: { toNow() }, onAdjust: { pan(by: $0) })
  }

  // MARK: - The axis (TV:474-496; timeline.css:316-392)

  private func axis(_ draw: Draw) -> some View {
    let step = TimelineScale.tickStep(pxPerMs: draw.k)
    let origin = (draw.t0 / step).rounded(.down) * step
    let ticks = TimelineScale.ticksBetween(
      fromMs: origin - step, toMs: origin + draw.scale.spanMs + 2 * step, step: step, timeZone: timeZone)
    let x1 = draw.columns.x1
    // The axis fades in from the left edge and out before the chip (the clip's mask, timeline.css:324-339).
    func at(_ px: Double) -> Double { min(1, max(0, px / x1)) }
    let fade = Gradient(stops: [
      .init(color: .clear, location: 0), .init(color: .black, location: at(30)),
      .init(color: .black, location: max(at(30), at(x1 - 64))),
      .init(color: .clear, location: max(at(30), at(x1 - 36))),
    ])
    return ZStack(alignment: .topLeading) {
      ZStack(alignment: .topLeading) {
        ForEach(ticks, id: \.t) { mark in
          Text(tickLabel(mark.t))
            .font(.system(size: 9, weight: .bold).monospacedDigit())
            .tracking(0.27)
            .foregroundStyle(
              TimelineCanvasReplay.color(input.skin.ink(mark.hour ? .textMuted : .textFaint)))
            .fixedSize()
            .position(x: (mark.t - draw.t0) * draw.k, y: 6 + 5.5)
        }
      }
      .frame(width: x1, height: TimelineLayout.axis, alignment: .topLeading)
      .clipped()
      .mask(LinearGradient(gradient: fade, startPoint: .leading, endPoint: .trailing))
      chip(draw)
        .position(x: x1, y: 3 + 8)
    }
    .frame(width: draw.columns.width, height: TimelineLayout.axis, alignment: .topLeading)
    .overlay(alignment: .bottom) {
      Rectangle().fill(TimelineCanvasReplay.color(input.skin.ink(.panelBorder))).frame(height: 1)
    }
    .accessibilityHidden(true)
  }

  /// A tick's words: the clock, or the day at midnight (TV:478-481).
  private func tickLabel(_ t: Double) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: t / 1000))
    return parts.hour == 0 && parts.minute == 0
      ? TimelineLayout.dayLabel(t, timeZone: timeZone, locale: .current)
      : GodviewFormat.formatClock(ms: t, timeZone: timeZone)
  }

  /// Now is ink, never red: the live clock in a solid chip; looking back, the head's time outlined.
  private func chip(_ draw: Draw) -> some View {
    let skin = input.skin
    let text =
      draw.following
      ? GodviewFormat.formatClock(ms: draw.nowMs, withSeconds: true, timeZone: timeZone)
      : GodviewFormat.formatClock(ms: draw.t1, timeZone: timeZone)
    let shape = RoundedRectangle(cornerRadius: 4)
    return Text(text)
      .font(.system(size: 9, weight: .bold).monospacedDigit())
      .tracking(0.18)
      .foregroundStyle(TimelineCanvasReplay.color(draw.following ? draw.inks.ground : skin.ink(.textMuted)))
      .padding(.horizontal, 6)
      .frame(height: 16)
      .background(shape.fill(TimelineCanvasReplay.color(draw.following ? skin.ink(.textMain) : draw.inks.ground)))
      .overlay {
        if !draw.following { shape.strokeBorder(TimelineCanvasReplay.color(skin.ink(.textFaint)), lineWidth: 1) }
      }
      .background(RoundedRectangle(cornerRadius: 7).fill(TimelineCanvasReplay.color(draw.inks.ground)).padding(-3))
      .fixedSize()
  }

  // MARK: - The lanes (TV:450-472, :540-568; timeline.css:394-797)

  private func lanes(_ draw: Draw) -> some View {
    let height = draw.rowsHeight
    let paint = TimelineWakePaint(
      width: draw.columns.x1, height: height, ratio: 1, lanes: draw.placement.placed, t0: draw.t0, t1: draw.t1,
      nowMs: draw.nowMs, lit: -1, glow: TimelineParameters.defaults.glow)
    let commands = TimelinePaint.wakes(paint, inks: draw.inks, timeZone: timeZone)
    return ScrollView(.vertical) {
      ZStack(alignment: .topLeading) {
        Canvas { context, _ in
          TimelineCanvasReplay.draw(commands, in: context, hourFont: .system(size: 7.5, weight: .bold))
        }
        .frame(width: draw.columns.x1, height: height)
        .accessibilityHidden(true)
        if let divider = draw.placement.divider {
          terminalsDivider(width: draw.columns.width, inks: draw.inks).offset(y: divider)
        }
        names(draw)
        heads(draw)
        targets(draw)
      }
      .frame(width: draw.columns.width, height: height, alignment: .topLeading)
    }
    .scrollBounceBehavior(.basedOnSize)
    .frame(width: draw.columns.width, height: draw.bodyHeight)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(TimelineWords.bodyLabel)
    .simultaneousGesture(panning(draw))
    .simultaneousGesture(pinching(draw))
  }

  /// `TERMINALS`: the quiet group's divider (timeline.css:424-454).
  private func terminalsDivider(width: Double, inks: TimelineInks) -> some View {
    ZStack(alignment: .leading) {
      Rectangle().fill(TimelineCanvasReplay.color(input.skin.ink(.panelBorder))).frame(height: 1)
      Text(TimelineWords.terminals)
        .font(.system(size: 7.5, weight: .black))
        .tracking(0.6)
        .foregroundStyle(TimelineCanvasReplay.color(input.skin.ink(.textFaint)))
        .padding(.trailing, 6)
        .background(TimelineCanvasReplay.color(inks.ground))
        .padding(.leading, 14)
    }
    .frame(width: width, height: TimelineLayout.divider)
    .accessibilityHidden(true)
  }

  /// The names float over the wakes' far end: no rail, a fade into the ground (timeline.css:457-471).
  private func names(_ draw: Draw) -> some View {
    let width = draw.columns.names
    let ground = TimelineCanvasReplay.color(draw.inks.ground)
    return ZStack(alignment: .topLeading) {
      LinearGradient(
        stops: [
          .init(color: ground, location: 0), .init(color: ground, location: max(0, (width - 70) / width)),
          .init(color: ground.opacity(0), location: 1),
        ], startPoint: .leading, endPoint: .trailing)
      ForEach(draw.placement.placed, id: \.lane.id) { placed in
        TimelineNameRow(lane: placed.lane, h: placed.h, inks: draw.inks, skin: input.skin)
          .frame(width: width, height: placed.h, alignment: .leading)
          .offset(y: placed.y)
      }
    }
    .frame(width: width, height: draw.rowsHeight, alignment: .topLeading)
    .accessibilityHidden(true)
  }

  /// The head column: the head line (dashed while looking back), then each lane's body and readout.
  private func heads(_ draw: Draw) -> some View {
    let skin = input.skin
    return ZStack(alignment: .topLeading) {
      if draw.following {
        Rectangle().fill(TimelineCanvasReplay.color(skin.ink(.textMain).withAlpha(0.32)))
          .frame(width: 1, height: draw.rowsHeight)
      } else {
        Path { path in
          path.move(to: CGPoint(x: 0.5, y: 0))
          path.addLine(to: CGPoint(x: 0.5, y: draw.rowsHeight))
        }
        .stroke(TimelineCanvasReplay.color(skin.ink(.textFaint)), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
        .frame(width: 1, height: draw.rowsHeight)
      }
      ForEach(draw.placement.placed, id: \.lane.id) { placed in
        TimelineHeadRow(
          lane: placed.lane, h: placed.h, readout: readout(placed.lane, draw), inks: draw.inks, skin: skin,
          motion: motion
        )
        .frame(width: draw.columns.head, height: placed.h, alignment: .leading)
        .offset(y: placed.y)
      }
    }
    .frame(width: draw.columns.head, height: draw.rowsHeight, alignment: .topLeading)
    .offset(x: draw.columns.x1)
    .accessibilityHidden(true)
  }

  /// A lane's readout at the head's moment (TV:540-568).
  private func readout(_ lane: TimelineLane, _ draw: Draw) -> TimelineReadout {
    TimelineWords.readout(
      lane, moment: TimelineLanes.state(of: lane, at: draw.at), at: draw.at, live: draw.following,
      nowMs: draw.nowMs)
  }

  /// Each lane as a control: a tap opens its card, and the reader hears it as its sentence (the reader's list,
  /// TV:882-887; the open card's lane is selected).
  private func targets(_ draw: Draw) -> some View {
    ForEach(draw.placement.placed, id: \.lane.id) { placed in
      Rectangle()
        .fill(Color.clear)
        .contentShape(Rectangle())
        .frame(width: draw.columns.width, height: placed.h)
        .offset(y: placed.y)
        .onTapGesture { open(placed.lane) }
        .accessibilityElement()
        .accessibilityLabel(TimelineWords.label(placed.lane, nowMs: draw.nowMs))
        .accessibilityAddTraits(placed.lane.row.active ? [.isButton, .isSelected] : .isButton)
    }
  }

  /// The empty stage (TV:882; timeline.css:854-875): upstream's title, the hint without its pane (the words rule).
  private var empty: some View {
    VStack(spacing: 7) {
      Text(TimelineWords.noAgents)
        .font(.system(size: 11, weight: .heavy))
        .tracking(1.98)
        .foregroundStyle(TimelineCanvasReplay.color(input.skin.ink(.textMuted)))
      Text(TimelineWords.noAgentsHint)
        .font(.system(size: 9))
        .foregroundStyle(TimelineCanvasReplay.color(input.skin.ink(.textFaint)))
    }
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .allowsHitTesting(false)
  }

  // MARK: - Touch

  /// A horizontal drag in the track pans (TV:642-662); a vertical one is the lanes' scroll.
  private func panning(_ draw: Draw) -> some Gesture {
    DragGesture(minimumDistance: 4)
      .onChanged { value in
        guard value.startLocation.x <= draw.columns.x1 else { return }
        guard panned != nil || abs(value.translation.width) > abs(value.translation.height) else { return }
        let dx = value.translation.width - (panned ?? 0)
        panned = value.translation.width
        let (now, frame) = clocks()
        pan(by: -dx / (draw.columns.x1 / current(nowMs: now, frameMs: frame).scale.spanMs))
      }
      .onEnded { _ in panned = nil }
  }

  /// A pinch zooms about its centre, each change a factor of the last (`zoomAround`, TV:305-317).
  private func pinching(_ draw: Draw) -> some Gesture {
    MagnifyGesture()
      .onChanged { value in
        let factor = (pinched ?? 1) / value.magnification
        pinched = value.magnification
        zoom(
          by: factor, anchorFromHeadPx: draw.columns.x1 - value.startAnchor.x * draw.columns.width,
          x1: draw.columns.x1)
      }
      .onEnded { _ in pinched = nil }
  }

  private func open(_ lane: TimelineLane) {
    guard let row = input.rows.first(where: { $0.id == lane.id }) else { return }
    input.onOpen(row)
  }

  // MARK: - The scale's moves (TV:272-330)

  private func laneSet(nowMs: Double) -> TimelineLaneSet {
    let rows = input.rows.map { row in
      TimelineRow(
        row, unread: input.unreadIds.contains(row.id), colour: input.colour(row),
        active: TimelineActive.lights(row: row, activeId: input.activeId))
    }
    return TimelineLanes.lanes(rows, nowMs: nowMs)
  }

  /// The scale as the draw shows it at `frameMs`, mid-tween included, and whether it follows now.
  private func current(nowMs: Double, frameMs: Double) -> (scale: TimelineScale, following: Bool) {
    if let tween {
      let step = TimelineScale.tweenAt(tween, at: frameMs, nowMs: nowMs, reduced: !motion)
      return (step.scale, step.scale.live || (tween.live && tween.toEnd == .now))
    }
    let following = TimelineScale.followNow(scale ?? TimelineScale.initial(nowMs: nowMs), nowMs: nowMs)
    return (following, following.live)
  }

  /// Now (the stage's clock) and the frame's own time.
  private func clocks() -> (now: Double, frame: Double) {
    (Self.ms(input.now()), Self.frameMs(Date()))
  }

  private func earliest(_ scale: TimelineScale, nowMs: Double) -> Double {
    TimelineLanes.earliestHead(laneSet(nowMs: nowMs), spanMs: scale.spanMs, nowMs: nowMs)
  }

  /// A held head no earlier than the map allows at its span.
  private func clampHead(_ scale: TimelineScale, nowMs: Double) -> TimelineScale {
    guard !scale.live else { return scale }
    return TimelineScale.headAt(scale, endMs: scale.endMs, nowMs: nowMs, earliestMs: earliest(scale, nowMs: nowMs))
  }

  /// Put a new scale in place now: a drag, the map. Any tween stops.
  private func place(_ next: TimelineScale) {
    tween = nil
    scale = next
  }

  /// Ease from the scale on screen toward `target` (240 ms, island), or land it at once without motion.
  private func ease(to target: TimelineScale, nowMs: Double, frameMs: Double) {
    guard motion else {
      place(target)
      return
    }
    let from = current(nowMs: nowMs, frameMs: frameMs).scale
    scale = from
    land(TimelineScale.tweenBetween(from, target, at: frameMs))
  }

  /// Run `next`, and when its time is up keep where it landed (unless another move took over).
  private func land(_ next: TimelineTween) {
    tween = next
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(Int(next.durationMs.rounded(.up))))
      guard tween == next else { return }
      scale = TimelineScale.tweenTarget(next, nowMs: Self.ms(input.now()))
      tween = nil
    }
  }

  /// A preset (`zoomTo`): about the head, building on a running tween's target.
  private func zoom(to spanMs: Double, x1: Double) {
    let (now, frame) = clocks()
    let base = TimelineScale.settled(scale ?? TimelineScale.initial(nowMs: now), tween: tween, nowMs: now)
    let zoomed = TimelineScale.zoomAt(base, spanMs: spanMs, anchorFromHeadPx: 0, widthPx: x1, nowMs: now)
    ease(to: clampHead(zoomed, nowMs: now), nowMs: now, frameMs: frame)
  }

  /// A pinch (`zoomAround`): about its centre.
  private func zoom(by factor: Double, anchorFromHeadPx: Double, x1: Double) {
    let (now, frame) = clocks()
    let base = TimelineScale.settled(scale ?? TimelineScale.initial(nowMs: now), tween: tween, nowMs: now)
    let zoomed = TimelineScale.zoomAt(
      base, spanMs: TimelineScale.clampSpan(base.spanMs * factor), anchorFromHeadPx: anchorFromHeadPx, widthPx: x1,
      nowMs: now)
    ease(to: clampHead(zoomed, nowMs: now), nowMs: now, frameMs: frame)
  }

  /// NOW (`toNow`): glide back to following (a still lands it at once: `tweenAt`'s reduced motion).
  private func toNow() {
    let (now, frame) = clocks()
    let from = current(nowMs: now, frameMs: frame).scale
    if from.live && tween == nil { return }
    scale = from
    land(TimelineScale.glide(from, at: frame))
  }

  /// A drag or VoiceOver's adjust (`pan`).
  private func pan(by deltaMs: Double) {
    let (now, frame) = clocks()
    let from = current(nowMs: now, frameMs: frame).scale
    place(TimelineScale.panBy(from, deltaMs: deltaMs, nowMs: now, earliestMs: earliest(from, nowMs: now)))
  }

  /// The map pressed or dragged (`scrubTo`): the head there, following now in the map's last 5 pt.
  private func scrub(to fraction: Double, width: Double, startMs: Double) {
    let (now, frame) = clocks()
    let from = current(nowMs: now, frameMs: frame).scale
    if fraction >= 1 - 5 / width {
      place(TimelineScale(spanMs: from.spanMs, endMs: now, live: true))
      return
    }
    let end = startMs + fraction * (now - startMs)
    place(TimelineScale.headAt(from, endMs: end, nowMs: now, earliestMs: earliest(from, nowMs: now)))
  }

  private static func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }
  private static func frameMs(_ date: Date) -> Double { date.timeIntervalSinceReferenceDate * 1000 }
}
