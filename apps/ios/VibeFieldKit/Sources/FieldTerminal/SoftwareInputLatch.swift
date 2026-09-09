import GhostteaTerminal

/// The card's sticky Ctrl, applied to the SOFTWARE keyboard's own events.
///
/// In Draft mode the composer field intercepts a latched character before it
/// reaches the draft (`InputCardModel.interceptCharacter`). In Live mode there
/// is no field to intercept: the Metal view is the `UITextInput`, and what
/// arrives here is already the kit's committed-text event. So the latch has to
/// meet the event instead of the keystroke, and this is the shaping — a pure
/// function, no state, so the rule can be pinned by calling it.
///
/// It reproduces the shape of the kit's own accessory latch
/// (`GhostteaAccessoryInputState.apply`, read at the pinned 0.10.1 checkout):
/// a single-character commit becomes a key event, Enter and Backspace become
/// their named keys, and a paste or an already-shaped key event is left alone.
/// We reproduce it rather than use it because the kit's latch is internal,
/// single-shot, and blind to the rail (K-D3 — one latch, ours, in both modes).
enum SoftwareInputLatch {

  /// The keystroke this event becomes under `modifiers`, or `nil` when the
  /// event should be forwarded untouched.
  ///
  /// `nil` is the honest answer in four cases, and each is a real one:
  /// - **no modifiers** — nothing to apply, and re-shaping a plain letter into
  ///   a hardware key event would change the path text takes for no reason;
  /// - **a multi-character commit** — an IME composition or a multi-scalar
  ///   grapheme has no single key to name, and guessing one would send the
  ///   wrong byte;
  /// - **`.paste`** — a block of text is not a keystroke (the caller does not
  ///   even ask the latch for one);
  /// - **`.key`** — already a key event, already carrying its own modifiers.
  static func keystroke(
    for event: GhostteaSoftwareInputEvent,
    modifiers: TerminalModifiers
  ) -> TerminalKeystroke? {
    guard !modifiers.isEmpty else { return nil }
    switch event {
    case .text(let text):
      guard text.count == 1, let character = text.first else { return nil }
      return TerminalKeystroke(.character(character), modifiers: modifiers)
    case .enter:
      return TerminalKeystroke(.enter, modifiers: modifiers)
    case .deleteBackward:
      return TerminalKeystroke(.backspace, modifiers: modifiers)
    case .paste, .key:
      return nil
    }
  }
}
