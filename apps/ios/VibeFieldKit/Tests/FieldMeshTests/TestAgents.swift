import FieldAgents

// Test files may name agent ids — R23b's literal lint reads product code only.
// These are the ids the rows in this target were written against, kept as the
// statics the kit itself no longer has (AC-5: `AgentModel.swift` names no
// agent). Declared in THIS test module, so no product code can reach them.
extension AgentProvider {
  static let claude = AgentProvider(rawValue: "claude")
  static let codex = AgentProvider(rawValue: "codex")
  static let grok = AgentProvider(rawValue: "grok")
  static let acp = AgentProvider(rawValue: "acp")
}
