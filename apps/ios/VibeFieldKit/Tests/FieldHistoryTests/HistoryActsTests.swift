import Foundation
import Testing

@testable import FieldHistory

/// PJ-7 (Q3 (a); TP §5) — a session's act on the phone: Jump to when the
/// field holds its run (joined by the conversation's native id), Resume when
/// it ended and its own desktop answers and offers it, the reason when that
/// desktop sleeps, and nothing when the agent cannot resume. A refused Resume
/// is said in words.
@Suite("PJ-7 — Resume and Jump to")
struct HistoryActsTests {
  private func session(live: Bool = false, native: String? = "n-1", provider: String? = "claude") -> HistorySession {
    HistorySession(
      id: "s1", projectId: "p", title: "t", agent: "claude", meta: "", branch: "", last: live ? "now" : "2h",
      device: "dev-1", deviceName: "studio", folder: "vibe-field", provider: provider, nativeSessionId: native)
  }

  @Test("the field holds its run: Jump to, whatever else is true")
  func jump() {
    #expect(FieldHistoryModel.sessionAct(session(), inField: true, desktopAwake: false, canResume: false) == .jump)
    #expect(FieldHistoryModel.sessionAct(session(live: true), inField: true, desktopAwake: true, canResume: true) == .jump)
  }

  @Test("an ended session: Resume when its own desktop answers and offers it; asleep said; else absent")
  func resume() {
    #expect(FieldHistoryModel.sessionAct(session(), inField: false, desktopAwake: true, canResume: true) == .resume)
    #expect(FieldHistoryModel.sessionAct(session(), inField: false, desktopAwake: false, canResume: true) == .why("asleep"))
    #expect(FieldHistoryModel.sessionAct(session(), inField: false, desktopAwake: true, canResume: false) == nil)
    #expect(FieldHistoryModel.sessionAct(session(), inField: false, desktopAwake: true, canResume: nil) == nil)
    #expect(FieldHistoryModel.sessionAct(session(native: nil), inField: false, desktopAwake: true, canResume: true) == nil)
    #expect(
      FieldHistoryModel.sessionAct(session(live: true), inField: false, desktopAwake: true, canResume: true) == nil,
      "moving per the index with no run of ours: no act, its last word stands")
  }

  @Test("a refused Resume, in words")
  func refusals() {
    func words(_ kind: String, reason: String? = nil, state: String? = nil) -> String {
      FieldHistoryModel.resumeRefusal(
        kind: kind, reason: reason, state: state, message: "fieldd's own sentence", desktop: "studio", agent: "Claude Code")
    }
    #expect(words("UNAVAILABLE") == "studio is asleep")
    #expect(words("TIMEOUT") == "studio is asleep")
    #expect(words("PRECONDITION_FAILED", reason: "missing-cwd") == "The folder is gone")
    #expect(words("PRECONDITION_FAILED", state: "signed-out") == "Signed out of Claude Code on studio")
    #expect(words("PRECONDITION_FAILED", reason: "other-profile") == "Held under another profile on studio")
    #expect(words("NOT_FOUND", reason: "unknown-conversation") == "studio does not know this conversation")
    #expect(words("INTERNAL") == "fieldd's own sentence")
  }
}
