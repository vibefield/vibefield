import FieldTerminal
import Testing

@testable import FieldInput

/// Every user act on the card leaves as one `InputAct` through one sink, and
/// that is what makes the card testable with no mesh, no simulator and no
/// Ghosttea import. These are the acts, recorded.
@MainActor
@Suite("the input card's acts")
struct InputActTests {

  /// A model with its sink wired to a recorder — the host's job, done by a
  /// test instead.
  private func card() -> (InputCardModel, Recorder) {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    return (model, recorder)
  }

  final class Recorder {
    var acts: [InputAct] = []
  }

  // MARK: - Send

  @Test("a draft leaves as one act and the field is cleared")
  func sendsTheDraft() {
    let (model, recorder) = card()
    model.draft = "git status"
    model.tapSend()
    #expect(recorder.acts == [.sendDraft("git status")])
    #expect(model.draft.isEmpty)
  }

  /// Send is never disabled (D-i6). With nothing typed the act still happens —
  /// the attachment turns an empty draft into Enter alone, which is what
  /// "run it" means at a bare prompt.
  @Test("an empty draft still sends")
  func emptySends() {
    let (model, recorder) = card()
    model.tapSend()
    #expect(recorder.acts == [.sendDraft("")])
  }

  /// A draft of spaces is a draft the user typed. Trimming it would silently
  /// turn a deliberate `"  "` into Enter.
  @Test("whitespace is a draft, not an empty one")
  func whitespaceIsADraft() {
    let (model, recorder) = card()
    model.draft = "   "
    model.tapSend()
    #expect(recorder.acts == [.sendDraft("   ")])
  }

  // MARK: - Rail keys

