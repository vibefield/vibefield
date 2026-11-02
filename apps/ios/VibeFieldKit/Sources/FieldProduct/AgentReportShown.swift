import Foundation

/// PG-3f — `agent.reportShown`'s params as the phone sends them (`packages/contracts/src/agent-field.ts`, MV-3a (L5) as
/// amended by PG-3b): the rows the phone's one pane shows, by MODEL id, and the desktop that owns them. `device` is
/// always present, the home's own rows included — the contract serves "absent or this desktop's own id" locally, and
/// one shape keeps one encoder against the golden (`agent-report-shown.routed.json`). An empty `ids` clears the
/// report. The answer is `{reported: true}`; a refusal is read by the sender from its `details` (design v2 §4.3).
public struct AgentReportShownParams: Sendable, Equatable {
  public static let method = "agent.reportShown"

  public let ids: [String]
  public let device: String

  public init(ids: [String], device: String) {
    self.ids = ids
    self.device = device
  }

  /// PG-3f (red) — the skeleton: encodes nothing yet.
  public var json: JSONValue { .object([:]) }
}
