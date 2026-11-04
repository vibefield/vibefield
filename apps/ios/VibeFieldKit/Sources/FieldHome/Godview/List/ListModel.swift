import FieldMesh
import FieldProduct
import Foundation

// PG-5 — THE LIST VIEW'S MODEL: the order, the count and every row's words, transcribed from puppeteer-views 0.3.3 at
// the pin `52d09c8e` (`src/views/list/AgentList.tsx` `e79fc53d`, `list-parameters.ts` `5abe8f75`).
//
// SKELETON (PG-5 (red)): every word is "", the order is the window's, and nothing is joined.

/// One row as the list reads it on the phone: the remote cut's row, and what only this window joins.
struct ListRowInput: Equatable {
  var monitor: MonitorAgentRow
  var isSelf: Bool
  var stale: Bool
  var active: Bool
  var receded: Bool = false
  var linked: Bool = false

  var id: String { monitor.id }
}

/// One drawn row: its flags, its cells' words and its label.
struct ListRowModel: Equatable, Identifiable {
  enum Agent: Equatable {
    case agent(providerId: String, model: String, account: String?)
    case host(String)
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

  var current: Bool { active }
}

/// The list as the phone draws it.
struct ListModel: Equatable {
  let count: String
  let allReceded: Bool
  let rows: [ListRowModel]

  static let emptyTitle = ""
  static let emptyHint = ""
  static let newTerminalWord = ""
  static let drawsNewTerminal = true

  /// J-S4 (James, accepted 2026-11-04 01:14Z): the open card's row is lit.
  static let lightsOpenCard = true

  var isEmpty: Bool { rows.isEmpty }

  struct Parameters: Equatable {
    var rowHeight: Double
    var projectWidth: Double

    static let defaults = Parameters(rowHeight: 38, projectWidth: 150)
    static let rowHeightRange = 26.0...72.0
    static let projectWidthRange = 90.0...280.0

    static func normalize(_ values: [String: Double]) -> Parameters { defaults }
  }

  static func inputs(rows: [RemoteFieldRow], activeId: String?, fieldIsLive: Bool) -> [ListRowInput] {
    rows.map { ListRowInput(monitor: $0.row.monitor, isSelf: $0.isSelf, stale: $0.stale, active: false) }
  }

  static func rank(_ status: MonitorRowStatus) -> Int { 0 }

  static func compare(_ left: ListRowInput, _ right: ListRowInput) -> Int { 0 }

  static func ordered(_ inputs: [ListRowInput]) -> [ListRowInput] { inputs }

  static func of(_ inputs: [ListRowInput]) -> ListModel {
    ListModel(count: "", allReceded: false, rows: ordered(inputs).map(row))
  }

  static func row(_ input: ListRowInput) -> ListRowModel {
    ListRowModel(
      id: input.monitor.id, status: .idle, active: false, stale: false, linked: false, remote: false,
      receded: false, project: "", branch: nil, agent: .terminal(""), detail: "", context: "", label: "")
  }
}

extension ListModel {
  @MainActor static func of(input: GodviewStageInput) -> ListModel {
    of(inputs(rows: input.rows, activeId: input.activeId, fieldIsLive: input.fieldIsLive))
  }
}
