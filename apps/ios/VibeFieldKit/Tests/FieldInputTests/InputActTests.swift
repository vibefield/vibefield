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
}
