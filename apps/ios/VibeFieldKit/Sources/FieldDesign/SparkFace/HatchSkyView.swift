import Metal
import MetalKit
import SwiftUI
import UIKit
import os

// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — NEW SPARK'S SKY ON SCREEN: hatch.tsx's `Live` (:155)
// on the phone. The Mac draws two canvases, one over the other: the star engine's sky and the face engine's faces.
// Here they are two Metal layers in one view, on one clock:
// - the sky, opaque, at the screen's scale capped at the star engine's 2 (`HatchSkyRenderer`, VF-PM's Q3 ruling);
// - the faces over it, transparent, at the screen's scale, as 12e's stage draws them (`SparkStarRenderer`);
// - the clock is the hatch's (`#draw`, :284): each frame it moves on by the time since the last, clamped to 0.05 s,
//   and both engines draw at it (`HatchSky.Live.frame(at:)`).
// A new seed deals again: the face before leaves, and the next star falls (`deal`, :199).
//
// The rest is said (Q3):
// - at most 60 frames a second, and 30 in Low Power Mode (12e's rule), and only while the app is active;
// - under reduced motion no star falls and the face is born at once with hello, its motions still (the engine's own
//   reduced motion; the ground still drifts and twinkles, as the Mac's does);
// - where Metal cannot build the sky or the star, the flat star stands on the sky's colour: never a blank (§2.10);
// - DEBUG's `-vf-spark-time=<seconds>` holds the clock: each deal is at 0 with Mulberry32 of the face's seed, stepped
//   at 60 frames a second to that time and drawn once, so a still is the same every run.
// Created (f6), the face leaves the sky for its flight: `HatchSkyHero` hands the sheet its place in the window.

/// IOS-12f's f6 — the sky's hero, for its flight: the sheet holds one, and Create takes the face out of the sky.
@MainActor
public final class HatchSkyHero {
  weak var layer: HatchSkyLayer?

  public init() {}

  /// `fly`'s first step: the face leaves the sky, and where it stood goes with it, in the window's space. Nil where the
  /// sky has no face to give: the flat star, or none dealt.
  public func take() -> SparkFlight.Start? { layer?.takeHero() }
}

/// New spark's sky (§8): the night, the star that falls, and the face born where it lands.
public struct HatchSkyView: View {
  let seed: UInt32
  let faceSize: CGFloat
  let hero: HatchSkyHero?
  /// Made once the view appears, never per re-render: it owns two Metal views.
  @State private var holder: HatchSkyHolder?
  @State private var flat = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var phase

  public init(seed: UInt32, faceSize: CGFloat = CGFloat(HatchSky.faceSize), hero: HatchSkyHero? = nil) {
    self.seed = seed
    self.faceSize = faceSize
    self.hero = hero
  }

  public var body: some View {
    ZStack {
      ChromePalette.sparkNight
      if let holder {
        HatchSkyLayerView(layer: holder.layer)
      } else if flat {
        // the flat star, where the sky cannot be drawn: it fades in where it lands
        SparkFaceView(seed: seed, status: "hello", size: faceSize, framed: false)
          .id(seed)
          .transition(.opacity)
      }
    }
    .animation(FieldMotion.plainEase(0.32), value: seed)
    .accessibilityHidden(true)
    .onAppear {
      if holder == nil && !flat {
        holder = HatchSkyHolder.make(faceSize: Double(faceSize))
        flat = holder == nil
      }
      holder?.reducedMotion = reduceMotion
      holder?.active = phase == .active
      holder?.deal(seed)
      hero?.layer = holder?.layer
    }
    .onChange(of: seed) { holder?.deal(seed) }
    .onChange(of: reduceMotion) { holder?.reducedMotion = reduceMotion }
    .onChange(of: phase) { holder?.active = phase == .active }
    .onDisappear { holder?.active = false }
  }
}

/// ES-5c — what the night's page holds to wake it: a touch on the page.
@MainActor
public final class HatchNightHandle {
  weak var layer: HatchSkyLayer?

  public init() {}

  /// A touch: the night is live again, for §6's 20 s.
  public func wake() { layer?.wake() }
}

