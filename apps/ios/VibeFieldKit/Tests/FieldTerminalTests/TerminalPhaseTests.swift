import GhostteaTruffle
import Testing

@testable import FieldTerminal

@Suite struct TerminalPhaseMappingTests {
  /// Both dial-shaped states render as connecting: someone is actively
  /// dialing in each, unlike `suspended`, where dialing deliberately stopped.
  @Test func dialingStatesAreConnecting() {
    #expect(TerminalAttachment.phase(for: .opening) == .connecting)
    #expect(TerminalAttachment.phase(for: .synchronizing) == .connecting)
    #expect(
      TerminalAttachment.phase(for: .reconnecting(attempt: 3, nextRetryMs: 500)) == .connecting)
    #expect(TerminalAttachment.phase(for: .live) == .live)
  }

  /// Every rest carries its reason — nothing becomes idle on its own.
  @Test func suspensionsSayWhy() {
    #expect(
      TerminalAttachment.phase(for: .suspended(.hostAbsent))
        == .suspended("host absent — reconnects when it returns"))
    #expect(
      TerminalAttachment.phase(for: .suspended(.suspendedByApp))
        == .suspended("paused in the background"))
    #expect(
      TerminalAttachment.phase(for: .suspended(.accessDenied))
        == .suspended("the host refused this device"))
  }

  @Test func endingsSayWhy() {
    #expect(
      TerminalAttachment.phase(for: .ended(.sessionClosed))
        == .ended("session closed on the host"))
    #expect(TerminalAttachment.phase(for: .ended(.sessionExited)) == .ended("process exited"))
    #expect(
      TerminalAttachment.phase(for: .ended(.sessionExited), exitCode: 137)
        == .ended("process exited (code 137)"))
    #expect(
      TerminalAttachment.phase(for: .ended(.sessionUnavailable))
        == .ended("session unavailable — the host could not say why"))
    #expect(
      TerminalAttachment.phase(for: .ended(.hostRestarted)) == .ended("the host restarted"))
    #expect(TerminalAttachment.phase(for: .ended(.hostShutdown)) == .ended("the host shut down"))
    #expect(
      TerminalAttachment.phase(for: .ended(.closedLocally)) == .ended("closed from this device"))
  }

  /// The exit code belongs to `sessionExited` alone; it must not leak into
  /// other endings' reasons.
  @Test func exitCodeOnlyDecoratesSessionExited() {
    #expect(
      TerminalAttachment.phase(for: .ended(.hostShutdown), exitCode: 1)
        == .ended("the host shut down"))
    #expect(
      TerminalAttachment.phase(for: .suspended(.hostAbsent), exitCode: 1)
        == .suspended("host absent — reconnects when it returns"))
  }
}

@Suite struct InputRejectionNoticeTests {
  /// §4.3's visible half: every refusal reason has one honest line.
  @Test func everyReasonHasALine() {
    #expect(
      TerminalAttachment.notice(for: .notLive) == "keystroke dropped — the session is not live")
    #expect(
      TerminalAttachment.notice(for: .readOnly)
        == "view-only — the host has not granted write access")
    #expect(TerminalAttachment.notice(for: .writeFailed) == "keystroke did not land — reconnecting")
    #expect(TerminalAttachment.notice(for: .noControl) == "take control before resizing")
    #expect(
      TerminalAttachment.notice(for: .attachmentEnded)
        == "the connection dropped before the host answered")
  }
}
