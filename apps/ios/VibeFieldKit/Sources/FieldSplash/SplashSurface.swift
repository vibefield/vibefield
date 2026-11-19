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
  var tear: Int?
}

/// The desktop's TEAR curve and revealValues uniforms, timed for a phone launch.
/// Start on the first drawable, with the noise clock starting at the first nonzero front.
struct SplashTear {
  static let duration = 0.7
  /// Allow a quarter-second for drawable delivery before falling back to the short fade.
  static let completionLimit: Duration = .seconds(duration) + .milliseconds(250)
  let move: Int
  let began: CFTimeInterval
  private var noiseBegan: CFTimeInterval?
  var sentFinalFrame = false

  init(move: Int, began: CFTimeInterval) {
    self.move = move
    self.began = began
  }

  mutating func uniforms(at time: CFTimeInterval) -> SIMD4<Float> {
    let progress = max(0, min(1, (time - began) / Self.duration))
    if progress > 0, noiseBegan == nil { noiseBegan = time }
    let mark = min(1, progress / 0.24)
    return SIMD4(Float(progress * progress), Float(max(0, time - (noiseBegan ?? time))),
                 Float(1 - mark * mark * (3 - 2 * mark)), 0.5)
  }

  static func ink(light: Bool) -> SIMD4<Float> {
    light ? SIMD4(1, 0.955, 0.87, 0.3) : SIMD4(220.0 / 255, 230.0 / 255, 1, 0.3)
  }
}

/// The surface the splash draws on: a `CAMetalLayer`, drawn on a thread of its own by the
/// splash's Metal runtime (`Splash/SplashRuntime.swift`, vendored) at 60 frames a second — the
/// look's own rate, as the web splash caps itself, so a ProMotion panel shows every other
/// refresh. The main thread only sizes it, and the work the app does there at launch never stops it.
///
/// Over it stands the launch screen until the field is up: the field's ground and the app's
/// `SplashMark` — the still Info.plist's UILaunchScreen shows, drawn by this runtime from its first
/// frame (apps/ios/scripts/splash-stills.mjs) — on exactly the pixels the live mark takes, so the
/// field comes up around a mark that never moves. Core Animation fades the still once the GPU
/// finishes the first frame. The Metal layer then composites the field directly over the home.
@MainActor
final class SplashSurfaceView: UIView {
  private let metalLayer = CAMetalLayer()
  private let groundLayer = CALayer()
  private let stillLayer = CALayer()
  private var request: SplashRequest
  private var loop: SplashLoop?
  private var generation = 0
  private let fadeIn: Double
  private let onTearFinished: @MainActor @Sendable (Int) -> Void
  private let onFirstFrame: @MainActor @Sendable (CFTimeInterval) -> Void
  private let onFailure: @MainActor @Sendable (String) -> Void

  init(
    look: SplashLook, motion: Bool, active: Bool, fadeIn: Double,
    onTearFinished: @escaping @MainActor @Sendable (Int) -> Void,
    onFirstFrame: @escaping @MainActor @Sendable (CFTimeInterval) -> Void,
    onFailure: @escaping @MainActor @Sendable (String) -> Void
  ) {
    request = SplashRequest(look: look, motion: motion, active: active)
    self.fadeIn = fadeIn
    self.onTearFinished = onTearFinished
    self.onFirstFrame = onFirstFrame
    self.onFailure = onFailure
    super.init(frame: .zero)
    isOpaque = false
    isUserInteractionEnabled = false
    backgroundColor = .clear
    metalLayer.device = MTLCreateSystemDefaultDevice()
    metalLayer.pixelFormat = .bgra8Unorm
    // the look's colours are sRGB, as the web canvas it was tuned on is: matched to the panel, never
    // sent to a P3 display as they are (a CAMetalLayer with no colour space is not colour-matched)
    metalLayer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    metalLayer.framebufferOnly = true
    metalLayer.isOpaque = false
    layer.addSublayer(metalLayer)
    groundLayer.addSublayer(stillLayer)
    layer.addSublayer(groundLayer)
    dress(look)
  }

  /// The launch screen's two layers in the look's appearance: its ground, and the still of the mark
  /// (absent in a host without the app's asset, a test's).
  private func dress(_ look: SplashLook) {
    let ground: UIColor = look.light ? .white : .black
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

  func update(look: SplashLook, motion: Bool, active: Bool, tear: Int?) {
    guard look.hash != request.look.hash || motion != request.motion || active != request.active || tear != request.tear else { return }
    if look.hash != request.look.hash { dress(look) }
    request.look = look
    request.motion = motion
    request.active = active
    request.tear = tear
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
      let generation = self.generation
      let loop = SplashLoop(
        layer: metalLayer, request: request, onTearFinished: { [weak self] move in
          guard let self, self.generation == generation else { return }
          self.onTearFinished(move)
        },
        onFirstFrame: { [weak self] at in
          guard let self, self.generation == generation else { return }
          self.fadeStill(at: at)
          self.onFirstFrame(at)
        }, onFailure: { [weak self] why in
          guard let self, self.generation == generation else { return }
          self.onFailure(why)
        })
      self.loop = loop
      loop.start()
    } else {
      stop()
    }
  }

