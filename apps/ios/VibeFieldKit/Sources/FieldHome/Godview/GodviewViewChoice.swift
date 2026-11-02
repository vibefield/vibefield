import FieldAgents
import FieldMesh
import FieldProduct
import SwiftUI

// PG-4s — THE GODVIEW VIEW THE FIELD PAGE STANDS ON, and everything a view takes from the home screen. No `#if` in
// this file: every symbol is compiled into Release, and only DEBUG code names the launch flags (the pattern of
// `settingsOpening(argument:)`), so the selector's lander never has to un-gate the enum or the dispatch.

/// The raw values ARE puppeteer-views' manifest ids (`views/swarm/index.js:13`; list, rain, timeline, spend :12), so
/// `-vf-godview-view=list` names a view as the desktop does. The desktop's order is swarm · list · rain · timeline ·
/// spend (`monitor/registry.js` MONITOR_VIEWS); the selector's lander owns an explicit order, and no one displays
/// `allCases` (keep-both merges append in landing order).
enum GodviewViewChoice: String, CaseIterable, Sendable {
  case swarm
  // PG-5…8: one case each, here.

  static let argument = "-vf-godview-view"
  static let nowArgument = "-vf-godview-now"

  /// The first `-vf-godview-view=<id>`: its view, or nil when it is absent or names none (the caller keeps `.swarm`,
  /// the desktop's own fallback, `monitorViewFor`). Matched with its `=`, so a longer flag never parses as this one.
  static func launch(_ arguments: [String]) -> GodviewViewChoice? {
    // PG-4s (red)
    nil
  }

  /// The first `-vf-godview-now=<epoch ms>` (Q-S5 (a)): the frozen clock a still is taken at, or nil (the live
  /// clock). A value that is not a whole number of ms is nil.
  static func frozenNow(_ arguments: [String]) -> Date? {
    // PG-4s (red)
    nil
  }
}

/// Everything a view takes from the home screen, and only from it. HS builds one per render.
@MainActor
struct GodviewStageInput {
  /// The field is on screen and the scene active (HS's `isActive`, computed once).
  var isActive: Bool
  /// The window's drawn rows (`FieldLink.rows`); empty under the mock fleet, where no link stands.
  var rows: [RemoteFieldRow]
  /// The home answers (`FieldLink.fieldIsLive`); a row is greyed by `row.stale || !fieldIsLive`.
  var fieldIsLive: Bool
  /// The rows a view draws unread, by MODEL id: the link's bubbles' own `unread`, so the open card's row on a
  /// desktop that cannot hear this phone is held out exactly as the swarm holds it (S2: a value, never a reader of the
  /// link's unobserved state).
  var unreadIds: Set<String>
  /// The open card's row, by model id (Q-S6 (a)).
  var activeId: String?
  /// The project ledger's deal for a row, the swarm's own colour (agents only).
  var colour: (RemoteFieldRow) -> SwarmColor?
  /// The clock: live, or frozen for a still (Q-S5 (a)).
  var now: () -> Date
  /// The bar's band, the view's bottom inset (`AppBar.band(homeInset:)`; DESIGN.md "Stage insets replace host
  /// padding rules").
  var bandHeight: CGFloat
  /// A row tapped: the card on its body.
  var onOpen: @MainActor (RemoteFieldRow) -> Void

  /// The open card's row: the drawn row whose VISUAL id is the card's subject (`selection.id`), by its model id.
  nonisolated static func activeId(rows: [RemoteFieldRow], cardSubject: String?) -> String? {
    // PG-4s (red)
    nil
  }

  /// The deal the swarm's dress uses (`FieldAssembly.fold`): `projects.seqByKey[MonitorWords.projectName(row)]` →
  /// `SwarmColor.project(seq, tint)`, keyed as the bubble's `project` is (S3); nil for a terminal or an undealt
  /// project.
  nonisolated static func colour(of row: RemoteFieldRow, projects: ProjectLedger, tint: ProjectTint) -> SwarmColor? {
    // PG-4s (red)
    nil
  }

  /// The model ids the swarm draws unread (S2): `Set(bubbles.filter(\.unread).compactMap(\.modelId))`.
  nonisolated static func unreadIds(bubbles: [FieldBubble]) -> Set<String> {
    // PG-4s (red)
    []
  }
}

/// The stage: one view mounted at a time (DESIGN.md "The host mounts one at a time"). The swarm arm is HS's own
/// SwarmField, handed in, because it captures HS's privates (the card, the hold, the bloom). It stands where
/// SwarmField stood, so the scanlines and the vignette stay above every view.
struct GodviewStage<Swarm: View>: View {
  let choice: GodviewViewChoice
  let input: GodviewStageInput
  @ViewBuilder let swarm: () -> Swarm

  var body: some View {
    switch choice {
    case .swarm: swarm()
    // PG-5…8: `case .<view>: framed(<View>View(input: input))`
    }
  }

  /// What a non-swarm view stands in (Q-S7 (a)).
  func framed(_ view: some View) -> some View {
    // PG-4s (red)
    view
  }
}
