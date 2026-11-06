import SwiftUI
import Testing
import UIKit

@testable import FieldDesign

/// IOS-12e (§4's second stills, 2026-11-06, at `68428ef36`) — the stage in a real window. A live face laid out at a
/// known place under the bars must be drawn there. The corner row in SparkStageTests feeds the stage its numbers by
/// hand, so it could not see the §4 red: there the stage's two inputs, the faces' boxes and the layer's corner, came
/// from two geometries that disagreed. This row trusts neither. It reads the box the stage will draw, puts it back in
/// the window through the real layer's UIKit frame (where the pixels go), and holds it to the layout's own arithmetic.
@MainActor
@Suite("a live face is drawn where the window lays it out, under the bars")
struct SparkStageHostTests {
  /// The bars' inset the host adds, as the iPhone 17's top; the window's own (a scene's) adds to it.
  static let top: CGFloat = 62
  /// The content's own space above the face.
  static let above: CGFloat = 100
  static let lead: CGFloat = 20
  static let size: CGFloat = 48

  @Test("under a 62 top inset, a live face 100 below the content's top and 20 in is drawn there, at its size")
  func underTheBars() async throws {
    #expect(SparkStarGate.app.drawing == .star, "the kit's simulator draws the star")
    let host = UIHostingController(rootView: Self.page)
    host.additionalSafeAreaInsets = UIEdgeInsets(top: Self.top, left: 0, bottom: 34, right: 0)
    // a scene's window when the run has one (TerminalSurfaceResizeTests' reason), else a detached one
    let window: UIWindow
    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
      window = UIWindow(windowScene: scene)
    } else {
      window = UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    }
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer {
      window.isHidden = true
      window.rootViewController = nil
    }
    var layer: SparkStageLayer?
    var placed: [(face: SparkStageFace, box: CGRect)] = []
    for _ in 0..<150 {
      window.layoutIfNeeded()
      host.view.layoutIfNeeded()
      layer = Self.layer(in: window)
      placed = layer?.stage?.placements() ?? []
      if !placed.isEmpty { break }
      try await Task.sleep(for: .milliseconds(20))
    }
    // settled: one more turn and layout, so the layer's own layout and the faces' reports are both in
    try await Task.sleep(for: .milliseconds(200))
    window.layoutIfNeeded()
    host.view.layoutIfNeeded()
    placed = layer?.stage?.placements() ?? placed
    let drawn = try #require(layer)
    let face = try #require(placed.first)
    // where the layout puts the face: the content starts under the host's whole top inset
    let inset = host.view.safeAreaInsets.top
    #expect(inset >= Self.top)
    // where the stage draws it: its box in the layer, put back in the window by the layer's own UIKit frame
    let box = drawn.convert(face.box, to: nil)
    #expect(abs(box.minY - (inset + Self.above)) < 0.5, "drawn at \(box.minY), laid out at \(inset + Self.above)")
    #expect(abs(box.minX - Self.lead) < 0.5, "drawn at \(box.minX), laid out at \(Self.lead)")
    #expect(abs(box.width - Self.size) < 0.5 && abs(box.height - Self.size) < 0.5)
  }

  static var page: some View {
    SparkStageHost {
      VStack(alignment: .leading, spacing: 0) {
        Color.clear.frame(height: above)
        SparkFaceView(seed: 4211, status: "thinking", size: size, live: true)
          .padding(.leading, lead)
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  /// The stage's layer, wherever SwiftUI hosts it in the window.
  static func layer(in view: UIView) -> SparkStageLayer? {
    if let layer = view as? SparkStageLayer { return layer }
    for subview in view.subviews {
      if let found = layer(in: subview) { return found }
    }
    return nil
  }
}