  @Test("a rail key with no latch carries no modifiers")
  func plainRailKey() {
    let (model, recorder) = card()
    model.tapKey(.escape)
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.escape))])
  }

  @Test("a rail key under an armed latch carries control and un-arms")
  func armedRailKey() {
    let (model, recorder) = card()
    model.tapControl()
    #expect(model.latch.phase == .armed)
    model.tapKey(.arrowUp)
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.arrowUp, modifiers: .control))])
    #expect(model.latch.phase == .off)
  }

  @Test("a rail key under a locked latch carries control and stays locked")
  func lockedRailKey() {
    let (model, recorder) = card()
    model.tapControl()
    model.tapControl()
    model.tapKey(.tab)
    model.tapKey(.tab)
    #expect(
      recorder.acts == [
        .keystroke(TerminalKeystroke(.tab, modifiers: .control)),
        .keystroke(TerminalKeystroke(.tab, modifiers: .control)),
      ])
    #expect(model.latch.phase == .locked)
  }

  // MARK: - The typed character

  /// `Ctrl` then `c` is `^C`, and the `c` must not ALSO reach the draft —
  /// which is what the composer field's `false` return depends on.
  @Test("an armed latch turns a typed character into a keystroke")
  func interceptsWhileArmed() {
    let (model, recorder) = card()
    model.tapControl()
    #expect(model.interceptCharacter("c"))
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.character("c"), modifiers: .control))])
    #expect(model.latch.phase == .off)
  }

  @Test("a locked latch keeps intercepting")
  func interceptsWhileLocked() {
    let (model, _) = card()
    model.tapControl()
    model.tapControl()
    #expect(model.interceptCharacter("x"))
    #expect(model.interceptCharacter("s"))
    #expect(model.latch.phase == .locked)
  }

  /// With no latch the character is the field's, and nothing is emitted —
  /// otherwise every letter typed would also be a keystroke.
  @Test("with no latch the character stays in the draft")
  func passesThroughWhenOff() {
    let (model, recorder) = card()
    #expect(model.interceptCharacter("c") == false)
    #expect(recorder.acts.isEmpty)
  }

  // MARK: - Modes

  @Test("the mode toggles and the draft survives the trip")
  func modeKeepsTheDraft() {
    let (model, recorder) = card()
    model.draft = "half a command"
    model.toggleMode()
    #expect(model.mode == .live)
    #expect(model.draft == "half a command")
    model.toggleMode()
    #expect(model.mode == .draft)
    #expect(model.draft == "half a command")
    // Toggling is a local act: nothing is sent to the terminal by changing
    // which keyboard owner is typing into it.
    #expect(recorder.acts.isEmpty)
  }

  /// One keyboard, one responder: the composer wants it in Draft and gives it
  /// up in the other mode, where the terminal itself is the text input.
  @Test("only one responder wants the keyboard at a time")
  func focusFollowsTheMode() {
    let (model, _) = card()
    model.toggleMode()
    #expect(model.fieldFocused == false)
    model.toggleMode()
    #expect(model.fieldFocused)
  }

  /// A draft belongs to the session it was typed for, and a latch left locked
  /// must not modify the first key of the next card.
  @Test("closing the card resets everything the next one would inherit")
  func resetClearsTheCard() {
    let (model, _) = card()
    model.draft = "secret"
    model.toggleMode()
    model.tapControl()
    model.reset()
    #expect(model.draft.isEmpty)
    #expect(model.mode == .draft)
    #expect(model.latch.phase == .off)
    #expect(model.fieldFocused == false)
  }

  /// The expiry the model's own clock would fire, called directly rather than
  /// waited out.
  @Test("the arm window releases the latch")
  func expiryReleasesTheArm() {
    let (model, _) = card()
    model.tapControl()
    model.latchExpired()
    #expect(model.latch.phase == .off)
  }

  /// A card with no host is not a broken card — the demo fixture is exactly
  /// this, and it must not trap.
  @Test("a card with no sink still takes taps")
  func silentWithoutASink() {
    let model = InputCardModel()
    model.draft = "nowhere to go"
    model.tapSend()
    model.tapKey(.escape)
    #expect(model.draft.isEmpty)
  }

  // MARK: - The latch in Live mode (IOS-5b)

  /// K-D3, stated as a test: one latch, and it means the same thing whichever
  /// responder holds the keyboard. The host hands this to the attachment, which
  /// calls it once per software-input event.
  @Test("the terminal spends an armed latch exactly once")
  func terminalSpendsTheArm() {
    let (model, _) = card()
    model.tapControl()
    #expect(model.takeLatchForTerminal() == .control)
    #expect(model.latch.phase == .off)
    #expect(model.takeLatchForTerminal() == [])
  }

  /// The other half of locking: `Ctrl-X Ctrl-S` typed on the system keyboard
  /// in Live mode is two keys under one lock, and the lock re-arms itself.
  @Test("the terminal keeps a locked latch")
  func terminalKeepsTheLock() {
    let (model, _) = card()
    model.tapControl()
    model.tapControl()
    #expect(model.takeLatchForTerminal() == .control)
    #expect(model.takeLatchForTerminal() == .control)
    #expect(model.latch.phase == .locked)
  }

  @Test("an idle latch hands the terminal nothing")
  func terminalGetsNothingWhenIdle() {
    let (model, _) = card()
    #expect(model.takeLatchForTerminal() == [])
  }

  // MARK: - The Meta burst

  /// One key, then gone — that is the whole difference between the burst and
  /// the latch, and the reason ESC needs no lock dot.
  @Test("the burst rides exactly one key")
  func burstRidesOneKey() {
    let (model, recorder) = card()
    model.armMeta()
    #expect(model.metaArmed)
    model.tapKey(.arrowLeft)
    model.tapKey(.arrowLeft)
    #expect(
      recorder.acts == [
        .keystroke(TerminalKeystroke(.arrowLeft, modifiers: .option)),
        .keystroke(TerminalKeystroke(.arrowLeft)),
      ])
    #expect(model.metaArmed == false)
  }

  /// The burst reaches the terminal's own keyboard by the same door the latch
  /// does — a Meta-armed letter typed in Draft is `Esc x` on the wire, not an
  /// `x` in the draft.
  @Test("the burst reaches both modes")
  func burstReachesBothModes() {
    let (live, _) = card()
    live.armMeta()
    #expect(live.takeLatchForTerminal() == .option)
    #expect(live.metaArmed == false)

    let (draft, recorder) = card()
    draft.armMeta()
    #expect(draft.interceptCharacter("x"))
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.character("x"), modifiers: .option))])
  }

  /// Independent windows: Ctrl can be locked while a burst is armed, and the
  /// key that follows carries both.
  @Test("the burst and the latch ride the same key")
  func burstAndLatchTogether() {
    let (model, recorder) = card()
    model.tapControl()
    model.tapControl()
    model.armMeta()
    model.tapKey(.arrowUp)
    #expect(
      recorder.acts == [.keystroke(TerminalKeystroke(.arrowUp, modifiers: [.control, .option]))])
    #expect(model.latch.phase == .locked)
    #expect(model.metaArmed == false)
  }

  @Test("the burst's window releases it")
  func burstExpires() {
    let (model, _) = card()
    model.armMeta()
    model.metaExpired()
    #expect(model.metaArmed == false)
  }

  // MARK: - Chords from the fan

  /// A chord names its own modifiers. Adding the latch's would give `^^C`, and
  /// picking HOME with Ctrl held would give Ctrl-Home — neither is what the
  /// finger asked for.
  @Test("a chord carries its own modifiers and no others")
  func chordCarriesItsOwn() {
    let (model, recorder) = card()
    model.tapChord(.control("c"))
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.character("c"), modifiers: .control))])
  }

  /// But an arm the fan already answered must not survive onto the next letter.
  @Test("a chord spends an armed latch and leaves a locked one")
  func chordSpendsTheArm() {
    let (armed, _) = card()
    armed.tapControl()
    armed.tapChord(.control("c"))
    #expect(armed.latch.phase == .off)

    let (locked, recorder) = card()
    locked.tapControl()
    locked.tapControl()
    locked.tapChord(TerminalKeystroke(.home))
    #expect(locked.latch.phase == .locked)
    // Home, not Ctrl-Home: the fan key said what it wanted.
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.home))])
  }

  /// The one modifier a chord does inherit: the burst is a one-shot on "the
  /// next keystroke", and a chord is a keystroke.
  @Test("the burst rides a chord")
  func burstRidesAChord() {
    let (model, recorder) = card()
    model.armMeta()
    model.tapChord(.shiftTab)
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.tab, modifiers: [.shift, .option]))])
    #expect(model.metaArmed == false)
  }

  /// A popover is a presentation, and a presentation can take the first
  /// responder with it. Closing the fan gives the keyboard back — and only if
  /// it was up, because raising one the user had put away is the opposite
  /// mistake and just as visible.
  @Test("closing a fan restores the keyboard it interrupted and never raises one")
  func fanRestoresTheKeyboard() {
    let (up, _) = card()
    up.fieldFocused = true
    up.showFan(.control)
    up.fieldFocused = false  // what a presentation taking the responder looks like
    up.closeFan()
    #expect(up.fieldFocused)
    #expect(up.openFan == nil)

    let (down, _) = card()
    down.showFan(.control)
    down.closeFan()
    #expect(down.fieldFocused == false)
  }

  /// A card being closed must hand nothing to the next one — including a fan
  /// left open and a burst left armed.
  @Test("closing the card clears the burst and the fan")
  func resetClearsTheBurstAndTheFan() {
    let (model, _) = card()
    model.armMeta()
    model.showFan(.control)
    model.reset()
    #expect(model.metaArmed == false)
    #expect(model.openFan == nil)
  }
}

