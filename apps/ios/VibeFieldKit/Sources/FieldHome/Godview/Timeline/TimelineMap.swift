import FieldAgents
import FieldDesign
import SwiftUI

// PG-6 — THE MAP OF THE DAY'S STRIP AND THE VIEW'S TOOLS, transcribed from puppeteer-views 0.3.3 at the lock's
// `52d09c8e` (the timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`): `TimelineView.tsx`
// (dist `TimelineView.js`) the map's draw :497-532 (Pulse over the day, its lens and knob, the slider's words), the
// scrubber :729-779 and the strip's elements :859; drawn as `timeline.css` lays them out: the strip :47-51, the box
// :54-66, the canvas :72-79, the dims :82-102, the head and its knob :106-135, the tip :137-152, the tools :157-259 and
// SINCE :261-273. The map's paint is `TimelinePaint.pulse`, composited bottom first.
//
// TOUCH (the read's §5, fd's Q12): pressing or dragging on the map puts the head there, snapping to now in its last
// 5 pt, with the tip over the finger; the narrow head's ONE preset button cycles 15M → 1H → 4H → 12H; NOW glides home.
// VoiceOver adjusts the map by 5 minutes (the desktop's ← →). No hover, no keys.
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): the record's sentence under SINCE (:274-314) is not transcribed.

/// The strip: the map box, the tools in the head column, and SINCE under them.
struct TimelineMapStrip: View {
  var body: some View {
    EmptyView()
  }
}
