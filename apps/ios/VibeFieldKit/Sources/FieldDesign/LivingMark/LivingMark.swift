import SwiftUI

// Item 417b (2026-11-14; on James's item 417, 08:13:38Z, session qa-01: "message view initial loading should adopt
// latest desktop design that uses our logo mark") — THE LIVING MARK, DRAWN BY THE PHONE. The desktop's mark is a
// generated SVG that animates itself (`packages/design-kit/src/living-mark`). The phone reads that SVG's own
// numbers (LivingMarkData.swift) by that SVG's own rules, in a Canvas. DESIGN.md §8 "The living mark, drawn as
// SVG".
//
// The SVG's recipe, as a browser reads it:
//   · the ink: the edge filled even-odd in the ground's ink with a hairline of half a point, and over it the
//     crossing's cover, filled and hairlined the same;
//   · the twist: the edge, the cover and the hole are keyed thirteen times over 9.52 s. Between two keys every
//     number of a path goes from the one to the other on the stretch's own cubic-bezier. Every key has one command
//     structure, which is what lets a browser mix two keys, and lets this;
//   · the lights: three colours, five strokes each. A stroke is one dash of the edge, round at its ends, about its
//     light's place: its `stroke-dashoffset` is the light's place and its class's lead, and to it are ADDED what
//     the twist's keys say and what the lap says (`animation-composition: replace, add, add`). The dash's period
//     is the edge's whole length, so a stroke is one stretch of the edge wherever it has got to;
//   · the lights are clipped to the hole's path, even-odd: everywhere but the near strand at the crossing;
//   · at rest every animation is off: the first key, and the offsets as the classes state them.
//
// The rules are pure and held by rows (LivingMarkTests). `LivingMarkDrawing` and `LivingMark` alone draw, and they
// draw what the rules answer. Nothing is read from text while it draws: the keys are read once, when a mark is
// first drawn (`LivingMarkShapes`), and a mark that is not on screen costs nothing.

/// One path of the mark as the SVG writes it: its commands in order and their numbers in order, kept apart so two
/// paths of one structure mix number for number.
struct LivingMarkOutline: Equatable, Sendable {
  /// The commands by the SVG's letters. `M` and `L` name a place. `c` and `s` are curves, `h` and `v` lines along
  /// one axis, each measured from where the path stands. `z` closes.
  let commands: [Character]
  let numbers: [Double]

  init(commands: [Character], numbers: [Double]) {
    self.commands = commands
    self.numbers = numbers
  }

  /// Reads a path as the generator writes one: whole numbers, parted by a space, a line break, a command's letter
  /// or the next number's own minus sign.
  init(reading text: String) {
    var commands: [Character] = []
    var numbers: [Double] = []
    var digits = ""
    for character in text {
      if Self.digit.contains(character) {
        digits.append(character)
        continue
      }
      // whatever is not a digit ends the number before it; a minus sign begins the next
      if let number = Double(digits) { numbers.append(number) }
      digits = character == "-" ? "-" : ""
      if character.isLetter { commands.append(character) }
    }
    if let number = Double(digits) { numbers.append(number) }
    self.init(commands: commands, numbers: numbers)
  }

  private static let digit: ClosedRange<Character> = "0"..."9"

  /// How many numbers a command takes.
  static func takes(_ command: Character) -> Int {
    switch command {
    case "M", "L": return 2
    case "h", "v": return 1
    case "c": return 6
    case "s": return 4
    default: return 0
    }
  }

  /// This path mixed with `other`, `share` of the way to it: number for number, as a browser mixes two paths of
  /// one structure. Paths of two structures do not mix, and this one stands.
  func mixed(with other: LivingMarkOutline, by share: Double) -> LivingMarkOutline {
    guard commands == other.commands, numbers.count == other.numbers.count else { return self }
    var mixed = numbers
    for index in mixed.indices {
      mixed[index] += (other.numbers[index] - mixed[index]) * share
    }
    return LivingMarkOutline(commands: commands, numbers: mixed)
  }

