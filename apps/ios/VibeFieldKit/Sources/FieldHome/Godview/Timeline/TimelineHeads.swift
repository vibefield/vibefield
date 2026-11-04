import FieldAgents
import FieldDesign
import FieldMesh
import FieldProduct
import SwiftUI

// PG-6 — A LANE'S NAME AND ITS BODY AT THE HEAD, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the
// timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`): `TimelineView.tsx` (dist
// `TimelineView.js`) `FolderMark` :90-92, `PeerMark` :94-96, `nameRow` :98-105, `headRow` :107-114 and `NowMark`
// :120-122, drawn as `timeline.css` lays them out: the names :457-573 (the fade into the ground :457-471, a row
// :473-483, two lines :485-490, the name :499-506, the sub line :508-515, the marks :517-531, a terminal :533-536,
// receded :544-547, active :553-557, the band :560-573) and the heads :576-797 (the head line :586-601, a head
// :603-611, the body :613-680, the wave you owe :682-716, the readout :718-757, its inks :767-797). The words are
// TimelineWords'; the colours are the inks' and the skin's; the type is the system face (names-4t) at the desktop's
// sizes and weights.
//
// J-S4 (James, 2026-11-04; fd's Q3): the open card's lane wears the desktop's own active treatment — the name
// underlined and the 4 px band at the lane's edge — in TEXT MAIN where the desktop wears the pane's colour, decided in
// ONE place, `TimelineActive.lights(row:activeId:)`. `laneAlpha` is untouched by it (the desktop's hover, never
// `active`).
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): the ended run's rows (`is-ended`, its own name and device) and the
// recorded readout's two lines (:759-765) are not transcribed. The keyboard's focus ring (:802-815) neither: the phone
// has no keys.

/// J-S4: whether a drawn row's lane wears the active treatment — it is the open card's row.
enum TimelineActive {
  /// The underline under the active lane's name (timeline.css:553-557).
  static let underlineThickness = 1.0
  static let underlineOffset = 3.0
  /// The band at the active lane's edge (timeline.css:559-573, `.is-active`).
  static let bandWidth = 4.0
  static let bandInset = 5.0

  static func lights(row: RemoteFieldRow, activeId: String?) -> Bool {
    false
  }
}

/// `FolderMark`: a project's folder, or a terminal's prompt, 11 pt in a 24 grid.
struct TimelineFolderMark: Shape {
  let terminal: Bool

  func path(in rect: CGRect) -> Path {
    Path()
  }
}

/// `PeerMark`: a desktop's line mark, for a lane on another device.
struct TimelinePeerMark: Shape {
  func path(in rect: CGRect) -> Path {
    Path()
  }
}

/// `NowMark`: the way home, an arrow to the head.
struct TimelineNowMark: Shape {
  func path(in rect: CGRect) -> Path {
    Path()
  }
}

/// `nameRow`: a lane's name floated over its wake's far end.
struct TimelineNameRow: View {
  let lane: TimelineLane
  let h: Double
  let inks: TimelineInks
  let skin: GodviewSkin

  var body: some View {
    EmptyView()
  }
}

/// `headRow`: a lane's body on the head line and its readout beside it.
struct TimelineHeadRow: View {
  let lane: TimelineLane
  let h: Double
  let readout: TimelineReadout
  let inks: TimelineInks
  let skin: GodviewSkin
  let motion: Bool

  var body: some View {
    EmptyView()
  }
}
