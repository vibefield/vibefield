import FieldDesign
import FieldProduct
import Foundation

// UM-4 (UM-D24 A; DESIGN.md §8 "The phone's corner": "Hold it", "Held", "With one profile", "With several", "The
// reach", "The words follow the reach", "Let go", "VoiceOver") — THE HELD FACE, PURE: where the profiles bloom about
// the face (the drawing's `FACE_ANG` and `FACE_R`, `round4/src/p3c-phone.js`), what a finger reaches, what the huge
// words and the mono line say, each bud's label and where it stands, and what VoiceOver offers in place of a hold it
// cannot make. `FaceHoldOverlay` draws it; the lens takes the let-go (`ProfileLens.letGo`).
//
// The mono line counts the meters ("3 read · none need you"), never sessions: the design's "8 sessions · every
// profile" waits for a run's profile on the phone's rows (UM-5), so the hub and a bud say their plans' reads instead.

enum FaceHold {
  /// The spawn bloom's hold (`FieldMotion.longPressDuration`, 520 ms), and the slop before it opens.
  static let hold = FieldMotion.longPressDuration
  static let slop: CGFloat = 10
  /// The first four buds' spokes, 160 from the face's centre; a fifth to an eighth stand at 224, half a step (11°) on
  /// (the lead's placement, ‹for James›). Past eight ‹for James›: the bloom holds eight, the page lists every one.
  static let angles: [Double] = [-92, -70, -48, -26]
  static let radius: Double = 160
  static let outerRadius: Double = 224
  static let outerTurn: Double = 11
  static let most = 8
  /// A bud: its disc and its circle at 54.
  static let bud: Double = 54
  /// The reach: the hub within 30; else the nearest bud within 58; else the hub within 52; else open ground.
  static let hubReach: Double = 30
  static let budReach: Double = 58
  static let hubLeft: Double = 52

  /// A hold in progress: the face's centre in the window, and what the finger reaches.
  struct Held: Equatable {
    let face: CGPoint
    var reach: ProfileLens.Release
  }

  /// The held face's standing on HomeScreen. A STUB (the U3 review's red): only a let-go closes it, as HomeScreen
  /// held it.
  struct Stand: Equatable {
    var held: Held?

    mutating func open(face: CGPoint) { held = Held(face: face, reach: .hub) }

    mutating func move(_ finger: CGPoint, profiles: [String]) {
      guard let face = held?.face else { return }
      let reach = FaceHold.reach(finger, face: face, profiles: profiles)
      if reach != held?.reach { held?.reach = reach }
    }

    mutating func letGo() -> ProfileLens.Release? {
      defer { held = nil }
      return held?.reach
    }

    mutating func cancel() {}
  }

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

  /// A bud's label: its name (mono capitals) over its state ("42% · 5H", "READING", "NO METER").
  struct BudLabel: Equatable {
    let name: String
    let state: String
    let hot: Bool
  }

  /// What VoiceOver offers in place of the hold.
  enum Act: Equatable {
    /// opens the Agent Profiles page
    case page
    /// sets the lens on a profile
    case show(String)
    /// clears the lens
    case showAll
  }

  struct Action: Equatable {
    let name: String
    let act: Act
  }

  /// The buds' places for `count` profiles about the face, at most eight.
  static func spots(_ count: Int, face: CGPoint) -> [Spot] {
    (0..<min(count, most)).map { index in
      let first = index < angles.count
      let angle = first ? angles[index] : angles[index - angles.count] + outerTurn
      let r = first ? radius : outerRadius
      let a = angle * Double.pi / 180
      return Spot(angle: angle, r: r, x: Double(face.x) + r * cos(a), y: Double(face.y) + r * sin(a))
    }
  }

  /// What a finger at `finger` reaches, the profiles' buds standing in their order.
  static func reach(_ finger: CGPoint, face: CGPoint, profiles: [String]) -> ProfileLens.Release {
    let fromFace = hypot(Double(finger.x - face.x), Double(finger.y - face.y))
    if fromFace < hubReach { return .hub }
    let near = zip(profiles, spots(profiles.count, face: face))
      .map { id, spot in (id: id, distance: hypot(Double(finger.x) - spot.x, Double(finger.y) - spot.y)) }
      .min { $0.distance < $1.distance }
    if let near, near.distance < budReach { return .bud(near.id) }
    return fromFace < hubLeft ? .hub : .open
  }

