import FieldTerminal
import Foundation
import Observation

/// What one act on the input card MEANS, in the terminal's vocabulary but not
/// its machinery.
///
/// The card never touches an attachment: it emits these and the host turns
/// each into the matching verb. That is what lets the whole card be tested
/// without a mesh, a simulator, or a Ghosttea import — the finding from the
/// IOS-3 review was that every serious bug lived in the one module with no
/// test target, and this is the seam that keeps this module out of that shape.
public enum InputAct: Equatable, Sendable {
  case keystroke(TerminalKeystroke)
  case sendDraft(String)
  case typeText(String)
  // --- IOS-5c
  /// Text straight through as ONE input, with no Enter behind it.
  ///
  /// Distinct from `typeText` on purpose: the host turns this into the kit's
  /// paste op, which the far terminal brackets when the program running there
  /// has DECSET 2004 on — so a pasted block arrives as a block rather than as
  /// a run of commands. Distinct from `sendDraft` because a paste in the
  /// terminal's own line editor is the user's to finish; committing it would
  /// run whatever they were about to read.
  case paste(String)
  // --- end IOS-5c
}

// --- IOS-5c ---------------------------------------------------------------
/// A paste held back for the user to look at before it goes through.
///
/// Identity is the text itself, which is what a sheet presented by `item:`
/// needs and also the right answer: pasting the same block twice is the same
/// question twice, and a fresh identity would re-present a sheet the user has
/// already answered.
public struct PendingPaste: Identifiable, Equatable, Sendable {
  // --- IOS-5d ---------------------------------------------------------------
  /// What SEND on the review sheet actually does.
  ///
  /// IOS-5c had one answer because there was one source: the paste chip, whose
  /// text is always a block with no Enter behind it. IOS-5d added a second —
  /// a snippet, which may have been written to RUN — and a sheet that says
  /// "nothing runs until you press Enter" over text that runs on SEND would be
  /// the one lie on this card. So the commit rides with the text, and the
  /// sheet reads it.
  public enum Commit: Equatable, Sendable {
    /// The kit's paste op: one block, bracketed where the far program asks
    /// for it, and nothing runs.
    case paste
    /// Typed through as input, still with no Enter behind it.
    case type
    /// The block, then Enter. Only a snippet the user marked "sends Enter"
    /// reaches this, and the sheet says so in as many words.
    case run
  }

  public let text: String
  public let commit: Commit
  // --- end IOS-5d -----------------------------------------------------------
  public var id: String { text }

  public init(text: String, commit: Commit = .paste) {
    self.text = text
    self.commit = commit
  }
}

// --- IOS-5d -----------------------------------------------------------------
/// A door the `+` menu opens.
///
/// Three, and exactly three (K-D6): Photo, Take Photo and Choose File are
/// ABSENT rather than disabled, because a phone-to-host file transport does
/// not exist — EL2 says bytes ride ticketed direct sockets, and no mesh verb
/// has been minted to carry a file from this phone to a desktop. A greyed
/// "Choose File" would promise a door with nothing behind it, which is the one
/// thing D-i6 forbids. They arrive with the verb, not before it.
public enum CardSurface: String, Identifiable, Equatable, Sendable {
  case snippets
  case clipboardHistory
  case scanText

  public var id: String { rawValue }
}

/// Which face of the `⋯` keypad is showing.
///
/// Three pages rather than one long grid, because the three have different
/// natures: Keys and Combos are always key EVENTS, while Symbols is text in
/// Draft and input in Live. Mixing them would make one keypad whose keys mean
/// two things depending on where on it you press.
public enum KeypadPage: String, Equatable, Sendable, CaseIterable {
  case keys
  case symbols
  case combos

  /// The segmented row's face. Mono 9 heavy, like every other label here.
  public var title: String {
    switch self {
    case .keys: return "KEYS"
    case .symbols: return "SYMBOLS"
    case .combos: return "COMBOS"
    }
  }
}
// --- end IOS-5d -------------------------------------------------------------
// --- end IOS-5c -----------------------------------------------------------

