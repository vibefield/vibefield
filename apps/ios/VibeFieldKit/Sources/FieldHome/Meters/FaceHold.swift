import FieldProduct
import Foundation

// UM-4 (UM-D24 A; DESIGN.md §8 "The phone's corner") — THE HELD FACE, PURE.
//
// RED STUB (UM-4e): the shape, finding and saying nothing.

enum FaceHold {
  /// Where a bud stands about the face: its spoke's angle and reach, and the point they make.
  struct Spot: Equatable {
    let angle: Double
    let r: Double
    let x: Double
    let y: Double
  }

  /// The huge words (a verb at 40%, then the rest) and the mono line under them.
  struct Words: Equatable {
    let verb: String?
    let rest: String
    let line: String
  }

  /// A bud's label: its name over its state.
  struct BudLabel: Equatable {
    let name: String
    let state: String
    let hot: Bool
  }

  /// What VoiceOver offers in place of the hold.
  enum Act: Equatable {
    case page
    case show(String)
    case showAll
  }

  struct Action: Equatable {
    let name: String
    let act: Act
  }

  static func spots(_ count: Int, face: CGPoint) -> [Spot] { [] }

  static func reach(_ finger: CGPoint, face: CGPoint, profiles: [String]) -> ProfileLens.Release { .open }

  static func labelRadius(_ spot: Spot, letters: Int, reached: Bool) -> Double { 0 }

  static func words(_ reading: MetersReading, reach: ProfileLens.Release, now: Date) -> Words {
    Words(verb: nil, rest: "", line: "")
  }

  static func budLabel(_ set: AgentProfileSet, reading: MetersReading, now: Date) -> BudLabel {
    BudLabel(name: "", state: "", hot: false)
  }

  static func faceLabel(_ name: String) -> String { "" }

  static func actions(_ profiles: [AgentProfileSet]) -> [Action] { [] }

  #if DEBUG
    static func mockReach(_ arguments: [String]) -> ProfileLens.Release? { nil }
  #endif
}
