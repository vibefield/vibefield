import FieldMesh
import Foundation

// PG-4s — THE ROW WORDS ONLY THE GODVIEW VIEWS SAY, beside the ones the body says (FieldMesh's `MonitorWords`, PG-3e,
// which stays byte for byte; Q-S1 (a)). Transcribed from puppeteer-view-sdk 0.3.2 at the pin `95a70aa7`:
//   · `src/toolkit/words.ts` (`e79fc53d`): `deviceWord` :33;
//   · `src/toolkit/state-words.ts` (`5abe8f75`): `STATE_WORDS` :14-27, the ten words MonitorWords.StateWords does
//     not carry (it holds `blocked`, `running`, `empty` and `unreadLine`).
// `kindTerminal` and `waitFailure` restate values MonitorWords holds as `terminalName` and inside `waitWord`; they
// are different SDK keys, so both stand, the views' pinned by the toolkit golden (K5) and the body's by 3e's body
// parity (the design check's N8). Internal to FieldHome: only the views read them.

extension MonitorWords {
  /// `deviceWord`: `This desktop` on the desktop the model is read on, its name otherwise. The SDK falls back to a
  /// host menu's `label`; a row always carries `name` (`MonitorDeviceRef`, AgentRemoteShapes.swift), so the phone
  /// takes the name alone (the design check's N11). `isSelf` is the window's join (`RemoteFieldRow.isSelf`).
  static func deviceWord(name: String, isSelf: Bool) -> String {
    isSelf ? thisDesktop : name
  }
}

extension MonitorWords.StateWords {
  // status (MonitorWords holds `blocked`)
  static let idle = "idle"
  static let working = "working"
  // terminal (MonitorWords holds `running` and `empty`)
  static let quiet = "quiet"
  static let opening = "opening"
  // wait
  static let waitPermission = "permission"
  static let waitQuestion = "question"
  static let waitFailure = "failed"
  // unread (MonitorWords holds its `line`, `unreadLine`)
  static let unreadState = "reply unseen"
  // kind
  static let kindTerminal = "terminal"
  static let kindRemote = "remote session"
}
