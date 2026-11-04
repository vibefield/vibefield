import FieldAgents
import FieldDesign
import FieldMesh
import FieldProduct
import SwiftUI

// PG-6 — A LANE'S NAME AND ITS BODY AT THE HEAD, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the
// timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`): `TimelineView.tsx` (dist
// `TimelineView.js`) `FolderMark` :90-92, `PeerMark` :94-96, `nameRow` :98-105, `headRow` :107-114 and `NowMark`
// :120-122, drawn as `timeline.css` lays them out: the names :457-573 (the fade into the ground :457-471, a row
// :473-483, two lines :485-490, the name :499-506, the sub line :508-515, the marks :517-531, a terminal :533-536,
// receded :544-547, active :553-557, the band :560-573) and the heads :576-797 (the head line :586-601, a head
// :603-611, the body :613-680, the wave you owe :682-716, the readout :718-757, its inks :767-797). The words are
// TimelineWords'; the colours are the inks' and the skin's; the type is the system face (names-4t) at the desktop's
// sizes and weights.
//
// J-S4 (James, 2026-11-04; fd's Q3): the open card's lane wears the desktop's own active treatment — the name
// underlined and the 4 px band at the lane's edge — in TEXT MAIN where the desktop wears the pane's colour, decided in
// ONE place, `TimelineActive.lights(row:activeId:)`. `laneAlpha` is untouched by it (the desktop's hover, never
// `active`).
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): the ended run's rows (`is-ended`, its own name and device) and the
// recorded readout's two lines (:759-765) are not transcribed. The keyboard's focus ring (:802-815) neither: the phone
// has no keys.

/// J-S4: whether a drawn row's lane wears the active treatment — it is the open card's row.
enum TimelineActive {
  /// The underline under the active lane's name (timeline.css:553-557).
  static let underlineThickness = 1.0
  static let underlineOffset = 3.0
  /// The band at the active lane's edge (timeline.css:559-573, `.is-active`).
  static let bandWidth = 4.0
  static let bandInset = 5.0

  static func lights(row: RemoteFieldRow, activeId: String?) -> Bool {
    row.id == activeId
  }
}

/// A mark's path in the desktop's 24-unit grid, scaled into `rect`. A rounded corner is a quarter arc between the edges
/// it joins (the SVG's `a` command at the same radius).
private struct GridPath {
  var path = Path()

  mutating func move(_ x: Double, _ y: Double) { path.move(to: CGPoint(x: x, y: y)) }
  mutating func line(_ x: Double, _ y: Double) { path.addLine(to: CGPoint(x: x, y: y)) }
  mutating func corner(_ cx: Double, _ cy: Double, to x: Double, _ y: Double, radius: Double) {
    path.addArc(tangent1End: CGPoint(x: cx, y: cy), tangent2End: CGPoint(x: x, y: y), radius: radius)
  }
  mutating func close() { path.closeSubpath() }

  func scaled(into rect: CGRect) -> Path {
    path.applying(
      CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: rect.width / 24, y: rect.height / 24))
  }
}

/// `FolderMark`: a project's folder, or a terminal's prompt, 11 pt in a 24 grid.
struct TimelineFolderMark: Shape {
  let terminal: Bool

  func path(in rect: CGRect) -> Path {
    var grid = GridPath()
    if terminal {
      // M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3ZM7 9.5l3 2.5-3 2.5M12 15h4.5
      grid.move(3, 8)
      grid.corner(3, 5, to: 6, 5, radius: 3)
      grid.line(18, 5)
      grid.corner(21, 5, to: 21, 8, radius: 3)
      grid.line(21, 16)
      grid.corner(21, 19, to: 18, 19, radius: 3)
      grid.line(6, 19)
      grid.corner(3, 19, to: 3, 16, radius: 3)
      grid.close()
      grid.move(7, 9.5)
      grid.line(10, 12)
      grid.line(7, 14.5)
      grid.move(12, 15)
      grid.line(16.5, 15)
    } else {
      // M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z
      grid.move(3.5, 7)
      grid.corner(3.5, 5, to: 5.5, 5, radius: 2)
      grid.line(9.5, 5)
      grid.line(11.5, 7)
      grid.line(18.5, 7)
      grid.corner(20.5, 7, to: 20.5, 9, radius: 2)
      grid.line(20.5, 18)
      grid.corner(20.5, 20, to: 18.5, 20, radius: 2)
      grid.line(5.5, 20)
      grid.corner(3.5, 20, to: 3.5, 18, radius: 2)
      grid.close()
    }
    return grid.scaled(into: rect)
  }
}

