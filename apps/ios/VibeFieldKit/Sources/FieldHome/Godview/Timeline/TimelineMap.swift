import FieldAgents
import FieldDesign
import SwiftUI

// PG-6 — THE MAP OF THE DAY'S STRIP AND THE VIEW'S TOOLS, transcribed from puppeteer-views 0.3.3 at the lock's
// `52d09c8e` (the timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`): `TimelineView.tsx`
// (dist `TimelineView.js`) the map's draw :497-532 (Pulse over the day, its lens and knob, the slider's words), the
// scrubber :729-779 and the strip's elements :859; drawn as `timeline.css` lays them out: the strip :47-51, the box
// :54-66, the canvas :72-79, the dims :82-102, the head and its knob :106-135, the tip :137-152, the tools :157-259 and
// SINCE :261-273. The map's paint is `TimelinePaint.pulse`, composited bottom first.
//
// TOUCH (the read's §5, fd's Q12): pressing or dragging on the map puts the head there, snapping to now in its last
// 5 pt, with the tip over the finger; the narrow head's ONE preset button cycles 15M → 1H → 4H → 12H; NOW glides home.
// VoiceOver adjusts the map by 5 minutes (the desktop's ← →). No hover, no keys.
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): the record's sentence under SINCE (:274-314) is not transcribed.

/// The strip: the map box, the tools in the head column, and SINCE under them. Its numbers are the view's draw's.
struct TimelineMapStrip: View {
  let columns: TimelineLayout.Columns
  let layers: TimelinePulseLayers
  /// The day the map spans, and the window in view (its left edge and the head).
  let startMs: Double
  let nowMs: Double
  let t0: Double
  let t1: Double
  let following: Bool
  let inks: TimelineInks
  let skin: GodviewSkin
  let timeZone: TimeZone
  /// The span on show, as its preset (nil: a span no preset names).
  let preset: TimelineScale.Preset?
  /// The slider's words: `Now, 14:05` or `14:05, 3 minutes ago`.
  let valueText: String
  /// A press or drag on the map: the fraction of the day under the finger, and the map's width.
  let onScrub: (_ fraction: Double, _ width: Double) -> Void
  let onSpan: (_ spanMs: Double) -> Void
  let onNow: () -> Void
  /// VoiceOver's adjust: the head moved by `deltaMs`.
  let onAdjust: (_ deltaMs: Double) -> Void

  /// Where the finger is on the map, while it is down (the tip's place).
  @State private var finger: Double?

  private var width: Double { max(1, columns.x1 - TimelineLayout.mapLeft) }

  var body: some View {
    ZStack(alignment: .topLeading) {
      box
        .offset(x: TimelineLayout.mapLeft, y: 8)
      tools
        .frame(width: max(0, columns.width - columns.x1 - 18), alignment: .trailing)
        .offset(x: columns.x1 + 10, y: 7)
      Text(TimelineWords.since(GodviewFormat.formatClock(ms: startMs, timeZone: timeZone)))
        .font(.system(size: 7.5, weight: .black))
        .tracking(0.525)
        .foregroundStyle(TimelineCanvasReplay.color(skin.ink(.textFaint)))
        .lineLimit(1)
        .frame(width: max(0, columns.width - columns.x1 - 24), alignment: .trailing)
        .offset(x: columns.x1 + 16, y: 33)
        .accessibilityHidden(true)
    }
    .frame(width: columns.width, height: TimelineLayout.mapStrip, alignment: .topLeading)
  }

