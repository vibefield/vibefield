import FieldInput
import FieldTerminal
import Foundation
import Testing

@testable import FieldHome

/// RB-2e — the Developer page's Input card states lab (DESIGN.md §8 "The phone's Settings", amended 2026-11-12 and
/// 2026-11-17; §9 "Developer"; asked for 2026-11-12). Each state the lab names is the real card's model, moved there
/// by the card's own public acts on a fresh model, so every state is held here without a view. The lab's sink takes
/// nothing, so nothing typed there is sent, and its names are §9's, read from DESIGN.md at the repo's root. The
/// Listening state's look is `DictationSession.labListening`, read when a mic is made; no row calls `start()`, which
/// with the flag down would ask Speech for real.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the Input card states lab: the real card in each of §9's states, and nothing sent")
@MainActor
struct InputCardStatesLabTests {
  /// DESIGN.md at the repo's root, six steps up from this file
  /// (`apps/ios/VibeFieldKit/Tests/FieldHomeTests/InputCardStatesLabTests.swift`).
  static let design = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("DESIGN.md")

  /// The bullet in §9 "Developer" that lists the lab's states, after Labs.
  static let listHead = "- The states in **Input card states**:"

  /// §9's list: the bullet's lines joined with one space, then every bold run after its head, in order. A name a
  /// line break splits joins again, as the page reads it.
  static func designNames() throws -> [String] {
    let lines = try String(contentsOf: design, encoding: .utf8).components(separatedBy: "\n")
    guard let head = lines.firstIndex(where: { $0.hasPrefix(listHead) }) else { return [] }
    var bullet = String(lines[head].dropFirst(listHead.count))
    var next = head + 1
    while next < lines.count, lines[next].hasPrefix("  ") {
      bullet += " " + lines[next].trimmingCharacters(in: .whitespaces)
      next += 1
    }
    let parts = bullet.components(separatedBy: "**")
    return stride(from: 1, to: parts.count, by: 2).map { parts[$0] }
  }

  /// A fresh model in `state`, as the lab seeds it.
  private func seeded(_ state: InputCardLabState) -> InputCardModel {
    let model = InputCardModel()
    state.seed(model)
    return model
  }

  @Test("the lab's names are §9's list, read from DESIGN.md, in its order")
  func namesAreSection9s() throws {
    let design = try Self.designNames()
    let lab = InputCardLabState.allCases.map { $0.name }
    #expect(!design.isEmpty, "no list headed \(Self.listHead) in \(Self.design.path)")
    #expect(lab == design)
  }

  @Test("A key’s fan, open: Ctrl's chord fan stands open, over a card whose keyboard is up")
  func fanOpen() {
    let model = seeded(.fanOpen)
    let fan = model.openFan
    let owner = model.keyboardOwner
    #expect(fan == KeyFan.control)
    // PF-8: the rail, and so a key's fan, stands in the terminal's mode alone.
    #expect(owner == .terminal)
  }

  @Test("Control, armed is one tap on Ctrl and Control, locked two, each over a card whose keyboard is up")
  func control() {
    let armed = seeded(.controlArmed)
    let locked = seeded(.controlLocked)
    let phases = [armed.latch.phase, locked.latch.phase]
    let owners = [armed.keyboardOwner, locked.keyboardOwner]
    #expect(phases == [.armed, .locked])
    #expect(owners == [.terminal, .terminal])
  }

  @Test("Meta, armed: Esc's burst waits for the next key, with the latch off and the letters up, so Esc says Meta")
  func meta() {
    let model = seeded(.metaArmed)
    let armed = model.metaArmed
    let phase = model.latch.phase
    let keypad = model.keypadShown
    let owner = model.keyboardOwner
    #expect(armed)
    #expect(phase == .off)
    #expect(!keypad)
    #expect(owner == .terminal)
  }

  @Test("Listening: the heard words are in the draft, and a mic made while the lab holds the look listens")
  func listening() {
    let model = seeded(.listening)
    let draft = model.draft
    let mode = model.mode
    let owner = model.keyboardOwner
    let listens = InputCardLabState.allCases.filter { $0.listens }
    DictationSession.labListening = true
    let held = DictationSession().state
    DictationSession.labListening = false
    let after = DictationSession().state
    #expect(draft == "run the tests and show me what fails")
    #expect(mode == .draft)
    #expect(owner == .composer)
    #expect(listens == [.listening])
    #expect(held == .listening)
    #expect(after == .idle)
  }