/// `PeerMark`: a desktop's line mark, for a lane on another device.
struct TimelinePeerMark: Shape {
  func path(in rect: CGRect) -> Path {
    // M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5Z
    // M9 20.5h6M12 17v3.5
    var grid = GridPath()
    grid.move(4.5, 5)
    grid.line(19.5, 5)
    grid.corner(21, 5, to: 21, 6.5, radius: 1.5)
    grid.line(21, 15.5)
    grid.corner(21, 17, to: 19.5, 17, radius: 1.5)
    grid.line(4.5, 17)
    grid.corner(3, 17, to: 3, 15.5, radius: 1.5)
    grid.line(3, 6.5)
    grid.corner(3, 5, to: 4.5, 5, radius: 1.5)
    grid.close()
    grid.move(9, 20.5)
    grid.line(15, 20.5)
    grid.move(12, 17)
    grid.line(12, 20.5)
    return grid.scaled(into: rect)
  }
}

/// `NowMark`: the way home, an arrow to the head.
struct TimelineNowMark: Shape {
  func path(in rect: CGRect) -> Path {
    // M4 12h10.5M11 8.5l3.5 3.5-3.5 3.5M19.5 4.5v15
    var grid = GridPath()
    grid.move(4, 12)
    grid.line(14.5, 12)
    grid.move(11, 8.5)
    grid.line(14.5, 12)
    grid.line(11, 15.5)
    grid.move(19.5, 4.5)
    grid.line(19.5, 19.5)
    return grid.scaled(into: rect)
  }
}

extension Shape {
  /// A mark stroked as the stylesheet strokes it: its viewBox's stroke width at `size`, round caps and joins.
  func timelineMark(size: Double, strokeWidth: Double, colour: SwarmColor) -> some View {
    stroke(
      TimelineCanvasReplay.color(colour),
      style: StrokeStyle(lineWidth: strokeWidth * size / 24, lineCap: .round, lineJoin: .round)
    )
    .frame(width: size, height: size)
  }
}

/// `nameRow`: a lane's name floated over its wake's far end — its marks and name, and under it what runs it when the
/// lane is tall enough for two lines; the open card's lane underlined, with the band at its edge (J-S4).
struct TimelineNameRow: View {
  let lane: TimelineLane
  let h: Double
  let inks: TimelineInks
  let skin: GodviewSkin

  var body: some View {
    let sub = TimelineWords.subLine(lane)
    let two = h >= 30 && lane.kind == .agent && !sub.isEmpty
    let terminal = lane.kind == .terminal
    let markColour = terminal ? skin.ink(.textMuted) : (lane.colour ?? skin.ink(.textMuted))
    ZStack(alignment: .leading) {
      if lane.row.active {
        UnevenRoundedRectangle(bottomTrailingRadius: 2, topTrailingRadius: 2)
          .fill(TimelineCanvasReplay.color(skin.ink(.textMain)))
          .frame(width: TimelineActive.bandWidth, height: max(0, h - 2 * TimelineActive.bandInset))
      }
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 5) {
          if !lane.row.isSelf {
            TimelinePeerMark().timelineMark(size: 11, strokeWidth: 2, colour: skin.ink(.textMuted))
              .accessibilityLabel("on \(lane.row.monitor.device.name)")
          }
          TimelineFolderMark(terminal: terminal).timelineMark(size: 11, strokeWidth: 2, colour: markColour)
          Text(TimelineWords.name(lane))
            .font(.system(size: 11, weight: terminal ? .semibold : .bold))
            .tracking(-0.11)
            .foregroundStyle(TimelineCanvasReplay.color(terminal ? skin.ink(.textMuted) : skin.ink(.textMain)))
            .underline(lane.row.active, color: TimelineCanvasReplay.color(skin.ink(.textMain)))
            .lineLimit(1)
            .truncationMode(.tail)
        }
        if two {
          Text(sub)
            .font(.system(size: 9))
            .foregroundStyle(TimelineCanvasReplay.color(skin.ink(.textMuted)))
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.leading, 16)
        }
      }
      .padding(.leading, 14)
      .padding(.trailing, 10)
    }
    .frame(height: h, alignment: .leading)
    .opacity(lane.receded ? TimelineLanes.quietAlpha : 1)
  }
}

/// `headRow`: a lane's body on the head line and its readout beside it, lit as the swarm lights a body
/// (timeline.css:613-680): the project's colour while it works, the waits' lights over their grounds, rest's ground
/// with a faint ring; a hollow body for a moment with no record, none before its birth; a terminal a small square of
/// its own. A wait you owe rings out of it (1.1 s, island), only while motion is allowed.
struct TimelineHeadRow: View {
  let lane: TimelineLane
  let h: Double
  let readout: TimelineReadout
  let inks: TimelineInks
  let skin: GodviewSkin
  let motion: Bool

  private var terminal: Bool { lane.kind == .terminal }
  /// `--mv-timeline-body`: clamp(14 px, the lane less 12, 22 px); a terminal's is 10.
  private var size: Double { terminal ? 10 : min(22, max(14, h - 12)) }
  private var colour: SwarmColor { inks.project(lane.colour) }

  var body: some View {
    ZStack(alignment: .leading) {
      mark
        .frame(width: size, height: size)
        .offset(x: -size / 2)
      words
        .padding(.leading, terminal ? 14 : size / 2 + 9)
        .padding(.trailing, 8)
    }
    .frame(height: h, alignment: .leading)
    .opacity(lane.receded ? TimelineLanes.quietAlpha : 1)
  }

