import Testing

@testable import FieldInput

/// Who holds the keyboard, and what the card does when nobody does.
///
/// The mode says which responder WOULD take the keys; ownership says whether
/// one is holding the keyboard right now. They come apart the moment the user
/// puts the keyboard down without leaving the mode, and the closed row is that
/// gap rendered — a card that folded to one row only on a mode change would
/// hover a rail over a terminal the user is trying to read.
@MainActor
@Suite("who owns the keyboard")
struct KeyboardOwnerTests {

  /// A card opens with the keyboard down. That is the resting state, not a
  /// failure: raising a keyboard over a terminal nobody asked to type into is
  /// the chrome deciding for the user.
  @Test("a fresh card owns no keyboard")
  func freshCardIsClosed() {
    #expect(InputCardModel().keyboardOwner == .none)
  }

  @Test("the composer owns it in Draft, and only while it is focused")
  func draftOwnership() {
    let model = InputCardModel()
    model.fieldFocused = true
    #expect(model.keyboardOwner == .composer)
    model.fieldFocused = false
    #expect(model.keyboardOwner == .none)
  }

  /// The terminal's flag is fed by the surface from the RESULT of its
  /// responder call, so a `becomeFirstResponder` that did not take leaves the
  /// card closed rather than pretending.
  @Test("the terminal owns it in the other mode, and only while it reports so")
  func terminalOwnership() {
    let model = InputCardModel()
    model.toggleMode()
    #expect(model.keyboardOwner == .terminal)
    model.terminalFocused = false
    #expect(model.keyboardOwner == .none)
  }

  /// One keyboard, one responder: a stale flag from the other mode must never
  /// make the card claim an owner the mode does not have.
  @Test("the flags stay exclusive across a mode flip")
  func flagsStayExclusive() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.toggleMode()
    #expect(model.fieldFocused == false)
    #expect(model.terminalFocused)
    model.toggleMode()
    #expect(model.fieldFocused)
    #expect(model.terminalFocused == false)
  }

  @Test("the swipe puts it down in both modes")
  func dismissClosesEither() {
    let model = InputCardModel()
    model.fieldFocused = true
    model.dismissKeyboard()
    #expect(model.keyboardOwner == .none)
    model.toggleMode()
    model.dismissKeyboard()
    #expect(model.keyboardOwner == .none)
  }

  @Test("KEYBOARD asks the right responder back")
  func requestGoesToTheCurrentMode() {
    let model = InputCardModel()
    model.requestKeyboard()
    #expect(model.keyboardOwner == .composer)
    model.toggleMode()
    model.dismissKeyboard()
    model.requestKeyboard()
    #expect(model.keyboardOwner == .terminal)
  }

  /// The nonce is the whole reason the chip works twice: after the terminal
  /// resigned on its own, "please take the keyboard" carries the same value it
  /// already holds, and the surface would rightly skip a request that says
  /// nothing new.
  @Test("every request is distinguishable from the last")
  func requestsAreCounted() {
    let model = InputCardModel()
    let start = model.keyboardRequests
    model.requestKeyboard()
    model.dismissKeyboard()
    model.requestKeyboard()
    #expect(model.keyboardRequests == start + 2)
  }

  /// A request is not an act on the terminal: nothing is sent by asking for
  /// the keyboard back.
  @Test("neither asking nor dismissing sends anything")
  func focusIsLocal() {
    let model = InputCardModel()
    var acts: [InputAct] = []
    model.sink = { acts.append($0) }
    model.requestKeyboard()
    model.dismissKeyboard()
    #expect(acts.isEmpty)
  }

  @Test("closing the card leaves nothing holding the keyboard")
  func resetClosesIt() {
    let model = InputCardModel()
    model.toggleMode()
    model.reset()
    #expect(model.keyboardOwner == .none)
    #expect(model.terminalFocused == false)
  }
}
