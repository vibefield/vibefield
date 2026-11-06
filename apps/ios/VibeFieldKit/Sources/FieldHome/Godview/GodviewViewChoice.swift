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
  case list
  /// PG-8 — the rain (puppeteer-views `views/rain`): a `.flow` picture view, its stage painted whole (`RainView`).
  case rain
  case timeline
  case spend

  /// PG-4t — the defaults key the pick is kept under, per phone and across a sign-out (`SignOutSweep.kept`): the
  /// kit's convention (`vibefield.phone.appearance`). An id the phone has no view for reads as the swarm, the
  /// desktop's own fallback (`monitorViewFor`).
  static let storageKey = "vibefield.godview.view"
  static let argument = "-vf-godview-view"
  static let nowArgument = "-vf-godview-now"
  /// PG-4t — a still: every view draws one frame and runs no loop, no transition and no timer.
  static let stillArgument = "-vf-godview-still"
  /// PG-4t — a still's name: the Stories row says this view's name and holds it, with no deadline.
  static let sayArgument = "-vf-godview-say"
  /// PG-4t — a frame-meter run without the dissolve (DEBUG): the stage draws its view unmasked, so a meter reads a
  /// frame's time with and without it on the same build.
  static let dissolveOffArgument = "-vf-godview-dissolve=off"

  /// PG-4t — the registry's order (PV `monitor/registry.ts:28-34` at `52d09c8e`): the order the Stories row draws
  /// its circles in, whatever order the cases landed in.
  static let registryOrder = ["swarm", "list", "rain", "timeline", "spend"]

  /// PG-4t — the ids given, in the registry's order; an id the registry does not name is dropped.
  static func ordered(_ ids: Set<String>) -> [String] {
    registryOrder.filter { ids.contains($0) }
  }

  /// PG-4t — the views the Stories row draws: every case the phone has, in the registry's order, and nothing else
  /// (VF-PM, 2026-11-04: never a placeholder; one ringed circle while only the swarm exists).
  static var shown: [GodviewViewChoice] {
    ordered(Set(allCases.map { $0.rawValue })).compactMap(GodviewViewChoice.init(rawValue:))
  }

  /// PG-4t (J-S3, drop) — whether the scanlines and the vignette stand over this view: over the swarm only, never
  /// another view (the desktop paints them over every view, `GodviewStage.tsx:178-179`; the phone differs on purpose).
  var wearsAtmosphere: Bool { self == .swarm }

  /// PG-4t — the stage this view takes, as its manifest asks (puppeteer-view-sdk `stageAllocation`): the swarm's
  /// alone is `'full'`, so it runs under the bar's band; every other view's stage ends at the band.
  var allocation: GodviewStageAllocation { self == .swarm ? .full : .flow }

  /// The first `-vf-godview-view=<id>`: its view, or nil when it is absent or names none (the caller keeps `.swarm`,
  /// the desktop's own fallback, `monitorViewFor`). Matched with its `=`, so a longer flag never parses as this one.
  static func launch(_ arguments: [String]) -> GodviewViewChoice? {
    value(of: argument, in: arguments).flatMap(GodviewViewChoice.init(rawValue:))
  }

  /// PG-4t — the first `-vf-godview-say=<id>`: the view whose name a still holds, or nil when it is absent or names
  /// none. Matched with its `=`, as `launch` is.
  static func said(_ arguments: [String]) -> GodviewViewChoice? {
    value(of: sayArgument, in: arguments).flatMap(GodviewViewChoice.init(rawValue:))
  }

  /// PG-4t — whether the stage dissolves under the row: always, unless `-vf-godview-dissolve=off` is given, the
  /// whole argument.
  static func dissolves(_ arguments: [String]) -> Bool {
    !arguments.contains(dissolveOffArgument)
  }

  /// PG-4t — whether `-vf-godview-still` is given: the whole argument, so a longer flag is never this one.
  static func still(_ arguments: [String]) -> Bool {
    arguments.contains(stillArgument)
  }

  /// The first `-vf-godview-now=<epoch ms>` (Q-S5 (a)): the frozen clock a still is taken at, or nil (the live
  /// clock). A value that is not a whole number of ms is nil.
  static func frozenNow(_ arguments: [String]) -> Date? {
    guard let text = value(of: nowArgument, in: arguments), let ms = Int64(text) else { return nil }
    return Date(timeIntervalSince1970: Double(ms) / 1000)
  }

  /// The value of the first `<flag>=…` argument: the flag matched WITH its `=`.
  private static func value(of flag: String, in arguments: [String]) -> String? {
    let prefix = flag + "="
    return arguments.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
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
  /// PG-4t — the Stories row's reserve, the stage's TOP inset, from the screen's top (the stage is full-bleed, so
  /// stage space is screen space; `GodviewStories.reserve(safeTop:)`, 108 on an island phone). DATA, never host
  /// padding (DESIGN.md "Stage insets replace host padding rules"): a view of words and controls keeps them below it;
  /// a picture paints its whole stage and keeps its own words below it.
  var topInset: CGFloat
  /// PG-4t — the monitor skin, resolved for the phone's look (DESIGN.md §8 "The monitor view owns its drawing").
  var skin: GodviewSkin
  /// PG-4t — a still (`-vf-godview-still`, DEBUG; always false in Release): draw one frame, run no loop, no
  /// transition and no timer.
  var isStill: Bool
  /// PG-4t — the stage dissolves under the row (always in Release; DEBUG's `-vf-godview-dissolve=off` turns it off for
  /// a frame meter's run). Defaulted, so a view lane's input needs no new argument.
  var dissolves: Bool = true
  /// SE-2 (SE-P6) — the phone's lens, the chosen profile's id (`ProfileLens.profile`): the list, the rain and the
  /// timeline recede every row but the home's under it (`GodviewRecede.byLens`). nil shows every profile. Defaulted,
  /// so a view lane's input needs no new argument. NOT YET the swarm (the S2 review's finding 2, owed): its bodies
  /// carry no recede weight in FieldSwarm's renderer, so under a lens the swarm still draws every body; Spend draws
  /// spend, not rows to recede.
  var lens: String? = nil
  /// A row tapped: the card on its body.
  var onOpen: @MainActor (RemoteFieldRow) -> Void

  /// PG-4t — the stage's chrome as insets inside a view of this allocation's stage: the reserve at the top always;
  /// the bar's band at the bottom only inside a `.full` stage, which runs under the bar (a `.flow` stage ends at the
  /// band, where `framed` ends it). The pure helper a word view reads; nothing pads by it but the view itself.
  func insets(_ allocation: GodviewStageAllocation) -> EdgeInsets {
    EdgeInsets(top: topInset, leading: 0, bottom: allocation == .full ? bandHeight : 0, trailing: 0)
  }

  /// The open card's row: the drawn row whose VISUAL id is the card's subject (`selection.id`), by its model id.
  nonisolated static func activeId(rows: [RemoteFieldRow], cardSubject: String?) -> String? {
    guard let cardSubject else { return nil }
    return rows.first { $0.visualId == cardSubject }?.id
  }

  /// The deal the swarm's dress uses (`FieldAssembly.fold`): `projects.seqByKey[MonitorWords.projectName(row)]` →
  /// `SwarmColor.project(seq, tint)`, keyed as the bubble's `project` is (S3); nil for a terminal or an undealt
  /// project.
  nonisolated static func colour(of row: RemoteFieldRow, projects: ProjectLedger, tint: ProjectTint) -> SwarmColor? {
    let monitor = row.row.monitor
    guard monitor.kind == .agent else { return nil }
    return projects.seqByKey[MonitorWords.projectName(monitor)].map { SwarmColor.project($0, tint) }
  }

  /// The model ids the swarm draws unread (S2): `Set(bubbles.filter(\.unread).compactMap(\.modelId))`.
  nonisolated static func unreadIds(bubbles: [FieldBubble]) -> Set<String> {
    Set(bubbles.filter { $0.unread }.compactMap { $0.modelId })
  }
}