/// The fans are a catalog, and a catalog with the wrong subtitle under the
/// wrong chord is wrong on a device and right in every screenshot of the rail.
@Suite("the long-press fans")
struct KeyFanTests {

  /// The design's ten chords, in its order, with its one-word subtitles.
  @Test("the chord fan is the design's two rows")
  func chordFan() {
    let fan = KeyFan.control
    #expect(fan.rows.count == 2)
    #expect(fan.rows.map(\.count) == [5, 5])
    #expect(fan.items.map(\.label) == ["^C", "^D", "^Z", "^R", "^L", "^U", "^W", "^A", "^E", "^K"])
    #expect(
      fan.items.map(\.subtitle) == [
        "interrupt", "eof", "suspend", "search", "clear",
        "kill-line", "kill-word", "home", "end", "kill-end",
      ])
    // No dedicated ^C key (decision 2) — this is the gesture that replaces it,
    // so interrupt is the first thing under the finger.
    #expect(fan.items.first?.act == .stroke(.control("c")))
  }

  /// What a screen reader hears instead of "caret C".
  @Test("every chord names itself for VoiceOver")
  func chordLabels() {
    #expect(KeyFan.control.items.first?.accessibilityLabel == "Control C, interrupt")
    #expect(KeyFan.control.items.last?.accessibilityLabel == "Control K, kill-end")
    #expect(KeyFan.escape.items.first?.accessibilityLabel == "Meta, one key")
    #expect(KeyFan.arrow(.arrowLeft)?.items.first?.accessibilityLabel == "Home")
  }

  /// Each arrow's far end, and nothing under the keys that have none.
  @Test("the arrows fan out to their far ends")
  func arrowFans() {
    #expect(KeyFan.arrow(.arrowLeft)?.items.first?.act == .stroke(TerminalKeystroke(.home)))
    #expect(KeyFan.arrow(.arrowRight)?.items.first?.act == .stroke(TerminalKeystroke(.end)))
    #expect(KeyFan.arrow(.arrowUp)?.items.first?.act == .stroke(TerminalKeystroke(.pageUp)))
    #expect(KeyFan.arrow(.arrowDown)?.items.first?.act == .stroke(TerminalKeystroke(.pageDown)))
    #expect(KeyFan.arrow(.tab) == nil)
    #expect(KeyFan.arrow(.escape) == nil)
  }

  /// ⇧Tab is `tab` + shift (the kit's usage 0x2b), and META arms rather than
  /// sends — the one item in any fan that is not a keystroke.
  @Test("tab fans to shift-tab and escape fans to the burst")
  func namedFans() {
    #expect(KeyFan.tab.items.first?.act == .stroke(TerminalKeystroke(.tab, modifiers: .shift)))
    #expect(KeyFan.escape.items.first?.act == .meta)
  }

  /// One fan open at a time: the card's popover binds on this id, so two fans
  /// sharing one would present each other's keys.
  @Test("every fan has its own identity")
  func distinctIdentities() {
    let ids = [
      KeyFan.control.id, KeyFan.escape.id, KeyFan.tab.id,
      KeyFan.arrow(.arrowLeft)?.id, KeyFan.arrow(.arrowRight)?.id,
      KeyFan.arrow(.arrowUp)?.id, KeyFan.arrow(.arrowDown)?.id,
    ].compactMap { $0 }
    #expect(ids.count == 7)
    #expect(Set(ids).count == 7)
  }
}