/// The sticky Ctrl, as a pure value.
///
/// Three phases and one rule each: a tap walks off → armed → locked → off; a
/// consumed key clears `armed` and LEAVES `locked` (that is the whole point of
/// locking); and only `armed` expires. Nothing here schedules anything — the
/// model owns the clock, so this stays testable by calling it.
public struct LatchState: Equatable, Sendable {
  public enum Phase: Equatable, Sendable {
    case off
    case armed
    case locked
  }

  public private(set) var phase: Phase = .off

  public init() {}

  /// The modifiers a key would carry right now, without consuming anything —
  /// what the CTRL key's own appearance is drawn from.
  public var modifiers: TerminalModifiers { phase == .off ? [] : .control }

  /// VoiceOver's name for the key in this phase. The announcement is IOS-5e;
  /// the label is now, because a control whose state is only a fill is
  /// invisible to a screen reader until it is named.
  public var accessibilityLabel: String {
    switch phase {
    case .off: return "Control"
    case .armed: return "Control armed"
    case .locked: return "Control locked"
    }
  }

  public mutating func tap() {
    switch phase {
    case .off: phase = .armed
    case .armed: phase = .locked
    case .locked: phase = .off
    }
  }

  /// Take the modifiers for one key. Armed spends itself; locked does not.
  public mutating func consume() -> TerminalModifiers {
    let taken = modifiers
    if phase == .armed { phase = .off }
    return taken
  }

  /// The 3 s timeout. A LOCKED latch is deliberately immune: it was locked on
  /// purpose and only a third tap releases it.
  public mutating func expire() {
    if phase == .armed { phase = .off }
  }
}

/// The input card's state and every act it can emit.
///
/// Two modes, one model. Draft edits a local `draft` and sends it as a block;
/// Live hands the keyboard to the terminal itself. The draft survives the trip
/// either way — leaving Live gives it back untouched — and the rail's keys
/// mean the same thing in both.
@MainActor
@Observable
public final class InputCardModel {
  /// The spec's names for the two modes. Neither name reaches the screen: the
  /// copy rule out of the design's decision table is that the word "Live"
  /// never appears in UI, so the mode is a terminal glyph and a strip that
  /// says what is happening instead of what it is called.
  public enum Mode: Equatable, Sendable {
    case draft
    case live
  }

