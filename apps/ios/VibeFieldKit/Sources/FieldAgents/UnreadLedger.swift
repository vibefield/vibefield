import Foundation

/// Which agents finished something the user has not looked at — the reference's
/// `monitor/unread.ts`.
///
/// An agent is unread while it is idle, it is not the active one, and Core says
/// its idle began after the user last had it in front of them. "Last had it in
/// front of them" is the later of first sight and the last projection in which
/// it was active. Reading Core's `statusSince` rather than watching the status
/// change here is what keeps the rule honest under coalescing: a short turn can
/// begin and end between two projections, and a transition nobody saw would
/// otherwise never be marked. Terminals without an agent are never unread; a
/// shell finishing a command is not a reply.
public struct UnreadLedger: Equatable, Sendable {
  /// When each agent was last in front of the user, epoch ms.
  public var seenAtByID: [String: Double]
  public var unreadIDs: Set<String>

  public init(seenAtByID: [String: Double] = [:], unreadIDs: Set<String> = []) {
    self.seenAtByID = seenAtByID
    self.unreadIDs = unreadIDs
  }

  public static let empty = UnreadLedger()

  public func reconciling(_ candidates: [UnreadCandidate], nowMs: Double) -> UnreadLedger {
    var seenAtByID: [String: Double] = [:]
    var unreadIDs: Set<String> = []
    for candidate in candidates {
      let before = self.seenAtByID[candidate.id]
      if candidate.active || before == nil {
        seenAtByID[candidate.id] = nowMs
        continue
      }
      seenAtByID[candidate.id] = before
      guard candidate.hasAgent, candidate.status == .idle, let since = candidate.statusSinceMs,
        let seen = before
      else { continue }
      if since > seen { unreadIDs.insert(candidate.id) }
    }
    return UnreadLedger(seenAtByID: seenAtByID, unreadIDs: unreadIDs)
  }
}

public struct UnreadCandidate: Sendable {
  public var id: String
  public var status: AgentVisualStatus
  public var active: Bool
  /// Whether an agent is behind this row; a bare terminal never earns the dot.
  public var hasAgent: Bool
  /// Core's `statusSince`, epoch ms; absent for a terminal.
  public var statusSinceMs: Double?

  public init(
    id: String, status: AgentVisualStatus, active: Bool = false, hasAgent: Bool = true,
    statusSinceMs: Double? = nil
  ) {
    self.id = id
    self.status = status
    self.active = active
    self.hasAgent = hasAgent
    self.statusSinceMs = statusSinceMs
  }
}
