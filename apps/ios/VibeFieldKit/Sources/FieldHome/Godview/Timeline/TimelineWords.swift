import FieldMesh
import FieldProduct
import Foundation

// PG-6 — WHAT THE TIMELINE SAYS IN WORDS, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the timeline
// is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/timeline-words.ts` (dist
// `timeline-words.js`): `spanWord` :12-18, `readoutAt` :47-78, `laneName` :93-95, `laneSubLine` :100-108 and
// `laneLabel` :112-131. The toolkit's words are REUSED, never re-transcribed (PG-4s, Q-E11): MonitorWords'
// `projectName`, `modelWord`, `waitWord` and `StateWords`; GodviewFormat's `formatShort` and `formatWords`; and
// TimelineFormat's `elapsed` (the SDK's `formatElapsed`). Held to `phone-timeline.golden.json`.
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): NOT transcribed, history alone reaches them — `BOUNDS_WORDS` :10,
// `recordedReadout` :23-37, `readoutAt`'s past and ended arms :52-63, `recordState` :83-87, `endedName` :89-91,
// `OPENS_IN_HISTORY` :110, and the ended arms of `laneName`, `laneSubLine` and `laneLabel`. So the `bounds` and
// `ended` tones never occur here.

/// `ReadoutTone`, the six the phone can say.
enum TimelineReadoutTone: String, Sendable, Equatable {
  case working, idle, blocked, unseen, none, unrecorded
}

/// `TimelineReadout`: a body's readout — its length (`big`), its words (`small`), and whether it is a wait you owe.
struct TimelineReadout: Equatable, Sendable {
  let tone: TimelineReadoutTone
  let big: String
  let small: String
  let owed: Bool
}

enum TimelineWords {
  /// What a moment before a lane's birth says (`readoutAt` :49).
  static let notStarted = "not started yet"
  /// What a moment before its current state says without a record (`readoutAt` :51).
  static let notRecorded = "not recorded"
  /// The readout's length where it has none to give (`readoutAt` :51): an en dash.
  static let noLength = "–"

  // THE VIEW'S OWN WORDS (TimelineView.js), every one the phone says, here so the hand row H10 reads them all. THE
  // WORDS RULE (VF-PM via fd, 2026-11-04): on the phone no word, label or title names a key, hover or a pane.

  /// The empty stage's words (`TimelineView.js:882`), as transcribed.
  static let noAgents = "NO ACTIVE AGENTS"
  static let noAgentsHint = "Launch an agent from a terminal pane."
  /// The body's group label (`TimelineView.js:861`, its aria-label), as transcribed.
  static let bodyLabel =
    "Agents over time. Up and down light a lane, Enter opens it, left and right move through time, "
    + "minus and equals zoom."
  /// The map of the day's label (`TimelineView.js:856`, its aria-label).
  static let mapLabel = "The head\u{2019}s moment in the day"
  /// The now tool's label, following now and looking back (`TimelineView.js:859`).
  static let followingNow = "Following now"
  static let backToNow = "Back to now"
  /// The terminals' divider (`TimelineView.js:878`).
  static let terminals = "TERMINALS"

  /// The map's since words (`TimelineView.js:515`): the day's start as a clock.
  static func since(_ clock: String) -> String { "SINCE \(clock)" }

  /// The narrow head's span tool (`TimelineView.js:859`): the span shown (`custom` off the presets), then what a tap
  /// does, the next preset's title.
  static func spanLabel(_ label: String?, next title: String) -> String { "Span \(label ?? "custom"); \(title)" }

  /// The map's value following now (`TimelineView.js:804`, its aria-valuetext).
  static func nowValue(_ clock: String) -> String { "Now, \(clock)" }

  /// The map's value looking back (`TimelineView.js:805`): the head's clock, then how long ago.
  static func pastValue(_ clock: String, ago words: String) -> String { "\(clock), \(words) ago" }

