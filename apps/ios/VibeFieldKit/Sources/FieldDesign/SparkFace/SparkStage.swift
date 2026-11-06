import CoreGraphics
import Foundation
import os

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — A STAGE: the Mac kit's `StageLayer` (`stage.tsx`) on the
// phone. A screen that shows live faces is one stage: a transparent Metal layer over its content and under whatever
// covers it. Each live face says where its box is and its scroll view's visible rect, both in the stage's space.
// - A face whose box meets that rect is on screen, and the rect clips it (row 29, which the shader discards outside).
// - A face with no part in it is dropped from the draw and keeps moving.
// - Every live face steps each frame, as `Engine.render` updates them all.
// - Every face on screen is one draw, nearest the top first.
// - With no face on screen, or the app not active, there is no frame (one clear wipes the last picture).
// The model is here; the Metal layer that draws it is `SparkStageLayer`, and the rows of these suites are
// SparkStageTests.

/// One live face on a stage, in the stage's space (points, y down).
public struct SparkStageFace: Equatable, Sendable {
  public let id: String
  public var seed: UInt32
  public var status: String
  public var size: Double
  public var framed: Bool
  /// The ground behind a framed face, for its cut ring.
  public var cut: SIMD3<Double>
  /// The face's box.
  public var frame: CGRect
  /// Its scroll view's visible rect: the face is cut where it is.
  public var clip: CGRect

  public init(
    id: String, seed: UInt32, status: String, size: Double, framed: Bool, cut: SIMD3<Double>, frame: CGRect,
    clip: CGRect
  ) {
    self.id = id
    self.seed = seed
    self.status = status
    self.size = size
    self.framed = framed
    self.cut = cut
    self.frame = frame
    self.clip = clip
  }

  /// On screen: some part of its box is inside its scroll view's visible rect.
  var onScreen: Bool { frame.intersects(clip) }
}

/// What draws a stage's frames: its Metal layer in the app, a recorder in the tests.
@MainActor
public protocol SparkStageDrawer: AnyObject {
  /// One frame: `faces` faces' rows, nearest the top first, on a view `view` points wide, at `time`.
  func draw(rows: [Float], faces: Int, view: CGSize, time: Double)
  /// Wipe the last frame: no face is on screen now.
  func clear()
}

@MainActor
public final class SparkStage {
  /// The coordinate space a stage's faces report their boxes and clips in.
  public nonisolated static let space = "vf-spark-stage"
  /// The Mac kit's STAGE_MAX: past it a face is a still.
  public nonisolated static let most = 32
  /// The stage's clock: the engine steps at 60 frames a second, and dt is clamped as `Engine.render` clamps it.
  nonisolated static let fps = 60.0

  struct Mover {
    var face: SparkStageFace
    var buddy: SparkBuddy
  }

  public weak var drawer: (any SparkStageDrawer)?
  /// The stage's size in points (`uView`).
  public var view: CGSize = .zero
  /// The app is active: a stage draws only then.
  public var active = true {
    didSet { changed() }
  }
  public var reducedMotion: Bool
  /// Told when `drawing` may have turned, so the layer can start or stop its frames.
  public var onDrawingChange: (@MainActor (Bool) -> Void)?

  private var movers: [String: Mover] = [:]
  private var order: [String] = []
  private var last: Double?
  private var held: Double?
  /// The layer holds a picture of faces.
  private var drew = false

  public init(drawer: any SparkStageDrawer, reducedMotion: Bool = false) {
    self.drawer = drawer
    self.reducedMotion = reducedMotion
  }

  /// A live face is on screen and the app is active.
  public var drawing: Bool { active && movers.values.contains { $0.face.onScreen } }

  /// A face joins the stage, or tells it where it is now. A new status is felt as the stage feels one
  /// (`buddy.rest = status; buddy.feel(status)`).
  public func show(_ face: SparkStageFace) {
    if var mover = movers[face.id] {
      if mover.face.status != face.status {
        mover.buddy.rest = face.status
        mover.buddy.feel(face.status)
      }
      mover.face = face
      movers[face.id] = mover
    } else {
      guard movers.count < Self.most else { return }
      var buddy = Self.buddy(for: face)
      if let held { Self.step(&buddy, to: held) }
      movers[face.id] = Mover(face: face, buddy: buddy)
      order.append(face.id)
    }
    changed()
  }

  /// A face leaves the stage.
  public func hide(_ id: String) {
    guard movers.removeValue(forKey: id) != nil else { return }
    order.removeAll { $0 == id }
    changed()
  }

  /// One frame at `time` seconds of the stage's clock: every live face steps, and those on screen are drawn. While the
  /// clock is held, the held frame is drawn again.
  public func frame(at time: Double) {
    guard active else { return }
    if let held {
      draw(at: held)
      return
    }
    let dt = last.map { min(max(time - $0, 0), 0.05) } ?? 0
    last = time
    for id in order { movers[id]?.buddy.update(t: time, dt: dt) }
    draw(at: time)
  }

