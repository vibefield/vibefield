import Foundation

/// The union model the swarm renders — D-i7, the desktop's GT-4b shape adopted
/// rather than re-invented: ONE visual model, projected by pure functions from
/// either source, so the field has one stage and the views never branch on
/// where a bubble came from. Since IOS-6a it is also the reference's
/// `MonitorAgent` row: the project's colour, the pane it is worked in, the
/// unread mark and the stale flag ride the row, dressed by `FieldAssembly`.

/// What an agent bubble knows that a terminal cannot.
public struct AgentFacet: Sendable, Equatable {
  public let provider: AgentProvider
  public let modelName: String?
  public let branch: String?
  public let contextUsedPercent: Double?
  /// What this agent is waiting on right now (IOS-5c, K-D4).
  ///
  /// It rides the FACET rather than being fetched from a snapshot at the card,
  /// because the chips that answer a permission read the FEED and never the
  /// terminal's frame: this phone has no text access to a frame (they arrive
  /// as TRF1 bytes that only the Metal view can read), so an approval the user
  /// can tap is only ever something the agent stream said. Empty is the honest
  /// default — an agent that is not waiting has nothing to answer, and a
  /// terminal bubble has no agent facet at all.
  public let permissions: [AgentPermission]
  /// Why the agent is blocked, when it is, with the evidence the state line
  /// quotes (the tool, the question, the detail, the code — D-i19).
  public let blocker: AgentBlocker?
  public var blockerKind: AgentBlockerKind? { blocker?.kind }
  public let effort: AgentEffort?
  /// The root agent's latest reply; the body shows its first line.
  public let lastMessage: String?
  /// Core's usage, verbatim — the ledger's INPUT, never drawn.
  public let monitorUsage: AgentUsage?
  /// The UI's display history of the run's USD (`UsageLedger`): the corrected
  /// total and the buckets. The body reads this for the total and
  /// `monitorUsage` for the live rate. Filled at assembly.
  public var usage: UsageHistory?
  public let statusSince: Date?
  public let lastEvidenceAt: Date?
  /// G3's join: where this run's terminal is, and on whose desktop. nil for a
  /// feed that has no desktop behind it.
  public let join: AgentJoin?

  public init(
    provider: AgentProvider,
    modelName: String? = nil,
    branch: String? = nil,
    contextUsedPercent: Double? = nil,
    permissions: [AgentPermission] = [],
    blocker: AgentBlocker? = nil,
    effort: AgentEffort? = nil,
    lastMessage: String? = nil,
    monitorUsage: AgentUsage? = nil,
    usage: UsageHistory? = nil,
    statusSince: Date? = nil,
    lastEvidenceAt: Date? = nil,
    join: AgentJoin? = nil
  ) {
    self.provider = provider
    self.modelName = modelName
    self.branch = branch
    self.contextUsedPercent = contextUsedPercent
    self.permissions = permissions
    self.blocker = blocker
    self.effort = effort
    self.lastMessage = lastMessage
    self.monitorUsage = monitorUsage
    self.usage = usage
    self.statusSince = statusSince
    self.lastEvidenceAt = lastEvidenceAt
    self.join = join
  }
}

/// What a remote bubble knows, and what the card needs to open it.
public struct RemoteFacet: Sendable, Equatable {
  public let deviceID: String
  public let deviceName: String
  /// The session's id on the PEER — there is no local session until attach.
  public let sessionID: String
  public let attachable: Bool
  /// Whether the HOST permits writes at all; who gets them is decided at attach.
  public let readWrite: Bool
  public let cwdLabel: String?

  public init(
    deviceID: String,
    deviceName: String,
    sessionID: String,
    attachable: Bool,
    readWrite: Bool,
    cwdLabel: String? = nil
  ) {
    self.deviceID = deviceID
    self.deviceName = deviceName
    self.sessionID = sessionID
    self.attachable = attachable
    self.readWrite = readWrite
    self.cwdLabel = cwdLabel
  }
}

/// The pane a session is worked in, and its colour (record §02, revised
/// 2026-09-12: a pane owns its colour). The phone has one pane — the card
/// (D-i12) — so a bubble carries this exactly while its card is open.
public struct PaneLink: Sendable, Equatable {
  public var color: SwarmColor
  public init(color: SwarmColor) { self.color = color }
}