  /// `spanWord`: a span's state as the readout words it — `blocked · <what it waits on>`, `reply unseen`, or the
  /// status.
  static func spanWord(_ span: TimelineSpan) -> String {
    switch span.status {
    case .blocked: "\(MonitorWords.StateWords.blocked) · \(MonitorWords.waitWord(span.wait?.kind))"
    case .unseen: MonitorWords.StateWords.unreadState
    case .working: MonitorWords.StateWords.working
    case .idle: MonitorWords.StateWords.idle
    }
  }

  /// `readoutAt`: a body's readout for the moment `at`. Following now it is the present; looking back it says how far
  /// into its current state the lane was and that it has lasted until now (`4:39` · `idle · of 7m+`, TL-D13). Before
  /// its current state a lane with no record says `–` · `not recorded`; before its birth, `not started yet`.
  static func readout(
    _ lane: TimelineLane, moment: TimelineMoment, at: Double, live: Bool, nowMs: Double
  ) -> TimelineReadout {
    switch moment {
    case .unborn:
      return TimelineReadout(tone: .none, big: "", small: notStarted, owed: false)
    case .unrecorded:
      return TimelineReadout(tone: .unrecorded, big: noLength, small: notRecorded, owed: false)
    case .span(let span):
      if lane.kind == .terminal {
        let running = span.status == .working
        return TimelineReadout(
          tone: running ? .working : .idle, big: running ? TimelineFormat.elapsed(ms: at - span.fromMs) : "",
          small: running ? MonitorWords.StateWords.running : MonitorWords.StateWords.quiet, owed: false)
      }
      // the span is the current state, so it is still going: a wait in it is owed now, and its length runs on
      let owed = live && (span.status == .blocked || span.status == .unseen)
      let word = live
        ? spanWord(span) : "\(spanWord(span)) · of \(GodviewFormat.formatShort(ms: nowMs - span.fromMs))+"
      return TimelineReadout(
        tone: tone(span.status), big: TimelineFormat.elapsed(ms: at - span.fromMs), small: word, owed: owed)
    }
  }

  private static func tone(_ status: TimelineStatus) -> TimelineReadoutTone {
    switch status {
    case .working: .working
    case .idle: .idle
    case .blocked: .blocked
    case .unseen: .unseen
    }
  }

  /// `laneName`: a row's project, as its name column prints it.
  static func name(_ lane: TimelineLane) -> String {
    MonitorWords.projectName(lane.row.monitor)
  }

  /// `laneSubLine`: what runs an agent, and its branch; nothing for a terminal.
  static func subLine(_ lane: TimelineLane) -> String {
    guard lane.kind == .agent else { return "" }
    let monitor = lane.row.monitor
    return [MonitorWords.modelWord(monitor), branch(monitor.project.branch)].filter { !$0.isEmpty }
      .joined(separator: " · ")
  }

  /// `laneLabel`: a lane as a screen reader hears it, at now.
  static func label(_ lane: TimelineLane, nowMs: Double) -> String {
    let monitor = lane.row.monitor
    let place = lane.row.isSelf ? "" : "on \(monitor.device.name), "
    let name = MonitorWords.projectName(monitor)
    let current = lane.current
    let length = GodviewFormat.formatWords(ms: nowMs - current.fromMs)
    if lane.kind == .terminal {
      return "\(place)\(name), terminal, \(current.status == .working ? "running for \(length)" : "quiet")"
    }
    let what: String
    if current.status == .blocked {
      let detail = current.wait?.detail.flatMap { $0.isEmpty ? nil : ": \($0)" } ?? ""
      what = "blocked on a \(MonitorWords.waitWord(current.wait?.kind)) for \(length)\(detail)"
    } else {
      what = "\(spanWord(current)) for \(length)"
    }
    return "\(place)\(name), \(MonitorWords.modelWord(monitor)), \(what)"
  }

  /// `row.project.branch` as JavaScript's `filter(Boolean)` reads it: a named branch, else nothing.
  private static func branch(_ branch: MonitorBranch) -> String {
    if case .named(let name) = branch { return name }
    return ""
  }
}
