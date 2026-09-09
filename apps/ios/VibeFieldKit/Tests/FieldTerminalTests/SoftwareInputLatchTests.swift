import GhostteaTerminal
import Testing

@testable import FieldTerminal

/// Live mode's latch is one pure function, and every bug it could have is
/// invisible: a paste that spends an arm, an Enter that loses its Ctrl, a
/// two-character commit shaped into the wrong key. None of them show in a
/// screenshot and all of them show in a shell on a device nobody is holding.
/// So the shaping is pinned by calling it.
@Suite("the software-input latch")
struct SoftwareInputLatchTests {

  /// The whole point: `Ctrl` armed, then `c` typed on the system keyboard,
  /// gives `^C` — the same keystroke the chord fan sends, down to the usage.
  @Test("a single character under control becomes that control byte")
  func characterUnderControl() {
    let stroke = SoftwareInputLatch.keystroke(for: .text("c"), modifiers: .control)
    #expect(stroke == TerminalKeystroke(.character("c"), modifiers: .control))
    let event = stroke?.ghostteaEvent()
    #expect(event?.hidUsage == 0x06)  // 0x04 + ('c' − 'a')
    #expect(event?.modifiers == .control)
    #expect(event?.action == .down)
  }

  /// The Meta burst rides the same path — it is a modifier like any other by
  /// the time it gets here.
  @Test("the burst's option rides a typed character too")
  func characterUnderOption() {
    let stroke = SoftwareInputLatch.keystroke(for: .text("x"), modifiers: .option)
    #expect(stroke == TerminalKeystroke(.character("x"), modifiers: .option))
    #expect(stroke?.ghostteaEvent()?.modifiers == .option)
  }

  /// `Ctrl` then Return is `^M` on the wire and a real chord in a REPL; it must
  /// not fall through to the plain `\r` the unlatched path writes.
  @Test("Enter under control becomes the Enter key with control")
  func enterUnderControl() {
    let stroke = SoftwareInputLatch.keystroke(for: .enter, modifiers: .control)
    #expect(stroke == TerminalKeystroke(.enter, modifiers: .control))
    #expect(stroke?.ghostteaEvent()?.hidUsage == 0x28)
  }

  /// `^H` and `^W` — a latched backspace is how a line is eaten a word at a
  /// time, and the unlatched path hardcodes a modifier-free Backspace.
  @Test("delete-backward under control becomes Backspace with control")
  func deleteUnderControl() {
    let stroke = SoftwareInputLatch.keystroke(for: .deleteBackward, modifiers: .control)
    #expect(stroke == TerminalKeystroke(.backspace, modifiers: .control))
    #expect(stroke?.ghostteaEvent()?.hidUsage == 0x2a)
  }

  /// An IME composition or a multi-scalar grapheme names no single key, and
  /// inventing one would send a byte the user never typed.
  @Test("a multi-character commit passes through untouched")
  func multiCharacterCommit() {
    #expect(SoftwareInputLatch.keystroke(for: .text("ab"), modifiers: .control) == nil)
    #expect(SoftwareInputLatch.keystroke(for: .text(""), modifiers: .control) == nil)
  }

  /// A paste is a block of text, not a key. The caller does not even ask the
  /// latch about one — this is the second lock on the same door.
  @Test("a paste is never a keystroke")
  func pasteIsNotAKey() {
    #expect(SoftwareInputLatch.keystroke(for: .paste("git status"), modifiers: .control) == nil)
  }

  /// Already a key event, already carrying its own modifiers — the rail's own
  /// keys arrive this way and must not be shaped twice.
  @Test("an already-shaped key event passes through")
  func keyEventPassesThrough() {
    let key = GhostteaHardwareKeyEvent(
      hidUsage: 0x29, characters: "", charactersIgnoringModifiers: "", modifiers: [],
      action: .down)
    #expect(key != nil)
    guard let key else { return }
    #expect(SoftwareInputLatch.keystroke(for: .key(key), modifiers: .control) == nil)
  }

  /// The resting case, and the one that runs on every keystroke of every
  /// session: no latch, no shaping, the event on exactly its old path.
  @Test("nothing latched shapes nothing")
  func noModifiersShapesNothing() {
    #expect(SoftwareInputLatch.keystroke(for: .text("c"), modifiers: []) == nil)
    #expect(SoftwareInputLatch.keystroke(for: .enter, modifiers: []) == nil)
    #expect(SoftwareInputLatch.keystroke(for: .deleteBackward, modifiers: []) == nil)
  }

  /// Both at once — a tmux binding under a locked Ctrl.
  @Test("control and option ride together")
  func bothModifiers() {
    let stroke = SoftwareInputLatch.keystroke(
      for: .text("b"), modifiers: [.control, .option])
    #expect(stroke?.modifiers == [.control, .option])
    #expect(stroke?.ghostteaEvent()?.modifiers == [.control, .option])
  }
}