/// ES-5c (DESIGN.md §2.10, §6 "At rest"; §8 "The phone's Chat", Empty: the night) — the hatch's night alone, at the size
/// of what holds it, with no face dealt. It keeps §6's rest. Where Metal cannot draw it, its ground stands: never a blank.
public struct HatchNightView: View {
  let handle: HatchNightHandle?
  /// Made once the view appears, never per re-render: it owns two Metal views.
  @State private var holder: HatchSkyHolder?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var phase

  public init(handle: HatchNightHandle? = nil) {
    self.handle = handle
  }

  public var body: some View {
    ZStack {
      ChromePalette.sparkNight
      if let holder {
        HatchSkyLayerView(layer: holder.layer)
      }
    }
    .accessibilityHidden(true)
    .onAppear {
      if holder == nil { holder = HatchSkyHolder.make(faceSize: HatchSky.faceSize) }
      holder?.reducedMotion = reduceMotion
      holder?.active = phase == .active
      holder?.layer.standNight()
      handle?.layer = holder?.layer
    }
    .onChange(of: reduceMotion) {
      holder?.reducedMotion = reduceMotion
      holder?.layer.standNight()
    }
    .onChange(of: phase) { holder?.active = phase == .active }
    .onDisappear { holder?.active = false }
  }
}

/// The sky's state and its two layers, made once a sky appears; nil where Metal cannot build the sky or the star.
@MainActor
final class HatchSkyHolder {
  let layer: HatchSkyLayer
  private static let log = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "spark-face")

  private init(layer: HatchSkyLayer) {
    self.layer = layer
  }

  static func make(faceSize: Double) -> HatchSkyHolder? {
    guard SparkStarGate.app.drawing == .star, let stars = try? SparkStarRenderer.system.get() else { return nil }
    do {
      let sky = try HatchSkyRenderer.system.get()
      var held: Double?
      #if DEBUG
        held = SparkStage.heldTime(ProcessInfo.processInfo.arguments)
      #endif
      return HatchSkyHolder(layer: try HatchSkyLayer(sky: sky, stars: stars, faceSize: faceSize, held: held))
    } catch {
      let said = String(describing: error)
      log.error("New spark's sky cannot be drawn in Metal (\(said, privacy: .public)); it is the flat star")
      return nil
    }
  }

  var reducedMotion: Bool {
    get { layer.reducedMotion }
    set { layer.reducedMotion = newValue }
  }

  var active: Bool {
    get { layer.active }
    set { layer.active = newValue }
  }

  func deal(_ seed: UInt32) { layer.deal(seed) }
}

/// The two layers and the clock: the sky's MTKView runs the frames, and draws the faces' layer after itself.
@MainActor
final class HatchSkyLayer: UIView, MTKViewDelegate {
  let skyRenderer: HatchSkyRenderer
  let starRenderer: SparkStarRenderer
  let sky: MTKView
  let faces: MTKView
  let faceSize: Double
  /// The held clock (`-vf-spark-time`), or nil.
  let held: Double?
  private(set) var live = HatchSky.Live()
  private var clock = 0.0
  private var last: CFTimeInterval?
  private var dealt: UInt32?
  private var pending: UInt32?
  private var skyTargets: HatchSkyRenderer.Targets?
  private var skyRows: [any MTLTexture] = []
  private var faceRows: [any MTLTexture] = []
  /// The rows texture each layer's next frame writes: the three are taken in turn.
  private var skyTurn = 0
  private var faceTurn = 0
  /// Three frames in flight at most on each layer: a rows texture is never rewritten while the GPU reads it.
  private let skyFlight = DispatchSemaphore(value: 3)
  private let faceFlight = DispatchSemaphore(value: 3)

  var reducedMotion = false
  var active = true {
    didSet { run() }
  }
  /// ES-5c — this sky is the night alone: no face dealt, and §6's rest (`NightRest`) drives its clock.
  private var night = false
  /// The rate the night's clock runs at, 1 live and 0 still.
  private var rate = 1.0
  private var lastTouch: CFTimeInterval = 0
  /// Drawn once rather than run: the held clock of a still, or reduced motion.
  private var drawsOnce: Bool { night && (held != nil || reducedMotion) }

