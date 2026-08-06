import Foundation
import SwarmPhysics

/// The three statuses the field ranks by (desktop `AgentVisualStatus`).
public enum AgentVisualStatus: String, Sendable {
  case idle
  case working
  case waiting
}

/// The styling tier a bubble wears. The desktop maps status → appearance
/// deliberately off-by-one: an idle agent still wears the calm `working`
/// tier, an actively working agent is *ignited* (working tier + particles),
/// and only permission-waiting agents get the biggest, loudest tier.
public enum AgentBubbleAppearance: String, Sendable {
  case idle
  case working
  case waiting
}

public struct AgentBubbleVisual: Sendable, Equatable {
  public let status: AgentVisualStatus
  public let appearance: AgentBubbleAppearance
  public let isIgnited: Bool
}

/// Desktop `classifyAgentStatus`, ported clause for clause.
/// nil return = the session has terminated and leaves the field.
public func classifyAgentStatus(_ state: AgentRuntimeState?) -> AgentVisualStatus? {
  guard let state else { return .working }
  if state.lifecycle == .exited || state.lifecycle == .failed { return nil }
  if !state.permissions.isEmpty { return .waiting }
  if state.lifecycle != .ready || state.activeTurn || state.activeReasoning
    || !state.toolRuns.isEmpty || state.taskCount > 0
  {
    return .working
  }
  return .idle
}

/// Desktop `agentBubbleVisualState` + `appearanceForVisualState`, fused.
public func bubbleVisual(for status: AgentVisualStatus) -> AgentBubbleVisual {
  switch status {
  case .idle: AgentBubbleVisual(status: status, appearance: .working, isIgnited: false)
  case .working: AgentBubbleVisual(status: status, appearance: .working, isIgnited: true)
  case .waiting: AgentBubbleVisual(status: status, appearance: .waiting, isIgnited: false)
  }
}

/// Desktop `radiusForStatus` keyed by the appearance tier.
public func bubbleRadius(for appearance: AgentBubbleAppearance, parameters: SwarmParameters)
  -> Double
{
  switch appearance {
  case .idle: parameters.radiusIdle
  case .working: parameters.radiusWorking
  case .waiting: parameters.radiusWaiting
  }
}

/// Desktop `agentDetail`: the one-line truth under the project name.
public func agentDetail(_ state: AgentRuntimeState?, status: AgentVisualStatus) -> String {
  guard let state else { return "starting" }
  if status == .waiting {
    if let tool = state.permissions.first?.tool { return "permission · \(tool)" }
    return "permission required"
  }
  if let tool = state.toolRuns.first { return tool.title ?? "using tool" }
  if state.activeReasoning { return "thinking" }
  if state.activeTurn { return "responding" }
  return status.rawValue
}

/// Desktop `classifyTerminalStatus`: a peer reports terminal activity, not
/// agent state, and `foreground-job` is the only kind that means work.
///
/// It can never return `.waiting`. That tier is agent-permission language —
/// something is asking the user to allow something — and a terminal has no
/// permissions to ask about, so a remote bubble is calm or ignited and never
/// the loud tier. The desktop says this in its return type
/// (`Exclude<AgentVisualStatus, "waiting">`); Swift can only say it here.
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

/// Desktop `agentColor`, exactly: FNV-1a over UTF-16 code units in signed
/// 32-bit arithmetic (`Math.imul` semantics), `abs(hash) % 360` as the hue.
/// JS quirk preserved: the seed is only truncated to Int32 by the first
/// bitwise op, so an empty id hashes from the raw 2166136261.
/// Cross-language goldens generated from the JS original pin this port.
public func agentIdentityHue(_ id: String) -> Int {
  guard !id.isEmpty else { return Int(UInt32(2_166_136_261) % 360) }
  var hash = Int32(bitPattern: 2_166_136_261)
  for unit in id.utf16 {
    hash ^= Int32(unit)
    hash = hash &* 16_777_619
  }
  return Int(Int64(hash).magnitude % 360)
}
