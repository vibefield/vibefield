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
}

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
  /// Whether the composer field wants the keyboard. Exactly one responder
  /// holds it at a time: in Live the terminal does, so this is false.
  public var fieldFocused: Bool = false
  /// Installed by the host at attach, cleared when the card closes. Absent is
  /// a card with nowhere to send — it still renders and still accepts taps,
  /// which is what the demo fixture is.
  public var sink: ((InputAct) -> Void)?

  /// The armed latch's clock. Held so a second tap, a consumed key, or a mode
  /// flip can cancel it — a stale timer disarming a latch the user re-armed is
  /// exactly the kind of ghost a 3 s window makes hard to see.
  @ObservationIgnored private var expiryTask: Task<Void, Never>?

  public init() {}

  // MARK: - Acts

  /// A rail key. It carries whatever the latch holds and spends it.
  public func tapKey(_ key: TerminalKey) {
    let modifiers = consumeLatch()
    emit(.keystroke(TerminalKeystroke(key, modifiers: modifiers)))
  }

  /// The CTRL key: off → armed → locked → off, with the arm window restarted
  /// on every tap that lands on `armed`.
  public func tapControl() {
    latch.tap()
    restartExpiry()
  }

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
  }

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
    guard latch.phase != .off else { return false }
    let modifiers = consumeLatch()
    emit(.keystroke(TerminalKeystroke(.character(character), modifiers: modifiers)))
    return true
  }

  /// Back to the resting card: a new session gets a new draft, and a latch
  /// left locked on the last card must not arm the first key of the next one.
  public func reset() {
    mode = .draft
    draft = ""
    latch = LatchState()
    fieldFocused = false
    expiryTask?.cancel()
    expiryTask = nil
  }

  // MARK: - Plumbing

  private func consumeLatch() -> TerminalModifiers {
    let modifiers = latch.consume()
    // Only an armed latch had a clock; consuming it ends the window whether or
    // not the phase moved.
    if latch.phase != .armed {
      expiryTask?.cancel()
      expiryTask = nil
    }
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

  private func emit(_ act: InputAct) {
    sink?(act)
  }
}
