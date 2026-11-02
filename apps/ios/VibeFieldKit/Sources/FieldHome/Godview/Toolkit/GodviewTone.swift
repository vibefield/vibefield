import FieldProduct
import Foundation

// PG-4s — the tone a row's state is drawn in, transcribed from puppeteer-view-sdk 0.3.2 at the pin `95a70aa7`,
// `src/toolkit/state-words.ts` (`5abe8f75`): `StateTone` :73, `stateTone` :75. Not the swarm's light
// (`SwarmLightTone`, FieldAgents): a view's own word.

enum GodviewTone: String, Sendable, CaseIterable {
  case working, blocked, unread, idle

  /// `stateTone`: status first; only an agent is ever unread. `unread` is the HOST's (`GodviewStageInput.unreadIds`,
  /// the open card's suppression applied), never a row's raw `unread` (the design check's N3: a namespaced static,
  /// never a free function).
  static func of(status: MonitorRowStatus, isAgent: Bool, unread: Bool) -> GodviewTone {
    // PG-4s (red): the skeleton is always idle
    .idle
  }
}