/// One citizen of the field. Exactly one facet is non-nil: a bubble is an
/// agent's or a peer's, and the absent facet is what tells the model to draw a
/// hollow rather than a body.
public struct FieldBubble: Identifiable, Sendable, Equatable {
  public let id: String
  /// The headline.
  public let project: String
  /// The one-line truth under it.
  public let detail: String
  public let status: AgentVisualStatus
  /// What the card header's hue still hashes (D-i16). Split from `id` because
  /// the two sources key it differently and both reasons are findings.
  public let identityKey: String
  public let createdAt: Date
  public let agent: AgentFacet?
  public let remote: RemoteFacet?
  /// The project's colour (record §02): the tag before the name, the flood,
  /// the centre light. nil is the ramp — a bare terminal belongs to no
  /// project, and an agent whose project has not been dealt yet wears it too.
  public var color: SwarmColor?
  /// Evidence recency is presentation metadata, never a fourth status.
  public var stale: Bool
  /// Worked in the pane the user has in front of them: the open card's subject.
  public var active: Bool
  public var pane: PaneLink?
  /// Finished something while another session had the card (`UnreadLedger`).
  public var unread: Bool

  public init(
    id: String,
    project: String,
    detail: String,
    status: AgentVisualStatus,
    identityKey: String,
    createdAt: Date,
    agent: AgentFacet? = nil,
    remote: RemoteFacet? = nil,
    color: SwarmColor? = nil,
    stale: Bool = false,
    active: Bool = false,
    pane: PaneLink? = nil,
    unread: Bool = false
  ) {
    self.id = id
    self.project = project
    self.detail = detail
    self.status = status
    self.identityKey = identityKey
    self.createdAt = createdAt
    self.agent = agent
    self.remote = remote
    self.color = color
    self.stale = stale
    self.active = active
    self.pane = pane
    self.unread = unread
  }
}

/// nil when the session has left the field (exited/failed) — the same law as
/// `classifyAgentStatus`, kept in one place so a dead agent cannot reach the
/// stage through a second door.
public func fieldBubble(from snapshot: AgentSnapshot) -> FieldBubble? {
  guard let status = classifyAgentStatus(snapshot.state) else { return nil }
  let state = snapshot.state
  return FieldBubble(
    id: snapshot.id,
    project: snapshot.project,
    detail: agentDetail(state, status: status),
    status: status,
    // Agents keep hashing the RUNTIME alias, as the desktop did: it is the
    // handle that survives a session's state churn.
    identityKey: snapshot.runtimeSessionID,
    createdAt: snapshot.createdAt,
    agent: AgentFacet(
      provider: snapshot.provider,
      modelName: state?.modelName,
      branch: state?.branch,
      contextUsedPercent: state?.contextUsedPercent,
      // The card's chips are derived from this and nothing else. `?? []` is
      // not a default standing in for missing news: a snapshot with no state
      // has not reported yet, and "not reported" is not "waiting".
      permissions: state?.permissions ?? [],
      blocker: status == .blocked ? agentBlocker(state) : nil,
      effort: state?.effort,
      lastMessage: state?.lastAssistantMessage,
      monitorUsage: state?.usage,
      statusSince: state?.statusSince,
      lastEvidenceAt: state?.lastEvidenceAt,
      join: snapshot.join),
    // NEVER both facets. "Exactly one facet is non-nil" is what tells the
    // renderer to draw a body rather than a hollow, so an agent whose PTY is
    // published does NOT become a remote bubble — the card resolves the join
    // itself (`agentTerminalFace`).
    remote: nil)
}