  /// The outline as a path, in the SVG's own units. A curve written `s` leaves its point as the curve before it
  /// came in: its first control is that curve's second, turned about the point between them. A path whose numbers
  /// run out is drawn as far as they go.
  func path() -> Path {
    var path = Path()
    // where the path stands, where its part began, and the last curve's second control
    var x = 0.0
    var y = 0.0
    var beganX = 0.0
    var beganY = 0.0
    var hookX = 0.0
    var hookY = 0.0
    var next = 0
    for command in commands {
      let count = Self.takes(command)
      guard next + count <= numbers.count else { break }
      switch command {
      case "M":
        x = numbers[next]
        y = numbers[next + 1]
        beganX = x
        beganY = y
        path.move(to: CGPoint(x: x, y: y))
        hookX = x
        hookY = y
      case "L":
        x = numbers[next]
        y = numbers[next + 1]
        path.addLine(to: CGPoint(x: x, y: y))
        hookX = x
        hookY = y
      case "h":
        x += numbers[next]
        path.addLine(to: CGPoint(x: x, y: y))
        hookX = x
        hookY = y
      case "v":
        y += numbers[next]
        path.addLine(to: CGPoint(x: x, y: y))
        hookX = x
        hookY = y
      case "c":
        let secondX = x + numbers[next + 2]
        let secondY = y + numbers[next + 3]
        let endX = x + numbers[next + 4]
        let endY = y + numbers[next + 5]
        path.addCurve(
          to: CGPoint(x: endX, y: endY),
          control1: CGPoint(x: x + numbers[next], y: y + numbers[next + 1]),
          control2: CGPoint(x: secondX, y: secondY))
        hookX = secondX
        hookY = secondY
        x = endX
        y = endY
      case "s":
        let secondX = x + numbers[next]
        let secondY = y + numbers[next + 1]
        let endX = x + numbers[next + 2]
        let endY = y + numbers[next + 3]
        path.addCurve(
          to: CGPoint(x: endX, y: endY),
          control1: CGPoint(x: 2 * x - hookX, y: 2 * y - hookY),
          control2: CGPoint(x: secondX, y: secondY))
        hookX = secondX
        hookY = secondY
        x = endX
        y = endY
      case "z":
        path.closeSubpath()
        x = beganX
        y = beganY
        hookX = x
        hookY = y
      default:
        break
      }
      next += count
    }
    return path
  }
}

/// The mark's clock: where in the twist a moment stands, and how far the lights have gone.
enum LivingMarkClock {
  /// Where a moment stands among the keys: the key its stretch begins at, and how far toward the next key a path
  /// has gone, on the stretch's own timing function.
  struct Place: Equatable, Sendable {
    let key: Int
    let share: Double
  }

  /// Where one stroke of a light lies on the edge, in shares of the edge's length: from where, and how long.
  struct Run: Equatable, Sendable {
    let from: Double
    let length: Double
  }

  /// The least time between two drawings of a moving mark: sixty a second at most.
  static let frame: Double = 1.0 / 60

  /// The SVG's timing functions as curves, in turn from the first key.
  static let curves: [UnitCurve] = LivingMarkData.eases.map { ease in
    UnitCurve.bezier(
      startControlPoint: UnitPoint(x: CGFloat(ease.x1), y: CGFloat(ease.y1)),
      endControlPoint: UnitPoint(x: CGFloat(ease.x2), y: CGFloat(ease.y2)))
  }

  /// Where the moment `seconds` after the mark began to move stands among the keys. The turn comes round every
  /// `twistPeriod`; a moment before the mark began is its beginning.
  static func place(at seconds: Double) -> Place {
    let keys = LivingMarkData.keys
    guard keys.count >= 2, LivingMarkData.twistPeriod > 0 else { return Place(key: 0, share: 0) }
    let turns = max(0, seconds) / LivingMarkData.twistPeriod
    let percent = (turns - turns.rounded(.down)) * 100
    var key = 0
    while key < keys.count - 2, percent >= keys[key + 1] { key += 1 }
    let span = keys[key + 1] - keys[key]
    let along = span > 0 ? min(max((percent - keys[key]) / span, 0), 1) : 0
    // a timing function begins at nothing and ends at the whole: at a stretch's two ends the key itself stands,
    // to the number, whatever a curve's solver would answer there
    guard along > 0, along < 1, !curves.isEmpty else { return Place(key: key, share: along) }
    return Place(key: key, share: curves[key % curves.count].value(at: along))
  }