  public var mode: Mode = .draft
  public var draft: String = ""
  public var latch = LatchState()
  // --- IOS-5b ---------------------------------------------------------------
  /// The Meta burst: `.option` on exactly the next keystroke, then gone.
  ///
  /// Alt has no rail slot (decision 4): Alt-x is ESC x for readline, emacs and
  /// zsh, so Esc then x already does it. What Esc-then-x does NOT do is tmux,
  /// which wants the escape and the key as one burst — so long-pressing ESC
  /// arms this instead and the next keystroke carries `.option`, which the kit
  /// encodes. One shot rather than a latch: a second phase here would be a
  /// second sticky modifier with no dot to tell it from the first.
  public private(set) var metaArmed = false
  /// Which rail key's long-press fan is open, or none. Opened and closed
  /// through `showFan`/`closeFan`, which also mind the keyboard.
  ///
  /// Card state rather than view state, for two reasons: only one fan may be
  /// open at a time across every key, which a per-key `@State` cannot promise;
  /// and a headless fixture with no finger can then open one to be looked at.
  public private(set) var openFan: KeyFan?
  // --- end IOS-5b -----------------------------------------------------------
  /// Whether the composer field wants the keyboard. Exactly one responder
  /// holds it at a time: in Live the terminal does, so this is false.
  ///
  /// It is intent AND reality in one flag: the host raises the field from it,
  /// and the field's own delegate writes back when the keyboard goes away
  /// under the user's thumb. `terminalFocused` is its twin for the other mode
  /// and works the same way.
  public var fieldFocused: Bool = false
  // --- IOS-5c
  /// The same flag for the terminal's own keyboard, fed by the host from
  /// `TerminalSurface.onFocusChange`.
  ///
  /// Live cannot infer this from the mode: the mode says the terminal is the
  /// one that WOULD take the keys, while this says whether it is holding the
  /// keyboard right now — and those come apart the moment the user puts the
  /// keyboard down without leaving the mode, which is exactly the state the
  /// closed row is for.
  public var terminalFocused: Bool = false
  /// Bumped by `requestKeyboard()`. The host passes it to `TerminalSurface` so
  /// a request can be made TWICE with the same answer: after the terminal has
  /// resigned on its own, "please take the keyboard" is the same value it
  /// already holds, and without a nonce the surface would rightly skip it.
  public private(set) var keyboardRequests: Int = 0
  /// Reply chips for the card's bubble, re-derived by the host whenever the
  /// bubble changes — never accumulated here. The row on screen IS the row
  /// the feed justifies, which is what makes the stale rule in `tapChip`
  /// enforceable rather than aspirational.
  public var chips: [ReplyChip] = []
  /// A paste too long to send unseen, waiting for the review sheet's answer.
  public var pendingPasteReview: PendingPaste?
  // --- end IOS-5c
  // --- IOS-5d ---------------------------------------------------------------
  /// Whether OUR keypad is standing in for the system keyboard.
  ///
  /// It is one flag for both modes even though the mechanism differs — in
  /// Draft the composer field swaps its own `inputView`, in Live a hidden
  /// responder rides one (K-D5) — because the user's fact is the same either
  /// way: the letters are gone and the terminal keys are there. The views
  /// listen and each does its half.
  public private(set) var keypadShown = false
  /// The page the keypad is on. It SURVIVES `reset`, which the rest of this
  /// model does not: the design says the keypad remembers its last page, and a
  /// person who works in tmux wants Combos again next time.
  public var keypadPage: KeypadPage = .keys
  /// Whether the `+` menu is open. The glyph rotates 45° from it, which is the
  /// whole reason this is state rather than a system `Menu` — see `PlusMenu`.
  public private(set) var plusMenuOpen = false
  /// The door the `+` menu asked for, or none. The host presents it.
  public var surface: CardSurface?
  /// The ring of pasted text, installed by the host. Absent is a card that
  /// records nothing and works the same otherwise — the demo fixture, and any
  /// host that has not asked for a history.
  @ObservationIgnored public var history: ClipboardHistory?
  // --- end IOS-5d -----------------------------------------------------------
  /// Installed by the host at attach, cleared when the card closes. Absent is
  /// a card with nowhere to send — it still renders and still accepts taps,
  /// which is what the demo fixture is.
  public var sink: ((InputAct) -> Void)?

  /// The armed latch's clock. Held so a second tap, a consumed key, or a mode
  /// flip can cancel it — a stale timer disarming a latch the user re-armed is
  /// exactly the kind of ghost a 3 s window makes hard to see.
  @ObservationIgnored private var expiryTask: Task<Void, Never>?
  // --- IOS-5b: the burst's own clock, on the arm's discipline ---------------
  @ObservationIgnored private var metaExpiryTask: Task<Void, Never>?
  /// Whether the composer held the keyboard when the fan opened. See
  /// `closeFan` — it restores, and never raises.
  @ObservationIgnored private var keyboardWasUpBeforeFan = false
  // --- IOS-5d: the same bookkeeping for the `+` menu, which is a presentation
  // for the same reason the fan is and takes the keyboard the same way.
  @ObservationIgnored private var keyboardWasUpBeforeMenu = false
  // --- end IOS-5b -----------------------------------------------------------

  public init() {}

  // MARK: - Acts

  /// A rail key. It carries whatever the latch holds and spends it.
  public func tapKey(_ key: TerminalKey) {
    let modifiers = consumeModifiers()
    emit(.keystroke(TerminalKeystroke(key, modifiers: modifiers)))
  }

  /// The CTRL key: off → armed → locked → off, with the arm window restarted
  /// on every tap that lands on `armed`.
  public func tapControl() {
    latch.tap()
    restartExpiry()
  }

