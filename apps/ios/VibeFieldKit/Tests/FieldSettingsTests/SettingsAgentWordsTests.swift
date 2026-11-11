import FieldSettings
import Testing

/// IOS-10c — the words under an agent on the home desktop's page (DESIGN.md §8 "The phone's Settings", amended
/// 2026-11-11; ‹draft› for James).
@Suite("an agent's sign-ins, in the page's words")
struct SettingsAgentWordsTests {
  private func agent(_ profiles: [SettingsAgent.Profile]) -> SettingsAgent {
    SettingsAgent(id: "claude", name: "Claude Code", mark: "claude", profiles: profiles)
  }

  @Test("one profile says its word; several say each name with its word; none says not signed in")
  func signIns() {
    #expect(SettingsModel.agentSignIns(agent([])) == "Not signed in")
    #expect(SettingsModel.agentSignIns(agent([.init(label: "Work", signIn: .signedIn)])) == "Signed in")
    #expect(SettingsModel.agentSignIns(agent([.init(label: "Work", signIn: .signingIn)])) == "Signing in…")
    #expect(SettingsModel.agentSignIns(agent([.init(label: "Work", signIn: .notSignedIn)])) == "Not signed in")
    #expect(SettingsModel.agentSignIns(agent([.init(label: "Work", signIn: .notRead)])) == "Not read yet")
    #expect(
      SettingsModel.agentSignIns(
        agent([.init(label: "Work", signIn: .signedIn), .init(label: "Personal", signIn: .notSignedIn)]))
        == "Work signed in · Personal not signed in")
  }

  @Test("the section's head and foot")
  func headAndFoot() {
    #expect(SettingsWords.agentsHead == "Agents")
    #expect(SettingsWords.agentsFoot == "Sign in and manage agents on this desktop.")
  }
}
