import Observation

/// Where the History tab is (the pushed stack) and what search landed in it
/// (the ring of hits the stepper walks). One object, owned by the home screen,
/// read by both tabs — the search tab lands INTO the History tab, so the two
/// have to share the stack.
///
/// SP-6 — a route names its DESKTOP: History is grouped by desktop (one corpus
/// per self desktop whose door answers), and rosetta's project id is a hash of
/// a LOCAL path (D30), so the same checkout on two desktops is two ids that
/// could collide only by their device. The id alone named a place when there
/// was one desktop; the pair does now.
@MainActor
@Observable
public final class HistoryRouter {
  public enum Route: Hashable, Sendable {
    case project(device: String, id: String)
    case session(device: String, id: String)

    public var device: String {
      switch self {
      case .project(let device, _), .session(let device, _): device
      }
    }
  }

  /// A landed search: the query (the stepper's word), the ring of anchors in
  /// reading order, and which one is lit.
  public struct Landed: Equatable, Sendable {
    public var query: String
    public var device: String
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
    case .session(let device, let projectId, let sessionId, let ring, let at):
      landed = Landed(query: query, device: device, sessionId: sessionId, ring: ring, at: at)
      rungSession = nil
      // a hit whose project the corpus has not named yet (a door's search
      // answers sessions, not projects) lands straight in the document
      path =
        projectId.isEmpty
        ? [.session(device: device, id: sessionId)]
        : [.project(device: device, id: projectId), .session(device: device, id: sessionId)]
    case .project(let device, let projectId, let sessionId):
      landed = nil
      rungSession = sessionId
      path = [.project(device: device, id: projectId)]
    }
  }

  public func step(_ delta: Int) {
    guard var current = landed else { return }
    current.at = FieldHistoryModel.step(current.at, by: delta, of: current.ring.count)
    landed = current
  }

  /// The stepper stands only while the landed session is on top.
  public var stepperShowing: Bool {
    guard let landed, case .session(let device, let id)? = path.last else { return false }
    return landed.sessionId == id && landed.device == device
  }

  public func clearLanding() { landed = nil }
}

/// SP-6 — what a History screen ASKS its source for (the reads are lazy: a
/// project's sessions and figures when it opens, a session's document and tail
/// when it opens, the older page when the reader reaches the top). The views
/// hand these up; the home screen routes each to the desktop's reader. The
/// mock answers none — its corpus is whole.
public enum HistoryNeed: Equatable, Sendable {
  /// A project was opened: its sessions and its figures.
  case project(device: String, id: String)
  /// A session was opened: its header, its newest page and its tail.
  case session(device: String, id: String)
  /// The reader reached the document's top: the next older page.
  case older(device: String, session: String)
  /// The reader saw the document's end: the arrivals are read.
  case seen(device: String, session: String)
}
