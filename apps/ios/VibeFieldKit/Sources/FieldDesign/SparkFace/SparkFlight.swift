import CoreGraphics
import Foundation
import Metal
import MetalKit
import UIKit

// IOS-12f's f6 (PC-D8 A, Q1, Q4; DESIGN.md §2.10 and §8 "The phone's Chat", Created) — THE FLIGHT: hatch.tsx's `fly`
// (:240–269) and its frame (`#draw`, :290–323) on the phone. Created, the face leaves New spark's sky for its row's
// face in Chat's list as the sheet folds:
// - 660 ms, its place on the island curve as hatch.tsx draws it, e = 1 − (1 − u)³, lifted on an arc;
// - its radius running to the row's;
// - past 0.45 of the way, the disc it wears in its row.
// `SparkFlight` is the model, pure, held by SparkFlightTests. `SparkFlightWindow` draws it in a window of its own over
// the sheet, for the flight alone, as hatch.tsx draws it on a canvas over the whole window (VF-PM's Q1 ruling,
// 17:10:10Z). What flies is the face engine's buddy of the hero's seed, `ready` and free, as hatch.tsx's is.

/// One flight: from the hero's place to a row face's box, from `t0` of the flight's own clock.
public struct SparkFlight: Equatable, Sendable {
  /// How long a flight to a row takes, seconds (hatch.tsx's FLY_S, :50).
  public static let duration = 0.66
  /// Past this share of the way, the face puts on its row's disc (hatch.tsx :308).
  public static let disc = 0.45
  /// The face's eyes once it wears the disc (hatch.tsx :314): a row's 48 is in the 1.12 band.
  public static let discFaceScale = 1.12
  /// The lift's ceiling, points, and its share of the distance (hatch.tsx :301–303).
  static let liftMost = 90.0
  static let liftShare = 0.18

  /// Where the face leaves from: its centre and its star's radius, in the window's space (points, y down) for a
  /// flight, in the sky's own for the sky's hero.
  public struct Start: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var R: Double

    public init(x: Double, y: Double, R: Double) {
      self.x = x
      self.y = y
      self.R = R
    }
  }

  /// Where the face is at a moment of its flight.
  public struct Pose: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var R: Double
    /// It wears its row's disc.
    public var framed: Bool
    /// It has landed: the face is the row's now.
    public var landed: Bool

    public init(x: Double, y: Double, R: Double, framed: Bool, landed: Bool) {
      self.x = x
      self.y = y
      self.R = R
      self.framed = framed
      self.landed = landed
    }
  }

  public let from: Start
  public let t0: Double

  public init(from: Start, t0: Double) {
    self.from = from
    self.t0 = t0
  }

  /// The island curve, `cubic-bezier(0.25, 1, 0.3, 1)`, near enough for a flight's position (hatch.tsx's `islandish`).
  public static func islandish(_ u: Double) -> Double { 1 - pow(1 - u, 3) }

  /// The share of the way at `t` of the flight's clock (hatch.tsx :299): 0 before it leaves, 1 once it has landed.
  public func share(at t: Double) -> Double { min(max((t - t0) / Self.duration, 0), 1) }

  /// The flight at `t`, to the row face's `box` as it stands now.
  public func pose(at t: Double, to box: CGRect) -> Pose { pose(u: share(at: t), to: box) }

  /// The flight at share `u` of the way (hatch.tsx :293–316), to the row face's `box` as it stands now. hatch.tsx reads
  /// the box each frame, so a row that moves is still met. The target is the box's centre with the star 6% of the row's
  /// radius below it, the row's radius its box's width / 2 / frameH.
  public func pose(u: Double, to box: CGRect) -> Pose {
    let R1 = Double(box.width) / 2 / SparkBuddy.frameH
    let toX = Double(box.midX)
    let toY = Double(box.midY) + SparkBuddy.frameC.1 * R1
    let e = Self.islandish(u)
    let lift = sin(Double.pi * e) * min(Self.liftMost, hypot(toX - from.x, toY - from.y) * Self.liftShare)
    return Pose(
      x: from.x + (toX - from.x) * e,
      y: from.y + (toY - from.y) * e - lift,
      R: from.R + (R1 - from.R) * e,
      framed: u > Self.disc,
      landed: u >= 1)
  }
}

/// What flies a face from New spark's sky to its row: the flight window in the app, a recorder in the tests.
@MainActor
public protocol SparkFlying: AnyObject {
  /// Flies the face of `seed` from `start` (the window's space) to the box `to` reads each frame, the row's face,
  /// its disc's cut ring on `cut`, and calls `landed` once it has landed. False where nothing can fly: the caller
  /// fades the row's face in instead.
  func fly(
    seed: UInt32, from start: SparkFlight.Start, cut: SIMD3<Double>, to: @escaping @MainActor () -> CGRect?,
    landed: @escaping @MainActor () -> Void
  ) -> Bool
}

