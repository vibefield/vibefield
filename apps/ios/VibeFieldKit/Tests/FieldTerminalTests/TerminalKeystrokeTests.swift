import GhostteaTerminal
import Testing

@testable import FieldTerminal

/// The encoder is the one place the card's vocabulary meets the kit's, and a
/// wrong HID usage is invisible until a shell does the wrong thing on a device
/// nobody is holding. So every key the rail can send is pinned here by number.
///
/// The named usages and the `|`/`~` rows are the kit's own table
/// (`GhostteaAccessoryInput.swift`), copied so our rail and the row we switched
/// off cannot drift apart.
@Suite("terminal keystroke encoding")
struct TerminalKeystrokeTests {

  @Test("every named key rides the usage the kit's own row uses")
  func namedKeys() {
    let expected: [(TerminalKey, UInt16, String)] = [
      (.escape, 0x29, "Escape"),
      (.tab, 0x2b, "Tab"),
      (.enter, 0x28, "Enter"),
      (.backspace, 0x2a, "Backspace"),
      (.arrowRight, 0x4f, "ArrowRight"),
      (.arrowLeft, 0x50, "ArrowLeft"),
      (.arrowDown, 0x51, "ArrowDown"),
      (.arrowUp, 0x52, "ArrowUp"),
      (.home, 0x4a, "Home"),
      (.end, 0x4d, "End"),
      (.pageUp, 0x4b, "PageUp"),
      (.pageDown, 0x4e, "PageDown"),
    ]
    for (key, usage, code) in expected {
      let event = TerminalKeystroke(key).ghostteaEvent()
      #expect(event?.hidUsage == usage, "\(key) should be \(usage)")
      #expect(event?.code == code)
      #expect(event?.modifiers == [])
      #expect(event?.action == .down)
    }
  }

  /// `0x04 + (c − 'a')` — and the letter rides as text, which is what a
  /// terminal needs to tell `a` from `A` on the same key.
  @Test("letters walk the alphabet from usage 0x04")
  func letters() {
    #expect(TerminalKeystroke(.character("a")).ghostteaEvent()?.hidUsage == 0x04)
    #expect(TerminalKeystroke(.character("c")).ghostteaEvent()?.hidUsage == 0x06)
    #expect(TerminalKeystroke(.character("z")).ghostteaEvent()?.hidUsage == 0x1d)
    let a = TerminalKeystroke(.character("a")).ghostteaEvent()
    #expect(a?.text == "a")
    #expect(a?.unshiftedCodepoint == 97)
    #expect(a?.code == "KeyA")
  }

  /// A capital is the same key WITH shift, and its unshifted codepoint is the
  /// lowercase letter — the kit's own rule for a committed capital.
  @Test("a capital is the lowercase key plus shift")
  func capitals() {
    let event = TerminalKeystroke(.character("R")).ghostteaEvent()
    #expect(event?.hidUsage == 0x15)  // the same key `r` rides
    #expect(event?.modifiers == .shift)
    #expect(event?.text == "R")
    #expect(event?.unshiftedCodepoint == 114)
  }

  /// The digit row starts at `1`, and `0` sits at its END — the one place the
  /// obvious arithmetic is wrong.
  @Test("digits start at 0x1e and zero sits at 0x27")
  func digits() {
    #expect(TerminalKeystroke(.character("1")).ghostteaEvent()?.hidUsage == 0x1e)
    #expect(TerminalKeystroke(.character("9")).ghostteaEvent()?.hidUsage == 0x26)
    #expect(TerminalKeystroke(.character("0")).ghostteaEvent()?.hidUsage == 0x27)
    #expect(TerminalKeystroke(.character("0")).ghostteaEvent()?.code == "Digit0")
  }

  /// The kit's own two punctuation entries: the shifted symbol rides the base
  /// key with shift, and the BASE character is the unshifted codepoint.
  @Test("pipe and tilde ride their base keys with shift")
  func shiftedPunctuation() {
    let pipe = TerminalKeystroke(.character("|")).ghostteaEvent()
    #expect(pipe?.hidUsage == 0x31)
    #expect(pipe?.modifiers == .shift)
    #expect(pipe?.text == "|")
    #expect(pipe?.unshiftedCodepoint == 92)  // backslash

    let tilde = TerminalKeystroke(.character("~")).ghostteaEvent()
    #expect(tilde?.hidUsage == 0x35)
    #expect(tilde?.modifiers == .shift)
    #expect(tilde?.unshiftedCodepoint == 96)  // backquote
  }

  @Test("unshifted punctuation carries no shift")
  func plainPunctuation() {
    #expect(TerminalKeystroke(.character("\\")).ghostteaEvent()?.hidUsage == 0x31)
    #expect(TerminalKeystroke(.character("\\")).ghostteaEvent()?.modifiers == [])
    #expect(TerminalKeystroke(.character("`")).ghostteaEvent()?.hidUsage == 0x35)
    #expect(TerminalKeystroke(.character("-")).ghostteaEvent()?.hidUsage == 0x2d)
    #expect(TerminalKeystroke(.character("/")).ghostteaEvent()?.hidUsage == 0x38)
    #expect(TerminalKeystroke(.character(" ")).ghostteaEvent()?.hidUsage == 0x2c)
  }

  /// `^C` — the interrupt the whole latch exists for. Usage 0x06 with control,
  /// NOT a 0x03 byte we made up.
  @Test("control on a letter is the letter's own key plus the modifier")
  func controlLetters() {
    let event = TerminalKeystroke.control("c").ghostteaEvent()
    #expect(event?.hidUsage == 0x06)
    #expect(event?.modifiers == .control)
    #expect(event?.text == "c")
    #expect(event?.unshiftedCodepoint == 99)

    #expect(TerminalKeystroke.control("r").ghostteaEvent()?.hidUsage == 0x15)
    #expect(TerminalKeystroke.control("d").ghostteaEvent()?.hidUsage == 0x07)
  }

  @Test("modifiers translate one for one, and never invent command")
  func modifiers() {
    let stroke = TerminalKeystroke(.tab, modifiers: [.control, .option, .shift])
    let event = stroke.ghostteaEvent()
    #expect(event?.modifiers.contains(.control) == true)
    #expect(event?.modifiers.contains(.option) == true)
    #expect(event?.modifiers.contains(.shift) == true)
    #expect(event?.modifiers.contains(.command) == false)
    #expect(TerminalKeystroke.shiftTab.ghostteaEvent()?.hidUsage == 0x2b)
    #expect(TerminalKeystroke.shiftTab.ghostteaEvent()?.modifiers == .shift)
  }

  @Test("function keys run F1…F12 and refuse anything else")
  func functionKeys() {
    #expect(TerminalKeystroke(.function(1)).ghostteaEvent()?.hidUsage == 0x3a)
    #expect(TerminalKeystroke(.function(12)).ghostteaEvent()?.hidUsage == 0x45)
    #expect(TerminalKeystroke(.function(1)).ghostteaEvent()?.code == "F1")
    #expect(TerminalKeystroke(.function(0)).ghostteaEvent() == nil)
    #expect(TerminalKeystroke(.function(13)).ghostteaEvent() == nil)
  }

  /// A character with no key on this layout encodes to nothing, and the card
  /// treats that as a no-op rather than sending a wrong byte.
  @Test("a character this layout cannot type encodes to nothing")
  func unencodable() {
    #expect(TerminalKeystroke(.character("é")).ghostteaEvent() == nil)
    #expect(TerminalKeystroke(.character("→")).ghostteaEvent() == nil)
    #expect(TerminalKeystroke(.character("\n")).ghostteaEvent() == nil)
  }
}
