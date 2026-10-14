import Foundation

// PJ-7 (2026-10-14; Q4 (a), SB §2.12, TP §6.3; DESIGN.md §8 "Hold, reach, let
// go", its phone paragraph) — the spawn bloom's state on the phone: what the
// hold opens, what the finger points at, and what letting go chooses. Pure
// over `SpawnBloomGeometry` (the reference, transcribed): ring one is the
// desktops (or one desktop's profiles), ring two the reached desktop's
// profiles, the hub the home. Letting go chooses a desktop and a profile for
// the LAUNCH SHEET, never a terminal (Q4).

/// One profile a desktop offers the bloom: the agents' own folders read
/// "Default" on the phone (Q5).
public struct BloomProfile: Equatable, Sendable, Identifiable {
  public let id: String
  public let label: String
  public let isDefault: Bool
  public let glyph: String?

  public init(id: String, label: String, isDefault: Bool, glyph: String? = nil) {
    self.id = id
    self.label = label
    self.isDefault = isDefault
    self.glyph = glyph
  }
}

/// One desktop the bloom offers: its OS mark, its name, whether it answers,
/// its state line, and its profiles (empty while they are not read: a leaf).
public struct BloomDesktop: Equatable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let platform: String?
  public let asleep: Bool
  /// `2 RUNNING` · `IDLE` · `ASLEEP · 2 H`
  public let sub: String
  public let profiles: [BloomProfile]

  public init(id: String, name: String, platform: String?, asleep: Bool, sub: String, profiles: [BloomProfile]) {
    self.id = id
    self.name = name
    self.platform = platform
    self.asleep = asleep
    self.sub = sub
    self.profiles = profiles
  }

  /// A desktop that opens its own ring: it answers and offers two profiles or more.
  public var blooms: Bool { !asleep && profiles.count >= 2 }
}

/// What letting go chose: a desktop, and the profile when one was reached.
public struct BloomChoice: Equatable, Sendable {
  public let desktop: String
  public let profile: String?
}

/// The feel of a moment (DESIGN.md §8's phone paragraph).
public enum BloomHaptic: Equatable, Sendable {
  /// the bloom opened: a soft impact
  case bloom
  /// the finger reached a new target: a selection tick
  case tick
}

public struct SpawnBloom: Sendable {
  public enum Mode: Equatable, Sendable {
    /// ring one is the desktops
    case desktops
    /// one desktop: ring one is its profiles
    case profiles
  }

  public let P: BloomPoint
  public let mode: Mode
  public let desktops: [BloomDesktop]
  public let home: String
  public private(set) var one: BloomGeometry.ArcLayout
  public private(set) var two: BloomGeometry.ArcLayout?
  /// the open desktop (ring one's index)
  public private(set) var open: Int?
  public private(set) var target: BloomTarget = .hub
  private var openedAt = 0.0
  private let field: BloomSize
  private let chrome: [BloomRect]
  private let measure: BloomMeasure

  /// Whether a hold blooms (SB §2.2): two desktops or more, or one with two
  /// profiles or more; else the hold opens the sheet at once.
  public static func blooms(_ desktops: [BloomDesktop]) -> Bool {
    desktops.count >= 2 || (desktops.first?.blooms ?? false)
  }

  /// The hold completed at `P`: ring one opens (nil when nothing blooms). The
  /// home leads the desktops (it is also the hub).
  public init?(
    at P: BloomPoint, desktops: [BloomDesktop], home: String?, field: BloomSize, chrome: [BloomRect],
    measure: @escaping BloomMeasure
  ) {
    guard Self.blooms(desktops) else { return nil }
    let ordered = desktops.sorted { $0.id == home && $1.id != home }
    self.P = P
    self.desktops = ordered
    self.home = home.flatMap { id in ordered.contains { $0.id == id } ? id : nil } ?? ordered[0].id
    self.field = field
    self.chrome = chrome
    self.measure = measure
    mode = ordered.count >= 2 ? .desktops : .profiles
    let labels: [BloomLabelText]
    let profiles: [Int]
    switch mode {
    case .desktops:
      labels = ordered.map { BloomLabelText(name: $0.name.uppercased(), sub: $0.sub) }
      profiles = ordered.map { $0.blooms ? $0.profiles.count : 0 }
    case .profiles:
      labels = ordered[0].profiles.map { BloomLabelText(name: $0.label.uppercased()) }
      profiles = labels.map { _ in 0 }
    }
    one = BloomRings.one(at: P, labels: labels, profiles: profiles, field: field, chrome: chrome, measure: measure)
  }

  /// The words of ring one's bud `i`.
  public func label(one i: Int) -> BloomLabelText {
    switch mode {
    case .desktops: BloomLabelText(name: desktops[i].name.uppercased(), sub: desktops[i].sub)
    case .profiles: BloomLabelText(name: desktops[0].profiles[i].label.uppercased())
    }
  }

