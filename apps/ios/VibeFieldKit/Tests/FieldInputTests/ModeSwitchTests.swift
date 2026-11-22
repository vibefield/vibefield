import CoreGraphics
import FieldTerminal
import Testing

@testable import FieldInput

/// The mode switch (PF-8, 2026-11-22; DESIGN.md §8 "The phone's input card is
/// one row in each of its two modes"): what a tap on one of its halves does to
/// the card, and the sizes the halves are drawn at.
///
/// The switch is two halves in one capsule. With the keyboard up the other
/// half changes the mode; with it down either half is a door. Both are one act
/// on the model, `enter`, so the rule is held here without a view.
@MainActor
@Suite("the mode switch")
struct ModeSwitchTests {

  @Test("with the keyboard down, either half is a door: the keyboard rises in that half's mode")
  func eitherHalfIsADoor() {
    let message = InputCardModel()
    message.enter(.draft)
    #expect(message.mode == .draft)
    #expect(message.keyboardOwner == .composer)

    let terminal = InputCardModel()
    terminal.enter(.live)
    #expect(terminal.mode == .live)
    #expect(terminal.keyboardOwner == .terminal)
  }

  /// The terminal has resigned the keyboard on its own, so asking again is the
  /// same answer it already holds: the request has to be a new one.
  @Test("the door of the mode in force asks for the keyboard anew")
  func theDoorInForceAsksAnew() {
    let model = InputCardModel()
    model.enter(.live)
    model.dismissKeyboard()
    #expect(model.mode == .live)
    #expect(model.keyboardOwner == .none)
    let asked = model.keyboardRequests
    model.enter(.live)
    #expect(model.keyboardOwner == .terminal)
    #expect(model.keyboardRequests == asked + 1)
  }

  @Test("with the keyboard up, the half in force changes nothing")
  func theHalfInForceChangesNothing() {
    let model = InputCardModel()
    model.enter(.live)
    let asked = model.keyboardRequests
    model.enter(.live)
    #expect(model.mode == .live)
    #expect(model.keyboardOwner == .terminal)
    #expect(model.keyboardRequests == asked)
  }

  @Test("the other half changes the mode and its keyboard, and a draft is kept both ways")
  func theOtherHalfChangesTheMode() {
    let model = InputCardModel()
    model.enter(.draft)
    model.draft = "make test"
    model.enter(.live)
    #expect(model.mode == .live)
    #expect(model.keyboardOwner == .terminal)
    #expect(model.draft == "make test")
    model.enter(.draft)
    #expect(model.mode == .draft)
    #expect(model.keyboardOwner == .composer)
    #expect(model.draft == "make test")
  }

  /// The composer's row has no keypad key, so a keypad left standing under a
  /// draft would have no way back to the letters.
  @Test("leaving the terminal's mode puts the keypad away, and the letters come back under the draft")
  func leavingPutsTheKeypadAway() {
    let model = InputCardModel()
    model.enter(.live)
    model.setKeypad(true)
    #expect(model.keyboardOwner == .keypad)
    model.enter(.draft)
    #expect(model.keypadShown == false)
    #expect(model.mode == .draft)
    #expect(model.keyboardOwner == .composer)
  }

  /// The composer's row has no Ctrl to show a latch on. A locked Ctrl carried
  /// into a draft would turn its next letter into a chord sent to the terminal.
  @Test("leaving the terminal's mode lets go of Ctrl, Meta and Shift, so a draft's letters are letters")
  func leavingLetsGoOfTheModifiers() {
    let model = InputCardModel()
    var sent: [InputAct] = []
    model.sink = { act in
      sent.append(act)
      return true
    }
    model.enter(.live)
    model.tapControl()
    model.tapControl()
    model.armMeta()
    model.toggleShift()
    #expect(model.latch.phase == .locked)
    model.enter(.draft)
    #expect(model.latch.phase == .off)
    #expect(model.metaArmed == false)
    #expect(model.shiftArmed == false)
    let taken = model.interceptCharacter("c")
    #expect(taken == false)
    #expect(sent.isEmpty)
  }

  @Test("entering the terminal's mode keeps what the rail holds: a latch armed there stays")
  func enteringKeepsTheRailsLatch() {
    let model = InputCardModel()
    model.enter(.live)
    model.tapControl()
    model.dismissKeyboard()
    model.enter(.live)
    #expect(model.latch.phase == .armed)
  }

  @Test("across the switch the keyboard always has an owner: the new one takes, the old one yields, no one releases")
  func theKeyboardIsHandedOver() {
    let model = InputCardModel()
    model.enter(.draft)
    #expect(model.responderRole(for: .composer) == .take)

    model.enter(.live)
    #expect(model.keyboardOwner == .terminal)
    #expect(model.responderRole(for: .terminal) == .take)
    #expect(model.responderRole(for: .composer) == .yield)
    #expect(model.responderRole(for: .keypadHost) == .yield)

    model.enter(.draft)
    #expect(model.keyboardOwner == .composer)
    #expect(model.responderRole(for: .composer) == .take)
    #expect(model.responderRole(for: .terminal) == .yield)
    #expect(model.responderRole(for: .keypadHost) == .yield)
  }

  @Test("the capsule is 88 by 38 beside the fold key and 110 by 52 as the doors, and both grow at the accessibility row")
  func theFigures() {
    #expect(ModeSwitch.halfSize(rowHeight: 44, doors: false) == CGSize(width: 40, height: 32))
    #expect(ModeSwitch.size(rowHeight: 44, doors: false) == CGSize(width: 88, height: 38))
    #expect(ModeSwitch.halfSize(rowHeight: 44, doors: true) == CGSize(width: 50, height: 44))
    #expect(ModeSwitch.size(rowHeight: 44, doors: true) == CGSize(width: 110, height: 52))
    #expect(ModeSwitch.size(rowHeight: 52, doors: false).height > 38)
    #expect(ModeSwitch.size(rowHeight: 52, doors: true).height > 52)
  }
}
