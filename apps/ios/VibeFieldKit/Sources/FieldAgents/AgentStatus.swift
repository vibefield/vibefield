import Foundation
import SwarmPhysics

/// The three statuses the field draws by — core's word since RFC 005
/// (`idle · working · blocked`); the July `waiting` was the same state under
/// a local name and retired with the views port on both surfaces.
public enum AgentVisualStatus: String, Sendable {
  case idle
  case working
  case blocked
}

/// The July classifier, ported clause for clause, with the reference's
/// blockers joined to the permission list: a permission, a question or a
/// failure each block. nil return = the session has terminated and leaves the
/// field.
public func classifyAgentStatus(_ state: AgentRuntimeState?) -> AgentVisualStatus? {
  guard let state else { return .working }
  if state.lifecycle == .exited || state.lifecycle == .failed { return nil }
  if !state.permissions.isEmpty || !state.blockers.isEmpty { return .blocked }
  if state.lifecycle != .ready || state.activeTurn || state.activeReasoning
    || !state.toolRuns.isEmpty || state.taskCount > 0
  {
    return .working
  }
  return .idle
}

/// The first blocker's kind: a permission outranks the rest, as the monitor
/// lists it first.
public func agentBlockerKind(_ state: AgentRuntimeState?) -> AgentBlockerKind? {
  guard let state else { return nil }
  if !state.permissions.isEmpty { return .permission }
  return state.blockers.first?.kind
}

/// The radius a body takes: the status's, and for a working body its place
/// among the working sessions by tokens — from the working size for the least
/// to the largest size for the most (RFC 005's drawn states).
public func bodyRadius(status: AgentVisualStatus, share: Double, parameters: SwarmParameters) -> Double {
  switch status {
  case .idle: return parameters.radiusIdle
  case .blocked: return parameters.radiusBlocked
  case .working:
    let clamped = max(0, min(1, share))
    return parameters.radiusWorking + (parameters.radiusWorkingMax - parameters.radiusWorking) * clamped
  }
}

/// The one-line truth under the project name: what the agent is waiting on
/// when it is, else what it is doing, else the status.
public func agentDetail(_ state: AgentRuntimeState?, status: AgentVisualStatus) -> String {
  guard let state else { return "starting" }
  if status == .blocked {
    if let tool = state.permissions.first?.tool { return "permission · \(tool)" }
    if !state.permissions.isEmpty { return "permission required" }
    switch state.blockers.first?.kind {
    case .question: return "question"
    case .failure: return "failed"
    case .permission, nil: return "blocked"
    }
  }
  if let tool = state.toolRuns.first { return tool.title ?? "using tool" }
  if state.activeReasoning { return "thinking" }
  if state.activeTurn { return "responding" }
  return status.rawValue
}

/// Desktop `classifyTerminalStatus`: a peer reports terminal activity, not
/// agent state, and `foreground-job` is the only kind that means work.
///
/// It can never return `.blocked`. That word means an agent is asking the user
/// for something, and a terminal has no agent to ask, so a remote bubble is a
/// hollow at rest or a hollow with a comet and never the lit body. The desktop
/// says this in its return type (`Exclude<AgentVisualStatus, "blocked">`);
/// Swift can only say it here.
public func classifyTerminalStatus(_ activityKind: String?) -> AgentVisualStatus {
  activityKind == "foreground-job" ? .working : .idle
}

/// Desktop `folderName`: the final path component, for bubbles and badges.
///
/// Ported clause for clause, because each one is load-bearing: trailing
/// separators are stripped BEFORE the split (so `/a/b/` is `b`, not the
/// fallback), both separators are honored (a peer may be a Windows host), and
/// an empty result falls through to the fallback rather than rendering a
/// bubble with a blank headline. The trim is the whole string's, exactly as in
/// JS — a component's own inner padding survives, which is what the original
/// does and what its callers have always been fed.
public func folderName(_ path: String?, fallback: String) -> String {
  var normalized = path?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  while let last = normalized.last, last == "/" || last == "\\" { normalized.removeLast() }
  let component =
    normalized.split(omittingEmptySubsequences: false) { $0 == "/" || $0 == "\\" }.last ?? ""
  return component.isEmpty ? fallback : String(component)
}

/// The July identity hue (desktop `agentColor`, FNV-1a over UTF-16 code units
/// in signed 32-bit arithmetic, `abs(hash) % 360`). The FIELD no longer reads
/// it — record §02 deals a project's colour instead (D-i16) — and it stays
/// only for the card header until that chrome is re-skinned; it goes, with its
/// goldens, with its last reader.
public func agentIdentityHue(_ id: String) -> Int {
  guard !id.isEmpty else { return Int(UInt32(2_166_136_261) % 360) }
  var hash = Int32(bitPattern: 2_166_136_261)
  for unit in id.utf16 {
    hash ^= Int32(unit)
    hash = hash &* 16_777_619
  }
  return Int(Int64(hash).magnitude % 360)
}
