import SwiftUI

// Item 417b (2026-11-14; on James's item 417, 08:13:38Z, session qa-01: "message view initial loading should adopt
// latest desktop design that uses our logo mark") — THE LIVING MARK, DRAWN BY THE PHONE. The desktop's mark is a
// generated SVG that animates itself (`packages/design-kit/src/living-mark`). The phone reads that SVG's own
// numbers (LivingMarkData.swift) by that SVG's own rules. DESIGN.md §8 "The living mark, drawn as SVG".
//
// STUB (the red): the rules answer nothing. A path's text reads to no command and no number, two paths do not
// mix, the clock stands at its first key with nothing added, and a light's stroke has no length. Nothing draws
// yet, and nothing reads these.

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

  /// Reads a path as the generator writes one.
  init(reading text: String) {
    self.init(commands: [], numbers: [])
  }

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

  /// This path mixed with `other`, `share` of the way to it.
  func mixed(with other: LivingMarkOutline, by share: Double) -> LivingMarkOutline {
    self
  }

  /// The outline as a path, in the SVG's own units.
  func path() -> Path {
    Path()
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

  /// Where the moment `seconds` after the mark began to move stands among the keys.
  static func place(at seconds: Double) -> Place {
    Place(key: 0, share: 0)
  }

  /// What the twist adds to every stroke's offset at `place`, in the edge's 1000.
  static func twist(at place: Place) -> Double {
    0
  }

  /// What the lights' lap adds to every stroke's offset `seconds` after the mark began to move, in the edge's 1000.
  static func travel(at seconds: Double) -> Double {
    0
  }

  /// Where a light's stroke lies on the edge: the light stands at `offset`, and `shift` is what the twist and the
  /// lap have added.
  static func run(of stroke: LivingMarkData.Stroke, at offset: Double, shift: Double) -> Run {
    Run(from: 0, length: 0)
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

  /// At rest: every motion off.
  static let rest = LivingMarkPose(place: LivingMarkClock.Place(key: 0, share: 0), shift: 0)

  /// The mark `seconds` after it began to move.
  static func at(_ seconds: Double) -> LivingMarkPose {
    rest
  }

  init(place: LivingMarkClock.Place, shift: Double) {
    let nothing = LivingMarkOutline(commands: [], numbers: [])
    edge = nothing
    cover = nothing
    hole = nothing
    self.shift = shift
  }
}