  @Test("the keypad stands in the system keyboard's place, on Navigate, Shortcuts and Fn")
  func keypad() {
    let states: [InputCardLabState] = [.keypadNavigate, .keypadShortcuts, .keypadFn]
    let models = states.map { seeded($0) }
    let shown = models.map { $0.keypadShown }
    let pages = models.map { $0.keypadPage }
    let titles = pages.map { $0.title }
    let owners = models.map { $0.keyboardOwner }
    #expect(shown == [true, true, true])
    #expect(pages == [.keys, .combos, .functions])
    #expect(titles == ["Navigate", "Shortcuts", "Fn"])
    #expect(owners == [.keypad, .keypad, .keypad])
    // PF-8: the keypad stands in the terminal's mode alone.
    #expect(models.map { $0.mode } == [.live, .live, .live])
  }

  @Test("A paste to read first: five made-up lines held for the review sheet, as a paste, in the terminal's mode")
  func pasteToRead() {
    let model = seeded(.pasteToRead)
    let pending = model.pendingPasteReview
    let lines = pasteLineCount(pending?.text ?? "")
    let commit = pending?.commit
    let named = pending?.text.contains("~/code/garden-planner") ?? false
    let mode = model.mode
    let owner = model.keyboardOwner
    #expect(lines >= InputCardModel.pasteReviewLines)
    #expect(commit == PendingPaste.Commit.paste)
    #expect(named)
    #expect(mode == .live)
    #expect(owner == .terminal)
  }

  @Test("Reply chips: the answers for a waiting agent stand on the row, over a card whose keyboard is up")
  func replyChips() {
    let model = seeded(.replyChips)
    let chips = model.chips
    let owner = model.keyboardOwner
    #expect(!chips.isEmpty)
    #expect(owner == .composer)
  }

  @Test("Typing into terminal: the keys go to the terminal, and the draft stays empty")
  func typingIntoTerminal() {
    let model = seeded(.typingIntoTerminal)
    let mode = model.mode
    let owner = model.keyboardOwner
    let draft = model.draft
    #expect(mode == .live)
    #expect(owner == .terminal)
    #expect(draft.isEmpty)
  }

  @Test("the lab's sink takes nothing in any state: every act is refused, so a Send keeps its draft")
  func nothingSent() {
    let acts: [InputAct] = [
      .keystroke(TerminalKeystroke(.enter)), .sendDraft("make test"), .typeText("make test"), .paste("make test"),
    ]
    var installed: [String] = []
    var refused: [String] = []
    var kept: [String] = []
    for state in InputCardLabState.allCases {
      let model = seeded(state)
      guard let sink = model.sink else { continue }
      installed.append(state.name)
      if acts.allSatisfy({ !sink($0) }) { refused.append(state.name) }
      model.draft = "make test"
      model.tapSend()
      if model.draft == "make test" { kept.append(state.name) }
    }
    let names = InputCardLabState.allCases.map { $0.name }
    #expect(installed == names)
    #expect(refused == names)
    #expect(kept == names)
  }

  @Test("Control, armed and Meta, armed are armed again while they stand, and let go once a key or a tap moves them")
  func keptWhileTheyStand() {
    let control = seeded(.controlArmed)
    InputCardLabState.controlArmed.keep(control)
    let held = control.latch.phase
    control.tapKey(.tab)
    InputCardLabState.controlArmed.keep(control)
    let spent = control.latch.phase
    let locked = seeded(.controlArmed)
    locked.tapControl()
    InputCardLabState.controlArmed.keep(locked)
    let stillLocked = locked.latch.phase
    let meta = seeded(.metaArmed)
    InputCardLabState.metaArmed.keep(meta)
    let metaHeld = meta.metaArmed
    meta.tapKey(.escape)
    InputCardLabState.metaArmed.keep(meta)
    let metaSpent = meta.metaArmed
    #expect(held == .armed)
    #expect(spent == .off)
    #expect(stillLocked == .locked)
    #expect(metaHeld)
    #expect(!metaSpent)
  }
}