  /// Schedule the still before mounting the home. Its layer belongs to a UIKit view, so the
  /// transaction and any layout it triggers must run on the main thread.
  private func fadeStill(at shown: CFTimeInterval) {
    guard groundLayer.opacity != 0 else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.duration = fadeIn
    fade.beginTime = max(shown, CACurrentMediaTime())
    fade.fillMode = .backwards
    fade.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 0.1, 0.25, 1)
    groundLayer.add(fade, forKey: "splash-still")
    groundLayer.opacity = 0
    CATransaction.commit()
  }

  /// Stops the thread, and the renderer goes with it (its targets are most of the splash's memory).
  func stop() {
    generation += 1
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
  private let request: OSAllocatedUnfairLock<SplashRequest>
  /// The thread's run loop once it runs, and whether it was asked to stop (before it ran, too).
  private let control = OSAllocatedUnfairLock<(runLoop: RunLoopRef?, stopped: Bool)>(initialState: (nil, false))
  private let onFirstFrame: @MainActor @Sendable (CFTimeInterval) -> Void
  private let onFailure: @MainActor @Sendable (String) -> Void
  private let onTearFinished: @MainActor @Sendable (Int) -> Void

  // the render thread's own
  private var device: MTLDevice?
  private var library: MTLLibrary?
  private var queue: MTLCommandQueue?
  private var renderer: SplashRenderer?
  private var link: CAMetalDisplayLink?
  private var startedAt: CFTimeInterval?
  private var presented = false
  private var tear: SplashTear?
  /// Under Reduce Motion one frame is drawn, at rest, and the link idles until what it drew changes.
  private var stillDrawn: SplashRequest?
  #if DEBUG
    private var gpuMs: [Double] = []
  #endif

  init(
    layer: CAMetalLayer, request: SplashRequest,
    onTearFinished: @escaping @MainActor @Sendable (Int) -> Void,
    onFirstFrame: @escaping @MainActor @Sendable (CFTimeInterval) -> Void,
    onFailure: @escaping @MainActor @Sendable (String) -> Void
  ) {
    self.layer = layer
    self.request = OSAllocatedUnfairLock(initialState: request)
    self.onTearFinished = onTearFinished
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
      let why = String(describing: error)
      log.error("the splash stopped drawing: \(why, privacy: .public)")
      presented = false
      link.isPaused = true
      let failure = onFailure
      Task { @MainActor in failure(why) }
      return
    }
    let drawable = update.drawable
    // the main thread sizes the layer: draw once its drawable is the runtime's size
    guard let g = renderer.geometry, drawable.texture.width == g.W, drawable.texture.height == g.H,
      let cb = queue.makeCommandBuffer()
    else { return }
    let at = update.targetPresentationTimestamp
    if startedAt == nil { startedAt = at }
    let seconds = r.motion ? at - (startedAt ?? at) : 0
    if tear?.move != r.tear { tear = r.tear.map { SplashTear(move: $0, began: at) } }
    let uniforms = tear?.uniforms(at: at) ?? SIMD4(0, 0, 1, 0)
    renderer.encode(seconds: seconds, pose: r.motion ? r.look.logo.pose : .atRest, reveal: uniforms,
                    revealInk: SplashTear.ink(light: r.look.light), into: drawable.texture, commandBuffer: cb)
    if let move = r.tear, uniforms.x == 1, tear?.sentFinalFrame == false {
      tear?.sentFinalFrame = true
      let finished = onTearFinished
      cb.addCompletedHandler { buffer in
        if buffer.status == .completed { Task { @MainActor in finished(move) } }
      }
    }
    if !presented {
      // the first frame: said once its GPU work is done, with the time it is shown at (a drawable's
      // own presented handler is not in the simulator's SDK)
      presented = true
      let shown = onFirstFrame
      let failure = onFailure
      cb.addCompletedHandler { buffer in
        if buffer.status == .completed {
          Task { @MainActor in shown(at) }
        } else {
          let why = buffer.error?.localizedDescription ?? "first frame failed"
          Task { @MainActor in failure(why) }
        }
      }
    }
    #if DEBUG
      cb.addCompletedHandler { [self] cb in
        let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
        perform { $0.measured(ms) }
      }
    #endif
    cb.present(drawable)
    cb.commit()
    if !r.motion {
      stillDrawn = r
      wake()
    }
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
