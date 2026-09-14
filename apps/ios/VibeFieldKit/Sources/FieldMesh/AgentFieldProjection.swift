import FieldAgents
import FieldProduct
import Foundation

// The fold, phone-side: `AgentFieldRow` → `AgentSnapshot` (§10.3). It lives in
// FieldMesh for the same reason `remoteSessionRows` does — this is the one
// module that sees both vocabularies, so the projection that makes bubbles
// never learns a wire type, and FieldAgents stays the pure domain it is.
//
// THE LAW THIS OBEYS (AR-D4): fieldd derives `status` ONCE and no view
// re-derives it. The phone already has a classifier, so the rule here is not
// "ignore it" but REPRODUCE it: the state this builds is shaped so that
// `classifyAgentStatus` returns the word fieldd already sent. A test asserts
// that over the golden for every row — if the two ever disagree, that is a red
// here and not a wrong bubble on a phone.

/// One wire date. Both spellings are accepted because both are on the wire:
/// fieldd's own timestamps carry milliseconds, and nothing forbids a producer
/// that omits them.
private let iso8601WithFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
private let iso8601WithoutFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: false)

public func parseWireDate(_ text: String?) -> Date? {
  guard let text, !text.isEmpty else { return nil }
  if let date = try? iso8601WithFraction.parse(text) { return date }
  return try? iso8601WithoutFraction.parse(text)
}

/// What a board became.
public struct AgentFieldProjection: Sendable, Equatable {
  public let agents: [AgentSnapshot]
  /// Rows dropped because the run has ended. Not a problem — an exited run
  /// leaves the field by design — but counted so "the board is empty" and
  /// "the board is five corpses" are different sentences.
  public let ended: Int

  public static let empty = AgentFieldProjection(agents: [], ended: 0)
}

/// A whole board.
public func projectAgentField(
  rows: [AgentFieldRow], device: String? = nil
) -> AgentFieldProjection {
  var agents: [AgentSnapshot] = []
  var ended = 0
  for row in rows {
    guard let snapshot = agentSnapshot(from: row, device: device) else {
      ended += 1
      continue
    }
    agents.append(snapshot)
  }
  return AgentFieldProjection(agents: agents, ended: ended)
}

