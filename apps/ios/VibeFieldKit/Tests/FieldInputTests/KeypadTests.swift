import FieldTerminal
import Testing
import UIKit

@testable import FieldInput

/// The `⋯` keypad's state, which is the half of it a simulator cannot show.
@MainActor
@Suite("the terminal keypad")
struct KeypadTests {
  final class Recorder {
    var acts: [InputAct] = []
  }

  private func card() -> (InputCardModel, Recorder) {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = {
      recorder.acts.append($0)
      return true
    }
    return (model, recorder)
  }

  /// PF-16: Shortcuts leads the pages and is the one a fresh card opens.
  @Test("a fresh card has no keypad, and would open it on Shortcuts, the first of the three pages")
  func restingState() {
    let model = InputCardModel()
    #expect(model.keypadShown == false)
    #expect(model.keypadPage == .combos)
    #expect(KeypadPage.allCases == [.combos, .keys, .functions])
    #expect(KeypadPage.allCases.map(\.title) == ["Shortcuts", "Navigate", "Fn"])
  }

  @Test("the key toggles it")
  func toggle() {
    let model = InputCardModel()
    model.toggleKeypad()
    #expect(model.keypadShown)
    model.toggleKeypad()
    #expect(model.keypadShown == false)
  }

  /// The card must not collapse to its closed row while the keypad is up: the
  /// keyboard is not down, it has been replaced. It is the same answer in both
  /// modes even though the responder differs, which is why it is its own case
  /// rather than folded into the other two.
  @Test("the keypad counts as the keyboard, in both modes")
  func ownershipWithTheKeypadUp() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.setKeypad(true)
    #expect(model.keyboardOwner == .keypad)
    model.toggleMode()
    #expect(model.keyboardOwner == .keypad)
  }

  /// In Live the hidden host takes the keys OFF the Metal view (K-D5), so the
  /// card must stop claiming the terminal has them — or the surface would be
  /// asked to take back a keyboard it is about to lose.
  @Test("the terminal gives the keys up when the keypad rises in Live")
  func liveHandsOver() {
    let model = InputCardModel()
    model.toggleMode()
    #expect(model.terminalFocused)
    model.setKeypad(true)
    #expect(model.terminalFocused == false)
  }

  /// `abc` in Live gives the keyboard back through the same nonce the KEYBOARD
  /// chip uses: without a fresh request the surface would rightly skip an
  /// intent it already holds.
  @Test("abc gives the terminal the keyboard back, distinguishably")
  func abcRestoresLive() {
    let model = InputCardModel()
    model.toggleMode()
    model.setKeypad(true)
    let before = model.keyboardRequests
    model.setKeypad(false)
    #expect(model.terminalFocused)
    #expect(model.keyboardRequests == before + 1)
    #expect(model.keyboardOwner == .terminal)
  }

  @Test("abc in Draft leaves the composer holding the keyboard")
  func abcRestoresDraft() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.setKeypad(true)
    model.setKeypad(false)
    #expect(model.keyboardOwner == .composer)
  }

  /// The keypad rides a first responder, so putting the keyboard down takes it
  /// with it — a rail over a keypad nobody can see is the card lying.
  @Test("the swipe puts the keypad away too")
  func dismissClosesTheKeypad() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.setKeypad(true)
    model.dismissKeyboard()
    #expect(model.keypadShown == false)
    #expect(model.keyboardOwner == .none)
  }

  /// The design says the keypad remembers its last page. That memory is a
  /// preference and survives the card closing; the keypad itself does not.
  @Test("closing the card puts the keypad away and keeps the page")
  func resetKeepsThePage() {
    let model = InputCardModel()
    model.keypadPage = .functions
    model.setKeypad(true)
    model.reset()
    #expect(model.keypadShown == false)
    #expect(model.keypadPage == .functions)
  }

  @Test("a mode flip with the keypad up leaves the terminal without the keys")
  func modeFlipMindsTheKeypad() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.setKeypad(true)
    model.toggleMode()
    #expect(model.mode == .live)
    #expect(model.terminalFocused == false)
    #expect(model.keypadShown)
  }

  // MARK: - Symbols

  /// The design's own rule (§4): a symbol types into the draft, or goes
  /// through in Live.
  @Test("a symbol lands in the draft in Draft and sends nothing")
  func symbolIntoDraft() {
    let (model, recorder) = card()
    model.draft = "echo hello"
    model.typeSymbol("|")
    #expect(model.draft == "echo hello|")
    #expect(recorder.acts.isEmpty)
  }

  @Test("a symbol goes straight through in the other mode")
  func symbolThroughLive() {
    let (model, recorder) = card()
    model.toggleMode()
    model.typeSymbol("~")
    #expect(recorder.acts == [.typeText("~")])
    #expect(model.draft.isEmpty)
  }

  /// The latch outranks the page. `Ctrl` then a symbol is a control byte in
  /// either mode, and leaving the character in the draft would eat a modifier
  /// the user just armed.
  @Test("a latched symbol is a keystroke, not text")
  func latchedSymbol() {
    let (model, recorder) = card()
    model.tapControl()
    model.typeSymbol("\\")
    #expect(
      recorder.acts == [
        .keystroke(TerminalKeystroke(.character("\\"), modifiers: .control))
      ])
    #expect(model.draft.isEmpty)
    #expect(model.latch.phase == .off)
  }

  @Test("a Meta-armed symbol carries the burst")
  func metaArmedSymbol() {
    let (model, recorder) = card()
    model.armMeta()
    model.typeSymbol(".")
    #expect(
      recorder.acts == [
        .keystroke(TerminalKeystroke(.character("."), modifiers: .option))
      ])
    #expect(model.metaArmed == false)
  }
}

