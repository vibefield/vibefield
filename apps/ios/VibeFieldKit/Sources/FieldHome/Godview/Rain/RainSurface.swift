import FieldProduct
import MetalKit
import UIKit

// PG-8 (red) — THE RAIN'S SURFACE, a skeleton: it mounts no renderer and no atlas, says no row, and draws nothing.
// The green is the MTKView the swarm's pattern builds (`FieldSwarm/SwarmMetalView.swift`).

@MainActor
final class RainMetalView: MTKView {
  let field: RainField
  var onOpen: (@MainActor (RemoteFieldRow) -> Void)?
  private(set) var failure: String? = "the skeleton mounts nothing"

  init(field: RainField) {
    self.field = field
    super.init(frame: .zero, device: nil)
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func apply(rows: [RemoteFieldRow], activeId: String?, isActive: Bool, moving: Bool) {}
}

/// One row's accessibility element.
@MainActor
final class RainRowElement: UIAccessibilityElement {
  let id: String

  init(container: Any, id: String) {
    self.id = id
    super.init(accessibilityContainer: container)
  }
}