  /// What the twist adds to every stroke's offset at `place`, in the edge's 1000: between the offsets its two
  /// keys state, by the place's share.
  static func twist(at place: Place) -> Double {
    let offsets = LivingMarkData.twist
    guard offsets.indices.contains(place.key) else { return 0 }
    guard offsets.indices.contains(place.key + 1) else { return offsets[place.key] }
    return offsets[place.key] + (offsets[place.key + 1] - offsets[place.key]) * place.share
  }

  /// What the lights' lap adds to every stroke's offset `seconds` after the mark began to move, in the edge's
  /// 1000: evenly from nothing to a whole edge back each `travelPeriod`, begun `travelLead` into the lap.
  static func travel(at seconds: Double) -> Double {
    guard LivingMarkData.travelPeriod > 0 else { return 0 }
    let laps = (max(0, seconds) + LivingMarkData.travelLead) / LivingMarkData.travelPeriod
    return -LivingMarkData.edgeLength * (laps - laps.rounded(.down))
  }

  /// Where a light's stroke lies on the edge: the light stands at `offset`, and `shift` is what the twist and the
  /// lap have added. The SVG's dash begins the stroke's whole offset BEFORE the edge's start, which on a closed
  /// edge is that far short of its end; it comes round at the edge's start.
  static func run(of stroke: LivingMarkData.Stroke, at offset: Double, shift: Double) -> Run {
    let edge = LivingMarkData.edgeLength
    guard edge > 0 else { return Run(from: 0, length: 0) }
    var start = (-(offset + stroke.lead + shift)).truncatingRemainder(dividingBy: edge)
    if start < 0 { start += edge }
    if start >= edge { start -= edge }
    return Run(from: start / edge, length: stroke.dash / edge)
  }
}

/// The mark's paths at each key, read once from the carried text when a mark is first drawn.
enum LivingMarkShapes {
  static let loop = LivingMarkData.loop.map { LivingMarkOutline(reading: $0) }
  static let cover = LivingMarkData.cover.map { LivingMarkOutline(reading: $0) }
  static let hole = LivingMarkData.hole.map { LivingMarkOutline(reading: $0) }
}

/// The mark at one moment: its three paths, and how far its lights have gone.
struct LivingMarkPose: Equatable, Sendable {
  let edge: LivingMarkOutline
  let cover: LivingMarkOutline
  let hole: LivingMarkOutline
  /// What the twist and the lap add to every stroke's offset, in the edge's 1000.
  let shift: Double

  /// At rest: every motion off. The first key, and each light where its class puts it. It is the SVG's `-rest`
  /// still, and what the moving SVG shows under reduced motion.
  static let rest = LivingMarkPose(place: LivingMarkClock.Place(key: 0, share: 0), shift: 0)

  /// The mark `seconds` after it began to move.
  static func at(_ seconds: Double) -> LivingMarkPose {
    let place = LivingMarkClock.place(at: seconds)
    return LivingMarkPose(
      place: place, shift: LivingMarkClock.twist(at: place) + LivingMarkClock.travel(at: seconds))
  }

  init(place: LivingMarkClock.Place, shift: Double) {
    edge = Self.mixed(LivingMarkShapes.loop, at: place)
    cover = Self.mixed(LivingMarkShapes.cover, at: place)
    hole = Self.mixed(LivingMarkShapes.hole, at: place)
    self.shift = shift
  }

  /// A keyed path at `place`: its key there, mixed toward the next by the place's share.
  static func mixed(_ keys: [LivingMarkOutline], at place: LivingMarkClock.Place) -> LivingMarkOutline {
    guard keys.indices.contains(place.key) else { return LivingMarkOutline(commands: [], numbers: []) }
    guard keys.indices.contains(place.key + 1), place.share != 0 else { return keys[place.key] }
    return keys[place.key].mixed(with: keys[place.key + 1], by: place.share)
  }
}

