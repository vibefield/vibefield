import Foundation

/// PG-9 S4b — how a mesh open answered each desktop: by the phone's cursor (`resumed`, a `delta`), whole, or not at all
/// (a desktop that has not answered its home). The debug line M1's app switch is read by.
public struct MeshOpenAnswers: Sendable, Equatable {
  public let resumed: Int
  public let delta: Int
  public let whole: Int
  public let unanswered: Int

  public init(resumed: Int, delta: Int, whole: Int, unanswered: Int) {
    self.resumed = resumed
    self.delta = delta
    self.whole = whole
    self.unanswered = unanswered
  }

  public init(_ open: AgentRemoteMeshOpen) {
    self.init(resumed: 0, delta: 0, whole: 0, unanswered: 0)
  }

  public var line: String { "" }
}
