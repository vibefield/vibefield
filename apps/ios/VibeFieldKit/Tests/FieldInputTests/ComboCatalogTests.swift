import Testing

@testable import FieldInput
@testable import FieldTerminal

/// What a combo IS, before any of it reaches a terminal.
///
/// The point of pinning the sequences rather than the labels: `^B c` looks
/// like one key on the page and is two presses on the wire, and a combo that
/// encoded to `Control-B-C` would open no tmux window while looking exactly as
/// correct on screen.
@Suite("the combo packs")
struct ComboCatalogTests {
  private static let profiles = ComboCatalog.profiles(tmuxPrefix: "b")

  /// PF-16: the strip's order is the catalog's, the agents and then the tools.
  @Test("the profiles are six agents, then three tools")
  func profileOrder() {
    #expect(
      Self.profiles.map(\.id) == [
        "keypad.claude", "keypad.codex", "keypad.gemini", "keypad.opencode", "keypad.copilot",
        "keypad.pi", "keypad.shell", "keypad.tmux", "keypad.screen",
      ])
    #expect(
      Self.profiles.map(\.title) == [
        "Claude", "Codex", "Gemini", "OpenCode", "Copilot", "Pi", "Shell", "tmux", "screen",
      ])
    #expect(Self.profiles.map(\.kind) == Array(repeating: .agent, count: 6) + [.tool, .tool, .tool])
  }

  @Test("every profile is fifteen keys, three rows of five")
  func fifteenEach() {
    for pack in Self.profiles {
      #expect(pack.combos.count == 15, "\(pack.id)")
    }
  }

  /// A face is read into its presses: one stroke for each press it spells.
  /// A press the catalog cannot read would leave a key that sends less than
  /// it says.
  @Test("every key sends one press for each press its face spells")
  func facesAreRead() {
    for pack in Self.profiles {
      for combo in pack.combos + ComboCatalog.fixedRow(for: pack) {
        let spelled = combo.label.split(separator: " ").count
        #expect(combo.strokes.count == spelled, "\(combo.id)")
      }
    }
  }

  /// The punctuation and the option chords are the ones most likely to encode
  /// to nothing: they leave the letter rows for the shifted-symbol table.
  @Test("every press of every key encodes to a real key")
  func everyStrokeEncodes() {
    for pack in Self.profiles {
      for combo in pack.combos + ComboCatalog.fixedRow(for: pack) {
        for stroke in combo.strokes {
          #expect(stroke.ghostteaEvent() != nil, "\(combo.id)")
        }
      }
    }
  }

  /// A word has one line under a cap a fifth of the keyboard wide.
  @Test("a key's word is ten characters at most, and its face seven")
  func wordsFit() {
    for pack in Self.profiles {
      for combo in pack.combos + ComboCatalog.fixedRow(for: pack) {
        #expect(combo.subtitle.count <= 10, "\(combo.id)")
        #expect(combo.label.count <= 7, "\(combo.id)")
      }
    }
  }

  // MARK: - The fixed row

  /// PF-16, 2026-11-22: tab and shift always stay in the fixed row.
  @Test("the fixed row is the same five keys under every profile")
  func fixedRowNeverMoves() {
    for pack in Self.profiles {
      let row = ComboCatalog.fixedRow(for: pack)
      #expect(row.map(\.label) == ["⇧Tab", "^C", "Esc Esc", "^J", "^D"], "\(pack.id)")
      #expect(
        row.map(\.strokes) == [
          [.shiftTab], [.control("c")],
          [TerminalKeystroke(.escape), TerminalKeystroke(.escape)],
          [.control("j")], [.control("d")],
        ], "\(pack.id)")
    }
  }

  @Test("the word under a fixed key is the profile's")
  func fixedRowWords() {
    func words(_ pack: ComboPack) -> [String] { ComboCatalog.fixedRow(for: pack).map(\.subtitle) }
    #expect(words(ComboCatalog.claude) == ["Mode", "Interrupt", "Rewind", "New line", "Exit"])
    #expect(words(ComboCatalog.codex) == ["Mode", "Interrupt", "Edit last", "New line", "Exit"])
    #expect(words(ComboCatalog.gemini) == ["Mode", "Interrupt", "Rewind", "New line", "Exit"])
    #expect(words(ComboCatalog.opencode) == ["Agent", "Interrupt", "Interrupt", "New line", "Exit"])
    #expect(words(ComboCatalog.copilot) == ["Mode", "Interrupt", "Interrupt", "", "Exit"])
    #expect(words(ComboCatalog.pi) == ["Thinking", "Interrupt", "Tree", "New line", "Exit"])
    for tool in [ComboCatalog.shell, ComboCatalog.tmux(prefix: "b"), ComboCatalog.screen] {
      #expect(words(tool) == ["Back", "Interrupt", "", "Enter", "Exit"], "\(tool.id)")
    }
  }

  /// A key of the fixed row is not said twice on a profile's own rows.
  @Test("no profile repeats a key of the fixed row")
  func noRepeats() {
    for pack in Self.profiles {
      let fixed = Set(ComboCatalog.fixedRow(for: pack).map(\.strokes))
      for combo in pack.combos {
        #expect(!fixed.contains(combo.strokes), "\(combo.id)")
      }
    }
  }

  // MARK: - The faces

  @Test("a control chord, an option chord and a named key are each one press")
  func singlePresses() {
    func strokes(_ face: String) -> [TerminalKeystroke] {
      ComboCatalog.combo("test", face, "").strokes
    }
    #expect(strokes("^O") == [.control("o")])
    #expect(strokes("^_") == [.control("_")])
    #expect(strokes("^/") == [.control("/")])
    #expect(strokes("⌥P") == [TerminalKeystroke(.character("p"), modifiers: .option)])
    #expect(strokes("⌥.") == [TerminalKeystroke(.character("."), modifiers: .option)])
    #expect(strokes("⌥↑") == [TerminalKeystroke(.arrowUp, modifiers: .option)])
    #expect(strokes("⌥↵") == [TerminalKeystroke(.enter, modifiers: .option)])
    #expect(strokes("⌥⌫") == [TerminalKeystroke(.backspace, modifiers: .option)])
    #expect(strokes("F2") == [TerminalKeystroke(.function(2))])
    #expect(strokes("⇧Tab") == [.shiftTab])
  }

  /// A leader is a key pressed and RELEASED. `^X m` with the control still
  /// held is `^X ^M`, which is Return.
  @Test("a leader's key is the chord and then a plain key")
  func leaders() {
    let models = ComboCatalog.opencode.combos.first { $0.label == "^X m" }
    #expect(models?.strokes == [.control("x"), TerminalKeystroke(.character("m"))])
    let stop = ComboCatalog.claude.combos.first { $0.label == "^X ^K" }
    #expect(stop?.strokes == [.control("x"), .control("k")])
    let queue = ComboCatalog.opencode.combos.first { $0.label == "^X ↵" }
    #expect(queue?.strokes == [.control("x"), TerminalKeystroke(.enter)])
    let details = ComboCatalog.gemini.combos.first { $0.label == "Tab Tab" }
    #expect(details?.strokes == [TerminalKeystroke(.tab), TerminalKeystroke(.tab)])
  }

  /// The prefix is a key you press and RELEASE. `^B c` with the control still
  /// held is `^B ^C`, which interrupts instead of making a window.
  @Test("a tmux combo is the prefix chord and then a plain key")
  func tmuxIsPrefixThenPlainKey() {
    let newWindow = ComboCatalog.tmux(prefix: "b").combos[0]
    #expect(newWindow.label == "^B c")
    #expect(newWindow.strokes == [.control("b"), TerminalKeystroke(.character("c"))])
    #expect(newWindow.strokes[1].modifiers.isEmpty)
    let copyMode = ComboCatalog.tmux(prefix: "b").combos.first { $0.label == "^B [" }
    let split = ComboCatalog.tmux(prefix: "b").combos.first { $0.label == "^B %" }
    #expect(copyMode?.strokes.last == TerminalKeystroke(.character("[")))
    #expect(split?.strokes.last == TerminalKeystroke(.character("%")))
  }

  @Test("screen's prefix is Control A, and a capital stays a capital")
  func screenKeys() {
    #expect(ComboCatalog.screen.combos[0].strokes == [.control("a"), TerminalKeystroke(.character("c"))])
    let rename = ComboCatalog.screen.combos.first { $0.label == "^A A" }
    #expect(rename?.strokes == [.control("a"), TerminalKeystroke(.character("A"))])
    let next = ComboCatalog.screen.combos.first { $0.label == "^A Tab" }
    #expect(next?.strokes == [.control("a"), TerminalKeystroke(.tab)])
  }

  @Test("a key says its presses for VoiceOver, and then its word")
  func spokenNames() {
    #expect(ComboCatalog.claude.combos[0].accessibilityLabel == "Control O, Transcript")
    #expect(ComboCatalog.claude.combos[3].accessibilityLabel == "Option P, Model")
    #expect(ComboCatalog.opencode.combos[3].accessibilityLabel == "Control X then m, Models")
    #expect(ComboCatalog.fixedRow(for: ComboCatalog.claude)[2].accessibilityLabel == "Escape then Escape, Rewind")
    #expect(ComboCatalog.fixedRow(for: ComboCatalog.copilot)[3].accessibilityLabel == "Control J")
  }

  /// Ids are what `ForEach` renders by, and `^T` is on five profiles.
  @Test("every combo in the catalog has its own id")
  func idsAreUnique() {
    let ids = Self.profiles.flatMap { $0.combos.map(\.id) }
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
    model.sink = {
      recorder.acts.append($0)
      return true
    }
    return (model, recorder)
  }

  @Test("the presses go out in order, one act each")
  func strokesInOrder() {
    let (model, recorder) = card()
    model.sendCombo(ComboCatalog.tmux(prefix: "b").combos[0])
    #expect(
      recorder.acts == [
        .keystroke(.control("b")),
        .keystroke(TerminalKeystroke(.character("c"))),
      ])
  }

  /// A combo names every key it presses. Folding an armed Ctrl into it would
  /// make `^A ^C` — the interrupt, not the window.
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
    model.sendCombo(ComboCatalog.shell.combos[5])
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
    model.sendCombo(ComboCatalog.shell.combos[0])
    #expect(recorder.acts == [.keystroke(.control("a"))])
    #expect(model.metaArmed == false)
  }
}
