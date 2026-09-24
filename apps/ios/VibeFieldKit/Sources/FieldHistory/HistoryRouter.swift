import Observation

/// Where the History tab is (the pushed stack) and what search landed in it
/// (the ring of hits the stepper walks). One object, owned by the home screen,
/// read by both tabs — the search tab lands INTO the History tab, so the two
/// have to share the stack.
@MainActor
@Observable
public final class HistoryRouter {
  public enum Route: Hashable, Sendable {
    case project(String)
    case session(String)
  }

  /// A landed search: the query (the stepper's word), the ring of anchors in
  /// reading order, and which one is lit.
  public struct Landed: Equatable, Sendable {
    public var query: String
    public var sessionId: String
    public var ring: [String]
    public var at: Int

    public var anchor: String? { ring.indices.contains(at) ? ring[at] : nil }
    public var words: String { FieldHistoryModel.stepWords(at: at, of: ring.count) }
  }

  public var path: [Route] = []
  public var landed: Landed?
  /// Whether History's scroll has folded the app's bar to its glyph (IOS-9e,
  /// the page's minimize). Set by `foldsBar`, read by the bar; the home screen
  /// opens it again on every push, pop and change of tab.
  public var barMinimized = false
  /// The session row to ring when a hit lands in a project that holds no
  /// document; cleared once the row has been rung.
  public var rungSession: String?

  public init() {}

  /// A hit was tapped: push where it lives and light it.
  public func land(_ landing: FieldHistoryModel.Landing, query: String) {
    barMinimized = false
    switch landing {
    case .session(let projectId, let sessionId, let ring, let at):
      landed = Landed(query: query, sessionId: sessionId, ring: ring, at: at)
      rungSession = nil
      path = [.project(projectId), .session(sessionId)]
    case .project(let projectId, let sessionId):
      landed = nil
      rungSession = sessionId
      path = [.project(projectId)]
    }
  }

  public func step(_ delta: Int) {
    guard var current = landed else { return }
    current.at = FieldHistoryModel.step(current.at, by: delta, of: current.ring.count)
    landed = current
  }

  /// The stepper stands only while the landed session is on top.
  public var stepperShowing: Bool {
    guard let landed, case .session(let id)? = path.last else { return false }
    return landed.sessionId == id
  }

  public func clearLanding() { landed = nil }
}
