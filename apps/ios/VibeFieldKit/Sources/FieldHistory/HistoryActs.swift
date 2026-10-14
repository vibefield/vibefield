import SwiftUI

// PJ-7 (Q3 (a); `thinking-project-places.md` §5, §6.3; PJ-D9, PJ-D10 (a)) —
// History's two acts on the phone. **Jump to** a session the field holds a run
// for (joined by the conversation's native id): the Field tab opens its card.
// **Resume** an ended one: `agent.resume {provider, nativeSessionId}` on the
// session's OWN desktop's door, with no path — that desktop fills the folder.
// The act is absent when the agent cannot resume; a sleeping desktop says so
// in the act's place; a refusal is said in words. The decisions are pure
// (FieldHistoryModel); the home screen performs them (`HistoryActs`).

/// What a session can do on the phone, here and now.
public enum SessionAct: Equatable, Sendable {
  case jump
  case resume
  /// the reason there is no act right now (`asleep`), in the act's place
  case why(String)
}

extension FieldHistoryModel {
  /// A session's act: Jump to when the field holds its run; else, for an
  /// ENDED session the index knows by its native id, Resume when its own
  /// desktop answers and offers it, `asleep` when that desktop does not
  /// answer, nothing when the agent cannot resume (or this phone has not
  /// heard whether it can). A session the index calls live with no run of
  /// ours keeps its last word.
  public static func sessionAct(
    _ session: HistorySession, inField: Bool, desktopAwake: Bool, canResume: Bool?
  ) -> SessionAct? {
    if inField { return .jump }
    guard session.nativeSessionId != nil, session.provider != nil, session.device != nil, !session.isLive else {
      return nil
    }
    if !desktopAwake { return .why("asleep") }
    return canResume == true ? .resume : nil
  }

  /// A refused Resume, in the record's words (TP §5): asleep, the folder
  /// gone, signed out — and the two the index adds (another profile, a
  /// conversation it does not know). Anything else is fieldd's own sentence.
  public static func resumeRefusal(
    kind: String, reason: String?, state: String?, message: String, desktop: String, agent: String
  ) -> String {
    if kind == "UNAVAILABLE" || kind == "TIMEOUT" { return "\(desktop) is asleep" }
    if state == "signed-out" { return "Signed out of \(agent) on \(desktop)" }
    switch reason {
    case "missing-cwd": return "The folder is gone"
    case "other-profile": return "Held under another profile on \(desktop)"
    case "unknown-conversation", "other-agent": return "\(desktop) does not know this conversation"
    default: return message
    }
  }
}

/// The acts History hands the home screen, and what it needs to know to draw
/// them: whether the field holds a conversation's run, whether a desktop
/// answers, whether its catalog offers Resume for an agent.
public struct HistoryActs: Sendable {
  public var inField: @MainActor @Sendable (_ nativeSessionId: String) -> Bool
  public var desktopAwake: @MainActor @Sendable (_ device: String) -> Bool
  public var canResume: @MainActor @Sendable (_ device: String, _ provider: String) -> Bool?
  /// Resume: answers the words to say (`Resuming on studio`, or the refusal).
  public var resume: @MainActor @Sendable (HistorySession) async -> String
  /// Jump to: the Field tab opens the run's card.
  public var jump: @MainActor @Sendable (_ nativeSessionId: String) -> Void

  public init(
    inField: @escaping @MainActor @Sendable (String) -> Bool,
    desktopAwake: @escaping @MainActor @Sendable (String) -> Bool,
    canResume: @escaping @MainActor @Sendable (String, String) -> Bool?,
    resume: @escaping @MainActor @Sendable (HistorySession) async -> String,
    jump: @escaping @MainActor @Sendable (String) -> Void
  ) {
    self.inField = inField
    self.desktopAwake = desktopAwake
    self.canResume = canResume
    self.resume = resume
    self.jump = jump
  }

  /// No acts (the mock, a preview): every session keeps its last word.
  public static let none = HistoryActs(
    inField: { _ in false }, desktopAwake: { _ in false }, canResume: { _, _ in nil }, resume: { _ in "" },
    jump: { _ in })

  @MainActor
  public func act(for session: HistorySession) -> SessionAct? {
    FieldHistoryModel.sessionAct(
      session, inField: session.nativeSessionId.map(inField) ?? false,
      desktopAwake: session.device.map(desktopAwake) ?? false,
      canResume: session.device.flatMap { device in session.provider.flatMap { canResume(device, $0) } })
  }
}

private struct HistoryActsKey: EnvironmentKey {
  static let defaultValue = HistoryActs.none
}

extension EnvironmentValues {
  /// PJ-7 — the acts History's rows offer; the home screen supplies them.
  public var historyActs: HistoryActs {
    get { self[HistoryActsKey.self] }
    set { self[HistoryActsKey.self] = newValue }
  }
}
