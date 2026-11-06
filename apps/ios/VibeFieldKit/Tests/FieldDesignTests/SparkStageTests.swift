import CoreGraphics
import Foundation
import Testing

@testable import FieldDesign

/// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — the phone's spark stage, as the Mac's kit draws one
/// (`stage.tsx`). A screen that shows live faces is one stage: a transparent Metal layer over its content and under
/// whatever covers it. Each live face reports its box and its scroll view's visible rect in the stage's space.
/// - A face whose box meets that rect is on screen, and the rect clips it (row 29, which the shader discards outside).
/// - One with no part in it is dropped from the draw and keeps moving.
/// - Every face on screen is one draw a frame, nearest the top first, as `Engine.render` sorts them.
/// - With no face on screen, or the app not active, there is no frame.
/// The drawer is the Metal layer in the app and a recorder here, so these rows need no GPU.
@MainActor
@Suite("the spark stage draws its live faces as the Mac's kit does")
struct SparkStageTests {
  final class Recorder: SparkStageDrawer {
    struct Draw {
      let rows: [Float]
      let faces: Int
      let view: CGSize
      let time: Double
    }
    var draws: [Draw] = []
    var clears = 0

    func draw(rows: [Float], faces: Int, view: CGSize, time: Double) {
      draws.append(Draw(rows: rows, faces: faces, view: view, time: time))
    }

    func clear() { clears += 1 }
  }

  final class Said {
    var lines: [String] = []
  }

  struct Failure: Error {}

  static let screen = CGRect(x: 0, y: 0, width: 390, height: 640)

  static func face(_ id: String, seed: UInt32 = 7, status: String = "running", y: Double, clip: CGRect = screen)
    -> SparkStageFace
  {
    SparkStageFace(
      id: id, seed: seed, status: status, size: 48, framed: true, cut: SIMD3(1, 1, 1),
      frame: CGRect(x: 16, y: y, width: 48, height: 48), clip: clip)
  }

  static func stage(_ recorder: Recorder, reducedMotion: Bool = false) -> SparkStage {
    let stage = SparkStage(drawer: recorder, reducedMotion: reducedMotion)
    stage.view = screen.size
    return stage
  }

  /// One row (a vec4) of the nth face drawn, out of a frame's rows.
  static func row(_ row: Int, face: Int, of rows: [Float]) -> [Float] {
    let start = face * SparkBuddy.floats + row * 4
    return Array(rows[start..<(start + 4)])
  }

  @Test("every live face on screen is one draw a frame, nearest the top first")
  func oneDraw() throws {
    let recorder = Recorder()
    let stage = Self.stage(recorder)
    stage.show(Self.face("c", y: 300))
    stage.show(Self.face("a", seed: 4211, y: 100))
    stage.show(Self.face("b", seed: 1, y: 200))
    #expect(stage.drawing)
    stage.frame(at: 1.0 / 60)
    stage.frame(at: 2.0 / 60)
    #expect(recorder.draws.count == 2)
    let last = try #require(recorder.draws.last)
    #expect(last.faces == 3)
    #expect(last.rows.count == 3 * SparkBuddy.floats)
    #expect(last.view == Self.screen.size)
    // row 0 is (x, y, R, seedF): the faces in the order Engine.render draws them, by y
    let ys = (0..<3).map { Self.row(0, face: $0, of: last.rows)[1] }
    #expect(ys == ys.sorted())
    #expect(Set((0..<3).map { Self.row(0, face: $0, of: last.rows)[3] }).count == 3)
  }

  @Test("a face partly out of its scroll view is clipped there, and a face wholly out is dropped")
  func clipThenDrop() throws {
    let recorder = Recorder()
    let stage = Self.stage(recorder)
    let list = CGRect(x: 0, y: 120, width: 390, height: 400)
    stage.show(Self.face("in", y: 200, clip: list))
    stage.show(Self.face("edge", y: 100, clip: list))
    stage.frame(at: 1.0 / 60)
    let both = try #require(recorder.draws.last)
    #expect(both.faces == 2)
    // the edge face is first (y 100); its row 29 is the scroll view's rect: left, top, right, bottom
    #expect(Self.row(29, face: 0, of: both.rows) == [0, 120, 390, 520])
    stage.show(Self.face("edge", y: 20, clip: list))
    stage.frame(at: 2.0 / 60)
    #expect(try #require(recorder.draws.last).faces == 1)
  }

