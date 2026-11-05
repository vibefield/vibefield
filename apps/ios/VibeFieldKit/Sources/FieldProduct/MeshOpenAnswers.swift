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
    var resumed = 0
    var delta = 0
    var whole = 0
    var unanswered = 0
    for entry in open.devices {
      if entry.resumed != nil {
        resumed += 1
      } else if entry.delta != nil {
        delta += 1
      } else if entry.snapshot != nil {
        whole += 1
      } else {
        unanswered += 1
      }
    }
    self.init(resumed: resumed, delta: delta, whole: whole, unanswered: unanswered)
  }

  /// "3 desktops: 1 resumed, 1 delta, 1 whole, 0 unanswered"
  public var line: String {
    let desktops = resumed + delta + whole + unanswered
    return "\(desktops) desktops: \(resumed) resumed, \(delta) delta, \(whole) whole, \(unanswered) unanswered"
  }
}
