import FieldAgents
import FieldDesign
import FieldMesh
import FieldProduct
import SwiftUI

// PG-6 — THE TIMELINE ON THE PHONE'S STAGE: puppeteer-views 0.3.3's `TimelineView` (lock `52d09c8e`; the timeline is
// byte-identical to 0.3.2's `95a70aa7`, its last change `5abe8f75`; dist `TimelineView.js:123-888`) as a SwiftUI view.
// Named `GodviewTimelineView`, never `TimelineView`: that is SwiftUI's schedule view, which this one runs on.
struct GodviewTimelineView: View {
  let input: GodviewStageInput

  var body: some View {
    EmptyView()
  }
}
