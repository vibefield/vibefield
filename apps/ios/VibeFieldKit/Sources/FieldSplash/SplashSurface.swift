import Metal
import QuartzCore
import UIKit
import os

/// The splash's own Metal library: `Splash/SplashShaders.metal`, compiled with the app into this
/// target's `default.metallib`. A splash cannot wait for a compile at first use (the swarm's
/// D-i14 trade), so all that is left to launch is the pipelines' own compile, which Metal caches.
public enum SplashLibrary {
  public static func make(device: MTLDevice) throws -> MTLLibrary {
    try device.makeDefaultLibrary(bundle: .module)
  }
}

private let log = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "splash")

/// What the main thread asks of the render thread: the surface's size, the look, whether it
/// moves, whether the scene is active.
struct SplashRequest: Sendable {
  var width = 0.0
  var height = 0.0
  var scale = 0.0
  var look: SplashLook
  var motion: Bool
  var active: Bool
  /// How long the launch screen takes to leave the field once it is up.
  var fadeIn: Double = 0.24
}

/// The surface the splash draws on: a `CAMetalLayer`, drawn on a thread of its own by the
/// splash's Metal runtime (`Splash/SplashRuntime.swift`, vendored) at 60 frames a second — the
/// look's own rate, as the web splash caps itself, so a ProMotion panel shows every other
/// refresh. The main thread only sizes it, and the work the app does there at launch never stops it.
///
/// Over it stands the launch screen until the field is up: the field's ground and the app's
/// `SplashMark` — the still Info.plist's UILaunchScreen shows, drawn by this runtime from its first
/// frame (apps/ios/scripts/splash-stills.mjs) — on exactly the pixels the live mark takes, so the
/// field comes up around a mark that never moves. They are layers of this view, and the render
/// thread fades them itself, on the first frame it presents, in a Core Animation transaction of its
/// own: the render server runs it while the home's start holds the main thread. (A SwiftUI animation
/// is stepped on the main thread, and a main-thread one is committed only when the main run loop
/// next waits, which the home's mount, in the same turn or the next, can put off for a second.)
@MainActor
final class SplashSurfaceView: UIView {
  private let metalLayer = CAMetalLayer()
  private let groundLayer = CALayer()
  private let stillLayer = CALayer()
  private var request: SplashRequest
  private var loop: SplashLoop?
  private let onFirstFrame: @MainActor @Sendable (CFTimeInterval) -> Void
  private let onFailure: @MainActor @Sendable (String) -> Void

  init(
    look: SplashLook, motion: Bool, active: Bool, fadeIn: Double,
    onFirstFrame: @escaping @MainActor @Sendable (CFTimeInterval) -> Void,
    onFailure: @escaping @MainActor @Sendable (String) -> Void
  ) {
    request = SplashRequest(look: look, motion: motion, active: active, fadeIn: fadeIn)
    self.onFirstFrame = onFirstFrame
    self.onFailure = onFailure
    super.init(frame: .zero)
    isOpaque = true
    isUserInteractionEnabled = false
    // an empty layer (before its first frame) shows the field's own ground
    backgroundColor = look.light ? .white : .black
    metalLayer.device = MTLCreateSystemDefaultDevice()
    metalLayer.pixelFormat = .bgra8Unorm
    // the look's colours are sRGB, as the web canvas it was tuned on is: matched to the panel, never
    // sent to a P3 display as they are (a CAMetalLayer with no colour space is not colour-matched)
    metalLayer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    metalLayer.framebufferOnly = true
    metalLayer.isOpaque = true
    layer.addSublayer(metalLayer)
    groundLayer.addSublayer(stillLayer)
    layer.addSublayer(groundLayer)
    dress(look)
  }

  /// The launch screen's two layers in the look's appearance: its ground, and the still of the mark
  /// (absent in a host without the app's asset, a test's).
  private func dress(_ look: SplashLook) {
    let ground: UIColor = look.light ? .white : .black
    backgroundColor = ground
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    groundLayer.backgroundColor = ground.cgColor
    let style = UITraitCollection(userInterfaceStyle: look.light ? .light : .dark)
    let still = UIImage(named: "SplashMark", in: .main, compatibleWith: style)
    stillLayer.contents = still?.cgImage
    stillLayer.contentsScale = still?.scale ?? 1
    stillLayer.contentsGravity = .resize
    CATransaction.commit()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func update(look: SplashLook, motion: Bool, active: Bool) {
    guard look.hash != request.look.hash || motion != request.motion || active != request.active else { return }
    if look.hash != request.look.hash { dress(look) }
    request.look = look
    request.motion = motion
    request.active = active
    loop?.ask(request)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let scale = window?.screen.scale ?? traitCollection.displayScale
    // the drawable is the runtime's own size for these points (geometry(): the scale, capped by the
    // field's budget), which the render thread computes alike from the same three numbers
    let size = SplashGeometry(width: bounds.width, height: bounds.height, scale: scale, look: request.look)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    metalLayer.frame = bounds
    metalLayer.contentsScale = scale
    metalLayer.drawableSize = CGSize(width: size.W, height: size.H)
    groundLayer.frame = bounds
    // the live mark's own rect: its texture's place and size in the frame, in points
    stillLayer.frame = CGRect(
      x: Double(size.MX) / size.k, y: Double(size.MY) / size.k, width: Double(size.LW) / size.k,
      height: Double(size.LH) / size.k)
    CATransaction.commit()
    request.width = bounds.width
    request.height = bounds.height
    request.scale = scale
    loop?.ask(request)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      guard loop == nil else { return }
      let loop = SplashLoop(layer: metalLayer, ground: groundLayer, request: request, onFirstFrame: onFirstFrame, onFailure: onFailure)
      self.loop = loop
      loop.start()
    } else {
      stop()
    }
  }

