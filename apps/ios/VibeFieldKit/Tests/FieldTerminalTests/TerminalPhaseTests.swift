import FieldProduct
import FieldRoutedTerminal
import Testing

@testable import FieldTerminal

/// The card's faces, decided without a simulator.
///
/// Every sentence a person can be shown about a terminal comes out of these
/// pure functions, which is why they are pure. The old mapping (upstream's
/// attachment phase → ours) went with the protocol that had one.
@Suite struct TerminalPhaseMappingTests {
  @Test func nothingOpenIsIdle() {
    #expect(TerminalAttachment.phase(for: .off, session: nil) == .idle)
  }

  @Test func dialingAndReadyAreBothConnecting() {
    #expect(TerminalAttachment.phase(for: .connecting, session: nil) == .connecting)
    // `ready` is BOTH LEGS ACCEPTED with nothing attached yet — still
    // connecting from a card's point of view, because there is nothing to show.
    #expect(TerminalAttachment.phase(for: .ready, session: nil) == .connecting)
  }

  @Test func attachedWithoutAPresentedSceneIsStillConnecting() {
    // The distinction TM-4's own witness was built on: attached is not
    // presenting. A card that said `live` here would claim a terminal over a
    // pane that has never been painted.
    #expect(TerminalAttachment.phase(for: .attached, session: nil) == .connecting)
  }

  @Test func reconnectingAndStaleRouteReadAsConnecting() {
    // Both are "somebody is actively getting this back", and the BANNER is
    // where the difference is said — a phase that spelled them apart would make
    // the card's primary line churn on transport news.
    #expect(TerminalAttachment.phase(for: .reconnecting, session: nil) == .connecting)
    #expect(TerminalAttachment.phase(for: .staleRoute, session: nil) == .connecting)
  }

  @Test func aRefusalKeepsTheCellsOwnWord() {
    #expect(
      TerminalAttachment.phase(for: .refused(code: "SEAT_HELD"), session: nil)
        == .refused("SEAT_HELD"))
  }

  @Test func aFailureKeepsItsReason() {
    #expect(
      TerminalAttachment.phase(for: .failed(reason: "no route"), session: nil)
        == .failed("no route"))
  }
}

@Suite struct TerminalBannerTests {
  @Test func aLiveOrIdleTerminalCarriesNoBanner() {
    #expect(TerminalAttachment.banner(for: .live, device: "studio", doorRefusal: nil) == nil)
    #expect(TerminalAttachment.banner(for: .idle, device: "studio", doorRefusal: nil) == nil)
    // Connecting is not news either: the card's own invitation says it.
    #expect(TerminalAttachment.banner(for: .connecting, device: "studio", doorRefusal: nil) == nil)
  }

  @Test func aRefusalPrefersTheDoorsWordsOverTheCells() {
    // The door's refusal is the more specific of the two and names the machine;
    // the cell's code is what stands when there is no door refusal to show.
    let withDoor = TerminalAttachment.banner(
      for: .refused("GRANT_INVALID"), device: "studio",
      doorRefusal: "studio is not publishing its terminal doors on the tailnet")
    #expect(withDoor?.title == "studio is not publishing its terminal doors on the tailnet")
    #expect(withDoor?.detail == nil)

    let cellOnly = TerminalAttachment.banner(
      for: .refused("GRANT_INVALID"), device: "studio", doorRefusal: nil)
    #expect(cellOnly?.title == "GRANT_INVALID")
    #expect(cellOnly?.detail == "studio turned this attach down.")
  }

  @Test func everyStaleFaceCoolsTheTerminalAndOffersTheField() {
    // The sink KEEPS the last scene — an honest stale face beats a blank one —
    // so every face that is not advancing has to say so, or the pane would look
    // live while nothing moves.
    let phases: [TerminalPhase] = [
      .suspended("paused in the background"), .refused("GRANT_INVALID"), .ended("exited"),
      .failed("no route"),
    ]
    for phase in phases {
      let banner = TerminalAttachment.banner(for: phase, device: "studio", doorRefusal: nil)
      #expect(banner?.coolsTerminal == true)
      #expect(banner?.actions.contains(.backToTheField) == true)
    }
  }

  @Test func anEndedSessionOffersNoRetry() {
    // Retrying an ended session would mint a ticket for a PTY that is gone. The
    // one act is leaving; RESUME belongs to the RUN and is the card's own.
    let banner = TerminalAttachment.banner(
      for: .ended("process exited"), device: "studio", doorRefusal: nil)
    #expect(banner?.actions == [.backToTheField])
    #expect(banner?.title == "this session ended — process exited")
  }

  @Test func anUnnamedDesktopIsNeverAULID() {
    let banner = TerminalAttachment.banner(
      for: .refused("GRANT_INVALID"), device: nil, doorRefusal: nil)
    #expect(banner?.detail == "that desktop turned this attach down.")
  }
}

@Suite struct TerminalDoorWordsTests {
  private func unavailable(_ state: String) -> FieldProductError {
    FieldProductError(
      kind: "UNAVAILABLE", message: "the daemon's own sentence", retryable: true,
      details: .object([
        "service": .string("terminal"), "state": .string(state),
      ]))
  }

  @Test func doorsNotPublishedIsASentenceAPersonCanActOn() {
    // TM-5's whole point: a desktop that answered its product door and is not
    // carrying its terminal doors onto the tailnet says exactly that, and never
    // shows a blank pane.
    #expect(
      TerminalAttachment.doorWords(unavailable("doors_not_published"), device: "studio")
        == "studio is not publishing its terminal doors on the tailnet")
  }

  @Test func transportNotLandedIsADifferentFactAndSaysSo() {
    // The two are never folded into one shrug: `doors_not_published` is about
    // this DEVICE's tailnet serve, `transport_not_landed` about the cell the
    // session lives in (fieldd's `terminal-service.ts` states the split).
    #expect(
      TerminalAttachment.doorWords(unavailable("transport_not_landed"), device: "studio")
        == "studio is serving this session without a routed door to dial")
  }

  @Test func anUnknownStateIsCarriedRatherThanSwallowed() {
    // Tolerant reader: a state this build has never heard of is still a word a
    // person can read, and inventing a friendlier one would hide the daemon's.
    #expect(
      TerminalAttachment.doorWords(unavailable("something_new"), device: nil)
        == "that desktop cannot hand out a ticket — something_new")
  }

  @Test func anUnavailableAboutAnotherServiceIsNotRewritten() {
    // Only the terminal's own states get terminal words. A degraded mesh or a
    // starting daemon is somebody else's sentence and is passed through.
    let error = FieldProductError(
      kind: "UNAVAILABLE", message: "the floor is still starting", retryable: true,
      details: .object(["service": .string("native"), "state": .string("starting")]))
    #expect(TerminalAttachment.doorWords(error, device: "studio") == "the floor is still starting")
  }

  @Test func anOrdinaryRefusalKeepsTheDoorsMessage() {
    let error = FieldProductError(
      kind: "FORBIDDEN_SCOPE", message: "terminal.attach is not in this token's scopes")
    #expect(
      TerminalAttachment.doorWords(error, device: "studio")
        == "terminal.attach is not in this token's scopes")
  }

  @Test func aRefusalWithNoMessageFallsBackToItsKind() {
    #expect(
      TerminalAttachment.doorWords(FieldProductError(kind: "INTERNAL", message: ""), device: "s")
        == "INTERNAL")
  }
}