/// Ported from the desktop's `monitorAgentFromRemote`, where every clause is a
/// finding rather than a preference (§10.2).
public func fieldBubble(from row: RemoteSessionRow) -> FieldBubble {
  let id = row.id
  let host = row.host
  let session = row.session
  // The JS truthiness clause, kept: an EMPTY label is no label, and rendering
  // `host · ` would hang a separator on nothing. It governs EVERY use of the
  // field below, the facet included — the desktop can pass its raw value on
  // because every JS consumer writes `if (cwdLabel)` and `""` is falsy there,
  // but a Swift consumer writes `if let cwd` and would bind an empty string
  // into an empty row. The peer's literal answer is not lost: the row keeps it
  // untouched in `RemoteSessionInfo`, and normalizing belongs in the
  // projection, never at the mesh seam that records what the peer said.
  let label = (session.cwdLabel?.isEmpty == false) ? session.cwdLabel : nil
  let untitled = session.title.isEmpty ? "remote" : session.title
  return FieldBubble(
    id: id,
    project: folderName(label, fallback: untitled),
    // The host rides in the detail as well as in the facet, because the detail
    // is what the swarm reads out: "a path with no machine attached to it" is
    // exactly the confusion GT-3's finding warned of.
    detail: label.map { "\(host.deviceName) · \($0)" } ?? host.deviceName,
    status: classifyTerminalStatus(session.activityKind),
    // The card header's hue keys by the QUALIFIED id, so the same session id
    // on two peers is two colours (D-i16 keeps the hue there, not on the field).
    identityKey: id,
    createdAt: Date(timeIntervalSince1970: Double(session.createdAtMs) / 1000),
    agent: nil,
    remote: RemoteFacet(
      deviceID: host.deviceID,
      deviceName: host.deviceName,
      sessionID: session.sessionID,
      attachable: session.attachable,
      readWrite: session.readWrite,
      cwdLabel: label))
}

// MARK: - The field's ledgers (the desktop's `assembleMonitorAgents` + its folds)

/// Everything the field decides ABOUT the rows rather than from them, folded
/// once per projection: the project colours (D-i13), the one pane's colour
/// (D-i12), the usage ledger, the unread marks, the stale flags. A plain
/// value the home screen keeps and folds; every rule inside is a pure
/// function with its own tests.
public struct FieldAssembly: Sendable {
  public var projects: ProjectLedger
  public var panes: PaneColourLedger
  public var usage: UsageLedger
  public var unread: UnreadLedger
  /// The theme's tint; the home screen swaps it with the colour scheme.
  public var tint: ProjectTint

  /// The reference's freshness policy: evidence older than this dims the body.
  public static let staleAfterMs: Double = 30_000
  /// The phone's one pane.
  public static let cardPaneID = "card"

  public init(
    tint: ProjectTint,
    projects: ProjectLedger = .empty,
    panes: PaneColourLedger = .empty,
    usage: UsageLedger = .empty,
    unread: UnreadLedger = .empty
  ) {
    self.tint = tint
    self.projects = projects
    self.panes = panes
    self.usage = usage
    self.unread = unread
  }

  /// The colour the card wears as the phone's pane, dealt on first use.
  public var paneColor: SwarmColor {
    let seq = panes.seqByID[Self.cardPaneID] ?? 0
    return .pane(seq, tint)
  }

  /// Fold one projection and dress its rows.
  public mutating func fold(
    _ bubbles: [FieldBubble], cardSubjectID: String?, nowMs: Double
  ) -> [FieldBubble] {
    projects = projects.dealing(bubbles.filter { $0.agent != nil }.map(\.project))
    panes = panes.dealing([Self.cardPaneID])
    // The row's id IS the run (AR-4b), so the ledger's run key is the id; the
    // native session id does not ride the row, and the reference's fold holds
    // a run's history across projections without it.
    usage = usage.reconciling(
      bubbles.map { UsageReading(id: $0.id, runId: $0.id, usage: $0.agent?.monitorUsage) }, nowMs: nowMs)
    unread = unread.reconciling(
      bubbles.map { bubble in
        UnreadCandidate(
          id: bubble.id,
          status: bubble.status,
          active: bubble.id == cardSubjectID,
          hasAgent: bubble.agent != nil,
          statusSinceMs: bubble.agent?.statusSince.map { $0.timeIntervalSince1970 * 1000 })
      }, nowMs: nowMs)
    let pane = PaneLink(color: paneColor)
    return bubbles.map { bubble in
      var dressed = bubble
      if var facet = bubble.agent {
        facet.usage = usage.history(of: bubble.id)
        dressed = FieldBubble(
          id: bubble.id, project: bubble.project, detail: bubble.detail, status: bubble.status,
          identityKey: bubble.identityKey, createdAt: bubble.createdAt, agent: facet, remote: bubble.remote)
        dressed.color = projects.seqByKey[bubble.project].map { SwarmColor.project($0, tint) }
        if let evidence = facet.lastEvidenceAt {
          dressed.stale = nowMs - evidence.timeIntervalSince1970 * 1000 > Self.staleAfterMs
        }
      }
      dressed.unread = unread.unreadIDs.contains(bubble.id)
      dressed.active = bubble.id == cardSubjectID
      dressed.pane = dressed.active ? pane : nil
      return dressed
    }
  }
}
