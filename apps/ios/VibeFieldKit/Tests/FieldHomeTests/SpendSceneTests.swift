import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-7 — THE CANVAS'S SCENE, by hand rows (pair 4b): the paint is by eye (Q2), so no golden holds the scene; each row
// ties the scene's points to the frame's own places, which P7 holds to the shipping view's DOM — the grid to the money
// ticks, the now line to the now chip, the cross to the moment's chip, a head and a dot to `xOf`/`yOf` of what the line
// spent, the start to the tag. Host-buildable; an extension of the one suite.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

extension SpendParityTests {
  /// The witness's open at the golden's stage, laid out with `state`, its scene drawn in fixed inks.
  private static func sceneAt(
    _ agents: [SpendAgent]? = nil, nowMs: Double = SpendWitness.nowMs, box: String = "open",
    _ change: (SpendModel.Frame, inout SpendModel.State) -> Void = { _, _ in }
  ) throws -> (input: SpendModel.Input, state: SpendModel.State, frame: SpendModel.Frame, scene: SpendScene.Scene) {
    let size = SpendDOM.box(try SpendGolden.step(box)["stage"])
    let rows = try agents ?? SpendWitness.open()
    let input = SpendModel.Input(
      agents: rows, nowMs: nowMs, width: size.width, height: size.height, timeZone: try SpendGolden.zone(),
      measure: SpendDOM.averageGlyph)
    var state = SpendModel.State()
    let first = SpendDOM.settled(input, &state)
    change(first, &state)
    let frame = SpendDOM.settled(input, &state)
    let colours = SpendScene.colours(frame.lines, sib: frame.sib, dark: false) { _ in Self.ink }
    return (input, state, frame, SpendScene.scene(input, state, frame, colours: colours))
  }

  private static let ink = SwarmColor(hex: "#4a90d9") ?? .black

  /// S1 — at now: the plot's box is the frame's; the grid is each money tick's line (its label sits 7 pt above it);
  /// the now line is the now chip's x; every line is its window spend in points from `xOf`/`yOf`, a peer's (a total
  /// alone) none; one head a recorded line, at now, on what it spent, with its row's state; nothing pointed, no cross.
  @Test func theSceneAtNowIsTheFramesPlaces() throws {
    let (input, _, frame, scene) = try Self.sceneAt()
    let g = frame.g
    #expect(scene.width == g.width && scene.height == g.height)
    #expect(scene.x0 == g.x0 && scene.x1 == g.x1 && scene.y0 == g.y0 && scene.y1 == g.y1)
    let ticks = frame.yTicks.map { $0.top + 7 }
    #expect(scene.grid == ticks, "the grid is the money ticks")
    #expect(scene.grid.count == 8)
    let nowChip = frame.chips.first?.left
    #expect(scene.nowX == nowChip, "the now line is the now chip's x")
    let ids = scene.lines.map { $0.id }
    #expect(ids == frame.lines.map { $0.id })
    for (line, meter) in zip(scene.lines, frame.lines) {
      let points = SpendSeries.spentPoints(meter, frame.span.ta, frame.span.tb).map {
        SpendScene.Point(x: SpendModel.xOf(g, frame.span, $0.t), y: SpendModel.yOf(g, frame.yMax, $0.v))
      }
      #expect(line.points == points, "\(line.id): its points")
      #expect(line.points.isEmpty == !meter.recorded, "\(line.id): a total alone draws no line")
      let tone = SpendInk.siblingTone(Self.ink, sib: frame.sib[line.id] ?? 0, dark: false)
      #expect(line.colour == tone, "\(line.id): its ink, its sibling's tone")
    }
    let recorded = frame.lines.filter { $0.recorded }
    let headIds = scene.heads.map { $0.id }
    #expect(headIds == recorded.map { $0.id }, "a head for each recorded line")
    for head in scene.heads {
      let meter = try #require(frame.lines.first { $0.id == head.id })
      let spent = SpendSeries.spentAt(meter, frame.span.ta, frame.span.tb) ?? .nan
      #expect(head.x == scene.nowX && head.y == SpendModel.yOf(g, frame.yMax, spent), "\(head.id): its head")
      let row = frame.rows.first { $0.id == head.id }
      #expect(head.key == row?.state.key, "\(head.id): its row's state")
    }
    #expect(scene.hot == nil && scene.fadeX == nil && scene.cross == nil && scene.ghostX == nil && scene.start == nil)
    #expect(scene.waves)
    #expect(input.agents.count > scene.lines.count, "the witness has terminals and unpriced rows the chart omits")
  }

  /// S2 — a held moment: the chart past it fades from the moment chip's x, the cross stands there, held, a dot on each
  /// line already started at what it had spent then; the heads still wave no more (a faded head has no wave). With a
  /// finger moving while the moment is held, the ghost is the finger's moment.
  @Test func aHeldMomentDrawsItsCross() throws {
    let moment = SpendWitness.nowMs - 120_000
    let (_, _, frame, scene) = try Self.sceneAt { _, state in state.held = moment }
    let chip = frame.chips.last
    #expect(chip?.moment == true)
    #expect(scene.fadeX == chip?.left, "the fade starts at the moment's chip")
    let cross = try #require(scene.cross)
    #expect(cross.x == scene.fadeX && cross.held)
    let tCross = try #require(frame.tCross)
    let started = frame.lines.filter { tCross >= $0.bornMs && SpendSeries.spentAt($0, frame.span.ta, tCross) != nil }
    let dotIds = cross.dots.map { $0.id }
    #expect(dotIds == started.map { $0.id })
    for dot in cross.dots {
      let meter = try #require(frame.lines.first { $0.id == dot.id })
      let spent = SpendSeries.spentAt(meter, frame.span.ta, tCross) ?? .nan
      #expect(dot.x == cross.x && dot.y == SpendModel.yOf(frame.g, frame.yMax, spent), "\(dot.id): its dot")
    }
    #expect(!scene.waves)
    #expect(scene.ghostX == nil, "no finger, no ghost")

    let ghosted = try Self.sceneAt { first, state in
      state.held = moment
      let point = SpendDOM.at(first, SpendWitness.nowMs - 300_000, top: true)
      SpendModel.point(first, &state, x: point.x, y: point.y)
    }
    let pointer = try #require(ghosted.state.pointer)
    let ghost = SpendModel.xOf(ghosted.frame.g, ghosted.frame.span, SpendScale.momentIn(pointer.t, ghosted.frame.span))
    #expect(ghosted.scene.ghostX == ghost, "the ghost is the finger's moment")
    #expect(ghosted.scene.cross?.held == true)
  }

