import FieldMesh
import FieldProduct
import Foundation

// PG-5 — THE LIST VIEW'S MODEL: the order, the count and every row's words, transcribed from puppeteer-views 0.3.3 at
// the pin `52d09c8e` (this view is byte-identical to 0.3.2's `95a70aa7`):
//   · `src/views/list/AgentList.tsx` (`e79fc53d`, 2026-10-28): `STATUS_ORDER` :26, `compareAgents` :28-35, and in
//     `AgentList` :37-129 the order :64, `shown` :65, every-receded :79, the count :85 and the empty state :115-119;
//     `ListRow` :137-204, its words :144-151, its flags :156-160, its label :168-170 and its cells :173-200
//     (dist `AgentList.js` :16-101);
//   · `src/views/list/list-parameters.ts` (`5abe8f75`, 2026-10-12): the defaults :8-11, the ranges :13-21 and
//     `normalizeListParameters` :25-35 (dist :1-26).
// Every word is the toolkit's (REUSE, never re-transcribed): `MonitorWords.projectName`, `.modelWord`, `.detailLine`,
// `.deviceWord`, `StateWords.kindTerminal`/`.kindRemote`, `GodviewFormat.formatPercent` and `GodviewRecede.every`.
// Held to `phone-list.golden.json` (the shipping view over the home's window, step by step) by FieldHomeTests'
// ListViewTests. Not transcribed: the spawn menu (PG-D10 (a)), and `＋ TERMINAL` is not drawn on the phone (fd's Q1
// ruling, a named deviation: the golden records it, `drawsNewTerminal` pins its absence). The empty hint names no
// pane (deviation 5, fd's words rule; pinned by H12, which scans every word the list says).

/// One row as the list reads it on the phone: the remote cut's row, and what only this window joins (the desktop's
/// `AgentView`): whether it lives on the home, its greying, the open card, receding and a pane's attachment.
struct ListRowInput: Equatable {
  var monitor: MonitorAgentRow
  /// `device.self`: the row lives on the home (`RemoteFieldRow.isSelf`).
  var isSelf: Bool
  /// `row.stale || !fieldIsLive` (GodviewStageInput's rule, GodviewViewChoice.swift:48; fd's Q10).
  var stale: Bool
  /// The open card's row, while `ListModel.lightsOpenCard` (J-S4).
  var active: Bool
  /// The host shows another group: never on the phone (no profile tabs), carried so the order is whole.
  var receded: Bool = false
  /// A pane shows it: never on the phone (no panes).
  var linked: Bool = false

  var id: String { monitor.id }
}

/// One drawn row: its flags, its cells' words and its label.
struct ListRowModel: Equatable, Identifiable {
  /// The agent column (AgentList.tsx:178-196).
  enum Agent: Equatable {
    /// An agent: its provider's mark (by id), what runs it, and the account it is bound to.
    case agent(providerId: String, model: String, account: String?)
    /// THE HOST CHIP: a peer's terminal, named by its desktop.
    case host(String)
    /// A home terminal.
    case terminal(String)
  }

  let id: String
  let status: MonitorRowStatus
  let active: Bool
  let stale: Bool
  let linked: Bool
  let remote: Bool
  let receded: Bool
  let project: String
  let branch: String?
  let agent: Agent
  let detail: String
  let context: String
  let label: String

  /// `aria-current`: the lit row.
  var current: Bool { active }
}

/// The list as the phone draws it.
struct ListModel: Equatable {
  /// `N SESSIONS`, or `S OF N SESSIONS` while some recede.
  let count: String
  /// Every row receded: the faintest weight (LC:111-113).
  let allReceded: Bool
  /// In the order drawn.
  let rows: [ListRowModel]

  /// The list's name for a screen reader (AgentList.tsx:81).
  static let listLabel = "Running agent list"
  /// The empty state's two lines (AgentList.tsx:116-119), drawn when there are no rows. The hint drops the desktop's
  /// "pane" (deviation 5, fd's words rule: no phone view names a key, hover or a pane; the phone's one pane is the
  /// open card, D-i12).
  static let emptyTitle = "NO ACTIVE AGENTS"
  /// Draft word: James's eye (VF-PM 2026-11-04). New copy he has not seen; his change is this line and E1's pin.
  static let emptyHint = "Launch an agent from a terminal."
  /// The toolbar's button as the desktop words it (AgentList.tsx:96). The phone does not draw it (fd's Q1: no create
  /// door in the stage input; the phone's spawn is its bloom, PG-D10 (a)).
  static let newTerminalWord = "＋ TERMINAL"
  static let drawsNewTerminal = false

  /// J-S4 (James, accepted 2026-11-04 01:14Z): the open card's row is lit. The ONE place a reversal edits.
  static let lightsOpenCard = true

  var isEmpty: Bool { rows.isEmpty }

  /// The view's tunable numbers (`ListParameters`): the phone passes none, so it draws at the defaults (fd's Q8).
  struct Parameters: Equatable {
    var rowHeight: Double
    var projectWidth: Double

    static let defaults = Parameters(rowHeight: 38, projectWidth: 150)
    static let rowHeightRange = 26.0...72.0
    static let projectWidthRange = 90.0...280.0