  /// Stops the thread, and the renderer goes with it (its targets are most of the splash's memory).
  func stop() {
    loop?.stop()
    loop = nil
  }
}

/// A thread's run loop, handed to other threads: what they do with it (perform a block, wake it,
/// stop it) CFRunLoop does safely from any thread.
private struct RunLoopRef: @unchecked Sendable {
  let loop: CFRunLoop
}

/// The render thread, used once: it owns the renderer, the display link and the clock. What the
/// main thread asks crosses in one locked value; everything else stays on this thread.
private final class SplashLoop: NSObject, CAMetalDisplayLinkDelegate, @unchecked Sendable {
  private let layer: CAMetalLayer
  /// The launch screen over the field, which this thread fades on its first frame.
  private let ground: CALayer
  private let request: OSAllocatedUnfairLock<SplashRequest>
  /// The thread's run loop once it runs, and whether it was asked to stop (before it ran, too).
  private let control = OSAllocatedUnfairLock<(runLoop: RunLoopRef?, stopped: Bool)>(initialState: (nil, false))
  private let onFirstFrame: @MainActor @Sendable (CFTimeInterval) -> Void
  private let onFailure: @MainActor @Sendable (String) -> Void

  // the render thread's own
  private var device: MTLDevice?
  private var library: MTLLibrary?
  private var queue: MTLCommandQueue?
  private var renderer: SplashRenderer?
  private var link: CAMetalDisplayLink?
  private var startedAt: CFTimeInterval?
  private var presented = false
  private var revealed = false
  /// Under Reduce Motion one frame is drawn, at rest, and the link idles until what it drew changes.
  private var stillDrawn: SplashRequest?
  #if DEBUG
    private var gpuMs: [Double] = []
  #endif

  init(
    layer: CAMetalLayer, ground: CALayer, request: SplashRequest,
    onFirstFrame: @escaping @MainActor @Sendable (CFTimeInterval) -> Void,
    onFailure: @escaping @MainActor @Sendable (String) -> Void
  ) {
    self.layer = layer
    self.ground = ground
    self.request = OSAllocatedUnfairLock(initialState: request)
    self.onFirstFrame = onFirstFrame
    self.onFailure = onFailure
  }

  func start() {
    let thread = Thread { [self] in run() }
    thread.name = "vibefield.splash"
    thread.qualityOfService = .userInteractive
    thread.start()
  }

  func ask(_ r: SplashRequest) {
    request.withLock { $0 = r }
    perform { $0.wake() }
  }

  func stop() {
    control.withLock { $0.stopped = true }
    perform { _ in CFRunLoopStop(CFRunLoopGetCurrent()) }
  }