  init(sky skyRenderer: HatchSkyRenderer, stars: SparkStarRenderer, faceSize: Double, held: Double?) throws {
    self.skyRenderer = skyRenderer
    starRenderer = stars
    self.faceSize = faceSize
    self.held = held
    for _ in 0..<3 {
      skyRows.append(try skyRenderer.rowsTexture(capacity: HatchSky.maxStars))
      faceRows.append(try stars.rowsTexture(capacity: HatchSky.maxFaces))
    }
    sky = MTKView(frame: .zero, device: skyRenderer.device)
    faces = MTKView(frame: .zero, device: stars.device)
    super.init(frame: .zero)
    for view in [sky, faces] {
      view.colorPixelFormat = HatchSkyRenderer.layerFormat
      view.framebufferOnly = true
      view.enableSetNeedsDisplay = false
      view.isPaused = true
      view.isUserInteractionEnabled = false
      view.isAccessibilityElement = false
      view.autoResizeDrawable = true
      addSubview(view)
    }
    sky.isOpaque = true
    faces.isOpaque = false
    faces.layer.isOpaque = false
    faces.backgroundColor = .clear
    faces.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    sky.delegate = self
    faces.delegate = self
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    followPower()
    NotificationCenter.default.addObserver(
      self, selector: #selector(powerChanged), name: .NSProcessInfoPowerStateDidChange, object: nil)
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    sky.frame = bounds
    faces.frame = bounds
    if let pending, bounds.width > 0, bounds.height > 0 {
      self.pending = nil
      deal(pending)
    } else if (held != nil && dealt != nil) || drawsOnce {
      drawBoth()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window else {
      run()
      return
    }
    let scale = traitCollection.displayScale > 0 ? traitCollection.displayScale : window.screen.scale
    // the sky at the star engine's own cap, the faces at the screen's
    sky.contentScaleFactor = min(scale, CGFloat(HatchSky.dprCap))
    faces.contentScaleFactor = scale
    if (held != nil && dealt != nil) || drawsOnce { drawBoth() }
    run()
  }

  /// `deal(seed)`: at the clock's time, or, held, a fresh sky stepped to the held time.
  func deal(_ seed: UInt32) {
    guard seed != dealt else { return }
    guard bounds.width > 0, bounds.height > 0 else {
      pending = seed
      return
    }
    dealt = seed
    if let held {
      live = HatchSky.Live()
      live.deal(seed: seed, draws: .seeded(seed), sky: bounds.size, size: faceSize, reducedMotion: reducedMotion)
      let frames = Int((held * 60).rounded())
      if frames > 0 {
        for frame in 1...frames { live.frame(at: Double(frame) / 60) }
      }
      clock = held
      drawBoth()
      return
    }
    live.deal(seed: seed, draws: .system(), sky: bounds.size, size: faceSize, reducedMotion: reducedMotion)
    run()
  }

  /// ES-5c — the night alone, standing from any moment of its clock (the Mac's night starts at 3.1 s), or the held one.
  /// Standing again wakes it.
  func standNight() {
    if !night {
      night = true
      clock = held ?? 3.1
      rate = reducedMotion ? 0 : 1
    }
    lastTouch = CACurrentMediaTime()
    if drawsOnce { drawBoth() }
    run()
  }

  /// ES-5c — a touch: the night is live again, for §6's 20 s.
  func wake() {
    guard night else { return }
    lastTouch = CACurrentMediaTime()
    run()
  }

  /// The hero leaves the sky for its flight (`HatchSky.Live.takeHero`): its place in the window, its star's radius. Nil
  /// out of a window, or with no hero.
  func takeHero() -> SparkFlight.Start? {
    guard window != nil, let hero = live.takeHero() else { return nil }
    let point = convert(CGPoint(x: hero.x, y: hero.y), to: nil)
    if held != nil { drawBoth() }
    return SparkFlight.Start(x: Double(point.x), y: Double(point.y), R: hero.R)
  }

  /// Runs while the sky is in a window, the app is active and the clock is not held.
  private func run() {
    let moving = dealt != nil || (night && !reducedMotion)
    let running = window != nil && active && held == nil && moving
    if running == !sky.isPaused { return }
    sky.isPaused = !running
    last = nil
  }

  /// Posted on any thread: the rate is set back on the main one.
  @objc nonisolated private func powerChanged() {
    Task { @MainActor in self.followPower() }
  }

  private func followPower() {
    sky.preferredFramesPerSecond = SparkStage.frameRate(lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
  }

  /// Both layers, at the clock's time, the sky first.
  private func drawBoth() {
    sky.draw()
    // the night has no faces: its layer stays clear
    if !night { faces.draw() }
  }

  // MARK: - MTKViewDelegate

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
    if view === sky { skyTargets = nil }
  }

  func draw(in view: MTKView) {
    if view === sky {
      // the hatch's clock: the time since the last frame, clamped to 0.05 s, and both engines step to it
      if held == nil && !sky.isPaused {
        let now = CACurrentMediaTime()
        if let last {
          let step = min(max(now - last, 0), 0.05)
          if night {
            // ES-5c — §6's rest: the clock eases to still, and a still night draws no frame
            let target = NightRest.target(sinceTouch: now - lastTouch, reduced: reducedMotion)
            rate = NightRest.rate(rate, target: target, dt: step)
            clock += step * rate
          } else {
            clock += step
          }
        }
        last = now
        if !night { live.frame(at: clock) }
      }
      drawSky()
      // the faces' layer after the sky's, on the same tick
      if !night && !sky.isPaused { faces.draw() }
      if night && rate == 0 && !sky.isPaused {
        sky.isPaused = true
        last = nil
      }
    } else {
      drawFaces()
    }
  }

  private func drawSky() {
    guard let drawable = sky.currentDrawable else { return }
    let texture = drawable.texture
    if skyTargets == nil || skyTargets?.scene.width != texture.width || skyTargets?.scene.height != texture.height {
      skyTargets = try? skyRenderer.targets(width: texture.width, height: texture.height)
    }
    guard let targets = skyTargets, let buffer = skyRenderer.queue.makeCommandBuffer() else { return }
    let semaphore = skyFlight
    semaphore.wait()
    let rows = skyRows[skyTurn]
    skyTurn = (skyTurn + 1) % skyRows.count
    HatchSkyRenderer.upload(live.starRows, stars: live.used, to: rows)
    do {
      try skyRenderer.encode(
        on: buffer, output: texture, format: HatchSkyRenderer.layerFormat, targets: targets, rows: rows,
        stars: live.used, view: bounds.size, scale: Double(sky.contentScaleFactor), time: clock,
        grain: HatchSky.grain)
    } catch {
      semaphore.signal()
      return
    }
    buffer.addCompletedHandler { _ in semaphore.signal() }
    buffer.present(drawable)
    buffer.commit()
  }

  private func drawFaces() {
    let (rows, count) = live.faceRows(reducedMotion: reducedMotion)
    let semaphore = faceFlight
    semaphore.wait()
    let texture = faceRows[faceTurn]
    faceTurn = (faceTurn + 1) % faceRows.count
    SparkStarRenderer.upload(rows, faces: count, to: texture)
    guard let pass = faces.currentRenderPassDescriptor, let drawable = faces.currentDrawable,
      let buffer = starRenderer.queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else {
      semaphore.signal()
      return
    }
    starRenderer.encode(
      encoder, format: SparkStarRenderer.layerFormat, rows: texture, faces: count, view: bounds.size,
      scale: Double(faces.contentScaleFactor), time: clock)
    encoder.endEncoding()
    buffer.addCompletedHandler { _ in semaphore.signal() }
    buffer.present(drawable)
    buffer.commit()
  }
}

struct HatchSkyLayerView: UIViewRepresentable {
  let layer: HatchSkyLayer

  func makeUIView(context: Context) -> HatchSkyLayer { layer }

  func updateUIView(_ view: HatchSkyLayer, context: Context) {}
}
