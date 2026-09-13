import FieldAgents
import Metal
import MetalKit
import QuartzCore
import UIKit

/// What a frame draws: the bodies, the hold indicator and any bare marks, for
/// a surface `width × height` points wide at `time`. The field supplies its
/// stage's; a lab cell supplies its fixture's.
public typealias SwarmFrameSource = @MainActor (_ time: Double, _ motion: Bool, _ size: CGSize) -> (
  bodies: [RenderBody], hold: SwarmHold?, marks: [RenderMark]
)

/// The one Metal surface the swarm paints on: transparent over the SwiftUI
/// ground, premultiplied, drawn at the display's rate while it is on screen.
/// It owns no meaning — a frame source hands it bodies, the theme and the
/// motion flag are set by whoever mounts it.
@MainActor
public final class SwarmMetalView: MTKView {
  public var theme: SwarmTheme
  public var motion = true
  public var parameters = SwarmParametersSnapshot()
  public var frameSource: SwarmFrameSource?
  /// Called before every frame with the time, so a stage can pump its physics.
  public var onTick: ((Double) -> Void)?
  public private(set) var renderer: SwarmRenderer?
  /// Why nothing is painting, when nothing is.
  public private(set) var failure: String?
  private let started = CACurrentMediaTime()

  public struct SwarmParametersSnapshot: Sendable {
    public var fillOpacity = 0.72
    public var glow = SwarmGlow(reach: 34, strength: 0.8, breath: 0)
    public init() {}
  }

  public init(theme: SwarmTheme) {
    self.theme = theme
    let device = MTLCreateSystemDefaultDevice()
    super.init(frame: .zero, device: device)
    colorPixelFormat = SwarmGPU.pixelFormat
    framebufferOnly = true
    isOpaque = false
    backgroundColor = .clear
    layer.isOpaque = false
    clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    preferredFramesPerSecond = UIScreen.main.maximumFramesPerSecond
    enableSetNeedsDisplay = false
    isUserInteractionEnabled = false
    delegate = self
    if let device {
      do {
        renderer = try SwarmRenderer(gpu: try SwarmGPU.shared(scale: UIScreen.main.scale))
      } catch {
        failure = "\(error)"
      }
    } else {
      failure = SwarmGPUError.noDevice.description
    }
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    renderer?.resize(width: bounds.width, height: bounds.height, scale: contentScaleFactor)
  }
}

extension SwarmMetalView: MTKViewDelegate {
  public func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
    renderer?.resize(width: bounds.width, height: bounds.height, scale: contentScaleFactor)
  }

  public func draw(in view: MTKView) {
    guard let renderer, let source = frameSource, bounds.width > 0, bounds.height > 0 else { return }
    let time = CACurrentMediaTime()
    onTick?(time)
    let content = source(time - started, motion, bounds.size)
    guard let pass = currentRenderPassDescriptor, let drawable = currentDrawable else { return }
    renderer.render(
      SwarmFrame(
        time: time - started, motion: motion, fillOpacity: parameters.fillOpacity, gridPitch: gridPitch,
        glow: parameters.glow, theme: theme, bodies: content.bodies, hold: content.hold, marks: content.marks),
      pass: pass, drawable: drawable)
  }
}

/// One body's accessibility element: the hidden button of the reference's
/// list, on a surface that has no elements of its own. Activating it is the
/// tap; VoiceOver focus draws the focus ring.
@MainActor
final class SwarmBodyElement: UIAccessibilityElement {
  let bodyID: String
  var onActivate: (() -> Void)?
  var onFocus: ((Bool) -> Void)?

  init(container: Any, bodyID: String) {
    self.bodyID = bodyID
    super.init(accessibilityContainer: container)
    accessibilityTraits = .button
  }

  override func accessibilityActivate() -> Bool {
    onActivate?()
    return true
  }

  override func accessibilityElementDidBecomeFocused() {
    onFocus?(true)
  }

  override func accessibilityElementDidLoseFocus() {
    onFocus?(false)
  }
}