  /// Runs `body` on the render thread, in its run loop's next turn; nothing before it runs.
  private func perform(_ body: @escaping @Sendable (SplashLoop) -> Void) {
    guard let runLoop = control.withLock({ $0.runLoop })?.loop else { return }
    CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue) { [self] in body(self) }
    CFRunLoopWakeUp(runLoop)
  }

  // ---- on the render thread

  private func run() {
    // from here a stop reaches this run loop; one asked before it is seen just below
    let current = RunLoopRef(loop: CFRunLoopGetCurrent())
    let stopped = control.withLock { state -> Bool in
      state.runLoop = current
      return state.stopped
    }
    defer { control.withLock { $0.runLoop = nil } }
    guard !stopped else { return }
    let begun = CACurrentMediaTime()
    do {
      guard let device = layer.device ?? MTLCreateSystemDefaultDevice() else { throw SplashError.resource("Metal device") }
      self.device = device
      library = try SplashLibrary.make(device: device)
      queue = device.makeCommandQueue()
      _ = try renderer(for: request.withLock { $0.look })
    } catch {
      let why = String(describing: error)
      log.error("the splash could not start: \(why, privacy: .public)")
      let failure = onFailure
      Task { @MainActor in failure(why) }
      return
    }
    let ms = Int(((CACurrentMediaTime() - begun) * 1000).rounded())
    log.info("the splash's pipelines were ready in \(ms) ms")
    #if DEBUG
      print("[splash] pipelines ready in \(ms) ms")
    #endif
    let link = CAMetalDisplayLink(metalLayer: layer)
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    link.delegate = self
    link.add(to: .current, forMode: .default)
    self.link = link
    wake()
    if !control.withLock({ $0.stopped }) { CFRunLoopRun() }
    // stopped: the link, the renderer and its targets go with the thread
    link.invalidate()
    self.link = nil
    renderer = nil
    queue = nil
    library = nil
  }

  /// The renderer for `look`, built when the look changes (an appearance changed under the
  /// splash: rare, and its pipelines compile once, then come from Metal's cache).
  private func renderer(for look: SplashLook) throws -> SplashRenderer {
    if let renderer, renderer.look.hash == look.hash { return renderer }
    guard let device, let library else { throw SplashError.resource("Metal device") }
    let made = try SplashRenderer(device: device, library: library, look: look, pixelFormat: layer.pixelFormat)
    renderer = made
    stillDrawn = nil
    return made
  }

  /// Pauses the link while there is nothing to draw: the scene inactive, or under Reduce Motion
  /// once its one frame is up (until the size or the look changes).
  private func wake() {
    guard let link else { return }
    let r = request.withLock { $0 }
    let still = !r.motion && stillDrawn.map { same($0, r) } == true
    link.isPaused = !r.active || still
  }

  private func same(_ a: SplashRequest, _ b: SplashRequest) -> Bool {
    a.width == b.width && a.height == b.height && a.scale == b.scale && a.look.hash == b.look.hash && a.motion == b.motion
  }

  func metalDisplayLink(_ link: CAMetalDisplayLink, needsUpdate update: CAMetalDisplayLink.Update) {
    let r = request.withLock { $0 }
    guard r.active, r.width > 0, r.height > 0, let queue else { return }
    let renderer: SplashRenderer
    do {
      renderer = try self.renderer(for: r.look)
      try renderer.resize(width: r.width, height: r.height, scale: r.scale)
    } catch {
      log.error("the splash stopped drawing: \(String(describing: error), privacy: .public)")
      link.isPaused = true
      return
    }
    let drawable = update.drawable
    // the main thread sizes the layer: draw once its drawable is the runtime's size
    guard let g = renderer.geometry, drawable.texture.width == g.W, drawable.texture.height == g.H,
      let cb = queue.makeCommandBuffer()
    else { return }
    if startedAt == nil { startedAt = update.targetPresentationTimestamp }
    let seconds = r.motion ? update.targetPresentationTimestamp - (startedAt ?? 0) : 0
    renderer.encode(seconds: seconds, pose: r.motion ? r.look.logo.pose : .atRest, into: drawable.texture, commandBuffer: cb)
    if !presented {
      // the first frame: said once its GPU work is done, with the time it is shown at (a drawable's
      // own presented handler is not in the simulator's SDK)
      presented = true
      let shown = onFirstFrame
      let at = update.targetPresentationTimestamp
      cb.addCompletedHandler { _ in Task { @MainActor in shown(at) } }
    }
    #if DEBUG
      cb.addCompletedHandler { [self] cb in
        let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
        perform { $0.measured(ms) }
      }
    #endif
    cb.present(drawable)
    cb.commit()
    if !revealed {
      revealed = true
      reveal(at: update.targetPresentationTimestamp, over: r.fadeIn)
    }
    if !r.motion {
      stillDrawn = r
      wake()
    }
  }

  /// The launch screen leaves the field from the moment its first frame is shown: a Core Animation
  /// fade on DESIGN.md §6's plain `ease` (CSS's own, cubic-bezier(0.25, 0.1, 0.25, 1)), committed
  /// from this thread, so nothing on the main thread can hold it.
  private func reveal(at shown: CFTimeInterval, over duration: Double) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.duration = duration
    fade.beginTime = max(shown, CACurrentMediaTime())
    fade.fillMode = .backwards
    fade.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 0.1, 0.25, 1)
    ground.add(fade, forKey: "splash-reveal")
    ground.opacity = 0
    CATransaction.commit()
  }

  #if DEBUG
    /// The GPU's time a frame, printed once a second's worth is in (the Debug build only).
    private func measured(_ ms: Double) {
      gpuMs.append(ms)
      guard gpuMs.count >= 60 else { return }
      let sorted = gpuMs.sorted()
      let median = String(format: "%.2f", sorted[sorted.count / 2])
      let p90 = String(format: "%.2f", sorted[sorted.count * 9 / 10])
      print("[splash] GPU a frame: \(median) ms median, \(p90) ms p90, over \(sorted.count) frames")
      gpuMs.removeAll(keepingCapacity: true)
    }
  #endif
}