/// The window the face flies in (Q1): clear, touch-through, over the app's window and its sheet, and gone once the face
/// lands. It is LockCurtain's pattern, a window of its own on the scene, at a level under the curtain's.
@MainActor
public final class SparkFlightWindow: SparkFlying {
  /// Over the app's window, so over the sheet; under the lock curtain (`.alert + 1`).
  static let level = UIWindow.Level.normal + 1
  let renderer: SparkStarRenderer
  private var window: UIWindow?

  private init(renderer: SparkStarRenderer) {
    self.renderer = renderer
  }

  /// The flight window, or nil where the star cannot be drawn: the gate draws flat, or Metal refuses the renderer.
  public static func make() -> SparkFlightWindow? {
    guard SparkStarGate.app.drawing == .star, let renderer = try? SparkStarRenderer.system.get() else { return nil }
    return SparkFlightWindow(renderer: renderer)
  }

  public func fly(
    seed: UInt32, from start: SparkFlight.Start, cut: SIMD3<Double>, to: @escaping @MainActor () -> CGRect?,
    landed: @escaping @MainActor () -> Void
  ) -> Bool {
    guard window == nil, let scene = Self.scene() else { return false }
    let window = UIWindow(windowScene: scene)
    let layer: SparkFlightLayer
    do {
      layer = try SparkFlightLayer(renderer: renderer, seed: seed, from: start, cut: cut, to: to) { [weak self] in
        self?.land()
        landed()
      }
    } catch {
      return false
    }
    window.windowLevel = Self.level
    window.backgroundColor = .clear
    window.isUserInteractionEnabled = false
    window.accessibilityElementsHidden = true
    let host = UIViewController()
    host.view = layer
    window.rootViewController = host
    window.isHidden = false
    self.window = window
    return true
  }

  /// Landed: the window goes, and the face is the row's.
  private func land() {
    window?.isHidden = true
    window?.rootViewController = nil
    window = nil
  }

  /// The scene the app stands in: the active one, else the first.
  private static func scene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }
}

/// The flight's one face, drawn by 12e's renderer on the flight's own clock: the time since the last frame, clamped to
/// 0.05 s, at 60 frames a second, or 30 in Low Power Mode (12e's rule).
@MainActor
final class SparkFlightLayer: UIView, MTKViewDelegate {
  let renderer: SparkStarRenderer
  let face: MTKView
  let rows: any MTLTexture
  let flight: SparkFlight
  let to: @MainActor () -> CGRect?
  let landed: @MainActor () -> Void
  private var buddy: SparkBuddy
  private var box: CGRect?
  private var clock = 0.0
  private var last: CFTimeInterval?
  private var done = false

  init(
    renderer: SparkStarRenderer, seed: UInt32, from start: SparkFlight.Start, cut: SIMD3<Double>,
    to: @escaping @MainActor () -> CGRect?, landed: @escaping @MainActor () -> Void
  ) throws {
    self.renderer = renderer
    rows = try renderer.rowsTexture(capacity: 1)
    flight = SparkFlight(from: start, t0: 0)
    self.to = to
    self.landed = landed
    // hatch.tsx's: a new buddy of the hero's seed, `ready` and free, where the hero stood, at its size
    var buddy = SparkBuddy(seed: seed, status: "ready", framed: false, cut: cut, random: Mulberry32(seed: seed))
    buddy.place(centreX: start.x, centreY: start.y, size: start.R * 2 * SparkBuddy.frameH, framed: false)
    self.buddy = buddy
    face = MTKView(frame: .zero, device: renderer.device)
    super.init(frame: .zero)
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    face.colorPixelFormat = SparkStarRenderer.layerFormat
    face.framebufferOnly = true
    face.isOpaque = false
    face.layer.isOpaque = false
    face.backgroundColor = .clear
    face.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    face.isUserInteractionEnabled = false
    face.autoResizeDrawable = true
    face.preferredFramesPerSecond = SparkStage.frameRate(lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    face.delegate = self
    addSubview(face)
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    face.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window else { return }
    face.contentScaleFactor = traitCollection.displayScale > 0 ? traitCollection.displayScale : window.screen.scale
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    guard !done else { return }
    let now = CACurrentMediaTime()
    let dt = last.map { min(max(now - $0, 0), 0.05) } ?? 0
    last = now
    clock += dt
    if let next = to() { box = next }
    guard let box else { return }
    let pose = flight.pose(at: clock, to: box)
    buddy.update(t: clock, dt: dt)
    buddy.fly(pose)
    var faceRows = [Float](repeating: 0, count: SparkBuddy.floats)
    buddy.write(into: &faceRows, at: 0, reducedMotion: false)
    SparkStarRenderer.upload(faceRows, faces: 1, to: rows)
    if let pass = view.currentRenderPassDescriptor, let drawable = view.currentDrawable,
      let buffer = renderer.queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    {
      renderer.encode(
        encoder, format: SparkStarRenderer.layerFormat, rows: rows, faces: 1, view: bounds.size,
        scale: Double(view.contentScaleFactor), time: clock)
      encoder.endEncoding()
      buffer.present(drawable)
      buffer.commit()
    }
    if pose.landed {
      done = true
      view.isPaused = true
      landed()
    }
  }
}
