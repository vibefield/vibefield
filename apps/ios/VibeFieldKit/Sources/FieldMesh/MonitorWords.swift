import FieldProduct
import Foundation

// PG-3e — THE WORDS A ROW GOES BY, on the phone: puppeteer-view-sdk 0.3.2 `toolkit/words.js` and the subset of
// `toolkit/state-words.js` they say, transcribed over the remote cut's `MonitorAgentRow`. The body (`RemoteFieldBubble`)
// reads them, and PG-4s's Toolkit reuses them (Q-E11). Here in FieldMesh because they read FieldProduct's row and feed
// FieldAgents' bubble; this file imports nothing else, so the host inner loop builds it.
//
// JavaScript's truthiness, kept: an EMPTY string is no word (`row.project.name || …`), and `trim()` is
// `trimmingCharacters(in: .whitespacesAndNewlines)`, which agrees with it on every character the witness carries.

public enum MonitorWords {
  /// What a view calls the desktop it is read on (M34).
  public static let thisDesktop = "This desktop"
  /// M4's words, the backend's too: a run nothing drives yet, and one the runtime has not reported.
  public static let pendingLine = "unobserved · resumes when idle"
  public static let startingLine = "starting"
  /// What both hosts call a terminal in no folder.
  public static let terminalName = "terminal"

  /// `STATE_WORDS`, the subset the body and the detail line say.
  public enum StateWords {
    public static let blocked = "blocked"
    public static let running = "running"
    public static let empty = "empty"
    public static let unreadLine = "new message"
  }

  /// The name a row goes by: its folder's; an agent in no folder by its provider's label; a terminal in none,
  /// `terminal`.
  public static func projectName(_ row: MonitorAgentRow) -> String {
    if !row.project.name.isEmpty { return row.project.name }
    return row.kind == .agent ? (row.provider?.label ?? "") : terminalName
  }

  /// What runs an agent, where its model's name stands: the model, else its provider's label.
  public static func modelWord(_ row: MonitorAgentRow) -> String {
    if let model = row.model, !model.isEmpty { return model }
    return row.provider?.label ?? ""
  }

  /// A status as a row says it (`statusWord`).
  public static func statusWord(_ status: MonitorRowStatus) -> String { status.rawValue }

  /// A wait as a readout says it (`waitWord`): a kind the toolkit does not know is said as itself; none at all reads
  /// as a failure.
  public static func waitWord(_ kind: String?) -> String {
    switch kind {
    case nil, "failure": "failed"
    case "permission": "permission"
    case "question": "question"
    case let other?: other
    }
  }

  /// The mark a wait asks with (`waitMark`); a kind the toolkit does not know asks with the failure's.
  public static func waitMark(_ kind: String) -> String {
    switch kind {
    case "permission", "question": kind
    default: "failure"
    }
  }

  /// A wait as the line says it: its kind, and a permission's tool (`waitLine`).
  public static func waitLine(_ wait: MonitorWait) -> String {
    if let tool = wait.tool, !tool.isEmpty { return "\(wait.kind) · \(tool)" }
    return wait.kind
  }

  /// The line under a row's name, composed by ONE rule (M4): reply-first. An agent says what it waits on when
  /// blocked, else its reply, else its status; one not heard from says so. A row from another desktop leads with its
  /// desktop's name and prefers the question it asks. A terminal says the backend's own line. `isSelf` is the
  /// window's join (`device.self`), which the row does not carry.
  public static func detailLine(_ row: MonitorAgentRow, isSelf: Bool) -> String {
    guard row.kind == .agent else { return row.detail }
    let reply = trimmed(row.reply?.text)
    if !isSelf {
      let line: String
      if row.pending == true {
        line = pendingLine
      } else if row.status == .blocked {
        if let wait = row.wait { line = trimmed(wait.question) ?? waitLine(wait) } else { line = StateWords.blocked }
      } else {
        line = reply ?? statusWord(row.status)
      }
      return "\(row.device.name) · \(line)"
    }
    if row.pending == true { return pendingLine }
    if !row.observed { return startingLine }
    if row.status == .blocked { return row.wait.map(waitLine) ?? StateWords.blocked }
    return reply ?? statusWord(row.status)
  }

  /// What a blocked body says in the name's place, in the swarm's order (M2, M14): a question as asked (its header,
  /// else its prompt), the detail an adapter gave, a permission's tool, a failure's code, then the latest reply, then
  /// the bare word for the wait. FieldAgents' `blockerText` says the same over the bubble's blocker.
  public static func waitBodyLine(_ wait: MonitorWait, reply: String?) -> String {
    if wait.kind == "question", let asked = trimmed(wait.header) ?? trimmed(wait.question) { return asked }
    if let detail = trimmed(wait.detail) { return detail }
    if wait.kind == "permission", let tool = wait.tool, !tool.isEmpty { return tool }
    if wait.kind == "failure", let code = wait.code, !code.isEmpty { return code }
    return reply ?? waitWord(wait.kind)
  }

  /// `text?.trim() || undefined`.
  static func trimmed(_ text: String?) -> String? {
    guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    return text
  }
}