  // --- IOS-5b ---------------------------------------------------------------
  /// A chord picked out of a long-press fan — `^C`, `⇧TAB`, `HOME`.
  ///
  /// A fan key names its own modifiers, so the latch does not add to them: the
  /// user asked for `^C`, not for `^^C`, and picking HOME with Ctrl held should
  /// give Home rather than Ctrl-Home. The latch is still SPENT, though — an arm
  /// the fan already answered must not survive onto the next typed letter — and
  /// a locked latch stays locked, because locking was deliberate.
  ///
  /// The Meta burst is the one modifier that does ride along: it is a one-shot
  /// on "the next keystroke", and a chord is a keystroke.
  public func tapChord(_ stroke: TerminalKeystroke) {
    let carried = consumeModifiers()
    var stroke = stroke
    stroke.modifiers.formUnion(carried.intersection(.option))
    emit(.keystroke(stroke))
  }

  /// A long press landed on a rail key: show its fan.
  public func showFan(_ fan: KeyFan) {
    keyboardWasUpBeforeFan = fieldFocused
    openFan = fan
  }

  /// The fan is done — picked from, or dismissed by a tap outside.
  ///
  /// It gives the keyboard back only if the composer had it when the fan
  /// opened. A popover is a presentation, and a presentation can take the
  /// first responder with it; asking for it back unconditionally would RAISE a
  /// keyboard the user had put away, which is the opposite mistake.
  public func closeFan() {
    openFan = nil
    if keyboardWasUpBeforeFan { fieldFocused = true }
  }

  /// Long-press ESC: arm `.option` for the next keystroke.
  ///
  /// Arming twice restarts the window rather than toggling — three seconds is
  /// short enough that waiting one out is cheaper than a second meaning on the
  /// same gesture.
  public func armMeta() {
    metaArmed = true
    restartMetaExpiry()
  }

  /// The burst's window elapsed. Public for the same reason `latchExpired` is:
  /// the clock is the model's, and a test drives it rather than waiting.
  public func metaExpired() {
    metaArmed = false
    metaExpiryTask = nil
  }