  /// How far out along its spoke a bud's label stands: `r + 33 + half × |cos a| + 12 × |sin a|` (38 for the reached
  /// bud), where half is `max(letters × 5.7, 40) / 2`.
  static func labelRadius(_ spot: Spot, letters: Int, reached: Bool) -> Double {
    let half = max(Double(letters) * 5.7, 40) / 2
    let a = spot.angle * Double.pi / 180
    return spot.r + (reached ? 38 : 33) + half * abs(cos(a)) + 12 * abs(sin(a))
  }

  /// The words over the held face (§9 "The meters' words"): with one profile "Usage" over its reads; with several,
  /// the reach's — Show all, Show ‹profile›, or Cancel on open ground.
  static func words(_ reading: MetersReading, reach: ProfileLens.Release, home: String, now: Date) -> Words {
    let profiles = reading.profiles
    guard profiles.count > 1 else {
      return Words(verb: nil, rest: "Usage", line: reads(reading.meters(of: profiles.first?.id, now: now)))
    }
    switch reach {
    case .hub:
      return Words(verb: "Show", rest: "all", line: "\(reads(reading.meters(of: nil, now: now))) · every profile")
    case .bud(let id):
      guard let set = profiles.first(where: { $0.id == id }) else { return cancel }
      return Words(verb: "Show", rest: set.label, line: reads(reading.meters(of: id, now: now)))
    case .open:
      return cancel
    }
  }

  private static let cancel = Words(verb: nil, rest: "Cancel", line: "let go here to leave the field as it is")

  /// "3 read · none need you", "1 read · 2 need you".
  static func reads(_ meters: ProfileMeters) -> String {
    let read = meters.entries.filter { $0.kind == .reading }.count
    let needs = meters.entries.filter { $0.kind == .needsYou }.count
    return "\(read) read · \(needs == 0 ? "none need you" : "\(needs) need you")"
  }

  /// A bud's label: the profile's name over its tightest percent and window, READING while a first read is out, or
  /// NO METER; in the attention ink when it runs hot.
  static func budLabel(_ set: AgentProfileSet, reading: MetersReading, now: Date) -> BudLabel {
    let meters = reading.meters(of: set.id, now: now)
    if let tightest = meters.tightest, let read = tightest.reading {
      let line = read.tightest.line
      return BudLabel(
        name: set.label, state: "\(wholeWords(line.usedPercent))% · \(line.group?.label ?? line.label)".uppercased(),
        hot: tightest.hot)
    }
    let firstRead = reading.usage == .waiting || meters.entries.contains { $0.kind == .firstRead }
    return BudLabel(name: set.label, state: firstRead ? "READING" : "NO METER", hot: false)
  }

  /// The face said to VoiceOver.
  static func faceLabel(_ name: String) -> String {
    "\(name.isEmpty ? "Account" : "\(name): account"). Hold for your agents' usage."
  }

  /// A hold cannot be made under VoiceOver, so the face offers its acts: the page, each profile, and every profile;
  /// with one profile, the page alone.
  static func actions(_ profiles: [AgentProfileSet]) -> [Action] {
    let page = Action(name: "Show your agents' usage", act: .page)
    guard profiles.count > 1 else { return [page] }
    return [page] + profiles.map { Action(name: "Show \($0.label)", act: .show($0.id)) }
      + [Action(name: "Show every profile", act: .showAll)]
  }

  #if DEBUG
    static let mockArgument = "-vf-mock-hold"

    /// `-vf-mock-hold[=hub|<profile>|cancel]`: the face held for a photograph, reaching the hub (bare too), a
    /// profile's bud, or open ground.
    static func mockReach(_ arguments: [String]) -> ProfileLens.Release? {
      guard let argument = arguments.first(where: { $0 == mockArgument || $0.hasPrefix(mockArgument + "=") }) else {
        return nil
      }
      switch argument.dropFirst(mockArgument.count + 1) {
      case "", "hub": return .hub
      case "cancel": return .open
      case let id: return .bud(String(id))
      }
    }
  #endif
}
