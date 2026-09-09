import FieldAgents
import FieldTerminal

/// One answer the card can give on the user's behalf, as a value.
///
/// A chip is derived, never stored: the host re-derives the whole row every
/// time the card's bubble changes, and `InputCardModel.tapChip` refuses one
/// that is no longer in the row. That is the stale rule, and it is the reason
/// this carries its own `id` — identity has to survive a re-derivation so the
/// row can animate rather than flash, and so a tap that arrives one frame late
/// can be matched against what is on screen now.
public struct ReplyChip: Identifiable, Equatable, Sendable {
  public let id: String
  public let label: String
  /// What the tap MEANS. The chip does not know there is a terminal, in the
  /// same way the rest of this module does not.
  public let act: InputAct

  public init(id: String, label: String, act: InputAct) {
    self.id = id
    self.label = label
    self.act = act
  }
}

/// The chips for an agent that is waiting on a permission — a pure function of
/// the feed (K-D4).
///
/// **Why the vendor decides.** `thinking-ar-agent-plane.md` §7 leaves exactly
/// two approval transports, and they are not interchangeable:
///
/// - **TUI-typed** — Claude's own terminal UI owns the dialog and is already
///   drawing `1. Yes` / `2. Yes, and don't ask again` / `3. No`. There is no
///   API to resolve; the answer IS the keystroke. So the chip TYPES it, which
///   is a thing this phone can do today because it is attached to that very
///   terminal.
/// - **structured** — acp, codex and grok resolve through `approval.resolve`
///   over a product API that does not exist yet. A chip for them would be a
///   button with nowhere to send, so there is NO chip: the card's existing
///   "approve at the desktop" line already says the true thing, and D-i6 says
///   an absence is a state in words rather than a dead control.
///
/// Nothing here reads the terminal. A frame reaches this phone as TRF1 bytes
/// that only the Metal renderer can decode, so the design's regex-over-the-
/// last-rows detection (decision 3) is not merely unnecessary here, it is
/// impossible — and the feed is the better source anyway, because it is the
/// same fact that made the bubble loud.
public func replyChips(
  provider: AgentProvider,
  permissions: [AgentPermission]
) -> [ReplyChip] {
  // Not waiting, nothing to answer. This is the common case by far, and it is
  // what makes the chips row absent rather than empty.
  guard !permissions.isEmpty else { return [] }
  switch provider {
  case .claude:
    return [
      ReplyChip(id: "claude-yes", label: "1 YES", act: .sendDraft("1")),
      ReplyChip(id: "claude-yes-always", label: "2 YES, DON'T ASK", act: .sendDraft("2")),
      ReplyChip(id: "claude-no", label: "3 NO", act: .sendDraft("3")),
      // Not an answer — the interrupt. It is on the row because a dialog you
      // did not expect is most often one you want gone, and Esc is what the
      // design gives that gesture (§2's chip row: 1 / 2 / 3 / Esc).
      ReplyChip(id: "claude-esc", label: "ESC", act: .keystroke(TerminalKeystroke(.escape))),
    ]
  case .codex, .grok, .acp:
    // Absent, not disabled. See the structured transport above.
    return []
  }
}
