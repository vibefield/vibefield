import FieldAgents
import FieldProduct
import Foundation

// PG-3e — ONE DRAWN ROW AS ONE SWARM BODY: 3d's `RemoteFieldRow` (the replica's row, its board row and the window's
// standing and visual id) mapped straight to the swarm's `FieldBubble`, which `bodyModel` reads — the window's
// `bubbleModel` inputs, transcribed (`bubble-model.js` 0.3.2; design v2 §2). Held to `phone-body.golden.json` step by
// step (`PhoneBodyParityTests`). This file imports nothing beyond FieldAgents and FieldProduct, so the host inner loop
// builds it.
//
// It does not go through `AgentSnapshot`, which has no slot for six facts the body now reads: the visual id, the model
// id beside the key, the host's name on an agent, the question's header, an OPEN coverage word and `observed`.
//
// The three ids (Q-E7): `FieldBubble.id` is the VISUAL id — the body the physics, the selection and the card follow,
// the golden's `bodyIdOf` — `modelId` is the row's id (what `agent.reportShown` names) and `runKey` its board key (what
// a resume names). They all differ for 3d's V1, a launched agent drawn in its shell's body.

/// The views draw these waits; another word in the row's wait is none to them (`DRAWN_WAITS`).
private func drawnWait(_ row: MonitorAgentRow) -> MonitorWait? {
  guard row.observed, let wait = row.wait, AgentBlockerKind(rawValue: wait.kind) != nil else { return nil }
  return wait
}

private func visualStatus(_ status: MonitorRowStatus) -> AgentVisualStatus {
  switch status {
  case .idle: .idle
  case .working: .working
  case .blocked: .blocked
  }
}

