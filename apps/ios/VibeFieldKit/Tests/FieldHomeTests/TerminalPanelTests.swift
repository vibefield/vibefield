import CoreGraphics
import Testing

@testable import FieldHome

/// PF-9 (2026-11-22; DESIGN.md §8 "The card's glass is the field") — a
/// session's card stands in the phone's own panel. These are the panel's
/// rules: where its top edge stands, what a pull does, and the home's blur.
@Suite("PF-9 — the card's panel")
struct TerminalPanelTests {
  @Test("a card is its terminal when its face is the session's and its slot is live")
  func whenACardIsItsTerminal() {
    // attached, or a run that offers its terminal
    #expect(
      FieldHomeModel.cardIsLive(
        hasSubject: true, listed: true, attached: true, remote: false, agentAttachable: false))
    #expect(
      FieldHomeModel.cardIsLive(
        hasSubject: true, listed: true, attached: false, remote: false, agentAttachable: true))
    // attached and no longer listed: the attachment still speaks
    #expect(
      FieldHomeModel.cardIsLive(
        hasSubject: true, listed: false, attached: true, remote: true, agentAttachable: false))
    // nothing to open: a reason, or a peer's facts
    #expect(
      !FieldHomeModel.cardIsLive(
        hasSubject: true, listed: true, attached: false, remote: false, agentAttachable: false))
    #expect(
      !FieldHomeModel.cardIsLive(
        hasSubject: true, listed: true, attached: false, remote: true, agentAttachable: false))
    // the session left the field with nothing attached: the ended face, even if its run offered a terminal
    #expect(
      !FieldHomeModel.cardIsLive(
        hasSubject: true, listed: false, attached: false, remote: false, agentAttachable: true))
    #expect(
      !FieldHomeModel.cardIsLive(
        hasSubject: false, listed: true, attached: false, remote: false, agentAttachable: true))
  }

  @Test("a terminal's card stands at the status bar's foot; any other stands at 55% of the room")
  func whereTheTopEdgeStands() {
    #expect(FieldHomeModel.livePanelTop(isTerminal: true, room: 759) == 0)
    #expect(FieldHomeModel.livePanelShortShare == 0.55)
    let top = FieldHomeModel.livePanelTop(isTerminal: false, room: 760)
    #expect(abs(top - 342) < 0.001)
    // a room not yet measured asks for nothing
    #expect(FieldHomeModel.livePanelTop(isTerminal: false, room: -10) == 0)
  }

  @Test("a pull moves the panel down with the finger, and never up")
  func aPullMovesItDown() {
    #expect(FieldHomeModel.livePanelPull(translation: 0) == 0)
    #expect(FieldHomeModel.livePanelPull(translation: 120) == 120)
    #expect(FieldHomeModel.livePanelPull(translation: -80) == 0)
  }

  @Test("let go past a quarter of the panel's height, or thrown past half of it, the panel leaves")
  func whenAPullCloses() {
    let height: CGFloat = 800
    #expect(!FieldHomeModel.livePanelCloses(pull: 60, predicted: 90, height: height))
    #expect(!FieldHomeModel.livePanelCloses(pull: 200, predicted: 200, height: height))
    #expect(FieldHomeModel.livePanelCloses(pull: 201, predicted: 201, height: height))
    // a short pull thrown downward
    #expect(FieldHomeModel.livePanelCloses(pull: 60, predicted: 401, height: height))
    #expect(!FieldHomeModel.livePanelCloses(pull: 60, predicted: 400, height: height))
    // pulled down and thrown back up: it returns
    #expect(!FieldHomeModel.livePanelCloses(pull: 150, predicted: -200, height: height))
    // a height not yet measured closes nothing
    #expect(!FieldHomeModel.livePanelCloses(pull: 500, predicted: 900, height: 0))
  }

  @Test("the home's blur is what the person set under a standing panel, eases with the pull, and is nothing with none")
  func theHomesBlur() {
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: false, pull: 0, height: 800) == 0)
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: false, pull: 300, height: 800) == 0)
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: true, pull: 0, height: 800) == 24)
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: true, pull: 400, height: 800) == 12)
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: true, pull: 800, height: 800) == 0)
    // past the foot it stays at nothing, and a height not yet measured keeps it whole
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: true, pull: 1200, height: 800) == 0)
    #expect(FieldHomeModel.livePanelBlur(full: 24, standing: true, pull: 100, height: 0) == 24)
    // the desk's own 40, and sharp: the home is given no blur at all, standing or pulled
    #expect(FieldHomeModel.livePanelBlur(full: 40, standing: true, pull: 400, height: 800) == 20)
    #expect(FieldHomeModel.livePanelBlur(full: 0, standing: true, pull: 0, height: 800) == 0)
    #expect(FieldHomeModel.livePanelBlur(full: 0, standing: true, pull: 400, height: 800) == 0)
    // a figure below nothing is nothing
    #expect(FieldHomeModel.livePanelBlur(full: -8, standing: true, pull: 0, height: 800) == 0)
  }

  @Test("the figures: 40pt corners, a 36 by 5 grabber 6 down at 28%, 420ms on the island curve, a 200ms fade")
  func theFigures() {
    #expect(FieldHomeModel.livePanelCorner == 40)
    #expect(FieldHomeModel.livePanelGrabber == CGSize(width: 36, height: 5))
    #expect(FieldHomeModel.livePanelGrabberTop == 6)
    #expect(FieldHomeModel.livePanelGrabberInk == 0.28)
    #expect(FieldHomeModel.livePanelTravel == 0.42)
    #expect(FieldHomeModel.livePanelFade == 0.2)
  }
}