/// The `+` menu's state — the doors it opens, and the one it never does.
@MainActor
@Suite("the plus menu")
struct PlusMenuTests {

  @Test("opening and dismissing gives the keyboard back")
  func dismissRestoresTheKeyboard() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.showPlusMenu()
    #expect(model.plusMenuOpen)
    model.fieldFocused = false  // the popover took it
    model.closePlusMenu()
    #expect(model.plusMenuOpen == false)
    #expect(model.fieldFocused)
  }

  /// Picking an item does NOT raise the keyboard: a sheet is about to rise
  /// over this card, and a keyboard raised into it fights the presentation.
  @Test("picking an item leaves the keyboard down")
  func pickingLeavesItDown() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.showPlusMenu()
    model.fieldFocused = false
    model.closePlusMenu(restoringKeyboard: false)
    #expect(model.fieldFocused == false)
  }

  /// A card that never held the keyboard must not be given one by a menu
  /// closing — the same rule `closeFan` follows.
  @Test("a menu opened from a closed card leaves it closed")
  func closedCardStaysClosed() {
    let model = InputCardModel()
    model.showPlusMenu()
    model.closePlusMenu()
    #expect(model.fieldFocused == false)
  }

  @Test("closing the card closes every door")
  func resetClosesEverything() {
    let model = InputCardModel()
    model.showPlusMenu()
    model.surface = .snippets
    model.reset()
    #expect(model.plusMenuOpen == false)
    #expect(model.surface == nil)
  }

  /// A popover and a sheet are presentations of the same controller, so a
  /// door picked from the menu opens when the menu has LEFT — on the menu's
  /// own signal, never a clock (it was a 260 ms sleep until 2026-10-17).
  @Test("a picked door opens when the menu has left, and not before")
  func aPickOpensOnTheMenusDeparture() {
    let model = InputCardModel()
    model.showPlusMenu()
    model.requestSurface(.snippets)
    #expect(model.plusMenuOpen == false)
    #expect(model.surface == nil, "the menu is still leaving")
    model.menuDidLeave()
    #expect(model.surface == .snippets)
  }

  @Test("a menu that leaves with no pick opens nothing — nor does a pick a closed card forgot")
  func aDepartureWithoutAPickOpensNothing() {
    let model = InputCardModel()
    model.showPlusMenu()
    model.closePlusMenu()
    model.menuDidLeave()
    #expect(model.surface == nil)
    model.showPlusMenu()
    model.requestSurface(.clipboardHistory)
    model.reset()
    model.menuDidLeave()
    #expect(model.surface == nil)
  }
}

