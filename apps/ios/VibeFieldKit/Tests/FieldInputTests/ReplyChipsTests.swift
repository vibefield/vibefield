import FieldAgents
import FieldTerminal
import Testing

@testable import FieldInput

/// K-D4, pinned: the chips are a pure function of the FEED, and the transport
/// is the vendor's. Nothing here touches a terminal, which is the point — the
/// phone cannot read one.
@Suite("reply chips")
struct ReplyChipsTests {
  private let bash = [AgentPermission(tool: "Bash")]

  /// The common case by far. An agent that is not waiting has nothing to
  /// answer, so the row is absent rather than empty.
  @Test("no pending permission, no chips — for every vendor")
  func nothingPendingIsNoChips() {
    for provider in AgentProvider.allCases {
      #expect(replyChips(provider: provider, permissions: []).isEmpty)
    }
  }

  /// Claude's own TUI is drawing `1. Yes / 2. Yes, and don't ask again / 3. No`
  /// in the terminal this phone is attached to, so the answer IS the keystroke
  /// and the chip types it.
  @Test("Claude's chips type the answer its TUI is asking for")
  func claudeTypesTheAnswer() {
    let chips = replyChips(provider: .claude, permissions: bash)
    // IOS-5v: sentence case (DESIGN.md §9), and the keystroke split off into
    // its own field because the canvas draws it in its own circle.
    #expect(chips.map(\.label) == ["Yes", "Yes, don't ask", "No", "Esc"])
    #expect(chips.map(\.number) == ["1", "2", "3", nil])
    #expect(chips.map(\.spokenLabel) == ["1, Yes", "2, Yes, don't ask", "3, No", "Esc"])
    #expect(
      chips.map(\.act) == [
        .sendDraft("1"),
        .sendDraft("2"),
        .sendDraft("3"),
        .keystroke(TerminalKeystroke(.escape)),
      ])
  }

  /// The structured transport (`approval.resolve` over the product API) does
  /// not exist yet. A chip for it would be a button with nowhere to send, and
  /// D-i6 says an absence is a state in words — the card's "approve at the
  /// desktop" line — never a dead control.
  @Test("the structured vendors get no chips until their transport exists")
  func structuredVendorsAreAbsentNotDisabled() {
    for provider in [AgentProvider.codex, .grok, .acp] {
      #expect(replyChips(provider: provider, permissions: bash).isEmpty)
    }
  }

  /// Several pending permissions are still one dialog on the far end: the TUI
  /// asks about them one at a time, and four chips is the answer to whichever
  /// is on screen.
  @Test("more than one pending permission is still one row of chips")
  func severalPermissionsAreOneRow() {
    let many = [AgentPermission(tool: "Bash"), AgentPermission(tool: "Write")]
    #expect(replyChips(provider: .claude, permissions: many).count == 4)
  }

  @Test("chip ids are stable across a re-derivation")
  func idsAreStable() {
    let first = replyChips(provider: .claude, permissions: bash)
    let second = replyChips(provider: .claude, permissions: [AgentPermission(tool: "Write")])
    #expect(first.map(\.id) == second.map(\.id))
  }
}

/// The stale rule. A permission can be resolved anywhere — at the desktop, by
/// another device, by the agent giving up — and the feed withdraws it the
/// moment it is. A chip that outlived its question must send nothing: `1` at a
/// shell prompt is not nothing.
@MainActor
@Suite("a chip sends only while it is still on the row")
struct ChipTapTests {
  private func card() -> (InputCardModel, Recorder) {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    return (model, recorder)
  }

  final class Recorder {
    var acts: [InputAct] = []
  }

  @Test("a chip on the row emits its act")
  func presentChipEmits() {
    let (model, recorder) = card()
    model.chips = replyChips(provider: .claude, permissions: [AgentPermission(tool: "Bash")])
    model.tapChip(model.chips[0])
    #expect(recorder.acts == [.sendDraft("1")])
  }

  @Test("a chip the feed withdrew before the tap sends nothing")
  func staleChipIsSilent() {
    let (model, recorder) = card()
    let chips = replyChips(provider: .claude, permissions: [AgentPermission(tool: "Bash")])
    model.chips = chips
    // The host re-derived from a feed that no longer carries the permission.
    model.chips = replyChips(provider: .claude, permissions: [])
    model.tapChip(chips[0])
    #expect(recorder.acts.isEmpty)
  }

  /// A re-derivation makes new VALUES for the same chips, and a tap carrying
  /// the previous value is still that chip. Matching on the whole struct
  /// would drop an answer the user meant.
  @Test("a re-derived row still accepts a tap carrying the old value")
  func rederivedRowStillAccepts() {
    let (model, recorder) = card()
    let stale = replyChips(provider: .claude, permissions: [AgentPermission(tool: "Bash")])
    model.chips = replyChips(provider: .claude, permissions: [AgentPermission(tool: "Write")])
    model.tapChip(stale[3])
    #expect(recorder.acts == [.keystroke(TerminalKeystroke(.escape))])
  }

  /// Closing the card takes the chips with it: they belong to the bubble that
  /// raised it, and the next session's card must not inherit an answer.
  @Test("reset clears the row")
  func resetClearsTheRow() {
    let (model, _) = card()
    model.chips = replyChips(provider: .claude, permissions: [AgentPermission(tool: "Bash")])
    model.reset()
    #expect(model.chips.isEmpty)
  }
}
