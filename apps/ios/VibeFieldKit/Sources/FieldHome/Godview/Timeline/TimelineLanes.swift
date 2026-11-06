import FieldAgents
import FieldMesh
import FieldProduct
import Foundation

// PG-6 — THE TIMELINE'S LANES, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the timeline is
// byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`, 2026-10-12), `src/views/timeline/timeline-lanes.ts`
// (dist `timeline-lanes.js`): `byBirth` :3, `laneStatus` :5-8, `laneFor` :32-51, `timelineLanes` :95-107, `stateAt`
// :148-156, `QUIET_ALPHA` :158, `laneAlpha` :166-171, `laneContentKey` :195-223, `dayStart` :231-236 and
// `earliestHead` :237-239; and puppeteer-view-sdk's `src/toolkit/lane-words.ts` (`5abe8f75`): `LANE_WAIT_WORDS_MAX`
// :12 and `laneWaitWords` :18-23, which only the timeline reads. Held to `phone-timeline.golden.json`
// (`TimelineModelParityTests`).
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): the phone is lent no `history` (puppeteer-view-sdk `view.d.ts:132-137`;
// DESIGN.md "Runtime only where no record is lent … the whole drawing on the phone"), so no lane has a recorded past
// or an end. NOT transcribed, a named deviation from the brief's §10 list (a puppeteer change to any of them is still
// a phone item): `pastBefore` :13, `endedLane` :53, `historyLanes` :67, `mergeByBirth` :79, `scrolledOutKey` :109,
// `withoutScrolledOut` :118, `spanIndexAt` :125, `recordedAt` :141, `ENDED_ALPHA` :160, `pastKey` :188, and the past
// and ended arms of `laneFor`, `timelineLanes`, `stateAt`, `laneAlpha` and `laneContentKey`. Nor `stepLight` :177, the
// keyboard's light: the phone's stage has no keys (fd's Q2).

/// The row as the timeline reads it (`AgentView`, puppeteer-view-sdk `model.d.ts:327-337`): the replica's row and the
/// host's joins, each where the phone holds it — `isSelf` the window's (`RemoteFieldRow.isSelf`), `unread` the swarm's
/// own (`GodviewStageInput.unreadIds`, S2; never `monitor.unread`), `colour` the ledger's deal
/// (`GodviewStageInput.colour`: nil for a terminal, which the timeline never colours, and for an undealt project),
/// `active` the open card's row (J-S4), `receded` the phone's lens (SE-2, `GodviewRecede.byLens`: every lane but the
/// home's under the chosen profile). *Corrected 2026-11-06 (SE-2h):* this said `receded` was false, the phone showing
/// no groups.
struct TimelineRow: Equatable, Sendable {
  let monitor: MonitorAgentRow
  let isSelf: Bool
  let unread: Bool
  let colour: SwarmColor?
  let active: Bool
  let receded: Bool

  var id: String { monitor.id }

  init(
    monitor: MonitorAgentRow, isSelf: Bool, unread: Bool, colour: SwarmColor?, active: Bool, receded: Bool = false
  ) {
    self.monitor = monitor
    self.isSelf = isSelf
    self.unread = unread
    self.colour = colour
    self.active = active
    self.receded = receded
  }

  /// A drawn row with the host's joins; under the phone's lens (SE-2, `GodviewStageInput.lens`) it recedes unless it
  /// is the home's under the chosen profile.
  init(_ row: RemoteFieldRow, unread: Bool, colour: SwarmColor?, active: Bool, lens: String? = nil) {
    let monitor = row.row.monitor
    self.init(
      monitor: monitor, isSelf: row.isSelf, unread: unread, colour: colour, active: active,
      receded: GodviewRecede.byLens(isSelf: row.isSelf, profileSet: monitor.profileSet, lens: lens))
  }
}

/// `LaneStatus`: the state a lane is in — the toolkit's tone, with an agent's unread idle said as `unseen`.
enum TimelineStatus: String, Sendable, Equatable {
  case working, idle, blocked, unseen
}

/// `LaneWait`: what a blocked lane waits on — the wait's kind, and its words when it has any.
struct TimelineWait: Equatable, Sendable {
  let kind: String
  let detail: String?
}

/// `LaneSpan`: a lane's current state, from `fromMs` to now.
struct TimelineSpan: Equatable, Sendable {
  let status: TimelineStatus
  let fromMs: Double
  let wait: TimelineWait?
}

/// `LiveLane`: a row's lane — born at its birth, its current status since `sinceMs` (never before the horizon). The
/// instants are JavaScript's numbers: ms, as `Double`.
struct TimelineLane: Equatable, Sendable, Identifiable {
  let row: TimelineRow
  let bornMs: Double
  let sinceMs: Double
  let current: TimelineSpan

  var id: String { row.id }
  var kind: MonitorRowKind { row.monitor.kind }
  var receded: Bool { row.receded }
  var colour: SwarmColor? { row.colour }
}

/// `TimelineLaneSet`: the agents in birth order, then the bare terminals in theirs.
struct TimelineLaneSet: Equatable, Sendable {
  let agents: [TimelineLane]
  let terminals: [TimelineLane]

  /// Every lane in the order the view draws them.
  var all: [TimelineLane] { agents + terminals }
}

/// `TimelineMoment`: what a lane was doing at a moment — not yet born, nothing recorded, or its current state.
enum TimelineMoment: Equatable, Sendable {
  case unborn
  case unrecorded
  case span(TimelineSpan)

  /// The SDK's `kind`.
  var kind: String {
    switch self {
    case .unborn: "unborn"
    case .unrecorded: "unrecorded"
    case .span: "span"
    }
  }
}

enum TimelineLanes {
  /// `QUIET_ALPHA`: the quiet a lane takes when another is lit (DESIGN §8: 30%).
  static let quietAlpha = 0.3
  /// `LANE_WAIT_WORDS_MAX`: the longest a lane's wait words run, in UTF-16 units.
  static let waitWordsMax = 160

  /// `laneStatus`: the toolkit's tone (`GodviewTone.of`), an agent's unread idle as `unseen`.
  static func status(of row: TimelineRow) -> TimelineStatus {
    switch GodviewTone.of(status: row.monitor.status, isAgent: row.monitor.kind == .agent, unread: row.unread) {
    case .working: .working
    case .blocked: .blocked
    case .unread: .unseen
    case .idle: .idle
    }
  }

  /// `laneWaitWords`: what a blocked lane waits on, in words — the wait's detail, else a question's prompt, trimmed as
  /// JavaScript trims and cut at 160 UTF-16 units with `…`; nil when the wait carries no words. A detail of nothing
  /// hides the question, as JavaScript's `??` keeps an empty string. A cut through a surrogate pair keeps U+FFFD where
  /// JavaScript keeps the lone half: a phone-only DEVIATION a Swift string cannot avoid (the kit's hand row H2).
  static func waitWords(kind: String, detail: String?, question: String?) -> String? {
    guard let raw = detail ?? (kind == "question" ? question : nil) else { return nil }
    let text = jsTrim(raw)
    if text.isEmpty { return nil }
    let units = text.utf16
    guard units.count > waitWordsMax else { return text }
    return String(decoding: units.prefix(waitWordsMax - 1), as: UTF16.self) + "…"
  }

  /// `laneFor` with no record: born at the row's birth, its current status since `statusSince`, never before now less
  /// the horizon, never after now.
  static func lane(for row: TimelineRow, nowMs: Double) -> TimelineLane {
    let monitor = row.monitor
    let createdAt = Double(monitor.createdAt)
    let sinceMs = min(nowMs, max(createdAt, Double(monitor.statusSince), nowMs - TimelineScale.horizonMs))
    let status = status(of: row)
    let wait = status == .blocked
      ? monitor.wait.map {
        TimelineWait(kind: $0.kind, detail: waitWords(kind: $0.kind, detail: $0.detail, question: $0.question))
      } : nil
    return TimelineLane(
      row: row, bornMs: min(createdAt, sinceMs), sinceMs: sinceMs,
      current: TimelineSpan(status: status, fromMs: sinceMs, wait: wait))
  }

  /// `timelineLanes` with no record: the agents in birth order, then the bare terminals in theirs.
  static func lanes(_ rows: [TimelineRow], nowMs: Double) -> TimelineLaneSet {
    var agents: [TimelineLane] = []
    var terminals: [TimelineLane] = []
    for row in rows {
      let lane = lane(for: row, nowMs: nowMs)
      if row.monitor.kind == .agent { agents.append(lane) } else { terminals.append(lane) }
    }
    return TimelineLaneSet(agents: agents.sorted(by: byBirth), terminals: terminals.sorted(by: byBirth))
  }

  /// `byBirth`: the earlier birth first, then the id as JavaScript compares strings (by UTF-16 unit).
  static func byBirth(_ a: TimelineLane, _ b: TimelineLane) -> Bool {
    if a.bornMs != b.bornMs { return a.bornMs < b.bornMs }
    return a.id.utf16.lexicographicallyPrecedes(b.id.utf16)
  }

  /// `stateAt` with no record: not yet born, nothing recorded before the current state, then the current state.
  static func state(of lane: TimelineLane, at t: Double) -> TimelineMoment {
    if t < lane.bornMs { return .unborn }
    if t < lane.sinceMs { return .unrecorded }
    return .span(lane.current)
  }

  /// `laneAlpha`: with a lane lit, it is whole and the rest quiet; with none, a receded lane is quiet. (An ended run's
  /// factor is 1: there are none.)
  static func alpha(_ lane: TimelineLane, index: Int, lit: Int) -> Double {
    if lit >= 0 { return lit == index ? 1 : quietAlpha }
    return lane.receded ? quietAlpha : 1
  }

  /// `laneContentKey`: what the canvases draw of the lanes, as one string, so a model that changed nothing they draw
  /// keeps the key. The colour is the ledger's deal, as its hex (none for a terminal).
  static func contentKey(_ lanes: [TimelineLane]) -> String {
    lanes.map { lane in
      let current = lane.current
      return [
        lane.id, lane.kind.rawValue, lane.receded ? "1" : "0", lane.colour?.hex ?? "",
        TimelineFormat.number(lane.bornMs), TimelineFormat.number(lane.sinceMs),
        "\(current.status.rawValue):\(TimelineFormat.number(current.fromMs)):\(current.wait?.kind ?? "")",
      ].joined(separator: ",")
    }.joined(separator: "|")
  }

  /// `dayStart`: the map of the day's left end — the first agent's birth, at most a horizon back, never inside the
  /// window.
  static func dayStart(_ set: TimelineLaneSet, spanMs: Double, nowMs: Double) -> Double {
    var start = nowMs - spanMs
    for lane in set.agents { start = min(start, lane.bornMs) }
    return max(nowMs - TimelineScale.horizonMs, start)
  }

  /// `earliestHead`: the head stands no earlier than the day's start plus the span.
  static func earliestHead(_ set: TimelineLaneSet, spanMs: Double, nowMs: Double) -> Double {
    min(nowMs, dayStart(set, spanMs: spanMs, nowMs: nowMs) + spanMs)
  }

  /// `String.prototype.trim`: JavaScript's WhiteSpace and LineTerminator (ECMA-262 §12.2, §12.3) off both ends — not
  /// Foundation's `.whitespacesAndNewlines`, which also trims U+0085 and keeps U+FEFF.
  static func jsTrim(_ text: String) -> String {
    let scalars = text.unicodeScalars
    guard let first = scalars.firstIndex(where: { !isJSSpace($0) }),
      let last = scalars.lastIndex(where: { !isJSSpace($0) })
    else { return "" }
    return String(scalars[first...last])
  }

  private static func isJSSpace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }
}