  /// Live mode's half of the latch: what the next key from the TERMINAL's own
  /// keyboard carries.
  ///
  /// The host installs this on `TerminalAttachment.softwareInputLatch`, which
  /// calls it once per software-input event. It CONSUMES, exactly like a rail
  /// tap does — an armed latch is spent here and a locked one is not — so the
  /// same three-phase rule holds whichever responder holds the keyboard, which
  /// is the whole of K-D3's "one latch, ours, in both modes".
  public func takeLatchForTerminal() -> TerminalModifiers {
    consumeModifiers()
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// Send. Never disabled and never refuses: an empty draft is Enter, which is
  /// what "run it" means with nothing left to say (D-i6 — an absence is an
  /// honest state, not a greyed-out control).
  public func tapSend() {
    let text = draft
    draft = ""
    emit(.sendDraft(text))
  }

  /// The `>_` key. The draft persists across the flip in both directions; only
  /// the keyboard's owner changes.
  public func toggleMode() {
    mode = mode == .draft ? .live : .draft
    // One keyboard, one responder. UIKit hands off on its own when the other
    // view becomes first responder, but saying it here keeps the model the
    // single place that knows which mode owns the keys.
    fieldFocused = mode == .draft
    // --- IOS-5c: the twin flag, kept exclusive with it.
    // --- IOS-5d: unless the keypad is up in Live, where the responder holding
    // the keys is the hidden keypad host and NOT the terminal. Claiming the
    // terminal has focus there would ask the Metal view to take the keyboard
    // back and close the keypad the user just opened.
    terminalFocused = mode == .live && !keypadShown
    // --- end IOS-5d
    // --- end IOS-5c
  }

  // --- IOS-5c -------------------------------------------------------------

  /// Who is holding the keyboard, if anyone.
  ///
  /// `.none` is not an error state — it is the card at rest: a session opens
  /// with the keyboard down, and the user puts it down again whenever the
  /// terminal underneath matters more than the next keystroke. The card
  /// collapses to one row there (the design's `MainClosed`) rather than
  /// hovering 110 pt of keys over nothing.
  public enum KeyboardOwner: Equatable, Sendable {
    case none
    case composer
    case terminal
    // --- IOS-5d
    /// Our own keypad, in place of the system keyboard.
    ///
    /// Its own case rather than folded into the other two, because it is a
    /// different fact in both modes at once: in Draft the composer is still
    /// the responder but the letters are gone, and in Live the terminal has
    /// RESIGNED to a hidden host. What the card needs from this answer is the
    /// same in both — the keyboard is up, so do not collapse to one row — and
    /// naming it keeps that testable instead of implied.
    case keypad
    // --- end IOS-5d
  }

  public var keyboardOwner: KeyboardOwner {
    // --- IOS-5d: the keypad IS the keyboard while it is up, in either mode.
    if keypadShown { return .keypad }
    // --- end IOS-5d
    switch mode {
    case .draft: return fieldFocused ? .composer : .none
    case .live: return terminalFocused ? .terminal : .none
    }
  }

  /// The KEYBOARD chip: ask for it back, for whichever mode is current.
  public func requestKeyboard() {
    switch mode {
    case .draft: fieldFocused = true
    case .live: terminalFocused = true
    }
    keyboardRequests += 1
  }

  /// Put it down. The swipe on the rail, and the one act that can leave the
  /// card with no responder while a mode is still selected.
  public func dismissKeyboard() {
    fieldFocused = false
    terminalFocused = false
    // --- IOS-5d: the keypad rides a first responder, so putting the keyboard
    // down puts it away too — and the flag has to follow, or the card would
    // hold a rail over a keypad that is no longer on screen.
    keypadShown = false
    // --- end IOS-5d
  }

  /// A reply chip. It sends only if it is STILL on the row.
  ///
  /// The permission a chip answers can be resolved anywhere — at the desktop,
  /// by another device, by the agent timing out — and the feed withdraws it
  /// the moment it is. A tap that lands in that window would answer a question
  /// nobody is asking, and `1` typed at a shell prompt is not nothing. So the
  /// row the host derived is the authority, and identity is the id: a
  /// re-derivation makes new values for the same chips, and equality on the
  /// whole struct would reject a chip that is plainly still there.
  public func tapChip(_ chip: ReplyChip) {
    guard chips.contains(where: { $0.id == chip.id }) else { return }
    emit(chip.act)
  }

  /// Text arriving from the paste chip.
  ///
  /// Draft appends rather than replaces — a paste is usually the second half
  /// of a thought whose first half is already typed — and it lands on its own
  /// line, because the two halves were composed apart and running them
  /// together is never what was meant.
  ///
  /// Live sends it through, except when it is long enough to be worth reading
  /// first: five lines is where a paste stops being a value and starts being a
  /// program, and a program dropped into a live shell runs. The threshold is
  /// the design's (§4, the `+` menu's "multi-line goes through review").
  public func acceptPaste(_ text: String) {
    acceptPaste(text, remember: true)
  }

  // --- IOS-5d ---------------------------------------------------------------
  /// The same door, with the ring made optional.
  ///
  /// `remember` is false for exactly one caller: a snippet, which is already
  /// saved under `+` and would otherwise appear twice — once as the snippet
  /// the user wrote and once as a thing they "pasted". Scanned text DOES get
  /// remembered: it came from outside the phone and there is nowhere else to
  /// find it again.
  public func acceptPaste(_ text: String, remember: Bool) {
    guard !text.isEmpty else { return }
    if remember { history?.record(text) }
    // --- end IOS-5d ---------------------------------------------------------
    switch mode {
    case .draft:
      if draft.isEmpty {
        draft = text
      } else if draft.hasSuffix("\n") {
        draft += text
      } else {
        draft += "\n" + text
      }
    case .live:
      if pasteLineCount(text) >= Self.pasteReviewLines {
        pendingPasteReview = PendingPaste(text: text)
      } else {
        emit(.paste(text))
      }
    }
  }

  /// SEND on the review sheet.
  public func confirmPasteReview() {
    guard let pending = pendingPasteReview else { return }
    pendingPasteReview = nil
    // --- IOS-5d: what SEND means is the pending paste's own, not this
    // method's — a snippet marked "sends Enter" arrives here to RUN.
    switch pending.commit {
    case .paste: emit(.paste(pending.text))
    case .type: emit(.typeText(pending.text))
    case .run: emit(.sendDraft(pending.text))
    }
    // --- end IOS-5d
  }

  /// CANCEL, and every other way the sheet can close. Nothing is sent and the
  /// text is dropped: the pasteboard still holds it, so there is nothing here
  /// worth keeping.
  public func cancelPasteReview() {
    pendingPasteReview = nil
  }

  /// Five, from the design. Named because the test that pins 4-sends/5-reviews
  /// should read as the rule rather than as two magic numbers.
  public static let pasteReviewLines = 5

  // --- end IOS-5c ---------------------------------------------------------

  /// The arm window elapsed. Public because the timer is the model's, but a
  /// test drives it directly rather than waiting three seconds.
  public func latchExpired() {
    latch.expire()
    expiryTask = nil
  }

  /// The composer field asks this before inserting a single typed character.
  ///
  /// An armed or locked latch turns that character into a control byte rather
  /// than text — `Ctrl` then `c` is `^C`, and the `c` must NOT also land in
  /// the draft. Returns true when the character was taken.
  public func interceptCharacter(_ character: Character) -> Bool {
    // IOS-5b: the burst counts too. A Meta-armed letter typed into the composer
    // is `Esc x` on the wire, and leaving it in the draft would swallow the
    // burst the user just armed.
    guard latch.phase != .off || metaArmed else { return false }
    let modifiers = consumeModifiers()
    emit(.keystroke(TerminalKeystroke(.character(character), modifiers: modifiers)))
    return true
  }

  // --- IOS-5d mic -----------------------------------------------------------
  // MARK: - Dictation
  //
  // Dictation lands in the DRAFT, never on the wire, so all of it that this
  // model owns is a string rule: where the heard text goes, and which part of
  // the draft the next refinement is allowed to overwrite. Speech itself lives
  // in `DictationSession` — the model stays a pure state machine with no
  // framework in it, which is what lets these rules be tested by calling them.

  /// The span the current dictation owns, as character offsets into `draft`.
  ///
  /// Character offsets rather than `String.Index` on purpose: the draft is
  /// edited by a UIKit text view underneath us, and an index into a string
  /// that has since been mutated is a trap rather than a stale number.
  @ObservationIgnored private var dictationSpan: Range<Int>?

  /// A partial arrived. The FIRST one appends; every one after it refines what
  /// the first put there.
  ///
  /// Recognition does not stream words, it re-reads the whole phrase — "get
  /// status" becoming "git status" arrives as the whole phrase again — so a
  /// second append would leave both. The separating space is added only when
  /// there is something to separate: an empty draft, or one already ending in
  /// whitespace, gets none.
  public func appendDictation(_ text: String) {
    if validDictationSpan() != nil {
      replaceDictationTail(text)
      return
    }
    guard !text.isEmpty else { return }
    let separator = draft.isEmpty || draft.last?.isWhitespace == true ? "" : " "
    let start = draft.count + separator.count
    draft += separator + text
    dictationSpan = start..<(start + text.count)
  }

  /// Refine what dictation already put in the draft, leaving everything the
  /// user typed around it alone.
  ///
  /// A no-op when no dictation is open: replacing a tail nobody started would
  /// have to guess which words were heard rather than typed.
  public func replaceDictationTail(_ text: String) {
    guard let span = validDictationSpan() else { return }
    let lower = draft.index(draft.startIndex, offsetBy: span.lowerBound)
    let upper = draft.index(draft.startIndex, offsetBy: span.upperBound)
    draft.replaceSubrange(lower..<upper, with: text)
    dictationSpan = span.lowerBound..<(span.lowerBound + text.count)
  }

  /// The run ended: the heard words stop being a span and become ordinary
  /// draft. The next dictation appends AFTER them rather than over them.
  public func commitDictation() {
    dictationSpan = nil
  }

  /// The span, or nil — and a stale one is dropped on the way past.
  ///
  /// The draft moves under this: Send clears it, the user edits it, `reset()`
  /// empties it for the next session. Rather than a line in each of those
  /// places, the span proves itself against the draft's length every time it
  /// is used, so a span that no longer fits simply stops existing and the next
  /// partial appends fresh.
  private func validDictationSpan() -> Range<Int>? {
    guard let span = dictationSpan else { return nil }
    guard span.upperBound <= draft.count else {
      dictationSpan = nil
      return nil
    }
    return span
  }
  // --- end IOS-5d mic -------------------------------------------------------

  /// Back to the resting card: a new session gets a new draft, and a latch
  /// left locked on the last card must not arm the first key of the next one.
  public func reset() {
    mode = .draft
    draft = ""
    latch = LatchState()
    fieldFocused = false
    // --- IOS-5c: the chips belong to the bubble that raised the card, and a
    // paste held for review belongs to the session it was aimed at.
    terminalFocused = false
    chips = []
    pendingPasteReview = nil
    // --- end IOS-5c
    expiryTask?.cancel()
    expiryTask = nil
    // --- IOS-5b: the burst and the fan belong to the card being closed ------
    metaArmed = false
    metaExpiryTask?.cancel()
    metaExpiryTask = nil
    openFan = nil
    keyboardWasUpBeforeFan = false
    // --- end IOS-5b ---------------------------------------------------------
    // --- IOS-5d: every door the card opened closes with it. `keypadPage` is
    // deliberately NOT reset — the design says the keypad remembers its last
    // page, and that memory is a preference rather than session state.
    keypadShown = false
    plusMenuOpen = false
    keyboardWasUpBeforeMenu = false
    surface = nil
    // --- end IOS-5d
  }

  // --- IOS-5d ---------------------------------------------------------------

  // MARK: - The keypad

  /// The `⋯` key. Up, down, and nothing else on the same gesture.
  public func toggleKeypad() {
    setKeypad(!keypadShown)
  }

  /// `abc` and every other way the keypad closes, plus the way it opens.
  ///
  /// The responder work is the views' — the composer swaps its `inputView`,
  /// the hidden host takes and gives back the keys — but the FLAGS are here,
  /// because "who holds the keyboard" has exactly one owner in this app and it
  /// is not a `UIViewRepresentable`.
  public func setKeypad(_ shown: Bool) {
    guard keypadShown != shown else { return }
    keypadShown = shown
    switch (mode, shown) {
    case (.draft, true):
      // The field keeps the responder; only what rises under it changes.
      fieldFocused = true
    case (.draft, false):
      fieldFocused = true
    case (.live, true):
      // The hidden host is about to take the keys off the Metal view. Saying
      // so here rather than waiting for `onFocusChange` keeps the card from
      // rendering one frame of a terminal that thinks it still has them.
      terminalFocused = false
    case (.live, false):
      // The terminal takes the keyboard back, through the same nonce the
      // KEYBOARD chip uses — the request has to be distinguishable from the
      // last one or the surface would rightly skip it.
      requestKeyboard()
    }
  }

  /// A key on the keypad's Symbols page.
  ///
  /// Two behaviours, and the design names both (§4): a symbol TYPES into the
  /// draft or goes THROUGH in Live. The latch outranks both — `Ctrl` then backslash
  /// is a control byte in either mode, and leaving it in the draft would eat a
  /// modifier the user just armed, which is the same rule `interceptCharacter`
  /// enforces for the system keyboard.
  public func typeSymbol(_ character: Character) {
    if latch.phase != .off || metaArmed {
      let modifiers = consumeModifiers()
      emit(.keystroke(TerminalKeystroke(.character(character), modifiers: modifiers)))
      return
    }
    switch mode {
    case .draft: draft.append(character)
    case .live: emit(.typeText(String(character)))
    }
  }

  /// A combo off the Combos page: its presses, in order.
  ///
  /// The latch is SPENT and not applied. A combo names every key it presses —
  /// `^B c` is a control chord and then a plain `c` — and folding an armed
  /// Ctrl into it would make `^B ^C`, which is not what anyone armed it for.
  /// Spending it is still right: an arm the user answered with a combo must
  /// not survive onto the next letter they type. The Meta burst goes the same
  /// way and for the same reason, which is the one place this differs from
  /// `tapChord`: a chord is one keystroke and can carry a burst, a combo is a
  /// script and the burst has no single key to ride.
  public func sendCombo(_ combo: Combo) {
    _ = consumeModifiers()
    for stroke in combo.strokes {
      emit(.keystroke(stroke))
    }
  }

  // MARK: - The `+` menu and its doors

  /// `+` was tapped.
  public func showPlusMenu() {
    keyboardWasUpBeforeMenu = fieldFocused
    plusMenuOpen = true
  }

  /// The menu closed — picked from, or dismissed by a tap outside.
  ///
  /// It gives the keyboard back on a dismissal and NOT on a pick, for the same
  /// reason `closeFan` restores conditionally: a sheet is about to rise over
  /// this card, and raising a keyboard into it would fight the presentation
  /// for the same screen.
  public func closePlusMenu(restoringKeyboard: Bool = true) {
    plusMenuOpen = false
    if restoringKeyboard, keyboardWasUpBeforeMenu { fieldFocused = true }
    keyboardWasUpBeforeMenu = false
  }

  /// An item on the `+` menu: close the menu, then open the door.
  ///
  /// The two are deliberately not one turn. A popover and a sheet are both
  /// presentations of the same controller, and asking for the second while the
  /// first is still dismissing is a sheet that never appears — the finding
  /// IOS-5c recorded when it moved the review sheet off the root. So the menu
  /// goes first and the door follows it.
  public func requestSurface(_ wanted: CardSurface) {
    closePlusMenu(restoringKeyboard: false)
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(Self.surfaceHandoff))
      self?.surface = wanted
    }
  }

  /// Long enough for a popover to finish leaving. Named because a bare 260 in
  /// the middle of a `Task` reads as a guess rather than as a handoff.
  static let surfaceHandoff = 260

  /// The door closed, however it was closed.
  public func closeSurface() {
    surface = nil
  }

  /// A snippet was tapped.
  ///
  /// Draft never sends: the snippet lands in the draft on its own line and the
  /// user finishes it, which is the whole reason Draft exists. Live sends —
  /// with Enter when the snippet was written to run, without when it was
  /// written to be completed — and goes through the review first when it is
  /// long enough to be a program rather than a command (five lines, IOS-5c's
  /// threshold, applied to the same kind of danger).
  public func useSnippet(_ snippet: Snippet) {
    let text = snippet.text
    guard !text.isEmpty else { return }
    switch mode {
    case .draft:
      // `remember: false` — it is already saved under `+`, and a history that
      // lists the user's own snippets back to them is noise.
      acceptPaste(text, remember: false)
    case .live:
      let commit: PendingPaste.Commit = snippet.sendsEnter ? .run : .type
      if pasteLineCount(text) >= Self.pasteReviewLines {
        pendingPasteReview = PendingPaste(text: text, commit: commit)
      } else if snippet.sendsEnter {
        emit(.sendDraft(text))
      } else {
        emit(.typeText(text))
      }
    }
  }
  // --- end IOS-5d -------------------------------------------------------------

  // MARK: - Plumbing

  /// Take the modifiers for one key and spend what is spendable: the armed
  /// latch (a locked one survives) and the Meta burst (always one shot).
  private func consumeModifiers() -> TerminalModifiers {
    var modifiers = latch.consume()
    // Only an armed latch had a clock; consuming it ends the window whether or
    // not the phase moved.
    if latch.phase != .armed {
      expiryTask?.cancel()
      expiryTask = nil
    }
    // --- IOS-5b ---
    if metaArmed {
      modifiers.insert(.option)
      metaArmed = false
      metaExpiryTask?.cancel()
      metaExpiryTask = nil
    }
    // --- end IOS-5b ---
    return modifiers
  }

  private func restartExpiry() {
    expiryTask?.cancel()
    guard latch.phase == .armed else {
      expiryTask = nil
      return
    }
    expiryTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(3))
      guard !Task.isCancelled else { return }
      self?.latchExpired()
    }
  }

  // --- IOS-5b: the same three seconds, on its own task ----------------------
  /// A separate clock from the latch's on purpose: the two windows are
  /// independent (Ctrl can be locked while a burst is armed), and sharing one
  /// task would let either arm cancel the other's window.
  private func restartMetaExpiry() {
    metaExpiryTask?.cancel()
    metaExpiryTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(3))
      guard !Task.isCancelled else { return }
      self?.metaExpired()
    }
  }
  // --- end IOS-5b -----------------------------------------------------------

  private func emit(_ act: InputAct) {
    sink?(act)
  }
}