  /// The held clock (`-vf-spark-time`): every face, now and any that joins later, is stepped from 0 to `time` at the
  /// stage's 60 frames a second and holds there, so a picture of live faces is the same on every run.
  public func hold(at time: Double) {
    held = time
    for id in order {
      guard let mover = movers[id] else { continue }
      var buddy = Self.buddy(for: mover.face)
      Self.step(&buddy, to: time)
      movers[id]?.buddy = buddy
    }
    if active { draw(at: time) }
  }

  /// At most 60 frames a second, and 30 in Low Power Mode: a face's motion and blink say nothing more at 120.
  public nonisolated static func frameRate(lowPower: Bool) -> Int { lowPower ? 30 : 60 }

  /// The held clock's flag, `-vf-spark-time=<seconds>`, from the launch arguments (DEBUG builds read it).
  public nonisolated static func heldTime(_ arguments: [String]) -> Double? {
    let flag = "-vf-spark-time="
    guard let argument = arguments.last(where: { $0.hasPrefix(flag) }) else { return nil }
    return Double(argument.dropFirst(flag.count))
  }

  // MARK: -

  private func changed() { onDrawingChange?(drawing) }

  nonisolated static func buddy(for face: SparkStageFace) -> SparkBuddy {
    SparkBuddy(
      seed: face.seed, status: face.status, framed: face.framed, cut: face.cut, random: Mulberry32(seed: face.seed))
  }

  /// From 0 to `time` at 60 frames a second, as the rows golden steps a face.
  nonisolated static func step(_ buddy: inout SparkBuddy, to time: Double) {
    var last: Double?
    for frame in 0...Int((time * fps).rounded()) {
      let t = Double(frame) / fps
      buddy.update(t: t, dt: last.map { min(max(t - $0, 0), 0.05) } ?? 0)
      last = t
    }
  }

  private func draw(at time: Double) {
    var shown: [(index: Int, buddy: SparkBuddy)] = []
    for (index, id) in order.enumerated() {
      guard var mover = movers[id], mover.face.onScreen else { continue }
      let face = mover.face
      mover.buddy.place(centreX: face.frame.midX, centreY: face.frame.midY, size: face.size, framed: face.framed)
      mover.buddy.clip = SIMD4<Double>(face.clip.minX, face.clip.minY, face.clip.maxX, face.clip.maxY)
      mover.buddy.cut = face.cut
      movers[id] = mover
      shown.append((index, mover.buddy))
    }
    guard !shown.isEmpty else {
      if drew {
        drawer?.clear()
        drew = false
      }
      return
    }
    // nearest the top first (`list.sort((a, b) => a.y - b.y)`, a stable sort)
    shown.sort { ($0.buddy.y, $0.index) < ($1.buddy.y, $1.index) }
    var rows = [Float](repeating: 0, count: shown.count * SparkBuddy.floats)
    for (slot, entry) in shown.enumerated() {
      entry.buddy.write(into: &rows, at: slot * SparkBuddy.floats, reducedMotion: reducedMotion)
    }
    drawer?.draw(rows: rows, faces: shown.count, view: view, time: time)
    drew = true
  }
}

/// How a face is drawn: the star in Metal, or the flat star where Metal cannot build it.
public enum SparkFaceDrawing: Equatable, Sendable {
  case star
  case flat
}

/// Builds the star's Metal the first time a face asks. Where it cannot, every face is the flat star and the log says
/// so once: never a blank (§2.10).
@MainActor
public final class SparkStarGate {
  private let build: () throws -> Void
  private let say: (String) -> Void
  private var resolved: SparkFaceDrawing?

  public init(build: @escaping () throws -> Void, say: @escaping (String) -> Void) {
    self.build = build
    self.say = say
  }

  public var drawing: SparkFaceDrawing {
    if let resolved { return resolved }
    let drawing: SparkFaceDrawing
    do {
      try build()
      drawing = .star
    } catch {
      say("the spark star cannot be drawn in Metal (\(error)); every spark's face is the flat star")
      drawing = .flat
    }
    resolved = drawing
    return drawing
  }

  private static let log = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "spark-face")

  /// The app's gate: the system's renderer. DEBUG's `-vf-spark-flat` asks for the fallback, to picture it.
  public static let app = SparkStarGate(
    build: {
      #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-vf-spark-flat") {
          throw SparkStarError.unavailable("Metal, by -vf-spark-flat")
        }
      #endif
      _ = try SparkStarRenderer.system.get()
    },
    say: { SparkStarGate.log.error("\($0, privacy: .public)") })
}
