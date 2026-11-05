import FieldDesign
import FieldProduct
import Foundation
import Testing
import UIKit

@testable import FieldHome

// PG-8 — THE RAIN'S KIT-ONLY ROWS (read-pg8 §7): what only the phone's own frameworks can say — the face resolves by
// name, the surface mounts with a device, and its accessibility elements are the window's rows, in order, saying the
// desktop's button lines. The host cannot build UIKit; these run in the kit on fd's word.

extension RainViewTests {
  @Suite("the surface on the phone")
  @MainActor
  struct Kit {
    /// The canvas's face, by its PostScript name, at the rain's size.
    @Test func courierNewBoldResolves() {
      let font = UIFont(name: RainAtlas.fontName, size: 12)
      #expect(font != nil, "CourierNewPS-BoldMT")
      #expect(font?.fontName == RainAtlas.fontName)
    }

    /// The surface mounts with a device and no failure. Its glyph atlas waits for a window (LP-4: it is drawn at the
    /// scale of the screen that window stands on), so a view in none has no atlas yet.
    @Test func theSurfaceMountsWithADevice() {
      let view = RainMetalView(field: RainField(dice: .seeded(Mulberry32(seed: 1))))
      #expect(view.device != nil)
      #expect(view.failure == nil, "\(view.failure ?? "")")
      #expect(view.atlasScale == 0, "no window, no atlas")
    }

    /// In a window, the atlas is drawn at that window's scale, the drawable follows the same scale and the loop asks
    /// that screen's rate (LP-4). Without this the rain would stay blank: `draw(in:)` paints nothing until an atlas
    /// exists, and only `followWindow` builds one.
    @Test func aWindowGivesTheAtlasItsScaleAndTheLoopItsRate() {
      let view = RainMetalView(field: RainField(dice: .seeded(Mulberry32(seed: 1))))
      let window = Self.hostWindow()
      defer {
        view.removeFromSuperview()
        window.isHidden = true
      }
      view.frame = CGRect(x: 0, y: 0, width: 402, height: 781)
      window.addSubview(view)
      window.layoutIfNeeded()
      view.layoutIfNeeded()
      let screen = RainMetalView.screen(of: window)
      let scale = view.traitCollection.displayScale > 0 ? view.traitCollection.displayScale : screen.scale
      #expect(scale > 0)
      #expect(view.failure == nil, "\(view.failure ?? "")")
      #expect(view.atlasScale == scale, "the atlas is drawn at the window's scale")
      #expect(view.contentScaleFactor == scale)
      #expect(view.preferredFramesPerSecond == screen.maximumFramesPerSecond)
    }

    /// The rate is read again at every frame, so a scene that moves to another screen keeping its window and its
    /// scale (Stage Manager) takes that screen's rate at its next frame: a stale rate is put back to the screen's.
    @Test func aStaleRateIsPutBackToTheScreens() {
      let view = RainMetalView(field: RainField(dice: .seeded(Mulberry32(seed: 1))))
      let window = Self.hostWindow()
      defer {
        view.removeFromSuperview()
        window.isHidden = true
      }
      window.addSubview(view)
      let rate = RainMetalView.screen(of: window).maximumFramesPerSecond
      view.preferredFramesPerSecond = 1
      view.followScreenRate()
      #expect(view.preferredFramesPerSecond == rate)
    }

    /// A window for a surface: the app's scene when the run has one, a detached window otherwise (the package-hosted
    /// kit has no scene; `TerminalSurfaceResizeTests` does the same).
    private static func hostWindow() -> UIWindow {
      if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
        return UIWindow(windowScene: scene)
      }
      return UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 781))
    }

    /// One element per row, in the window's order: the desktop's button line, "open" on the lit row only, each in
    /// its first stream's column; an empty window has none.
    @Test func theElementsAreTheRowsInOrder() throws {
      let steps = try HomeFixture.witnessSteps()
      let rows = try #require(steps.first?.rows)
      let view = RainMetalView(field: RainField(dice: .seeded(Mulberry32(seed: 1))))
      view.frame = CGRect(x: 0, y: 0, width: 402, height: 781)
      view.layoutIfNeeded()
      view.apply(rows: rows, activeId: "pty-h3", isActive: false, moving: false)
      let elements = (view.accessibilityElements as? [RainRowElement]) ?? []
      let ids = elements.map { $0.id }
      let rowIds = rows.map { $0.id }
      #expect(ids == rowIds)
      let labels = elements.map { $0.accessibilityLabel ?? "" }
      let spoken = rows.map { RainAgent(row: $0, activeId: "pty-h3").spoken }
      #expect(labels == spoken)
      let values = elements.map { $0.accessibilityValue ?? "-" }
      let openOnly = rows.map { $0.id == "pty-h3" ? "open" : "-" }
      #expect(values == openOnly)
      let first = try #require(elements.first)
      let column = try #require(view.field.columns(of: first.id).first)
      let left = Double(first.accessibilityFrameInContainerSpace.minX)
      #expect(left == Double(column) * 12, "the element stands in its first stream's column")
      view.apply(rows: [], activeId: nil, isActive: false, moving: false)
      let none = (view.accessibilityElements as? [RainRowElement]) ?? []
      #expect(none.isEmpty)
    }
  }
}
