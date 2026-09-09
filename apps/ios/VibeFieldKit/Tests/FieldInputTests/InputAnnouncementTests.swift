import Testing

@testable import FieldInput

/// What the card says out loud, pinned.
///
/// These strings are the only description a screen reader gets of state this
/// card otherwise draws as a fill, and they are the kind of thing that rots
/// quietly: a rename that leaves "Control armed" saying "Ctrl on" costs nobody
/// a compile error and costs one reader the whole rail. The design names two of
/// them outright (§4's rail, §10's acceptance list), so they are pinned as
/// literals rather than compared against themselves.
@Suite("what the card announces")
struct InputAnnouncementTests {

  @Test("the latch says its three phases")
  func latchPhases() {
    #expect(InputAnnouncement.latch(.armed) == "Control armed")
    #expect(InputAnnouncement.latch(.locked) == "Control locked")
    // "Released" rather than "off": a third tap let something GO, which is a
    // different fact from a control that was never armed.
    #expect(InputAnnouncement.latch(.off) == "Control released")
  }

  /// The announcement and the key's own label agree in the two phases they
  /// share. A reader who armed Ctrl and then went looking for it must not find
  /// a button whose name contradicts what they just heard.
  @Test("the announcement and the label are the same words")
  func announcementMatchesLabel() {
    var latch = LatchState()
    latch.tap()
    #expect(InputAnnouncement.latch(latch.phase) == latch.accessibilityLabel)
    latch.tap()
    #expect(InputAnnouncement.latch(latch.phase) == latch.accessibilityLabel)
  }

  /// The hint says what the NEXT tap does, which is exactly what the label
  /// cannot say on a three-phase control.
  @Test("every phase's hint names the phase it leads to")
  func hints() {
    var latch = LatchState()
    #expect(latch.accessibilityHint == "Arms Control for the next key")
    latch.tap()
    #expect(latch.accessibilityHint == "Locks Control until you release it")
    latch.tap()
    #expect(latch.accessibilityHint == "Releases Control")
  }

  /// The copy rule from the design's decision table, which holds when the card
  /// is speaking as well as when it is drawing: the word "Live" never reaches a
  /// user, by eye or by ear. The mode announces what is HAPPENING.
  @Test("the mode announces itself without ever saying Live")
  func modeNeverSaysLive() {
    #expect(InputAnnouncement.mode(.live) == "Typing into terminal")
    #expect(InputAnnouncement.mode(.draft) == "Drafting")
    for spoken in [
      InputAnnouncement.mode(.live), InputAnnouncement.mode(.draft),
      InputAnnouncement.metaArmed, InputAnnouncement.keypad(true),
      InputAnnouncement.keypad(false), InputAnnouncement.latch(.armed),
      InputAnnouncement.latch(.locked), InputAnnouncement.latch(.off),
    ] {
      #expect(!spoken.lowercased().contains("live"))
    }
  }

  @Test("the keypad says which keyboard is up")
  func keypad() {
    #expect(InputAnnouncement.keypad(true) == "Terminal keys")
    #expect(InputAnnouncement.keypad(false) == "System keyboard")
  }

  /// The burst names its window. A one-shot modifier that announced only
  /// "Meta armed" would leave a reader believing it was a latch, which is the
  /// one thing it is not.
  @Test("the Meta burst says it is for one key")
  func meta() {
    #expect(InputAnnouncement.metaArmed == "Meta armed for the next key")
    #expect(InputAnnouncement.metaArmed.contains("next key"))
  }

  /// Spoken text, not screen copy: these are read aloud, so they are sentences
  /// rather than the card's own upper-case markings.
  @Test("nothing announced is shouted")
  func sentenceCase() {
    for spoken in [
      InputAnnouncement.latch(.armed), InputAnnouncement.latch(.locked),
      InputAnnouncement.latch(.off), InputAnnouncement.metaArmed,
      InputAnnouncement.mode(.live), InputAnnouncement.mode(.draft),
      InputAnnouncement.keypad(true), InputAnnouncement.keypad(false),
    ] {
      #expect(spoken != spoken.uppercased())
      #expect(!spoken.isEmpty)
    }
  }
}
