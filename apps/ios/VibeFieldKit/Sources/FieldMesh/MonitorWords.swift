import FieldProduct
import Foundation

// PG-3e — THE WORDS A ROW GOES BY, on the phone: puppeteer-view-sdk 0.3.2 `toolkit/words.js` and the subset of
// `toolkit/state-words.js` they say, transcribed over the remote cut's `MonitorAgentRow`. The body (`RemoteFieldBubble`)
// reads them, and PG-4s's Toolkit reuses them (Q-E11). Here in FieldMesh because they read FieldProduct's row and feed
// FieldAgents' bubble; this file imports nothing else, so the host inner loop builds it.

public enum MonitorWords {
  /// The name a row goes by: its folder's; an agent in no folder by its provider's label; a terminal in none,
  /// `terminal`.
  public static func projectName(_ row: MonitorAgentRow) -> String { "" }

  /// What runs an agent, where its model's name stands: the model, else its provider's label.
  public static func modelWord(_ row: MonitorAgentRow) -> String { "" }

  /// The line under a row's name, by the toolkit's one rule (M4).
  public static func detailLine(_ row: MonitorAgentRow, isSelf: Bool) -> String { "" }

  /// What a blocked body says in the name's place, in the swarm's order.
  public static func waitBodyLine(_ wait: MonitorWait, reply: String?) -> String { "" }
}
