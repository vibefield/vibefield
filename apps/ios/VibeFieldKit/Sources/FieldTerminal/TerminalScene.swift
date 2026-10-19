import Foundation
import GhostteaCore
import GhostteaTerminal

/// ONE terminal's retained scene on this phone, and the only door a frame enters
/// it by (the second audit's D1 and B2, 2026-10-16; the freeway's §5).
///
/// The frame path used to end in a single observed `Data` slot: the sink
/// published each frame into `TerminalAttachment.frame` and told the client it
/// was applied, and SwiftUI applied whatever the slot held at its next update.
/// A delta published between two updates was overwritten unseen (D1) — and every
/// delta builds on the one before it — while the cell heard "applied" for frames
/// the renderer had not taken yet, or later refused (B2). Here the sink calls
/// `render(_:)`, which applies the frame to the view's retained state AT ONCE,
/// in the order the client hands frames over, and answers with the renderer's
/// own verdict. Drawing still coalesces: the view draws on its own cadence.
///
/// The scene OWNS its view, apart from SwiftUI's lifetime for the surface:
/// frames that arrive before the surface mounts, or while it is away, are
/// applied all the same, and `TerminalSurface` hosts whatever view the scene
/// holds. That is also what lets a session stay live off screen.
@MainActor
public final class TerminalScene {
  /// Why there is no view: Metal would not start on this device. Absent while
  /// the scene is healthy — including before its first view exists.
  public private(set) var failure: String?

  /// The view, once made. `nil` before the first frame or mount asked for one,
  /// after `clear()`, and on a scene that renders through `applying`.
  public private(set) var view: GhostteaTerminalMetalView?

  /// The renderer's line height in points, which a held screen's rows are
  /// counted in (item 42: the live card's readout stands in the rows it leaves
  /// empty). `nil` while there is no view.
  public var lineHeight: CGFloat? {
    view.map { CGFloat($0.terminalTextMetrics.lineHeightPixels) }
  }

  private let makeView: @MainActor () throws -> GhostteaTerminalMetalView
  private let applying: (@MainActor (Data) throws -> Bool)?

  /// The shipping scene: a Metal view, made on first use.
  public init() {
    makeView = { try GhostteaTerminalMetalView(terminalFrame: .zero) }
    applying = nil
  }

  /// The seam the suites hold: frames go to `applying` instead of a renderer,
  /// whose answer (or throw) is the verdict. No view is ever made.
  public init(applying: @escaping @MainActor (Data) throws -> Bool) {
    makeView = { throw TerminalSceneHasNoView() }
    self.applying = applying
  }

  /// The view the surface hosts — made now if there is none. `nil` when Metal
  /// would not start (the reason is `failure`) or on an `applying` scene.
  public func hostedView() -> GhostteaTerminalMetalView? {
    if let view { return view }
    guard applying == nil, failure == nil else { return nil }
    do {
      let made = try makeView()
      view = made
      return made
    } catch {
      failure = "Metal terminal unavailable — \(String(describing: error))"
      return nil
    }
  }

  /// Apply one frame and say whether the retained scene took it. `false` covers
  /// every refusal the renderer can give — a frame it would not decode, a delta
  /// its own lineage check refused, no renderer at all — because each means the
  /// same thing to the cell: this scene does not hold that frame.
  public func render(_ frame: Data) -> Bool {
    if let applying { return (try? applying(frame)) ?? false }
    guard let view = hostedView() else { return false }
    let took = (try? view.apply(frame: frame)) ?? false
    if took, veiled {
      veiled = false
      view.isHidden = false
    }
    return took
  }

  /// A different session is about to be shown here. Its first frame — a new
  /// activation always seeds — replaces the whole retained scene, so the view
  /// stays; until that frame lands, the previous session's picture must not sit
  /// on the glass under the new one's name, so the view is hidden.
  public func clear() {
    veiled = true
    view?.isHidden = true
  }

  private var veiled = false
}

/// An `applying` scene has no view to host.
struct TerminalSceneHasNoView: Error {}
