import FieldProduct
import Metal
import MetalKit
import QuartzCore
import SwiftUI
import UIKit

// PG-8 — THE RAIN'S SURFACE: the one Metal view the rain paints on, the swarm's proven pattern on this phone
// (`FieldSwarm/SwarmMetalView.swift`, `SwarmField.swift`): an `MTKView` at the display's rate while the field is on
// screen (`isPaused = !isActive`, fd's Q1), its frames stepped by the transcribed cap (`RainMotion`) so the fall keeps
// the desktop's chunky 30. Stopped by Reduce Motion or a still (`input.isStill`), it paints one still per change, as
// the desktop's stopped loop does (RainView.js:231-238). It owns no meaning: `RainField` plans, `RainRenderer` paints.
//
// The stage is opaque black, the rain's ground (`--vf-card-deep`), painted from y 0 to the stage's foot; 4t's
// dissolve masks it under the Stories row (never the rain's own fade). Each row is one accessibility element, in the
// window's order, standing in its first stream's column (the swarm's `SwarmBodyElement` pattern): its label the
// desktop's button line, its value "open" when lit, activation the tap.

@MainActor
final class RainMetalView: MTKView {
  let field: RainField
  var onOpen: (@MainActor (RemoteFieldRow) -> Void)?
  /// Why nothing paints, when nothing does.
  private(set) var failure: String?
  private var renderer: RainRenderer?
  private var atlas: RainAtlas?
  private var meter = RainFrameMeter()

  init(field: RainField) {
    self.field = field
    let device = MTLCreateSystemDefaultDevice()
    super.init(frame: .zero, device: device)
    colorPixelFormat = RainRenderer.pixelFormat
    framebufferOnly = true
    isOpaque = true
    preferredFramesPerSecond = UIScreen.main.maximumFramesPerSecond
    enableSetNeedsDisplay = true
    isPaused = true
    delegate = self
    isAccessibilityElement = false
    accessibilityContainerType = .semanticGroup
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
    guard let device else {
      failure = RainPaintError.noDevice.description
      return
    }
    do {
      renderer = try RainRenderer(device: device)
      atlas = try RainAtlas(device: device, scale: UIScreen.main.scale, fontSize: field.parameters.fontSize)
    } catch {
      failure = "\(error)"
    }
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  /// The rows, the lit one and whether the loop runs: the loop runs only while the field is on screen and neither
  /// Reduce Motion nor a still holds it; stopped, a change paints one still; off screen, nothing draws.
  func apply(rows: [RemoteFieldRow], activeId: String?, isActive: Bool, moving: Bool) {
    field.show(rows: rows, activeId: activeId)
    refreshAccessibility()
    let running = isActive && moving
    field.run(running, now: CACurrentMediaTime() * 1000)
    enableSetNeedsDisplay = !running
    isPaused = !running
    if isActive && !running { setNeedsDisplay() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    field.resize(width: bounds.width, height: bounds.height)
    refreshAccessibility()
    if !field.running { setNeedsDisplay() }
  }

  @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
    guard let row = field.row(atX: recognizer.location(in: self).x) else { return }
    onOpen?(row)
  }

  /// One element per row in the window's order, each in its first stream's column (or the whole stage while it has
  /// none: the desktop's list names every row, placed or not).
  private func refreshAccessibility() {
    let cell = field.frame.geometry.cell
    accessibilityElements = field.agents.map { agent in
      let element = RainRowElement(container: self, id: agent.id)
      element.accessibilityLabel = agent.spoken
      element.accessibilityValue = agent.accessibilityValue
      if let column = field.columns(of: agent.id).first {
        element.accessibilityFrameInContainerSpace = CGRect(
          x: Double(column) * cell, y: 0, width: cell, height: Double(bounds.height))
      } else {
        element.accessibilityFrameInContainerSpace = bounds
      }
      let id = agent.id
      element.onActivate = { [weak self] in
        guard let self, let row = self.field.rows.first(where: { $0.id == id }) else { return }
        self.onOpen?(row)
      }
      return element
    }
  }
}

extension RainMetalView: MTKViewDelegate {
  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    guard let renderer, let atlas, bounds.width > 0, bounds.height > 0 else { return }
    let started = CACurrentMediaTime()
    let ops: [RainOp]
    if field.running {
      guard let planned = field.tick(started * 1000) else { return }
      ops = planned
    } else {
      ops = field.still()
    }
    guard let pass = currentRenderPassDescriptor, let drawable = currentDrawable,
      let commands = renderer.queue.makeCommandBuffer()
    else { return }
    let painted = RainRenderer.instances(ops, atlas: atlas)
    let clear = painted.clear
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].clearColor = MTLClearColor(
      red: Double(clear.x), green: Double(clear.y), blue: Double(clear.z), alpha: Double(clear.w))
    guard let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
    renderer.encode(
      painted.quads, atlas: atlas, viewport: SIMD2(Float(bounds.width), Float(bounds.height)), into: encoder)
    encoder.endEncoding()
    commands.present(drawable)
    commands.commit()
    #if DEBUG
      if let line = meter.record(time: started, encodeMs: (CACurrentMediaTime() - started) * 1000) { print(line) }
    #endif
  }
}

