import Foundation

/// PG-1b's screen (`field-app/src/godview/monitor/board-screen.ts`), on the phone — a PASS-THROUGH skeleton: it
/// delivers what it is given and holds nothing.
public struct RemoteBoardScreen: Sendable {
  /// The stand-in key of a refused row with none (`NO_KEY`).
  static let noKey = "\u{0}"

  public init() {}

  public func holds(_ device: String) -> Bool { false }

  public mutating func open(_ open: AgentRemoteMeshOpen, now: String) -> AgentRemoteMeshOpen { open }

  public mutating func frame(_ frame: AgentRemoteMeshFrame, now: String) -> [AgentRemoteMeshFrame] { [frame] }
}
