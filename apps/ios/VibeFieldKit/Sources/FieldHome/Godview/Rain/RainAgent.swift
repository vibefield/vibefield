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
// `RainView.js:130-146` is not transcribed, fd's Q4). `receded` is the phone's lens (SE-2, `GodviewRecede.byLens`):
// PG:428-433 joined it false while the phone had no profile filter; the recede steps stood transcribed for it.
// *Corrected 2026-11-06 (SE-2h, the S2 review's finding 2):* this said the phone joins none.

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
  /// The open card's row, lit (J-S4): `RainAgent.lightsOpenCard` and the card's subject. The desktop's `active`.
  var lit = false
  /// The host's join: under the phone's lens, every column but the home's under the chosen profile (SE-2).
  var receded = false

  /// J-S4 — ACCEPTED by James (2026-11-04 01:12–01:14Z): a view lights the open card's row. The ONE switch: false
  /// stops the rain lighting it (its head back to its status's, its glow ×1, no "open"), whatever else stands.
  static let lightsOpenCard = true

  /// `agentName` (RainView.tsx:76-78, .js:36-38): an agent by its model's word, anything else `terminal`.
  var name: String { kind == .agent ? model : "terminal" }

  /// What the rain's accessible button says for the row (the list, RainView.tsx:381-393, .js:280): project, name,
  /// status, the line.
  var spoken: String { "\(projectName), \(name), \(status.rawValue): \(detail)" }

  /// The button's current mark (`aria-current` while `active`, the list), said as the swarm says its open body on the
  /// phone (`FieldSwarm/SwarmField.swift:242`).
  var accessibilityValue: String? { lit ? "open" : nil }
}

extension RainAgent {
  /// The rain's reading of one drawn row; `activeId` is the open card's row, by model id (`GodviewStageInput
  /// .activeId`). `lightsOpenCard` is J-S4's switch, a parameter only so the hand rows can throw it. `lens` is the
  /// phone's (SE-2, `GodviewStageInput.lens`): under it the column recedes unless it is the home's under the chosen
  /// profile; with none, nothing recedes.
  init(
    row: RemoteFieldRow, activeId: String? = nil, lens: String? = nil,
    lightsOpenCard: Bool = RainAgent.lightsOpenCard
  ) {
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
    lit = lightsOpenCard && activeId == monitor.id
    receded = GodviewRecede.byLens(isSelf: row.isSelf, profileSet: monitor.profileSet, lens: lens)
  }
}
