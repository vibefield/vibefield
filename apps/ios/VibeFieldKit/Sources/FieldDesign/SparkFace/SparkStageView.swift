import Metal
import MetalKit
import SwiftUI
import UIKit

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — A STAGE ON SCREEN: `SparkStageHost` lays one transparent
// Metal layer (`SparkStageLayer`, an MTKView, the rain's pattern) over a screen's content, under whatever covers it.
// It hands its `SparkStage` to the faces inside through the environment, and each live `SparkFaceView` reports where
// it is. The layer runs only while a live face is on screen and the app is active, at most 60 frames a second and
// 30 in Low Power Mode. One clear wipes it when the last face leaves.

extension EnvironmentValues {
  /// The stage a live face joins: nil outside a `SparkStageHost`, or where the star cannot be drawn.
  @Entry public var sparkStage: SparkStage? = nil
  /// The ground behind a framed face, for its cut ring: the first mostly opaque surface under it (§2.10 "The
  /// ground"). On the glass that is the paper under it, so the paper is the default.
  @Entry public var sparkGround: Color = ChromePalette.paper
}

/// The layer a stage draws on: transparent, premultiplied, the screen's scale, drawn on demand.
@MainActor
public final class SparkStageLayer: MTKView, MTKViewDelegate, SparkStageDrawer {
  let renderer: SparkStarRenderer
  private(set) var stage: SparkStage?
  private var textures: [any MTLTexture] = []
  private var next = 0
  /// Three frames in flight at most: a rows texture is never rewritten while the GPU reads it.
  private let inFlight = DispatchSemaphore(value: 3)
  private let start = CACurrentMediaTime()

  init(renderer: SparkStarRenderer) throws {
    self.renderer = renderer
    for _ in 0..<3 { textures.append(try renderer.rowsTexture(capacity: SparkStage.most)) }
    super.init(frame: .zero, device: renderer.device)
    colorPixelFormat = SparkStarRenderer.layerFormat
    framebufferOnly = true
    isOpaque = false
    layer.isOpaque = false
    backgroundColor = .clear
    clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    enableSetNeedsDisplay = false
    isPaused = true
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    delegate = self
    followPower()
    NotificationCenter.default.addObserver(
      self, selector: #selector(powerChanged), name: .NSProcessInfoPowerStateDidChange, object: nil)
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  /// The stage this layer draws: it runs while the stage draws, and one last frame clears it when it stops.
  func attach(_ stage: SparkStage) {
    self.stage = stage
    stage.onDrawingChange = { [weak self] drawing in
      guard let self else { return }
      if drawing {
        isPaused = false
      } else if !isPaused {
        draw()
        isPaused = true
      }
    }
  }

  override public func layoutSubviews() {
    super.layoutSubviews()
    stage?.view = bounds.size
  }

  override public func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window else { return }
    let scale = traitCollection.displayScale > 0 ? traitCollection.displayScale : window.screen.scale
    if scale > 0, contentScaleFactor != scale { contentScaleFactor = scale }
  }

  /// Posted on any thread: the rate is set back on the main one.
  @objc nonisolated private func powerChanged() {
    Task { @MainActor in self.followPower() }
  }

  private func followPower() {
    preferredFramesPerSecond = SparkStage.frameRate(lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
  }

  // MARK: - MTKViewDelegate

  public func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
    stage?.view = bounds.size
  }

  public func draw(in view: MTKView) {
    stage?.frame(at: CACurrentMediaTime() - start)
  }

  // MARK: - SparkStageDrawer

  public func draw(rows: [Float], faces: Int, view: CGSize, time: Double) {
    let texture = textures[next]
    next = (next + 1) % textures.count
    inFlight.wait()
    SparkStarRenderer.upload(rows, faces: faces, to: texture)
    render { encoder in
      renderer.encode(
        encoder, format: SparkStarRenderer.layerFormat, rows: texture, faces: faces, view: view,
        scale: Double(contentScaleFactor), time: time)
    }
  }

  public func clear() {
    inFlight.wait()
    render { _ in }
  }

  /// One pass on the next drawable, cleared to nothing first, as `Engine.render` clears its canvas.
  private func render(_ encode: (any MTLRenderCommandEncoder) -> Void) {
    let semaphore = inFlight
    guard let pass = currentRenderPassDescriptor, let drawable = currentDrawable,
      let buffer = renderer.queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else {
      semaphore.signal()
      return
    }
    encode(encoder)
    encoder.endEncoding()
    buffer.addCompletedHandler { _ in semaphore.signal() }
    buffer.present(drawable)
    buffer.commit()
  }
}

/// A screen that shows live faces: its content, one stage layer over it, and the stage handed to the faces inside.
public struct SparkStageHost<Content: View>: View {
  /// Made once the host appears, never per re-render: it owns a Metal view.
  @State private var holder: SparkStageHolder?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var phase
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    content
      .environment(\.sparkStage, holder?.stage)
      .coordinateSpace(.named(SparkStage.space))
      .overlay {
        if let layer = holder?.layer {
          // the content's whole frame, the safe area it reaches into too: the faces report in that space
          SparkStageLayerView(layer: layer)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
      }
      .onAppear {
        if holder == nil { holder = SparkStageHolder() }
        holder?.stage?.reducedMotion = reduceMotion
        holder?.stage?.active = phase == .active
      }
      .onChange(of: reduceMotion) { holder?.stage?.reducedMotion = reduceMotion }
      .onChange(of: phase) { holder?.stage?.active = phase == .active }
  }
}

/// The stage and its layer, made once a host appears; neither where the star cannot be drawn (every face is then the
/// flat star).
@MainActor
final class SparkStageHolder {
  let layer: SparkStageLayer?
  let stage: SparkStage?

  init() {
    guard SparkStarGate.app.drawing == .star, let renderer = try? SparkStarRenderer.system.get(),
      let layer = try? SparkStageLayer(renderer: renderer)
    else {
      layer = nil
      stage = nil
      return
    }
    let stage = SparkStage(drawer: layer)
    layer.attach(stage)
    #if DEBUG
      // `-vf-spark-time=<seconds>`: every stage held at that time, so a still of live faces is the same every run
      if let held = SparkStage.heldTime(ProcessInfo.processInfo.arguments) { stage.hold(at: held) }
    #endif
    self.layer = layer
    self.stage = stage
  }
}

struct SparkStageLayerView: UIViewRepresentable {
  let layer: SparkStageLayer

  func makeUIView(context: Context) -> SparkStageLayer { layer }

  func updateUIView(_ view: SparkStageLayer, context: Context) {}
}
