import FieldTerminal
import Testing

@testable import FieldInput

/// What a combo IS, before any of it reaches a terminal.
///
/// The point of pinning the sequences rather than the labels: `^B c` looks
/// like one key on the page and is two presses on the wire, and a combo that
/// encoded to `Control-B-C` would open no tmux window while looking exactly as
/// correct on screen.
@Suite("the combo packs")
struct ComboCatalogTests {

  @Test("a one-press combo is one control chord")
  func emacsIsSingleChords() {
    let pack = ComboCatalog.emacs
    #expect(pack.combos.count == 8)
    #expect(pack.combos.map(\.label) == ["^A", "^E", "^K", "^Y", "^F", "^B", "^N", "^P"])
    for combo in pack.combos {
      #expect(combo.strokes.count == 1)
      #expect(combo.strokes[0].modifiers == .control)
    }
    #expect(pack.combos[0].strokes == [.control("a")])
  }

  /// The prefix is a key you press and RELEASE. `^B c` with the control still
  /// held is `^B ^C`, which interrupts instead of making a window.
  @Test("a tmux combo is the prefix chord and then a plain key")
  func tmuxIsPrefixThenPlainKey() {
    let newWindow = ComboCatalog.tmux.combos[0]
    #expect(newWindow.label == "^B c")
    #expect(
      newWindow.strokes == [.control("b"), TerminalKeystroke(.character("c"))])
    #expect(newWindow.strokes[1].modifiers.isEmpty)
  }

  /// The punctuation entries are the ones most likely to encode to nothing —
  /// they leave the letter rows and land in the shifted-symbol table.
  @Test("the punctuation prefixes name real keys")
  func punctuationCombosEncode() {
    let copyMode = ComboCatalog.tmux.combos.first { $0.label == "^B [" }
    let split = ComboCatalog.tmux.combos.first { $0.label == "^B %" }
    #expect(copyMode?.strokes.last == TerminalKeystroke(.character("[")))
    #expect(split?.strokes.last == TerminalKeystroke(.character("%")))
  }

  @Test("readline and screen carry the packs the design names")
  func remainingPacks() {
    #expect(ComboCatalog.readline.combos.map(\.label) == ["^R", "^L", "^U", "^W", "^C", "^D"])
    #expect(ComboCatalog.screen.combos.map(\.label) == ["^A c", "^A n", "^A d"])
    #expect(ComboCatalog.packs.map(\.id) == ["emacs", "tmux", "readline", "screen"])
  }

  /// Ids are what `ForEach` renders by, and `^A` appears in two packs.
  @Test("every combo in the catalog has its own id")
  func idsAreUnique() {
    let ids = ComboCatalog.packs.flatMap { $0.combos.map(\.id) }
    #expect(Set(ids).count == ids.count)
  }
}

/// What tapping one does.
@MainActor
@Suite("sending a combo")
struct SendComboTests {
  final class Recorder {
    var acts: [InputAct] = []
  }

  private func card() -> (InputCardModel, Recorder) {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    return (model, recorder)
  }

  @Test("the presses go out in order, one act each")
  func strokesInOrder() {
    let (model, recorder) = card()
    model.sendCombo(ComboCatalog.tmux.combos[0])
    #expect(
      recorder.acts == [
        .keystroke(.control("b")),
        .keystroke(TerminalKeystroke(.character("c"))),
      ])
  }

  /// A combo names every key it presses. Folding an armed Ctrl into it would
  /// make `^B ^C` — the interrupt, not the window.
  @Test("an armed latch is spent and NOT applied")
  func latchIsSpentNotApplied() {
    let (model, recorder) = card()
    model.tapControl()
    model.sendCombo(ComboCatalog.screen.combos[0])
    #expect(
      recorder.acts == [
        .keystroke(.control("a")),
        .keystroke(TerminalKeystroke(.character("c"))),
      ])
    // Spent: the arm must not survive onto the next letter typed.
    #expect(model.latch.phase == .off)
  }

  /// A LOCKED latch was locked on purpose, and only a third tap releases it —
  /// the same rule every other act on this card follows.
  @Test("a locked latch survives a combo, still without being applied")
  func lockSurvives() {
    let (model, recorder) = card()
    model.tapControl()
    model.tapControl()
    model.sendCombo(ComboCatalog.readline.combos[0])
    #expect(recorder.acts == [.keystroke(.control("r"))])
    #expect(model.latch.phase == .locked)
  }

  /// The Meta burst goes the same way as the latch. A chord is one keystroke
  /// and can carry a burst; a combo is a script, and there is no single key
  /// for `.option` to ride.
  @Test("the Meta burst is spent by a combo and not applied to it")
  func burstIsSpent() {
    let (model, recorder) = card()
    model.armMeta()
    model.sendCombo(ComboCatalog.emacs.combos[0])
    #expect(recorder.acts == [.keystroke(.control("a"))])
    #expect(model.metaArmed == false)
  }
}