/// One row. `nil` = the run has ended and leaves the field, and that is now the
/// ONLY reason a row does not draw.
///
/// `kind` is carried whatever it says. An earlier cut of this refused a
/// provider this build had no mark for and counted it instead, which was the
/// wrong trade twice over: the reference already answers the question — a
/// provider without a mark wears its LETTER (`AgentIcon.tsx`) — and the Metal
/// renderer here had transcribed that fallback all along. The only thing
/// standing between an unfamiliar agent and the field was a closed enum.
public func agentSnapshot(from row: AgentFieldRow, device: String? = nil) -> AgentSnapshot? {
  let provider = AgentProvider(rawValue: row.kind)

  // WHAT KEEPS A ROW ON THE FIELD, in the wire's own three facts.
  //
  // MF-1e settled the first two: `alive` answers "is this agent still there",
  // `pending` answers "is anyone at the wheel". A run whose PTY the floor
  // hosts is ALIVE even while fieldd is not observing it, so today's goldens
  // ship `alive: true` beside `pending: "resume-when-idle"`. The `|| parked`
  // is kept anyway for a producer still on the first cut's spelling.
  //
  // MF-1f added the third and it is the one that bites: an EXITED run keeps
  // its row while the floor still lists its PTY — `alive: false`, no
  // `pending`, `terminal.hosted` still `local` with the same session id — so
  // that §07's "resume after an exit" has a row to live on. Reading `alive`
  // alone would drop exactly the row that change went to the trouble of
  // keeping, and the pane would vanish from under a card that was reading it.
  //
  // A run leaves when it is dead AND has no pane. That is the only exit.
  let parked = row.pending != nil
  let pane = row.terminal?.hosted != "none" && row.terminal?.runtimeSessionId != nil
  guard row.alive || parked || pane else { return nil }

  var permissions: [AgentPermission] = []
  var blockers: [AgentBlocker] = []
  for blocker in row.blockers {
    switch blocker.kind {
    case "permission":
      permissions.append(AgentPermission(tool: blocker.tool))
    case "question":
      blockers.append(AgentBlocker(kind: .question))
    default:
      // A blocker kind this build has no word for still BLOCKS — fieldd said
      // so — and the raw word rides in `detail` rather than being thrown away.
      blockers.append(AgentBlocker(kind: .failure, detail: blocker.kind))
    }
  }

  // Reproduce fieldd's word. `blocked` needs something in one of the two
  // lists; `working` needs a turn; `idle` and `unknown` need neither. A board
  // that says `blocked` with an empty blocker array would otherwise draw as
  // idle, so the status gets the last word and a synthetic blocker carries it.
  let status = row.statusValue
  if status == .blocked, permissions.isEmpty, blockers.isEmpty {
    blockers.append(AgentBlocker(kind: .failure, detail: "blocked"))
  }
  if status != .blocked, !permissions.isEmpty || !blockers.isEmpty {
    // The other direction: fieldd says not-blocked while carrying blockers.
    // Its word wins and the blockers are DROPPED — not moved somewhere the
    // classifier cannot see them, dropped. (An earlier comment here claimed
    // they were kept out of the verdict's reach; they were not kept at all.)
    //
    // Dropping is the right answer for the one consumer that exists: the
    // card's reply chips are derived from `permissions`, and offering somebody
    // a button that answers a permission fieldd has already stopped reporting
    // is worse than offering nothing. If a later surface wants the stale list,
    // it gets its own field and the classifier still never reads it.
    permissions = []
    blockers = []
  }

  let state = AgentRuntimeState(
    lifecycle: .ready,
    activeTurn: status == .working,
    activeReasoning: false,
    permissions: permissions,
    toolRuns: [],
    taskCount: 0,
    contextUsedPercent: row.contextUsedPercent,
    modelName: row.modelDisplayName ?? row.modelId,
    branch: row.branch,
    blockers: blockers,
    effort: row.effort.map {
      AgentEffort(value: $0, intent: row.effortIntent == "configured" ? .configured : .observed)
    },
    // DELIBERATELY nil: the field projection carries no reply text (§10.1).
    // The card fills it from `agent.list` when it opens, and until then the
    // body shows no line rather than a stale one.
    lastAssistantMessage: nil,
    usage: row.cumulativeTokens.map { AgentUsage(cumulativeTokens: $0) },
    statusSince: parseWireDate(row.statusSince),
    lastEvidenceAt: parseWireDate(row.lastActivityAt))

  return AgentSnapshot(
    // AR-4b: the row's identity IS the run. The field projection carries no
    // provider-native session id at all, by design.
    id: row.runtimeRunId,
    // The card header's hue is dealt from this; the PTY is the better alias
    // when there is one, because that is what a card will attach to (IOS-4c).
    runtimeSessionID: row.terminal?.runtimeSessionId ?? row.runtimeRunId,
    provider: provider,
    project: folderName(row.cwd, fallback: row.label),
    state: state,
    createdAt: parseWireDate(row.createdAt) ?? .now,
    // G3's join. The DEVICE is the publisher's — the slice's key, or the
    // desktop whose door answered — and not the row's own `device` field:
    // this id has to be the one a product client and the devices store are
    // filed under, and only the caller knows which desktop it heard this from.
    // The row's own word is the fallback for a caller that did not say.
    join: AgentJoin(
      deviceID: device ?? row.device,
      hosted: row.terminal?.hosted ?? "none",
      runtimeSessionID: row.terminal?.runtimeSessionId,
      pending: parked,
      // MF-1f's row: the process ended and the pane is still on the floor. A
      // PENDING row is not this — it is live and merely unobserved.
      exited: !row.alive && !parked))
}

/// Every live board the phone can hear, folded into one field.
///
/// Rows past their slice's `expiresAt` are dropped: a desktop that stopped
/// refreshing is a desktop whose board is no longer true, and the store's
/// heartbeat is what says so. The reader's clock is its own, which is why this
/// takes `now` rather than reading it — a test should not need to wait 30 s to
/// watch a board go stale.
public func projectAgentSlices(
  _ slices: [AgentFieldSlice], now: Date = .now
) -> AgentFieldProjection {
  var agents: [AgentSnapshot] = []
  var ended = 0
  // Device order, then the board's own order: a field that reshuffles because
  // a dictionary rehashed would respawn every body.
  for slice in slices.sorted(by: { $0.deviceId < $1.deviceId }) {
    guard !slice.isExpired(at: now) else { continue }
    let projected = projectAgentField(rows: slice.rows, device: slice.deviceId)
    agents.append(contentsOf: projected.agents)
    ended += projected.ended
  }
  return AgentFieldProjection(agents: agents, ended: ended)
}
