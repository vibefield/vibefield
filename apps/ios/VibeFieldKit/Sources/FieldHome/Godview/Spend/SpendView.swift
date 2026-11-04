import FieldAgents
import FieldProduct
import SwiftUI

// PG-7 — THE SPEND VIEW ON THE PHONE'S STAGE (kit-only). RED SKELETON (pair 5): draws nothing.

struct SpendView: View {
  let input: GodviewStageInput

  var body: some View {
    Color.clear
  }

  /// What the view lays out from, read from the stage. RED SKELETON.
  static func modelInput(_ input: GodviewStageInput, size: CGSize) -> SpendModel.Input {
    SpendModel.Input(agents: [], nowMs: 0, width: 0, height: 0, timeZone: .current, measure: { _, _ in 0 })
  }
}