  /// The box: Pulse over the day, gray outside the window, the head's knob, and the tip under the finger.
  private var box: some View {
    let range = max(1, nowMs - startMs)
    let left = min(1, max(0, (t0 - startMs) / range)) * width
    let right = min(1, max(0, (t1 - startMs) / range)) * width
    let shape = RoundedRectangle(cornerRadius: 6)
    let ground = TimelineCanvasReplay.color(inks.ground.withAlpha(inks.dark ? 0.38 : 0.30))
    return ZStack(alignment: .topLeading) {
      shape.fill(TimelineCanvasReplay.color(skin.ink(.panelBg).withAlpha(0.55)))
      pulse
      // Outside the window in view the day goes gray, so colour stands only where you are looking.
      pulse.grayscale(1).opacity(0.9)
        .mask(alignment: .topLeading) {
          ZStack(alignment: .topLeading) {
            Rectangle().frame(width: left)
            Rectangle().frame(width: max(0, width - right)).offset(x: right)
          }
        }
      Rectangle().fill(ground).frame(width: left)
      Rectangle().fill(ground).frame(width: max(0, width - right)).offset(x: right)
      shape.strokeBorder(TimelineCanvasReplay.color(skin.ink(.panelBorder).withAlpha(0.6)), lineWidth: 1)
      knob.offset(x: right)
      if let finger { tip(at: finger) }
    }
    .frame(width: width, height: PulseGeometry(width: width).height, alignment: .topLeading)
    .contentShape(shape)
    .gesture(
      DragGesture(minimumDistance: 0)
        .onChanged { value in
          finger = value.location.x
          onScrub(min(1, max(0, value.location.x / width)), width)
        }
        .onEnded { _ in finger = nil }
    )
    .accessibilityElement()
    .accessibilityLabel(TimelineWords.mapLabel)
    .accessibilityValue(valueText)
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: onAdjust(5 * 60_000)
      case .decrement: onAdjust(-5 * 60_000)
      @unknown default: break
      }
    }
  }

  /// The map's paint, bottom first: the hours, the ridge's light (the ridge again, blurred), the ridge.
  private var pulse: some View {
    let layers = layers
    return Canvas { context, _ in
      let font = Font.system(size: 7.5, weight: .bold)
      TimelineCanvasReplay.draw(layers.hours, in: context, hourFont: font)
      var light = context
      light.addFilter(.blur(radius: layers.lightBlur))
      light.opacity = layers.lightAlpha
      TimelineCanvasReplay.draw(layers.ridge, in: light, hourFont: font)
      TimelineCanvasReplay.draw(layers.ridge, in: context, hourFont: font)
    }
    .clipShape(RoundedRectangle(cornerRadius: 6))
    .frame(width: width, height: PulseGeometry(width: width).height)
  }

  /// The head on the map: a 2 pt line with a 9 pt knob, filled while following now and hollow while looking back.
  private var knob: some View {
    let main = TimelineCanvasReplay.color(skin.ink(.textMain))
    let ground = TimelineCanvasReplay.color(inks.ground)
    return ZStack(alignment: .top) {
      RoundedRectangle(cornerRadius: 1)
        .fill(main)
        .frame(width: 2, height: PulseGeometry(width: width).height + 4)
        .shadow(color: TimelineCanvasReplay.color(skin.ink(.textMain).withAlpha(0.45)), radius: 4.5)
      Circle()
        .fill(following ? main : ground)
        .overlay {
          if !following { Circle().strokeBorder(main, lineWidth: 1.5) }
        }
        .frame(width: 9, height: 9)
        .background(Circle().fill(ground).padding(-2))
        .offset(y: -5)
    }
    .offset(x: -1, y: -2)
  }

  /// The tip over the finger: the moment under it, or NOW at the map's last 5 pt.
  private func tip(at x: Double) -> some View {
    let fraction = min(1, max(0, x / width))
    let text = fraction >= 1 - 5 / width
      ? "NOW" : GodviewFormat.formatClock(ms: startMs + fraction * (nowMs - startMs), timeZone: timeZone)
    return Text(text)
      .font(.system(size: 9, weight: .bold).monospacedDigit())
      .foregroundStyle(TimelineCanvasReplay.color(inks.ground))
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(RoundedRectangle(cornerRadius: 4).fill(TimelineCanvasReplay.color(skin.ink(.textMain))))
      .fixedSize()
      .position(x: min(width - 20, max(20, x)), y: PulseGeometry(width: width).height + 5 + 8.5)
      .accessibilityHidden(true)
  }

  /// The tools: the narrow head's one preset button that cycles (the wide head's group), and NOW. No key legend:
  /// the phone has no keys (fd's Q2) and names none (the words rule), so NOW is the 22 pt tool its siblings are.
  private var tools: some View {
    let index = preset.flatMap { current in TimelineScale.presets.firstIndex { $0.id == current.id } }
    let next = TimelineScale.presets[((index ?? -1) + 1) % TimelineScale.presets.count]
    return HStack(spacing: 4) {
      if columns.narrow {
        Button { onSpan(next.spanMs) } label: { Text(preset?.label ?? "—") }
          .buttonStyle(TimelineToolStyle(skin: skin, pressed: false, home: false))
          .accessibilityLabel(TimelineWords.spanLabel(preset?.label, next: next.title))
      } else {
        HStack(spacing: 0) {
          ForEach(TimelineScale.presets, id: \.id) { choice in
            Button { onSpan(choice.spanMs) } label: { Text(choice.label) }
              .buttonStyle(TimelineToolStyle(skin: skin, pressed: choice.id == preset?.id, home: false, grouped: true))
              .accessibilityLabel(choice.title)
              .accessibilityAddTraits(choice.id == preset?.id ? .isSelected : [])
          }
        }
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(TimelineCanvasReplay.color(skin.ink(.panelBorder))))
      }
      Button(action: onNow) {
        // pressed (following) or the way home (looking back), NOW wears the main ink either way
        TimelineNowMark().timelineMark(size: 12, strokeWidth: 1.6, colour: skin.ink(.textMain))
      }
      .buttonStyle(TimelineToolStyle(skin: skin, pressed: following, home: !following))
      .accessibilityLabel(following ? TimelineWords.followingNow : TimelineWords.backToNow)
      .accessibilityAddTraits(following ? .isSelected : [])
    }
  }
}

/// A tool of the map strip (timeline.css:174-232): 22 pt, the border and words muted, pressed in the hover pair;
/// looking back, NOW in the main ink.
struct TimelineToolStyle: ButtonStyle {
  let skin: GodviewSkin
  let pressed: Bool
  let home: Bool
  var grouped = false

  func makeBody(configuration: Configuration) -> some View {
    let lit = pressed || configuration.isPressed
    let ink = lit || home ? skin.ink(.textMain) : skin.ink(.textMuted)
    let border = home ? skin.ink(.textMain) : (lit ? skin.ink(.controlHoverBorder) : skin.ink(.panelBorder))
    return configuration.label
      .font(.system(size: 9, weight: .bold))
      .tracking(0.54)
      .foregroundStyle(TimelineCanvasReplay.color(ink))
      .lineLimit(1)
      .padding(.horizontal, 5)
      .frame(minWidth: 22, minHeight: 22, maxHeight: 22)
      .background(TimelineCanvasReplay.color(lit ? skin.ink(.controlHoverBg) : .transparent))
      .overlay {
        if !grouped {
          RoundedRectangle(cornerRadius: 5).strokeBorder(TimelineCanvasReplay.color(border), lineWidth: 1)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: grouped ? 0 : 5))
      .contentShape(Rectangle())
  }
}