  /// The finger moved: what it points at now, a desktop it reached opening
  /// its profiles. Answers the haptic the move earns, if any.
  public mutating func point(_ p: BloomPoint, now: Double) -> BloomHaptic? {
    var r = BloomTargeting.resolve(state, p, now: now)
    if r.collapse {
      closeTwo()
      r = BloomTargeting.resolve(state, p, now: now)
    }
    var t = r.target
    if mode == .desktops, open == nil, case .ring1(let index, let d?) = t,
      d >= BloomConstants.r1 - BloomConstants.reach, desktops[index].blooms
    {
      openTwo(index, now: now)
      t = BloomTargeting.resolve(state, p, now: now).target
    }
    let moved = !Self.same(t, target)
    target = t
    switch t {
    case .none, .hub: return nil
    default: return moved ? .tick : nil
    }
  }

  /// Letting go: the hub is the home under its default; a desktop its
  /// default; a profile exactly that; a sleeping desktop, open ground — nothing.
  public func release() -> BloomChoice? {
    switch target {
    case .hub:
      return BloomChoice(desktop: home, profile: nil)
    case .none:
      return nil
    case .ring1(let index, _):
      switch mode {
      case .desktops:
        let desktop = desktops[index]
        return desktop.asleep ? nil : BloomChoice(desktop: desktop.id, profile: nil)
      case .profiles:
        return BloomChoice(desktop: desktops[0].id, profile: desktops[0].profiles[index].id)
      }
    case .ring2(let index):
      guard let open else { return nil }
      return BloomChoice(desktop: desktops[open].id, profile: desktops[open].profiles[index].id)
    }
  }

  /// The words: what letting go does, as a verb and a noun, and one line.
  public struct Words: Equatable, Sendable {
    public let verb: String
    public let noun: String
    public let detail: String
    /// the noun leads (`laptop is asleep`)
    public let nounFirst: Bool
    /// letting go opens nothing
    public let cancels: Bool
  }

  public var words: Words {
    switch target {
    case .hub:
      return Words(
        verb: "New agent on ", noun: name(home), detail: "THE HOME · THEN WHERE, MODEL, EFFORT", nounFirst: false,
        cancels: false)
    case .none:
      return Words(verb: "", noun: "Cancel", detail: "LET GO · NOTHING OPENS", nounFirst: false, cancels: true)
    case .ring1(let index, _):
      switch mode {
      case .desktops:
        let desktop = desktops[index]
        if desktop.asleep {
          return Words(
            verb: " is asleep", noun: desktop.name, detail: "NOTHING OPENS · \(desktop.sub)", nounFirst: true,
            cancels: true)
        }
        return Words(
          verb: "New agent on ", noun: desktop.name, detail: "ITS DEFAULT PROFILE · THEN WHERE, MODEL, EFFORT",
          nounFirst: false, cancels: false)
      case .profiles:
        return profileWords(desktops[0], desktops[0].profiles[index])
      }
    case .ring2(let index):
      guard let open else { return Words(verb: "", noun: "Cancel", detail: "", nounFirst: false, cancels: true) }
      return profileWords(desktops[open], desktops[open].profiles[index])
    }
  }

  private func profileWords(_ desktop: BloomDesktop, _ profile: BloomProfile) -> Words {
    Words(
      verb: "New agent as ", noun: profile.label, detail: "ON \(desktop.name.uppercased()) · THEN WHERE, MODEL, EFFORT",
      nounFirst: false, cancels: false)
  }

  private func name(_ id: String) -> String { desktops.first { $0.id == id }?.name ?? "your desktop" }

  // MARK: The rings

  private var state: BloomTargetState {
    BloomTargetState(
      P: P, l1: one.items.map(\.a), l1step: one.step, l2: two?.items.map(\.a) ?? [],
      l2step: two?.step ?? BloomConstants.step2,
      open: open.map { ($0, BloomPoint(x: one.items[$0].x, y: one.items[$0].y), openedAt + BloomConstants.settle) })
  }

  private mutating func openTwo(_ index: Int, now: Double) {
    let desktop = desktops[index]
    two = BloomRings.two(
      at: P, ring: one, open: index, openLabel: label(one: index), names: desktop.profiles.map { $0.label.uppercased() },
      field: field, chrome: chrome, measure: measure)
    open = index
    openedAt = now
  }

  private mutating func closeTwo() {
    two = nil
    open = nil
  }

  private static func same(_ a: BloomTarget, _ b: BloomTarget) -> Bool {
    switch (a, b) {
    case (.hub, .hub), (.none, .none): true
    case (.ring1(let x, _), .ring1(let y, _)): x == y
    case (.ring2(let x), .ring2(let y)): x == y
    default: false
    }
  }
}