/// One row's accessibility element: the desktop's hidden button, on a surface that has no elements of its own.
@MainActor
final class RainRowElement: UIAccessibilityElement {
  let id: String
  var onActivate: (() -> Void)?

  init(container: Any, id: String) {
    self.id = id
    super.init(accessibilityContainer: container)
    accessibilityTraits = .button
  }

  override func accessibilityActivate() -> Bool {
    onActivate?()
    return true
  }
}

/// How the rain paints over a window of drawn frames (DEBUG, the kit's witness; fd: with and without 4t's mask at the
/// slot, as the swarm's `SwarmFrameMeter`): the rate it reached, the drawn interval and the CPU's encode time.
struct RainFrameMeter {
  static let window: Double = 5
  private var start: Double?
  private var last: Double?
  private var intervals: [Double] = []
  private var encodes: [Double] = []

  /// `[rain] 30 Hz · frame 33.3 / 33.4 / 41.7 ms · encode 0.4 / 0.6 ms (p50 / p95[ / max])`, once a window.
  mutating func record(time: Double, encodeMs: Double) -> String? {
    defer { last = time }
    encodes.append(encodeMs)
    guard let opened = start else {
      start = time
      return nil
    }
    if let last { intervals.append((time - last) * 1000) }
    guard time - opened >= Self.window, !intervals.isEmpty else { return nil }
    func at(_ values: [Double], _ quantile: Double) -> Double {
      let sorted = values.sorted()
      return sorted[Int((Double(sorted.count - 1) * quantile).rounded())]
    }
    let rate = Int((Double(intervals.count) / (time - opened)).rounded())
    let line =
      "[rain] \(rate) Hz · frame \(format(at(intervals, 0.5))) / \(format(at(intervals, 0.95)))"
      + " / \(format(intervals.max() ?? 0)) ms · encode \(format(at(encodes, 0.5))) / \(format(at(encodes, 0.95))) ms"
    start = time
    intervals.removeAll(keepingCapacity: true)
    encodes.removeAll(keepingCapacity: true)
    return line
  }

  private func format(_ ms: Double) -> String { String(format: "%.1f", ms) }
}

/// The surface in SwiftUI.
struct RainSurface: UIViewRepresentable {
  let rows: [RemoteFieldRow]
  let activeId: String?
  let isActive: Bool
  let moving: Bool
  let onOpen: @MainActor (RemoteFieldRow) -> Void

  func makeUIView(context: Context) -> RainMetalView {
    #if DEBUG
      let seeded = Mulberry32.launch(ProcessInfo.processInfo.arguments)
    #else
      let seeded: Mulberry32? = nil
    #endif
    return RainMetalView(field: RainField(dice: .rolled(seeded: seeded)))
  }

  func updateUIView(_ view: RainMetalView, context: Context) {
    view.onOpen = onOpen
    view.apply(rows: rows, activeId: activeId, isActive: isActive, moving: moving)
  }
}
