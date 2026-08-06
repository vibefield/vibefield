import Foundation

/// The union model the swarm renders — D-i7, the desktop's GT-4b shape adopted
/// rather than re-invented: ONE visual model, projected by pure functions from
/// either source, so the field has one stage and the views never branch on
/// where a bubble came from.

/// What an agent bubble knows that a terminal cannot.
public struct AgentFacet: Sendable, Equatable {
  public let provider: AgentProvider
  public let modelName: String?
  public let branch: String?
  public let contextUsedPercent: Double?

  public init(
    provider: AgentProvider,
    modelName: String? = nil,
    branch: String? = nil,
    contextUsedPercent: Double? = nil
  ) {
    self.provider = provider
    self.modelName = modelName
    self.branch = branch
    self.contextUsedPercent = contextUsedPercent
  }
}

/// What a remote bubble knows, and what the card needs to open it.
public struct RemoteFacet: Sendable, Equatable {
  public let deviceID: String
  public let deviceName: String
  /// The session's id on the PEER — there is no local session until attach.
  public let sessionID: String
  public let attachable: Bool
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

/// One citizen of the field. Exactly one facet is non-nil: a bubble is an
/// agent's or a peer's, and the absent facet is what tells the chrome not to
/// draw a vendor glyph on something that has no vendor.
public struct FieldBubble: Identifiable, Sendable, Equatable {
  public let id: String
  /// The headline.
  public let project: String
  /// The one-line truth under it.
  public let detail: String
  public let status: AgentVisualStatus
  /// What `agentIdentityHue()` hashes for the accent. Split from `id` because
  /// the two sources key their color differently and both reasons are findings
  /// (see the projections below).
  public let identityKey: String
  public let createdAt: Date
  public let agent: AgentFacet?
  public let remote: RemoteFacet?

  public init(
    id: String,
    project: String,
    detail: String,
    status: AgentVisualStatus,
    identityKey: String,
    createdAt: Date,
    agent: AgentFacet? = nil,
    remote: RemoteFacet? = nil
  ) {
    self.id = id
    self.project = project
    self.detail = detail
    self.status = status
    self.identityKey = identityKey
    self.createdAt = createdAt
    self.agent = agent
    self.remote = remote
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
    // Agents keep hashing the RUNTIME alias, as the desktop does: it is the
    // handle that survives a session's state churn.
    identityKey: snapshot.runtimeSessionID,
    createdAt: snapshot.createdAt,
    agent: AgentFacet(
      provider: snapshot.provider,
      modelName: state?.modelName,
      branch: state?.branch,
      contextUsedPercent: state?.contextUsedPercent),
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
    // Accent by the QUALIFIED id, so the same session id on two peers is two
    // colors and one peer's session keeps its color across refreshes.
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