  @ViewBuilder private var mark: some View {
    let circle = Circle()
    switch (terminal, readout.tone) {
    case (_, .none):
      Color.clear
    case (_, .unrecorded):
      circle.strokeBorder(
        TimelineCanvasReplay.color(skin.ink(.textFaint)), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
    case (true, .working):
      circle.strokeBorder(
        TimelineCanvasReplay.color(skin.ink(.textMuted)), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
    case (true, _):
      circle.fill(TimelineCanvasReplay.color(skin.ink(.panelBorder)))
    case (false, .working):
      let between = TimelineInks.mix(colour, skin.ink(.idleBg), weight: 0.42)
      circle
        .fill(
          RadialGradient(
            stops: [
              .init(color: TimelineCanvasReplay.color(colour), location: 0.30),
              .init(color: TimelineCanvasReplay.color(between), location: 0.56),
              .init(color: TimelineCanvasReplay.color(skin.ink(.idleBg)), location: 0.80),
            ], center: .center, startRadius: 0, endRadius: size / 2 * 2.squareRoot())
        )
        .overlay(circle.strokeBorder(TimelineCanvasReplay.color(colour.withAlpha(0.75)), lineWidth: 1.5))
        .shadow(color: TimelineCanvasReplay.color(colour.withAlpha(0.45)), radius: 6)
    case (false, .blocked), (false, .unseen):
      let light = readout.tone == .blocked ? inks.orange : inks.blue
      let ground = readout.tone == .blocked ? inks.orangeGround : inks.blueGround
      circle
        .fill(
          RadialGradient(
            stops: [
              .init(color: TimelineCanvasReplay.color(light), location: 0.32),
              .init(color: TimelineCanvasReplay.color(ground), location: 0.74),
            ], center: .center, startRadius: 0, endRadius: size / 2 * 2.squareRoot())
        )
        .overlay(circle.strokeBorder(TimelineCanvasReplay.color(light), lineWidth: 1.5))
        .shadow(color: TimelineCanvasReplay.color(light.withAlpha(0.5)), radius: 6)
        .overlay {
          if readout.owed && motion { TimelineOwedRing(colour: light) }
        }
    case (false, .idle):
      circle.fill(TimelineCanvasReplay.color(skin.ink(.idleBg)))
        .overlay(circle.strokeBorder(TimelineCanvasReplay.color(skin.ink(.textFaint)), lineWidth: 1))
    }
  }

  /// The readout's two words: its length (`big`) and what it says (`small`), side by side in a one-line lane.
  @ViewBuilder private var words: some View {
    let one = h < 30
    let layout = one ? AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 7))
      : AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
    layout {
      if !readout.big.isEmpty {
        Text(readout.big)
          .font(.system(size: terminal ? 9.5 : 11, weight: bigWeight).monospacedDigit())
          .foregroundStyle(TimelineCanvasReplay.color(bigColour))
          .lineLimit(1)
      }
      Text(readout.small)
        .font(.system(size: 8.5))
        .foregroundStyle(TimelineCanvasReplay.color(smallColour))
        .lineLimit(1)
        .truncationMode(.tail)
    }
  }

  private var bigWeight: Font.Weight {
    terminal || readout.tone == .idle ? .semibold : .bold
  }

  /// The readout's inks (timeline.css:767-797): work in the project's ink (deepened toward the main ink on a light
  /// ground), the waits in theirs, rest muted, a moment with no state faint; a terminal's length muted.
  private var bigColour: SwarmColor {
    if terminal { return skin.ink(.textMuted) }
    switch readout.tone {
    case .working: return inks.dark ? colour : TimelineInks.mix(colour, skin.ink(.textMain), weight: 0.74)
    case .blocked: return inks.orangeInk
    case .unseen: return inks.blueInk
    case .idle: return skin.ink(.textMuted)
    case .none, .unrecorded: return skin.ink(.textFaint)
    }
  }

  private var smallColour: SwarmColor {
    switch readout.tone {
    case .blocked: inks.orangeInk
    case .unseen: inks.blueInk
    case .none, .unrecorded: skin.ink(.textFaint)
    case .working, .idle: skin.ink(.textMuted)
    }
  }
}

/// The wave you owe: a ring leaving the body, 1 → 1.9 its size and 85% → 0, 1.1 s on the island curve, forever
/// (timeline.css:682-704). Only mounted while motion is allowed (:706-716).
struct TimelineOwedRing: View {
  let colour: SwarmColor
  @State private var out = false

  var body: some View {
    Circle()
      .strokeBorder(TimelineCanvasReplay.color(colour), lineWidth: 1.5)
      .padding(-1)
      .scaleEffect(out ? 1.9 : 1)
      .opacity(out ? 0 : 0.85)
      .onAppear {
        withAnimation(FieldMotion.island(1.1).repeatForever(autoreverses: false)) { out = true }
      }
  }
}