  @Test("with no live face on screen the stage draws no frame, after one clear")
  func noneOnScreen() {
    let recorder = Recorder()
    let stage = Self.stage(recorder)
    stage.show(Self.face("a", y: 100))
    stage.frame(at: 1.0 / 60)
    stage.show(Self.face("a", y: 900))
    #expect(!stage.drawing)
    stage.frame(at: 2.0 / 60)
    stage.frame(at: 3.0 / 60)
    #expect(recorder.draws.count == 1)
    #expect(recorder.clears == 1)
    stage.hide("a")
    stage.frame(at: 4.0 / 60)
    #expect(recorder.draws.count == 1 && recorder.clears == 1)
  }

  @Test("while the app is not active the stage draws no frame")
  func inactive() {
    let recorder = Recorder()
    let stage = Self.stage(recorder)
    stage.show(Self.face("a", y: 100))
    stage.active = false
    #expect(!stage.drawing)
    stage.frame(at: 1.0 / 60)
    #expect(recorder.draws.isEmpty)
    stage.active = true
    stage.frame(at: 2.0 / 60)
    #expect(recorder.draws.count == 1)
  }

  @Test("at most 60 frames a second, and 30 in Low Power Mode")
  func frameRate() {
    #expect(SparkStage.frameRate(lowPower: false) == 60)
    #expect(SparkStage.frameRate(lowPower: true) == 30)
  }

  @Test("under reduced motion the stage writes no motion: a working face does not hop")
  func reducedMotion() throws {
    let still = Recorder()
    let moving = Recorder()
    for (recorder, reduced) in [(still, true), (moving, false)] {
      let stage = Self.stage(recorder, reducedMotion: reduced)
      stage.show(Self.face("a", status: "running", y: 100))
      stage.hold(at: 1.7)
    }
    // row 3 is the motion's (x, y, rot, scale): held still, its x, y and rot are 0
    let held = Self.row(3, face: 0, of: try #require(still.draws.last).rows)
    #expect(Array(held.prefix(3)) == [0, 0, 0])
    let hopping = Self.row(3, face: 0, of: try #require(moving.draws.last).rows)
    #expect(Array(hopping.prefix(3)) != [0, 0, 0])
  }

  @Test("a held clock: the same faces at the flag's time are the same bytes, in whatever order they arrive")
  func heldClock() throws {
    let first = Recorder()
    let early = Self.stage(first)
    early.show(Self.face("a", y: 100))
    early.show(Self.face("b", seed: 4211, status: "thinking", y: 200))
    early.hold(at: 1.7)

    let second = Recorder()
    let late = Self.stage(second)
    late.hold(at: 1.7)
    late.show(Self.face("b", seed: 4211, status: "thinking", y: 200))
    late.show(Self.face("a", y: 100))
    late.frame(at: 0.25)

    let held = try #require(first.draws.last)
    #expect(held.time == 1.7)
    #expect(try #require(second.draws.last).rows == held.rows)
    // the clock holds: a later frame draws the same bytes at the same time
    early.frame(at: 5)
    #expect(try #require(first.draws.last).rows == held.rows)
    #expect(try #require(first.draws.last).time == 1.7)
  }

  @Test("the flag is read from the launch arguments, as seconds")
  func heldTimeFlag() {
    #expect(SparkStage.heldTime(["-vf-mock", "-vf-spark-time=1.7"]) == 1.7)
    #expect(SparkStage.heldTime(["-vf-mock"]) == nil)
    #expect(SparkStage.heldTime(["-vf-spark-time=soon"]) == nil)
  }

  @Test("where Metal cannot build the star a face is the flat star, and the log says so once")
  func flatWhereMetalFails() {
    let said = Said()
    let failing = SparkStarGate(build: { throw Failure() }, say: { said.lines.append($0) })
    #expect(failing.drawing == .flat)
    #expect(failing.drawing == .flat)
    #expect(said.lines.count == 1)
    let working = SparkStarGate(build: {}, say: { said.lines.append($0) })
    #expect(working.drawing == .star)
    #expect(said.lines.count == 1)
  }
}