/// PG-4t — the stage a view takes (puppeteer-view-sdk's `stageAllocation`, mirrored from the manifests): on the
/// desktop it decides the stage's BOTTOM, the field wall (`GodviewMonitor.tsx:585-591`); every stage runs to the top.
enum GodviewStageAllocation: Sendable {
  /// The stage ends at the bar's band: list, rain, timeline, spend.
  case flow
  /// The stage runs under the bar, the band an obstacle: the swarm's alone (`stageAllocation: 'full'`).
  case full
}

/// PG-4t — the dissolve over the stage (DESIGN.md §8 "The phone's Stories row"): a mask, clear down to the row's
/// axis and whole from the reserve, laid in the stage's own frame, whatever the view. Built from frames, so it needs
/// no geometry reader.
struct GodviewDissolve: View {
  let topInset: CGFloat

  var body: some View {
    let fade = GodviewStories.dissolve(topInset: topInset)
    VStack(spacing: 0) {
      Color.clear.frame(height: fade.from)
      LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
        .frame(height: fade.to - fade.from)
      Color.black
    }
  }
}

/// The stage: one view mounted at a time (DESIGN.md "The host mounts one at a time"). The swarm arm is HS's own
/// SwarmField, handed in, because it captures HS's privates (the card, the hold, the bloom). It stands where
/// SwarmField stood. *(Corrected 2026-11-04, PG-4t: this said "so the scanlines and the vignette stay above every
/// view". J-S3 (drop) puts them over the swarm only: HS lays them by `GodviewViewChoice.wearsAtmosphere`.)*
///
/// PG-4t — the stage runs under the Stories row to the screen's top, and the WHOLE stage dissolves under the row,
/// whatever the view: clear at the row's axis, whole at the reserve (`GodviewDissolve`). The row, the bar and the
/// swarm's scanlines and vignette stand outside it, so none of them is masked.
struct GodviewStage<Swarm: View>: View {
  let choice: GodviewViewChoice
  let input: GodviewStageInput
  @ViewBuilder let swarm: () -> Swarm

  /// The mask's ONE place: a frame meter's DEBUG run (`input.dissolves` false) draws the arm unmasked.
  var body: some View {
    if input.dissolves {
      arm.mask { GodviewDissolve(topInset: input.topInset) }
    } else {
      arm
    }
  }

  @ViewBuilder
  private var arm: some View {
    switch choice {
    case .swarm: swarm().transition(.opacity)
    // PG-5…8: `case .<view>: framed(<View>View(input: input))`
    case .list: framed(ListView(input: input))
    case .rain: framed(RainView(input: input))
    case .timeline: framed(GodviewTimelineView(input: input))
    case .spend: framed(SpendView(input: input))
    }
  }

  /// What a non-swarm view stands in (Q-S7 (a)), written once so no lane re-derives it: a `.flow` stage ends at the
  /// bar's band, the one inset the host lays; a `.full` one runs under the bar. The top is never padded: the reserve
  /// is data on `input.topInset` (DESIGN.md "Stage insets replace host padding rules"), and a view's ground fills its
  /// stage from the screen's top. No door stands over the field since WI-1, so there is no gate or dim to lay. It
  /// fades in and out as the stage changes view (the host's 180 ms `ease`; DESIGN.md §6, the view switch).
  func framed(_ view: some View) -> some View {
    view.padding(.bottom, choice.allocation == .flow ? input.bandHeight : 0).transition(.opacity)
  }
}
