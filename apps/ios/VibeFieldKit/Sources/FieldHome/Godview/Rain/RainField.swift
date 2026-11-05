import FieldDesign
import FieldProduct
import Foundation

// PG-8 — THE RAIN'S FIELD: the reference model the surface draws from, as puppeteer-views 0.3.3's `RainView` keeps
// its refs (dist `views/rain/RainView.js`): the rows and their order (`agentsRef`, `orderRef`), the frame (`dropsRef`,
// `geometryRef`, the recede weights), the dice, and the loop. Every change of the rows reconciles (the agents effect,
// :79-83), as does every change of the stage's size (the resize observer, :100-101); the loop's draw plans a moving
// frame, and a stopped loop paints one still per change (:220-238). The 30 fps fall never passes through SwiftUI:
// the surface steps it. Host-buildable; the surface (`RainSurface.swift`) is the kit's.

/// The rain's dice as the field holds them: the system's for the live rain, or mulberry32 from the DEBUG seed flag
/// (fd's Q7), one concrete type so the field needs no existential.
enum RainDice: RainRandom {
  case system(SystemRainRandom)
  case seeded(Mulberry32)

  /// The live dice, or the seeded ones a DEBUG launch names (`Mulberry32.launch`, read by the caller's DEBUG code).
  static func rolled(seeded: Mulberry32?) -> RainDice {
    seeded.map(RainDice.seeded) ?? .system(SystemRainRandom())
  }

  mutating func next() -> Double {
    switch self {
    case .system(var dice):
      let roll = dice.next()
      self = .system(dice)
      return roll
    case .seeded(var dice):
      let roll = dice.next()
      self = .seeded(dice)
      return roll
    }
  }
}

@MainActor
final class RainField {
  /// The empty stage's words (RainView.js:261; fd's Q8): the desktop's title verbatim, and its line in the phone's
  /// words, as the list and spend say it. A NAMED DEVIATION (the words rule: on the phone no word names a key, hover
  /// or a pane): the desktop says "Launch an agent from a terminal pane.". Draft word: James's eye (VF-PM 2026-11-04).
  static let emptyTitle = "NO ACTIVE AGENTS"
  static let emptyLine = "Launch an agent from a terminal."

  /// The phone keeps the desktop's defaults: it has no parameter panel.
  let parameters = RainParameters.defaults
  let palette = RainPalette.rain
  private(set) var frame = RainFrame()
  private(set) var agents: [RainAgent] = []
  private(set) var rows: [RemoteFieldRow] = []
  private(set) var size = (width: 0.0, height: 0.0)
  private var dice: RainDice
  private var motion: RainMotion?

  init(dice: RainDice) {
    self.dice = dice
  }

  /// No row, no stream: the stage shows its empty words (H12).
  var isEmpty: Bool { agents.isEmpty }

  /// The loop runs (`loop.running`): a display frame steps it. Stopped, a change paints one still.
  var running: Bool { motion != nil }

  /// The agents effect (:79-83): the window's drawn rows, the open card's row lit (J-S4), then a reconcile.
  func show(rows: [RemoteFieldRow], activeId: String?) {
    self.rows = rows
    agents = rows.map { RainAgent(row: $0, activeId: activeId) }
    sync()
  }

  /// The resize observer (:100-101): the stage's size in points, then a reconcile.
  func resize(width: Double, height: Double) {
    guard size.width != width || size.height != height else { return }
    size = (width, height)
    sync()
  }

  /// The loop started or stopped (`createMotionLoop`'s `reconcile`): a start reads the clock (ms), so the first
  /// delta counts from it and a pause never arrives as one giant step.
  func run(_ wanted: Bool, now: Double) {
    if wanted {
      if motion == nil { motion = RainMotion(now: now, fps: parameters.refreshRate) }
    } else {
      motion = nil
    }
  }

  /// One display frame at `time` (ms): the moving frame's ops when the cap lets it draw, else nil (no draw, the last
  /// frame stands). A stopped loop draws nothing here.
  func tick(_ time: Double) -> [RainOp]? {
    guard var motion, let elapsed = motion.tick(time) else { return nil }
    self.motion = motion
    return frame.plan(
      agents: agents, parameters: parameters, palette: palette, hovered: RainTouchPeek.hovered, elapsed: elapsed,
      random: &dice)
  }

  /// The field where it stands (`stillRef`): no drop falls, no glyph scrambles, nothing rolled.
  func still() -> [RainOp] {
    frame.plan(
      agents: agents, parameters: parameters, palette: palette, hovered: RainTouchPeek.hovered, elapsed: nil,
      random: &dice)
  }

  /// A tap at `x` points (`agentAt` then the click, :241-249, :276-279): the row whose stream runs under it.
  func row(atX x: Double) -> RemoteFieldRow? {
    guard let agent = frame.agent(atX: x, among: agents) else { return nil }
    return rows.first { $0.id == agent.id }
  }

  /// The columns a row's streams run in, in draw order: where its accessibility element stands.
  func columns(of id: String) -> [Int] {
    frame.drops.entries.filter { $0.drop.agentId == id }.map(\.column)
  }

  /// `sync` bails while the canvas has no container (:63-65): the phone's, until the stage is laid out, so no drop is
  /// rolled for a 0 × 0 stage.
  private func sync() {
    guard size.width > 0, size.height > 0 else { return }
    frame.sync(
      width: size.width, height: size.height, fontSize: parameters.fontSize, order: agents.map(\.id),
      random: &dice)
  }
}

/// OPEN (H3), rain's touch tooltip, proposed in light/read-pg8.md §8; not built. The slot where the card would stand
/// and the column's `hovered` id, always nil: the desktop's hover lights a column and shows a card, and the phone's
/// touch form is James's to pick. A tap opens the card, as the desktop's click selects.
enum RainTouchPeek {
  static let hovered: String? = nil
}