/// The mark drawn, in the SVG's order: the ink, the crossing's cover, then the lights under their clip.
enum LivingMarkDrawing {
  /// Draws `pose` in `ink` across `size`, which is the SVG's box at whatever scale.
  static func draw(_ pose: LivingMarkPose, ink: Color, in context: inout GraphicsContext, size: CGSize) {
    let box = LivingMarkData.viewBox
    guard box.width > 0, size.width > 0 else { return }
    let scale = size.width / box.width
    // from here on a number is the SVG's own unit
    var mark = context
    mark.scaleBy(x: scale, y: scale)
    mark.translateBy(x: -box.minX, y: -box.minY)
    // the hairline does not scale with the mark: half a point at every size
    let hairline = StrokeStyle(lineWidth: LivingMarkData.hairline / scale, lineJoin: .round)

    let edge = pose.edge.path()
    mark.fill(edge, with: .color(ink), style: FillStyle(eoFill: true))
    mark.stroke(edge, with: .color(ink), style: hairline)
    let cover = pose.cover.path()
    mark.fill(cover, with: .color(ink))
    mark.stroke(cover, with: .color(ink), style: hairline)

    var lights = mark
    lights.clip(to: pose.hole.path(), style: FillStyle(eoFill: true))
    for light in LivingMarkData.lights {
      let color = Self.color(light.color)
      for stroke in LivingMarkData.strokes {
        let run = LivingMarkClock.run(of: stroke, at: light.offset, shift: pose.shift)
        lights.stroke(
          stretch(of: edge, run), with: .color(color.opacity(stroke.opacity)),
          style: StrokeStyle(lineWidth: stroke.width, lineCap: .round))
      }
    }
  }

  /// The stretch of the edge a run covers. A run that passes the edge's end goes on from its start, and the two
  /// parts are one path, so one stroke draws them and where they meet is not drawn twice.
  static func stretch(of edge: Path, _ run: LivingMarkClock.Run) -> Path {
    let end = run.from + run.length
    guard end > 1 else { return edge.trimmedPath(from: CGFloat(run.from), to: CGFloat(end)) }
    var path = edge.trimmedPath(from: CGFloat(run.from), to: 1)
    path.addPath(edge.trimmedPath(from: 0, to: CGFloat(end - 1)))
    return path
  }

  /// `#RRGGBB`, as the SVG writes a light's colour, in sRGB; clear for anything else.
  static func color(_ hex: String) -> Color {
    let digits = hex.hasPrefix("#") ? hex.dropFirst() : Substring(hex)
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return .clear }
    return Color(
      .sRGB, red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}

/// The living mark (DESIGN.md §8 "The living mark, drawn as SVG"): the field's own mark, the band that runs the ∞
/// with its one half-twist and its three lights, moving, for a wait the field does not draw. It is the desktop's
/// generated SVG, drawn by the phone from the SVG's own numbers.
///
/// It moves only while its work does (HG-L1): `resting` stands it still, in the pose the SVG rests in, and so does
/// Reduce Motion. It is decoration and is not read out: the words beside it say what loads.
public struct LivingMark: View {
  /// What the mark stands on, the app icon's two grounds: `dark` draws it in white ink, `light` in black. The
  /// lights are the same on both.
  public enum Ground: Sendable {
    case dark
    case light

    /// The ground a colour scheme is: the dark by night, the light by day.
    public init(_ scheme: ColorScheme) {
      self = scheme == .dark ? .dark : .light
    }

    var ink: Color {
      switch self {
      case .dark: return .white
      case .light: return .black
      }
    }
  }

  /// The mark's own size in points, the SVG's and the desktop's `LIVING_MARK_SIZE`: 99 by 44. A place made for the
  /// mark takes its box from here.
  public nonisolated static let size: CGSize = LivingMarkData.size

  private let ground: Ground
  private let width: CGFloat
  private let resting: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// When this mark was first drawn. Its clock starts there, from the pose it rests in, as the SVG's starts with
  /// its document.
  @State private var began = Date.now

  /// `width` is in points and the height follows it; nil is the mark's own 99. `resting` says its work is paused.
  public init(ground: Ground, width: CGFloat? = nil, resting: Bool = false) {
    self.ground = ground
    self.width = width ?? LivingMarkData.size.width
    self.resting = resting
  }

  public var body: some View {
    let ink = ground.ink
    return Group {
      if resting || reduceMotion {
        Canvas { context, canvas in
          LivingMarkDrawing.draw(LivingMarkPose.rest, ink: ink, in: &context, size: canvas)
        }
      } else {
        TimelineView(.animation(minimumInterval: LivingMarkClock.frame)) { timeline in
          let seconds = timeline.date.timeIntervalSince(began)
          Canvas { context, canvas in
            LivingMarkDrawing.draw(LivingMarkPose.at(seconds), ink: ink, in: &context, size: canvas)
          }
        }
      }
    }
    .frame(width: width, height: width * LivingMarkData.size.height / LivingMarkData.size.width)
    .accessibilityHidden(true)
  }
}
