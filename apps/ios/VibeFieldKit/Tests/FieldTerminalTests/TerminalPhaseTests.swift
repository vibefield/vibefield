import FieldProduct
import Testing

@testable import FieldRoutedTerminal
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

  @Test func aSessionThatHasPresentedStaysLiveThroughAReseed() {
    // Past its first frame a session is live: a reseed (a resize, a repair)
    // holds INPUT until the scene catches up, but the screen is up. Reading it
    // as connecting hid the input card and raised a status line on every
    // resize, and each of those re-laid the pane into the next one — the
    // phone's terminal tab jumping up and down (James, 2026-10-17).
    #expect(TerminalAttachment.phase(for: .attached, session: nil, presented: true) == .live)
    #expect(TerminalAttachment.phase(for: .attached, session: nil, presented: false) == .connecting)
  }

  @Test func aCellThatStoppedPresentingIsSaidAndNotLive() throws {
    // Live through a reseed is not live through a stop: a cell that stopped
    // presenting this viewer has ended its pump, and nothing restarts it — a
    // `.live` there was a frozen screen with no word (the scroll audit,
    // 2026-10-17). The phase says it, and its banner offers RETRY.
    var session = RoutedSessionState(sessionId: "s", activationId: "a")
    session.control = .attached
    session.status = try RoutedActivationStatus(
      json: .object([
        "sessionId": .string("s"), "activationId": .string("a"),
        "cellStatusSequence": .int(1), "leaseTtlMs": .int(6_000),
        "presentation": .object(["state": .string("stopped"), "reason": .string("overload")]),
        "input": .object(["state": .string("suspended"), "reason": .string("overload")]),
      ]))
    #expect(
      TerminalAttachment.phase(for: .attached, session: session, presented: true)
        == .suspended("this screen stopped updating — the desktop said overload"))
  }

  @Test func aRunTheCellSaidExitedIsEndedWithItsFacts() {
    // The audit's P8 (2026-10-17): the cell's `exited` went to a queue no one
    // drained, so a run that had exited read live and took keys into nothing.
    // Its facts end the card while the legs are still up — and after the
    // removal ends the activation, the run's words stay rather than "removed".
    var session = RoutedSessionState(sessionId: "s", activationId: "a")
    session.control = .attached
    session.exit = RoutedSessionExit(
      code: 1, signal: nil, requestedTermination: nil, outcome: "completed")
    #expect(
      TerminalAttachment.phase(for: .attached, session: session, presented: true, device: "studio")
        == .ended("its run exited on studio with code 1"))
    #expect(session.inputHeldBecause == "the run exited — completed")
    session.control = .ended(reason: "removed")
    #expect(
      TerminalAttachment.phase(for: .attached, session: session, presented: true, device: "studio")
        == .ended("its run exited on studio with code 1"))

    let words = { (exit: RoutedSessionExit) in
      TerminalAttachment.runEndedWords(device: "studio", exit: exit)
    }
    #expect(
      words(.init(code: 0, signal: nil, requestedTermination: nil, outcome: "completed"))
        == "its run exited on studio")
    #expect(
      words(.init(code: nil, signal: "SIGTERM", requestedTermination: "kill", outcome: "killed"))
        == "its run on studio was ended by SIGTERM")
    // The floor knows it ended and not how: said so, never an invented code.
    #expect(
      words(.init(code: nil, signal: nil, requestedTermination: nil, outcome: "unknown"))
        == "its run ended on studio")
  }

  @Test func aSessionTheDoorNoLongerHasIsEndedByTheDesktopsName() {
    // 2026-10-19: the floor was respawned under a live card, and the card said
    // nothing for three hours. The client ends the session with its reason code;
    // the card says it by the desktop's name, with no RETRY, since nothing is
    // left to attach to. Why is said when the door said it first (its cell gone).
    var session = RoutedSessionState(sessionId: "s", activationId: "a")
    session.control = .ended(reason: RoutedTerminalClient.notFoundReason)
    #expect(
      TerminalAttachment.phase(for: .reconnecting, session: session, device: "studio")
        == .ended("studio no longer has it"))
    session.control = .ended(reason: RoutedTerminalClient.cellGoneReason)
    let phase = TerminalAttachment.phase(for: .reconnecting, session: session, device: "studio")
    #expect(phase == .ended("studio's terminal engine restarted"))
    let banner = TerminalAttachment.banner(for: phase, device: "studio", doorRefusal: nil)
    #expect(banner?.title == "this session ended — studio's terminal engine restarted")
    #expect(banner?.actions == [.backToTheField])
    // An unnamed desktop is "that desktop"; every other reason is the client's
    // own word, as it was.
    #expect(
      TerminalAttachment.endedWords(RoutedTerminalClient.notFoundReason, device: nil)
        == "that desktop no longer has it")
    #expect(TerminalAttachment.endedWords("removed", device: "studio") == "removed")
  }

  @Test func anAttachRefusalIsItsSessionsWhileTheLegsStand() {
    // P5 (2026-10-17): the refusal lives on the SESSION — the set's state is
    // every card's on the lane — and it is said while the legs stand. Once
    // they are gone, the set's own state is the news.
    var session = RoutedSessionState(sessionId: "s", activationId: "a")
    session.control = .refused(code: "SESSION_NOT_FOUND", retryable: false)
    #expect(
      TerminalAttachment.phase(for: .attached, session: session) == .refused("SESSION_NOT_FOUND"))
    #expect(
      TerminalAttachment.phase(for: .ready, session: session) == .refused("SESSION_NOT_FOUND"))
    #expect(
      TerminalAttachment.phase(for: .failed(reason: "no route"), session: session)
        == .failed("no route"))
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

  /// A live session whose WRITE grant ran out is the one banner about an ACT
  /// rather than a state to wait out (TM-r3, K-M1). Nothing renews an attach
  /// grant on this phone, so a long session reaches this and used to show
  /// nothing at all: presentation continues, the phase stays `.live`, and the
  /// only sign was a keystroke going quietly nowhere.
  @Test func aLiveSessionWhoseWriteGrantRanOutNamesTheAct() throws {
    let banner = try #require(
      TerminalAttachment.banner(
        for: .live, device: "studio", doorRefusal: nil, writeGrantExpired: true))
    #expect(
      banner.title
        == "input has closed — studio is still showing this session but not taking keystrokes")
    #expect(banner.detail == "the write grant ran out. reattach to type again.")
    // `retryNow` IS the act: it re-mints and re-attaches, which is what a
    // renewal would do without the round trip.
    #expect(banner.actions.contains(.retryNow))
    #expect(banner.actions.contains(.backToTheField))
    // …and it does NOT cool the terminal. The scene is still advancing; only
    // typing stopped, and dimming the pane would say the opposite.
    #expect(!banner.coolsTerminal)
  }

  /// It speaks for the LIVE phase alone. Every other phase already has a face,
  /// and an idle card has no session to hold a grant for.
  @Test func anExpiredWriteGrantOnlySpeaksForALiveSession() {
    #expect(
      TerminalAttachment.banner(
        for: .idle, device: "studio", doorRefusal: nil, writeGrantExpired: true) == nil)
    #expect(
      TerminalAttachment.banner(
        for: .connecting, device: "studio", doorRefusal: nil, writeGrantExpired: true) == nil)
    let ended = TerminalAttachment.banner(
      for: .ended("process exited"), device: "studio", doorRefusal: nil, writeGrantExpired: true)
    #expect(ended?.title == "this session ended — process exited")
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

  @Test func aGoneCellIsTheSessionGoneAndSaysSo() {
    // TC-S3: the cell that held the session is gone, and the session with it.
    #expect(
      TerminalAttachment.doorWords(unavailable("cell_gone"), device: "studio")
        == "studio's terminal engine restarted, and this session went with it")
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

  @Test func anUnlinkedDesktopSaysWhyItCannotVouchAndWhereToFixIt() {
    // fieldd's TM-r10 refusal, reaching a face. `doorsFor` turns down a tailnet
    // principal whose `self` is not true instead of handing out its own
    // loopback ticket, and the default arm below degraded that to the bare
    // state word. It is the one refusal in this set a person can FIX, and the
    // fix is on the OTHER machine — so the sentence carries the act, which
    // `retryNow` cannot: retrying changes nothing until the desktop is linked.
    #expect(
      TerminalAttachment.doorWords(unavailable("device_not_linked"), device: "studio")
        == "studio is not linked to an account yet, so it cannot tell who you are — "
          + "link it on the desktop")
    // …and it names the machine, or degrades to the family's own words for one
    // it cannot name, exactly like its siblings.
    #expect(
      TerminalAttachment.doorWords(unavailable("device_not_linked"), device: nil)
        == "that desktop is not linked to an account yet, so it cannot tell who you are — "
          + "link it on the desktop")
    // A SENTENCE, not the state word leaking through the default arm.
    #expect(
      !TerminalAttachment.doorWords(unavailable("device_not_linked"), device: "studio")
        .contains("device_not_linked"))
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