    /// `normalizeListParameters`: a finite value is clamped into its range (`Math.max(min, Math.min(max, v))`);
    /// anything else, or a key it does not hold, keeps the default.
    static func normalize(_ values: [String: Double]) -> Parameters {
      var normalized = defaults
      if let value = values["rowHeight"], value.isFinite {
        normalized.rowHeight = clamp(value, rowHeightRange)
      }
      if let value = values["projectWidth"], value.isFinite {
        normalized.projectWidth = clamp(value, projectWidthRange)
      }
      return normalized
    }

    private static func clamp(_ value: Double, _ range: ClosedRange<Double>) -> Double {
      max(range.lowerBound, min(range.upperBound, value))
    }
  }

  // MARK: - The join: the phone's AgentView

  /// The window's drawn rows, joined as the phone's host joins them.
  static func inputs(rows: [RemoteFieldRow], activeId: String?, fieldIsLive: Bool) -> [ListRowInput] {
    rows.map { row in
      ListRowInput(
        monitor: row.row.monitor, isSelf: row.isSelf, stale: row.stale || !fieldIsLive,
        active: lightsOpenCard && activeId != nil && row.id == activeId)
    }
  }

  // MARK: - The order (`compareAgents`)

  /// `STATUS_ORDER`: blocked, working, idle.
  static func rank(_ status: MonitorRowStatus) -> Int {
    switch status {
    case .blocked: 0
    case .working: 1
    case .idle: 2
    }
  }

  /// `compareAgents`, its sign: what the host shows before what recedes, agents before bare terminals, then by status,
  /// then by birth. Compared, never subtracted, so no birth overflows; the sign is JavaScript's.
  static func compare(_ left: ListRowInput, _ right: ListRowInput) -> Int {
    if left.receded != right.receded { return left.receded ? 1 : -1 }
    let leftAgent = left.monitor.kind == .agent
    let rightAgent = right.monitor.kind == .agent
    if leftAgent != rightAgent { return leftAgent ? -1 : 1 }
    let byStatus = rank(left.monitor.status) - rank(right.monitor.status)
    if byStatus != 0 { return byStatus }
    let (a, b) = (left.monitor.createdAt, right.monitor.createdAt)
    return a < b ? -1 : (a > b ? 1 : 0)
  }

  /// `[...agents].sort(compareAgents)`: STABLE, as JavaScript's sort is, so equal rows keep the window's order.
  static func ordered(_ inputs: [ListRowInput]) -> [ListRowInput] {
    inputs.enumerated()
      .sorted { left, right in
        let sign = compare(left.element, right.element)
        return sign != 0 ? sign < 0 : left.offset < right.offset
      }
      .map(\.element)
  }

  // MARK: - The list and its rows

  static func of(_ inputs: [ListRowInput]) -> ListModel {
    let ordered = ordered(inputs)
    let shown = ordered.filter { !$0.receded }.count
    let count = shown == ordered.count ? "\(ordered.count) SESSIONS" : "\(shown) OF \(ordered.count) SESSIONS"
    return ListModel(
      count: count, allReceded: GodviewRecede.every(ordered.map(\.receded)), rows: ordered.map(row))
  }

  /// `ListRow`: the row's words, its flags and its label.
  static func row(_ input: ListRowInput) -> ListRowModel {
    let monitor = input.monitor
    let isAgent = monitor.kind == .agent
    let remote = !input.isSelf
    let project = MonitorWords.projectName(monitor)
    let model = MonitorWords.modelWord(monitor)
    let detail = MonitorWords.detailLine(monitor, isSelf: input.isSelf)
    let branch: String? =
      if isAgent, case .named(let name) = monitor.project.branch, !name.isEmpty { name } else { nil }
    let account = monitor.account.flatMap { $0.isEmpty ? nil : $0 }
    let device = MonitorWords.deviceWord(name: monitor.device.name, isSelf: input.isSelf)
    let name =
      isAgent
      ? [model, account ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
      : (remote ? MonitorWords.StateWords.kindRemote : MonitorWords.StateWords.kindTerminal)
    let agent: ListRowModel.Agent =
      if isAgent {
        .agent(providerId: monitor.provider?.id ?? "", model: model, account: account)
      } else if remote {
        .host(device)
      } else {
        .terminal(MonitorWords.StateWords.kindTerminal)
      }
    let lead = remote ? "on \(device), " : ""
    return ListRowModel(
      id: monitor.id, status: monitor.status, active: input.active, stale: input.stale, linked: input.linked,
      remote: remote, receded: input.receded, project: project, branch: branch, agent: agent, detail: detail,
      context: GodviewFormat.formatPercent(isAgent ? monitor.context?.usedPercent : nil),
      label: "\(lead)\(project), \(name), \(monitor.status.rawValue): \(detail)")
  }
}

extension ListModel {
  /// The list over the stage's input: its drawn rows, the open card and the home's answer.
  @MainActor static func of(input: GodviewStageInput) -> ListModel {
    of(inputs(rows: input.rows, activeId: input.activeId, fieldIsLive: input.fieldIsLive))
  }
}
