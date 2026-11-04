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

    /// The surface mounts with a device: a renderer and an atlas, and no failure.
    @Test func theSurfaceMountsWithADevice() {
      let view = RainMetalView(field: RainField(dice: .seeded(Mulberry32(seed: 1))))
      #expect(view.device != nil)
      #expect(view.failure == nil, "\(view.failure ?? "")")
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
      #expect(ids == rows.map { $0.id })
      let labels = elements.map { $0.accessibilityLabel ?? "" }
      let spoken = rows.map { RainAgent(row: $0, activeId: "pty-h3").spoken }
      #expect(labels == spoken)
      let values = elements.map { $0.accessibilityValue ?? "-" }
      #expect(values == rows.map { $0.id == "pty-h3" ? "open" : "-" })
      let first = try #require(elements.first)
      let column = try #require(view.field.columns(of: first.id).first)
      #expect(first.accessibilityFrameInContainerSpace.minX == Double(column) * 12)
      view.apply(rows: [], activeId: nil, isActive: false, moving: false)
      let none = (view.accessibilityElements as? [RainRowElement]) ?? []
      #expect(none.isEmpty)
    }
  }
}
