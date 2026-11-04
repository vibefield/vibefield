import FieldMesh
import FieldProduct
import Foundation

// PG-8 — ONE ROW AS THE RAIN READS IT: the fields puppeteer-views 0.3.3's rain reads of an `AgentView` (read-pg8 §3;
// views `e79fc53d`, SDK words `e79fc53d`, state-words and motion `5abe8f75`, at the pin `52d09c8e`), taken once per
// row from the window's drawn `RemoteFieldRow` (FieldProduct, PG-3d). The words are FieldMesh's `MonitorWords`
// (PG-3e, Q-E11), reused, never re-transcribed: `projectName`, `modelWord` and `detailLine`.
//
// What the rain does NOT read, named: cost, `unread` and `stale` (rain draws none of them, as the desktop's: §10;
// fd's Q9) and the home's `fieldIsLive`; a pane's `attachment` (the phone mounts no panes, PG:429 — the pane wash
// `RainView.js:130-146` is not transcribed, fd's Q4); and `receded` (the phone joins none, PG:428-433: every row's is
// false, kept as a field so the recede steps stand transcribed).

struct RainAgent: Equatable, Sendable {
  /// The model id (`AgentView.id`): the drops key on it.
  let id: String
  let kind: MonitorRowKind
  let status: MonitorRowStatus
  /// `device.self`: the row lives on the home (`RemoteFieldRow.isSelf`).
  let isSelf: Bool
  /// `device.name`: a peer terminal's stream names its desktop first.
  let deviceName: String
  /// `projectName(agent)` (SDK words :42).
  let projectName: String
  /// `project.branch` when it names one; nil when nothing looked (`.notLooked`) or there is none (`.noBranch`).
  let branch: String?
  /// `modelWord(agent)` (SDK words :48).
  let model: String
  /// `context.usedPercent`, an agent's only.
  let usedPercent: Double?
  /// `detailLine(agent)` (SDK words :64): the line the accessible button says.
  let detail: String
  /// The host's join; the phone's is always false.
  var receded = false
}

extension RainAgent {
  /// The rain's reading of one drawn row.
  init(row: RemoteFieldRow) {
    let monitor = row.row.monitor
    id = monitor.id
    kind = monitor.kind
    status = monitor.status
    isSelf = row.isSelf
    deviceName = monitor.device.name
    projectName = MonitorWords.projectName(monitor)
    if case .named(let name) = monitor.project.branch { branch = name } else { branch = nil }
    model = MonitorWords.modelWord(monitor)
    usedPercent = monitor.kind == .agent ? monitor.context?.usedPercent : nil
    detail = MonitorWords.detailLine(monitor, isSelf: row.isSelf)
  }
}