/// An epoch-ms instant on the wire (`createdAt`, `statusSince`).
private func wireInstant(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

/// One drawn row's bubble. `fieldIsLive` is false while no live home answers for the copy: every body greys (the
/// phone-only grey, outside the golden). `catalog` is the row's desktop's: its mark only, never its name (Q-E12).
/// `suppressUnread` holds the open card's row out of unread while its desktop cannot hear this phone's reports (PG-3f).
public func fieldBubble(
  from row: RemoteFieldRow, fieldIsLive: Bool, catalog: AgentCatalog, suppressUnread: Bool
) -> FieldBubble {
  let monitor = row.row.monitor
  let board = row.board
  let status = visualStatus(monitor.status)
  // A row from another desktop wears its host on the body, terminal or agent: the desktop's name alone.
  let host = row.isSelf ? nil : monitor.device.name
  // The window's stale (a home row's owner's, a peer's standing), and the phone's own grey while the home is down.
  let stale = row.stale || !fieldIsLive
  let project = MonitorWords.projectName(monitor)
  let detail = MonitorWords.detailLine(monitor, isSelf: row.isSelf)
  // The card header's hue: the pane's session when there is one, else the key (as the field cut's projection did).
  let identityKey = board.terminal?.runtimeSessionId ?? row.key
  let createdAt = wireInstant(monitor.createdAt)

  // A peer's `stale` IS its standing; the home answers while the home is live, whatever its owner's evidence clock.
  let deviceLive = fieldIsLive && (row.isSelf || !row.stale)
  // Items 154 and 162 — the owner deletes a row's `terminal` while its terminal doors are down (`attachableRows`,
  // agent-field.ts), and a run with no known pane carries it PRESENT as `{hosted: "none"}`; the two are told apart
  // here.
  let paneWithheld = board.terminal == nil
  // SE-2 — the home's profile the run is under, which the phone's lens keys on (the swarm's recede reads it): a peer's
  // is its own desktop's, so it carries none (the lead's ruling 17).
  let profileSet = row.isSelf ? monitor.profileSet : nil

  guard monitor.kind == .agent else {
    // A bare terminal carries no facet: the body draws it hollow, running while its job works. Item 154: its pane join
    // rides the bubble (`terminalJoin`, read through `join`), so its card attaches as an agent's does. (3e had none,
    // Q-E8.) It is never `exited`: the replica keeps a terminal's row only while it is alive.
    let join = AgentJoin(
      deviceID: row.device, hosted: board.terminal?.hosted ?? "none",
      runtimeSessionID: board.terminal?.runtimeSessionId, deviceLive: deviceLive, paneWithheld: paneWithheld)
    return FieldBubble(
      id: row.visualId, project: project, detail: detail, status: status, identityKey: identityKey,
      createdAt: createdAt, stale: stale, host: host, modelId: row.id, runKey: row.key, terminalJoin: join,
      profileSet: profileSet)
  }

  let provider = AgentProvider(rawValue: monitor.provider?.id ?? "")
  let observed = monitor.observed
  let blocked = status == .blocked
  let wait = blocked ? drawnWait(monitor) : nil
  let blocker = wait.flatMap { wait in
    AgentBlockerKind(rawValue: wait.kind).map {
      AgentBlocker(
        kind: $0, detail: wait.detail, header: wait.header, question: wait.question, tool: wait.tool, code: wait.code)
    }
  }
  // The card's reply chips read non-emptiness alone, and the row carries the first blocker's parts only, so one entry
  // draws the same chips as `wait.count`; the next frame's wait names the next.
  let permissions = blocker?.kind == .permission ? [AgentPermission(tool: blocker?.tool)] : []
  let effort: AgentEffort? = observed ? monitor.effort.flatMap { effort in
    effort.value.isEmpty
      ? nil : AgentEffort(value: effort.value, intent: effort.intent == .configured ? .configured : .observed)
  } : nil
  let cost: AgentCost? = observed ? monitor.cost.map {
    AgentCost(usd: $0.usd, coverage: $0.coverage.wire, burnPerHour: $0.burnPerHour)
  } : nil
  let branch: String? = {
    if case .named(let name) = monitor.project.branch, !name.isEmpty { return name }
    return nil
  }()
  let pending = monitor.pending ?? false
  let join = AgentJoin(
    deviceID: row.device,
    // (Corrected 2026-11-02, item 162: "none" for an ABSENT `terminal` read a withheld pane as no pane at all, and the
    // face read both as an ended run; `paneWithheld` now says which. The field cut's join, retired with PG-3e, filled
    // it the same way (`AgentFieldProjection.swift:190-197` at d4eb2e74f).)
    hosted: board.terminal?.hosted ?? "none",
    runtimeSessionID: board.terminal?.runtimeSessionId,
    pending: pending,
    // MF-1f's row: the process ended and the pane is still on the floor. A PENDING row is live and merely unobserved.
    exited: !monitor.alive && !pending,
    deviceLive: deviceLive,
    nativeSessionID: board.nativeSessionId,
    paneWithheld: paneWithheld)
  let facet = AgentFacet(
    provider: provider,
    label: monitor.provider.map { $0.label.isEmpty ? nil : $0.label } ?? nil,
    // The owner's word, possibly empty, never the catalog's label (Q-E12, J-E6).
    modelName: MonitorWords.modelWord(monitor),
    branch: branch,
    contextUsedPercent: monitor.context?.usedPercent,
    permissions: permissions,
    blocker: blocker,
    effort: effort,
    lastMessage: observed ? monitor.reply?.text : nil,
    cost: cost,
    statusSince: wireInstant(monitor.statusSince),
    // Its one reader, the 30 s rule, retires: the row's `stale` is the owner's.
    lastEvidenceAt: nil,
    join: join,
    catalogEntry: catalog.entry(for: provider))
  return FieldBubble(
    id: row.visualId, project: project, detail: detail, status: status, identityKey: identityKey,
    createdAt: createdAt, agent: facet, stale: stale, unread: monitor.unread && !suppressUnread, host: host,
    modelId: row.id, runKey: row.key, ofSpark: board.ofSpark, profileSet: profileSet)
}