@MainActor
@Suite("keypad geometry and input routing")
struct KeypadRegressionTests {
  @Test("native height survives keypad handoffs, floating keyboards, and rotation")
  func keyboardMeasurements() {
    let geometry = KeypadGeometry()
    let portrait = CGRect(x: 0, y: 0, width: 402, height: 874)
    geometry.updateViewport(portrait.size, bottomInset: 34)
    geometry.recordNativeKeyboard(CGRect(x: 0, y: 566, width: 402, height: 308), in: portrait)
    #expect(geometry.height == 308)
    geometry.recordNativeKeyboard(CGRect(x: 50, y: 400, width: 300, height: 260), in: portrait)
    #expect(geometry.height == 308, "a floating keyboard must not change the docked size")
    geometry.recordNativeKeyboard(CGRect(x: 0, y: 820, width: 402, height: 54), in: portrait)
    #expect(geometry.height == 308, "a hardware accessory bar is not a keyboard")
    let landscape = CGRect(x: 0, y: 0, width: 874, height: 402)
    geometry.updateViewport(landscape.size, bottomInset: 21)
    geometry.recordNativeKeyboard(CGRect(x: 0, y: 202, width: 874, height: 200), in: landscape)
    #expect(geometry.height == 200)
    geometry.updateViewport(portrait.size, bottomInset: 34)
    #expect(geometry.height == 308)
    geometry.recordNativeKeyboard(CGRect(x: 0, y: 522, width: 402, height: 352), in: portrait)
    #expect(
      geometry.height == 352, "native language/prediction height replaces the old measurement")
  }

  @Test("Live keypad text and hardware shortcuts reach the same sink once")
  func hardwareInput() {
    let model = InputCardModel()
    var acts: [InputAct] = []
    model.sink = {
      acts.append($0)
      return true
    }
    model.draft = "preserved"
    model.toggleMode()
    model.setKeypad(true)
    let responder = KeypadResponderView()
    responder.model = model
    responder.insertText("aé🙂")
    responder.deleteBackward()
    responder.insertText("\n")
    model.sendKeypadHardware(.control("r"))
    #expect(
      acts == [
        .typeText("a"), .typeText("é"), .typeText("🙂"),
        .keystroke(TerminalKeystroke(.backspace)), .keystroke(TerminalKeystroke(.enter)),
        .keystroke(.control("r")),
      ])
    #expect(model.draft == "preserved")
    model.dismissKeyboard()
    responder.insertText("stale")
    #expect(acts.count == 6, "a folded keypad must not send late input")
  }

  @Test("Shift is one-shot, composes with Control, and resets with the session")
  func shiftModifier() {
    let model = InputCardModel()
    var acts: [InputAct] = []
    model.sink = {
      acts.append($0)
      return true
    }
    model.toggleShift()
    model.tapKey(.tab)
    #expect(acts == [.keystroke(.shiftTab)])
    #expect(!model.shiftArmed)
    model.tapControl()
    model.toggleShift()
    model.tapKey(.arrowLeft)
    #expect(acts.last == .keystroke(TerminalKeystroke(.arrowLeft, modifiers: [.control, .shift])))
    model.toggleShift()
    model.reset()
    #expect(!model.shiftArmed)
  }

  @Test(
    "saved shortcut selections survive profile namespacing",
    arguments: ["claude", "tmux", "screen"])
  func legacyProfileSelection(id: String) {
    let legacy = ComboCatalog.profile(id: id, tmuxPrefix: "a")
    let current = ComboCatalog.profile(id: "keypad.\(id)", tmuxPrefix: "a")
    #expect(legacy == current)
    #expect(legacy.id == "keypad.\(id)")
    if id == "tmux" {
      #expect(legacy.combos[0].strokes == [.control("a"), TerminalKeystroke(.character("c"))])
    }
  }

  /// PF-16: Common became Shell and Emacs was retired into it, so a phone that
  /// had either chosen, in either spelling, lands on Shell.
  @Test(
    "a phone that had Common or Emacs chosen lands on Shell",
    arguments: ["common", "keypad.common", "emacs", "keypad.emacs"])
  func retiredProfileSelection(id: String) {
    #expect(ComboCatalog.profile(id: id, tmuxPrefix: "b") == ComboCatalog.shell)
  }

  @Test("an unknown saved profile, and no choice at all, is Shell")
  func unknownProfileSelection() {
    #expect(ComboCatalog.profile(id: "removed-profile", tmuxPrefix: "b") == ComboCatalog.shell)
    #expect(ComboCatalog.fallback == ComboCatalog.shell)
  }

  // MARK: - The profile a card opens on (PF-17)

  @Test("a hand's choice on this card comes first, then the card's agent's profile, then the one last chosen by hand")
  func chosenProfile() {
    func chosen(_ picked: String?, _ session: String?, _ stored: String) -> String {
      ComboCatalog.chosen(picked: picked, session: session, stored: stored, tmuxPrefix: "b").id
    }
    #expect(chosen(nil, nil, "keypad.tmux") == "keypad.tmux")
    #expect(chosen(nil, "keypad.codex", "keypad.tmux") == "keypad.codex")
    #expect(chosen("keypad.screen", "keypad.codex", "keypad.tmux") == "keypad.screen")
    #expect(chosen(nil, nil, "") == "keypad.shell")
  }

  /// The catalog's word is a desktop's, and the desktop may be a build ahead.
  /// A profile this build lacks must not take the hand's choice away by
  /// resolving to the fallback.
  @Test("a profile this build does not have is passed over, never resolved to Shell")
  func unknownSessionProfile() {
    let pack = ComboCatalog.chosen(
      picked: nil, session: "keypad.not-yet", stored: "keypad.claude", tmuxPrefix: "b")
    #expect(pack == ComboCatalog.claude)
    let picked = ComboCatalog.chosen(
      picked: "keypad.gone", session: "keypad.pi", stored: "keypad.claude", tmuxPrefix: "b")
    #expect(picked == ComboCatalog.pi)
  }

  @Test("closing the card lets go of its agent's profile and of the hand's choice for it")
  func resetClearsTheCardsProfile() {
    let model = InputCardModel()
    model.sessionProfile = "keypad.codex"
    model.pickedProfile = "keypad.tmux"
    model.reset()
    #expect(model.sessionProfile == nil)
    #expect(model.pickedProfile == nil)
  }

  @Test("tmux uses the selected prefix without applying it to the command")
  func configuredPrefix() {
    let model = InputCardModel()
    var acts: [InputAct] = []
    model.sink = {
      acts.append($0)
      return true
    }
    model.sendCombo(ComboCatalog.tmux(prefix: "a").combos[0])
    #expect(acts == [.keystroke(.control("a")), .keystroke(TerminalKeystroke(.character("c")))])
    #expect(ComboCatalog.tmux(prefix: "a").combos.allSatisfy { $0.strokes.first == .control("a") })
  }
}