  /// S3 — pointed: the line lit is the row lit (`hot`), the tag sits at its head; a line pointed at before its birth
  /// draws its start where the tag says it starts (the tag 8 pt right of it, 30 pt up).
  @Test func aPointedLineAndItsStart() throws {
    let pointed = try Self.sceneAt { first, state in
      let point = SpendDOM.at(first, SpendWitness.nowMs - 200_000, top: false)
      SpendModel.point(first, &state, x: point.x, y: point.y)
    }
    let hot = try #require(pointed.state.hover)
    #expect(pointed.scene.hot == hot)
    #expect(pointed.frame.tag?.id == hot)
    #expect(pointed.scene.start == nil)

    let vectors = try SpendGolden.vectors()
    let lines = try (vectors["seriesRows"]?.arrayValue ?? []).map(SpendGolden.agent)
    let nowMs = vectors["nowMs"]?.doubleValue ?? .nan
    let before = try Self.sceneAt(lines, nowMs: nowMs, box: "lines · before") { _, state in
      state.held = nowMs - 300_000
      state.hover = "l-born-inside"
    }
    let start = try #require(before.scene.start)
    let tag = try #require(before.frame.tag)
    #expect(!tag.trailing && tag.text.hasPrefix("starts "))
    #expect(tag.x == start.x + 8 && tag.y == start.y - 30, "the tag says where it starts")
    let meter = try #require(before.frame.lines.first { $0.id == "l-born-inside" })
    let x = SpendModel.xOf(before.frame.g, before.frame.span, max(meter.bornMs, before.frame.span.ta))
    #expect(start.x == x && start.y == SpendModel.yOf(before.frame.g, before.frame.yMax, 0))
    let tone = SpendInk.siblingTone(Self.ink, sib: before.frame.sib["l-born-inside"] ?? 0, dark: false)
    #expect(start.colour == tone)
  }

  /// S4 — the inks: a project's first agent keeps its colour, the second is a step darker, the third and on a step
  /// lighter, each with the fill its tag sits on; a colour that has not resolved is spend's own grey (`GREY`).
  @Test func eachLinesInksAndTheGreyFallback() throws {
    let (_, _, frame, _) = try Self.sceneAt()
    for dark in [false, true] {
      let colours = SpendScene.colours(frame.lines, sib: frame.sib, dark: dark) { _ in Self.ink }
      #expect(colours.count == frame.lines.count)
      for line in frame.lines {
        let n = frame.sib[line.id] ?? 0
        let colour = colours[line.id]
        #expect(colour?.ink == SpendInk.siblingTone(Self.ink, sib: n, dark: dark), "\(line.id) dark \(dark): ink")
        #expect(colour?.fill == SpendInk.liftedFill(Self.ink, sib: n), "\(line.id): fill")
      }
    }
    #expect(frame.sib.values.contains(1), "the witness has a second sibling")
    let unresolved = SpendScene.colours(frame.lines, sib: frame.sib, dark: false) { _ in nil }
    for line in frame.lines where (frame.sib[line.id] ?? 0) == 0 {
      #expect(unresolved[line.id]?.ink == SpendScene.grey, "\(line.id): grey")
    }
    #expect(SpendScene.grey == SwarmColor(r: 0.5, g: 0.5, b: 0.5, a: 1))
  }

  /// S5 — the wave: the loop repaints only while a head waits on the person (waiting or a reply unseen) and no moment
  /// is read; the witness's open has unseen heads.
  @Test func onlyAWaitingHeadMoves() throws {
    let (_, _, _, scene) = try Self.sceneAt()
    #expect(scene.heads.contains { $0.key == .unseen || $0.key == .blocked })
    #expect(SpendScene.moves(scene))
    let held = try Self.sceneAt { _, state in state.held = SpendWitness.nowMs - 120_000 }
    #expect(!SpendScene.moves(held.scene), "a moment read stills the waves")
    let quiet = try SpendWitness.open().filter { $0.id == "run-h-partial" }
    let working = try Self.sceneAt(quiet)
    #expect(!working.scene.heads.isEmpty && !SpendScene.moves(working.scene), "a working head does not wave")
  }

  /// S6 — the parameters: the phone offers none, so the lines draw at spend's defaults (`DEFAULT_SPEND_PARAMETERS`).
  @Test func theLinesDrawAtSpendsDefaults() throws {
    let defaults = try SpendGolden.vectors()["constants"]?["DEFAULT_SPEND_PARAMETERS"]
    #expect(SpendScene.weight == defaults?["weight"]?.doubleValue)
    #expect(SpendScene.wash == defaults?["wash"]?.doubleValue)
    let (_, _, _, scene) = try Self.sceneAt()
    #expect(scene.weight == SpendScene.weight && scene.wash == SpendScene.wash)
  }
}
