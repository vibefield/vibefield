import FieldAgents
import FieldMesh
import FieldProduct
import Foundation

// PG-7 — THE SPEND VIEW'S COMPOSITION: what it lays out from its input and its own state, and its acts, transcribed
// from puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend module `5abe8f75`): `src/views/spend/SpendView.tsx`
// (dist `SpendView.js` :38-643). Held to `phone-spend.golden.json` (SpendParityTests P7, V10, H1…H9).
//
// React lays out the window's DOM from the view's state; here `frame` lays out the same from `State`, and each act
// changes `State` as its handler does, after which the caller lays out again (React's re-render). The canvas's scene
// and its colours are the paint's (SpendPaint, with the view). On the phone there are no keys and no hover (fd's Q3):
// a finger on the chart is the pointer while it is down, a lift within 4 pt the click, a drag on the list the wheel;
// so `focus` is never set (the window's `hover ?? focus` reads `hover`), and no row is ever mounted in a pane
// (`is-mounted`, `agent.attachment`). JavaScript's double arithmetic in its own order, so a place is the window's to
// the bit.

enum SpendModel {
  /// A line within this many points of the finger is the one pointed at; further, a tap sets the moment (`REACH_PX`).
  static let reachPx = 16.0
  /// Under this height the rows go to one line of 30 pt (`COMPACT_BELOW`).
  static let compactBelow = 418.0

  // The view's fixed words (`SpendView.js` :616-643), the window's.
  static let colcapText = "Spent in the last 10 minutes"
  static let emptyTitle = "NO ACTIVE AGENTS"
  /// The empty view's hint: the window's names a pane (`Dropped.emptyHint`), so the phone says the list's words, word
  /// for word. Draft word: James's eye (VF-PM 2026-11-04).
  static let emptyHint = "Launch an agent from a terminal."
  /// The key that lets go of a set moment (`NOW_KEY`), and its legend from the toolkit's one table (`keys.js` :16).
  static let nowKey = "End"
  static let nowLegend = "↘"
  static let nowWords = "Now"
  static let nowLabel = "Back to now"
  /// The Now pill's title: the window's, less its key (`Dropped.nowTitle`).
  static let nowTitle = "Back to now"
  /// The view's label: the window's, less its key sentence (`Dropped.viewLabel`).
  static let viewLabel =
    "Spend: what each agent spent in the last ten minutes, a line each from $0, and each run's total in the list."

  /// The window's words the phone does not say (fd's words rule for every PG lane: a view's words never name a key,
  /// hover or a pane, for the phone has none), each a NAMED deviation pinned against the golden.
  enum Dropped {
    /// The view's label: its key sentence.
    static let viewLabel = " Up and down move between agents, Return opens one, End lets go of a set moment."
    /// Each row's label but a row not yet started.
    static let rowLabel = " Open in your pane."
    /// The Now pill's title: its key.
    static let nowTitle = " (End)"
    /// The empty view's hint, whole: the window's names a pane.
    static let emptyHint = "Launch an agent from a terminal pane."
  }

  /// `geometryFor`'s layout.
  struct Geometry: Equatable, Sendable {
    let width: Double
    let height: Double
    let compact: Bool
    let narrow: Bool
    let x0: Double
    let x1: Double
    let y0: Double
    let y1: Double
    let lx0: Double
    let listW: Double
    let ly0: Double
    let ly1: Double
    let rowH: Double
    let axisY: Double
  }

  /// `geometryFor` (:40): the plot on the left, the list on the right, the rows two lines (54) or one (30).
  static func geometryFor(width: Double, height: Double) -> Geometry {
    let compact = height < compactBelow
    let margin: Double = width < 640 ? 12 : 24
    let listW = width >= 960 ? 316 : JSNumber.round(Swift.min(316, Swift.max(168, width * 0.34)))
    let lx0 = width - margin - listW
    let x1 = Swift.max(margin + 40, lx0 - (width < 640 ? 44 : 52))
    let y0: Double = compact ? 48 : 80
    let y1 = Swift.max(y0 + 40, height - 26)
    return Geometry(
      width: width, height: height, compact: compact, narrow: width < 640, x0: margin, x1: x1, y0: y0, y1: y1, lx0: lx0,
      listW: listW, ly0: 12, ly1: height - 4, rowH: compact ? 30 : 54, axisY: y1 + 6)
  }

  /// A moment's x on the plot (`xOf`).
  static func xOf(_ g: Geometry, _ span: SpendScale.Window, _ t: Double) -> Double {
    g.x0 + ((t - span.ta) / (span.tb - span.ta)) * (g.x1 - g.x0)
  }

  /// A spend's y on the plot under the shown top (`yOf`).
  static func yOf(_ g: Geometry, _ yMax: Double, _ value: Double) -> Double {
    g.y1 - (value / Swift.max(1e-9, yMax)) * (g.y1 - g.y0)
  }

  /// The two weights the rows measure words in (`600 12px` the state, `400 12px` the task).
  enum TextStyle: Sendable { case state, row }

  /// What the view lays out from: the rows as spend reads them, now, its own box, and how it measures and says time.
  struct Input {
    let agents: [SpendAgent]
    let nowMs: Double
    let width: Double
    let height: Double
    let timeZone: TimeZone
    let measure: (String, TextStyle) -> Double
  }

  /// The view's own state (its `useState`s and its press ref).
  struct State: Equatable, Sendable {
    struct Pointer: Equatable, Sendable {
      let t: Double
      let near: String?
    }
    /// A finger down on the chart, and its token: the one its lift and its gesture's reset name.
    struct Press: Equatable, Sendable {
      let x: Double
      let y: Double
      let token: Int
    }
    /// A finger down on the list: its token, where it came down, the row it came down on, the whole rows its drag
    /// has stepped, and whether it is still down (the list holds its order only while it is).
    struct ListTouch: Equatable, Sendable {
      let token: Int
      let x: Double
      let y: Double
      let row: String?
      var applied: Int
      var down: Bool
    }
    var pointer: Pointer?
    var held: Double?
    var hover: String?
    var listHeld: [String]?
    var listOffset = 0
    var yShown: Double?
    var press: Press?
    var list: ListTouch?
    /// The touches so far: each new one's token is the next.
    var touches = 0
  }

  struct Hero: Equatable, Sendable {
    let big: String
    let rate: String
    let what: String
    let compact: Bool
    let narrow: Bool
    let left: Double
  }

  struct Label: Equatable, Sendable {
    let text: String
    let left: Double
    let top: Double
  }

  struct Head: Equatable, Sendable {
    let a: String
    let b: String
    let slim: Bool
    let x: Double
    let y: Double
    let width: Double
  }

  struct Chip: Equatable, Sendable {
    let text: String
    let moment: Bool
    let held: Bool
    let left: Double
    let top: Double
  }

  /// The Now pill: back to now, from the plot's right edge.
  struct NowPill: Equatable, Sendable {
    let right: Double
    let top: Double
  }

  /// The tag at the pointed line's head: what it spent by then; `trailing`, its right edge 10 pt before `x`.
  struct Tag: Equatable, Sendable {
    let id: String
    let text: String
    let x: Double
    let y: Double
    let trailing: Bool
  }

  /// A row's classes, by the window's names.
  enum Flag: String, CaseIterable, Sendable {
    case one = "is-one"
    case none = "is-none"
    case unrecorded = "is-unrecorded"
    case hot = "is-hot"
    case dim = "is-dim"
    case before = "is-before"
    case docked = "is-docked"
    case dockFirst = "is-dock-first"
    case mounted = "is-mounted"
    case active = "is-active"
  }

  struct Row: Equatable, Sendable {
    enum Dir: String, Sendable { case up, down }
    let id: String
    let state: SpendWords.State
    let dir: Dir?
    let hidden: Bool
    let flags: Set<Flag>
    let x: Double
    let top: Double
    let width: Double
    let height: Double
    let hollow: Bool
    let name: String
    /// Another desktop's agent: its desktop's name.
    let peer: String?
    /// The one-line form's state glyph and its tone.
    let stg: Stg?
    let figure: String
    /// The two-line form's second line: its task (or "no price"), its state words, their tone and glyph.
    let task: String?
    let stateText: String?
    let stateTone: SpendWords.Tone?
    let glyph: SpendWords.Glyph?
    let title: String
    let label: String

    struct Stg: Equatable, Sendable {
      let tone: SpendWords.Tone
      let glyph: SpendWords.Glyph
    }
  }

  /// The "more" row: how many more, and how many of them wait on the person.
  struct More: Equatable, Sendable {
    let top: Double
    let words: String
    let waiting: String
    let attention: Bool
  }

  /// One frame of the view: everything it lays out, and what its acts read.
  struct Frame {
    let g: Geometry
    let span: SpendScale.Window
    let pinned: Double?
    let tCross: Double?
    let lines: [SpendSeries.Meter]
    let order: [String]
    let target: (step: Double, max: Double)
    let yMax: Double
    let sib: [String: Int]
    let fit: SpendList.Fit
    let hero: Hero
    let colcap: Label
    let head: Head
    let yTicks: [Label]
    let xTicks: [Label]
    let chips: [Chip]
    let now: NowPill?
    let tag: Tag?
    let rows: [Row]
    let more: More?
    let empty: Bool
  }

  /// One row of the list as the view reads it at the moment (`rowOf` :177, the unpriced rows :201).
  private struct Entry {
    let id: String
    let agent: SpendAgent
    let name: SpendWords.Name
    let state: SpendWords.State
    let value: Double?
    let partial: Bool
    let status: SpendWords.Said
    let burn: Double?
    let unrecorded: Bool
    let priced: Bool
  }

  /// `SpendView`'s render (:117-643): the world at now, each row at the moment, the hero, the head, the list, the axes.
  static func frame(_ input: Input, _ state: State) -> Frame {
    let nowMs = input.nowMs
    let zone = input.timeZone
    // ───────────────────────────── the world now
    let meters = SpendSeries.spendMeters(input.agents)
    let set = SpendSeries.spendAt(meters, nowMs: nowMs)
    let sib = SpendInk.siblingIndex(
      meters.lines.map { SpendInk.Born(id: $0.id, project: $0.agent.monitor.project.name, bornMs: $0.bornMs) })
    let names = SpendWords.spendNames(meters.lines.map { $0.agent } + meters.unpriced.map { $0.agent })
    let g = geometryFor(width: input.width, height: input.height)
    let span = SpendScale.spendWindow(nowMs: nowMs)
    let pinned = SpendScale.heldIn(state.held, span)
    let tCross = (pinned ?? state.pointer?.t).map { SpendScale.momentIn($0, span) }
    let tView = tCross ?? span.tb
    let lines = set.lines
    // the order: most spent first, still while a finger is on the list, now's order while scrubbing
    let order = SpendList.listOrder(
      lines.map { SpendList.Entry(id: $0.id, value: $0.total, bornMs: $0.bornMs) }, held: state.listHeld)
    var byId: [String: SpendSeries.Meter] = [:]
    for line in lines { byId[line.id] = line }
    // the scale: from $0 to a round number above the most spent in the window, eased so a new high never jumps
    let top = lines.map { SpendSeries.spentAt($0, span.ta, span.tb) ?? 0 }.reduce(0, Swift.max)
    let target = SpendScale.moneyScale(top: top, compact: g.compact)
    let yMax = state.yShown ?? target.max
    let xOf = { (t: Double) in Self.xOf(g, span, t) }
    let yOf = { (value: Double) in Self.yOf(g, yMax, value) }
    let clock = { (ms: Double) in GodviewFormat.formatClock(ms: ms, timeZone: zone) }

    // ───────────────────────────── each row at the moment
    let rows: [Entry] = order.compactMap { byId[$0] }.map { line in
      let rowState = SpendWords.spendStateAt(bornMs: line.bornMs, agent: line.agent, t: tView, nowMs: nowMs)
      let before = rowState.key == .before
      let value = before ? nil : SpendSeries.valueAt(line, tView)
      // started, and still no figure: a row with a total alone, at any moment but now
      let unrecorded = !before && value == nil
      let rate = value == nil ? nil : SpendSeries.rateAt(line, tView)
      return Entry(
        id: line.id, agent: line.agent, name: names[line.id] ?? Self.nameless, state: rowState, value: value,
        partial: line.partial,
        status: unrecorded
          ? SpendWords.notRecorded : SpendWords.stateWords(rowState, t: tView, perMinute: rate, timeZone: zone),
        burn: unrecorded ? nil : SpendWords.printedBurn(rowState, perMinute: rate), unrecorded: unrecorded,
        priced: true)
    }
    let unpricedRows: [Entry] = set.unpriced.map { row in
      let rowState = SpendWords.spendStateAt(bornMs: row.bornMs, agent: row.agent, t: tView, nowMs: nowMs)
      let status =
        rowState.key == .working
        ? SpendWords.Said(text: "working", tone: .live)
        : SpendWords.stateWords(rowState, t: tView, perMinute: nil, timeZone: zone)
      return Entry(
        id: row.id, agent: row.agent, name: names[row.id] ?? Self.nameless, state: rowState, value: nil,
        partial: false, status: status, burn: nil, unrecorded: false, priced: false)
    }

    // ───────────────────────────── the hero: what the field had spent by the moment, and the burn the rows print
    var spent = 0.0
    var partial = false
    var perMinute = 0.0
    for row in rows where row.state.key != .before {
      if let value = row.value {
        spent += value
        if row.partial && value > 0 { partial = true }
      } else {
        partial = true
      }
      perMinute += row.burn ?? 0
    }
    let missing = set.unpriced.filter { $0.bornMs <= tView }
    let leftOut =
      missing.count == 1
      ? " · not counting \(names[missing[0].id]?.one ?? "")"
      : missing.count > 1 ? " · not counting \(missing.count) agents with no price" : ""
    let heroRate =
      tCross.map { "by \(clock($0)) · \(SpendWords.perHour(perMinute)) then" } ?? "\(SpendWords.perHour(perMinute)) now"
    let hero = Hero(
      big: "~\(SpendWords.money(spent))\(partial ? "+" : "")", rate: heroRate,
      what: "since each agent started, at API prices\(leftOut)", compact: g.compact || g.narrow, narrow: g.narrow,
      left: g.x0)

    // ───────────────────────────── the head: who had started by the moment, and what the money column means
    let all = rows.count + unpricedRows.count
    let started = (rows + unpricedRows).filter { $0.state.key != .before }.count
    let head = Head(
      a: started < all ? "\(started) of \(all) started" : g.compact ? "" : "By spend",
      b: tCross.map { "Total by \(clock($0))" } ?? "Total", slim: g.compact, x: g.lx0, y: g.ly0, width: g.listW)

    // ───────────────────────────── the list: whole rows, a "more" row, waiting rows docked at the foot
    let listTop = g.ly0 + (g.compact ? 14 : 26)
    let room = g.ly1 - listTop - Double(unpricedRows.count) * g.rowH - (unpricedRows.isEmpty ? 0 : 6)
    // `Math.max(1, Math.floor(room / rowH))`, bounded so no stage size can trap the conversion
    let cap = Int(Swift.min(1e6, Swift.max(1, (room / g.rowH).rounded(.down))))
    var waiting: [String: Double] = [:]
    for row in rows where SpendWords.waits(row.state) { waiting[row.id] = row.state.sinceMs }
    let fit = SpendList.fitList(order, cap: cap, offset: state.listOffset, waiting: waiting)
    var dockIndex: [String: Int] = [:]
    for (index, id) in fit.docked.enumerated() { dockIndex[id] = index }
    let shownRows = fit.more ? cap : rows.count
    let listRows =
      rows.enumerated().map { place(input, g, $0.element, $0.offset, foot: false, fit, dockIndex, shownRows, state) }
      + unpricedRows.enumerated().map {
        place(input, g, $0.element, $0.offset, foot: true, fit, dockIndex, shownRows, state)
      }
    let more =
      fit.more
      ? More(
        top: listTop + Double(fit.fits) * g.rowH, words: SpendList.moreWords(fit),
        waiting: fit.waitingUnshown > 0 ? "\(fit.waitingUnshown) more waiting" : "", attention: fit.waitingUnshown > 0)
      : nil

    // ───────────────────────────── the tag at the pointed line's head, the chart's only label
    var tag: Tag?
    if let hot = state.hover, let line = byId[hot] {
      if let tCross, tCross < line.bornMs {
        // a row not yet started shows its start instead
        tag = Tag(
          id: hot, text: "starts \(clock(line.bornMs))", x: xOf(Swift.max(line.bornMs, span.ta)) + 8,
          y: yOf(0) - 30, trailing: false)
      } else {
        let t = tCross ?? span.tb
        if let spentThen = t < line.bornMs ? nil : SpendSeries.spentAt(line, span.ta, t) {
          tag = Tag(
            id: hot, text: SpendWords.est(spentThen, partial: line.partial), x: xOf(t) - 10, y: yOf(spentThen) - 11,
            trailing: true)
        }
      }
    }

    // ───────────────────────────── the axes and their chips
    let yTicks = SpendScale.moneyTicks(max: yMax, step: target.step).map {
      Label(text: SpendWords.axisMoney($0, step: target.step), left: g.x1 + 12, top: yOf($0) - 7)
    }
    let chipXs = [xOf(span.tb)] + (tCross.map { [xOf($0)] } ?? [])
    let xTicks = SpendScale.timeTicks(ta: span.ta, tb: span.tb, x0: g.x0, x1: g.x1, chips: chipXs).map {
      Label(text: clock($0.t), left: $0.x, top: g.axisY)
    }
    var chips = [Chip(text: clock(span.tb), moment: false, held: false, left: xOf(span.tb), top: g.axisY - 2)]
    if let tCross {
      chips.append(Chip(text: clock(tCross), moment: true, held: pinned != nil, left: xOf(tCross), top: g.axisY - 2))
    }

    return Frame(
      g: g, span: span, pinned: pinned, tCross: tCross, lines: lines, order: order, target: target, yMax: yMax,
      sib: sib, fit: fit, hero: hero, colcap: Label(text: colcapText, left: g.x0, top: g.y0 + 8), head: head,
      yTicks: yTicks, xTicks: xTicks, chips: chips,
      now: pinned == nil ? nil : NowPill(right: g.width - g.x1 + 4, top: g.y0 + 2), tag: tag, rows: listRows,
      more: more, empty: rows.isEmpty && unpricedRows.isEmpty)
  }

  /// A row with no name (never: every row the view lists is named); the window would throw where this says nothing.
  private static let nameless = SpendWords.Name(name: "", one: "", task: "", model: "")

  /// `rowElement` (:563): a row's place in the list (in sequence, docked, hidden, or at the foot), its words, its
  /// classes, its title and its label.
  private static func place(
    _ input: Input, _ g: Geometry, _ row: Entry, _ index: Int, foot: Bool, _ fit: SpendList.Fit,
    _ dockIndex: [String: Int], _ shownRows: Int, _ state: State
  ) -> Row {
    let one = g.compact
    let docked = dockIndex[row.id]
    let inSequence = !foot && index >= fit.offset && index < fit.offset + fit.fits
    let slot = foot ? shownRows + index : docked.map { fit.fits + 1 + $0 } ?? index - fit.offset
    let top = g.ly0 + (g.compact ? 14 : 26) + Double(slot) * g.rowH + (foot ? 6 : 0)
    let before = row.state.key == .before
    // its state's glyph, unless nobody recorded it then
    let glyph = row.unrecorded ? nil : row.state.glyph
    let est = SpendWords.est(row.value, partial: row.partial)
    let figure = before ? (one ? row.status.text : "—") : row.priced && !row.unrecorded ? est : "—"
    let stateWidth = input.measure(row.status.text, .state) + (glyph == nil ? 0 : 15)
    let what = row.name.task.isEmpty ? row.name.model : row.name.task
    let task =
      row.priced
      ? SpendWords.fitWords(what, max: g.listW - 35 - stateWidth - 12, measure: { input.measure($0, .row) }) : ""
    let provider = row.agent.monitor.provider?.label ?? "its provider"
    let said = row.status.text
    // the window's words, less its " Open in your pane." (`Dropped.rowLabel`): the phone has no pane. Nor does it
    // mount one (`agent.attachment`), so no row says the window's ", in a pane", and none is `is-mounted` (H6).
    let label =
      before
      ? "\(row.name.one), \(what), had not started then; \(said)."
      : row.unrecorded
        ? "\(row.name.one), \(what): what it had spent then was not recorded (its row carries only its total)."
        : row.priced
          ? "\(row.name.one), \(what), \(est)\(said.isEmpty ? "" : ", \(said)")."
          : "\(row.name.one): \(provider) reports no cost, so it isn't drawn\(said.isEmpty ? "" : "; \(said)")."
    let taskPart = row.name.task.isEmpty ? "" : " · \(row.name.task)"
    let title =
      row.priced
      ? "\(row.name.one) · \(row.name.model)\(taskPart)"
      : "\(row.name.one) · \(provider) reports no cost, so it isn't drawn\(taskPart)"
    var flags: Set<Flag> = []
    if one { flags.insert(.one) }
    if !row.priced { flags.insert(.none) }
    if row.unrecorded { flags.insert(.unrecorded) }
    if state.hover == row.id { flags.insert(.hot) }
    if state.hover != nil && state.hover != row.id { flags.insert(.dim) }
    if before { flags.insert(.before) }
    if docked != nil { flags.insert(.docked) }
    if docked == 0 { flags.insert(.dockFirst) }
    // J-S4 (a), fd's Q9: the open card's row; spend draws it only through the pane square, which the phone has not
    if row.agent.active { flags.insert(.active) }
    return Row(
      id: row.id, state: row.state, dir: docked == nil ? nil : index < fit.offset ? .up : .down,
      hidden: !foot && !inSequence && docked == nil, flags: flags, x: g.lx0, top: top, width: g.listW,
      height: g.rowH - 2, hollow: row.state.key == .idle, name: one ? row.name.one : row.name.name,
      peer: row.agent.isSelf ? nil : row.agent.monitor.device.name,
      stg: one ? glyph.map { Row.Stg(tone: row.status.tone, glyph: $0) } : nil, figure: figure,
      task: one ? nil : row.priced ? task : "\(row.agent.monitor.provider?.label ?? "agent") · no price",
      stateText: one ? nil : said, stateTone: one ? nil : row.status.tone, glyph: one ? nil : glyph, title: title,
      label: label)
  }

  // MARK: - The stage (pair 5: what the view reads from the phone's stage)

  /// The rows as spend reads them from the stage: the window's `self` (the row's own join), the STAGE's unread
  /// (`unreadIds`, S2: the open card's row held out, never the row's raw `unread`), and active for the open card's row
  /// alone (`activeId`, Q-S6 (a)).
  static func agents(_ rows: [RemoteFieldRow], unreadIds: Set<String>, activeId: String?) -> [SpendAgent] {
    rows.map {
      SpendAgent(
        monitor: $0.row.monitor, isSelf: $0.isSelf, unread: unreadIds.contains($0.id), active: $0.id == activeId)
    }
  }

  /// The view's own box (`stageBox`, SpendView.js:67): the stage less the reserve its words start below
  /// (`GodviewStageInput.insets(.flow).top`); the phone clears nothing on the left. Never negative.
  static func box(width: Double, height: Double, topInset: Double) -> (width: Double, height: Double) {
    (Swift.max(0, width), Swift.max(0, height - topInset))
  }

  /// The clock as the view reads it: whole ms, as `Date.now()` is; the nearest, so a still's frozen
  /// `-vf-godview-now=<ms>` comes back to the ms through its `Date`.
  static func nowMs(_ date: Date) -> Double {
    (date.timeIntervalSince1970 * 1000).rounded()
  }

  /// How often now moves (SpendView.js:407-410): about a pixel at a time, never more often than every 250 ms nor less
  /// often than once a second.
  static func clockEveryMs(_ g: Geometry) -> Double {
    Swift.min(1000, Swift.max(250, SpendScale.windowMs / Swift.max(1, g.x1 - g.x0)))
  }

  /// A drag on the list as the wheel's steps (fd's Q3): every whole row of travel from where the drag began is one
  /// step, a finger moving up stepping the list down. Not finite, or no row height: no steps.
  static func listSteps(from: Double, to: Double, rowH: Double) -> Int {
    guard from.isFinite, to.isFinite, rowH.isFinite, rowH > 0 else { return 0 }
    return Int(Swift.min(1e6, Swift.max(-1e6, ((from - to) / rowH).rounded(.towardZero))))
  }

  // MARK: - Acts

  /// `tAt`: the moment under an x, never outside the window.
  private static func tAt(_ frame: Frame, _ x: Double) -> Double {
    let g = frame.g
    let span = frame.span
    return SpendScale.momentIn(span.ta + ((x - g.x0) / (g.x1 - g.x0)) * (span.tb - span.ta), span)
  }

  /// `nearest`: the line whose spend at `t` is within reach of `y`, the nearest of them.
  private static func nearest(_ frame: Frame, _ t: Double, _ y: Double) -> String? {
    var best: String?
    var distance = reachPx
    for line in frame.lines {
      guard let spent = t < line.bornMs ? nil : SpendSeries.spentAt(line, frame.span.ta, t) else { continue }
      let d = abs(yOf(frame.g, frame.yMax, spent) - y)
      if d < distance {
        distance = d
        best = line.id
      }
    }
    return best
  }

  /// A finger on the chart moves (`onHitMove` → `point`): off the plot, nothing is pointed; on it, the moment under
  /// it and the line in reach, which is lit.
  static func point(_ frame: Frame, _ state: inout State, x: Double, y: Double) {
    let g = frame.g
    guard x >= g.x0 - 2 && x <= g.x1 + 2 && y >= g.y0 - 12 && y <= g.y1 + 6 else {
      state.pointer = nil
      state.hover = nil
      return
    }
    let t = tAt(frame, x)
    let near = nearest(frame, t, y)
    state.pointer = State.Pointer(t: t, near: near)
    state.hover = near
  }

  // The view hears a gesture's end twice, its lift (`onEnded`) and its gesture state's reset, in an order no host
  // row can witness; a cancelled touch is its reset alone. So every touch has a token, and each act names the touch
  // it began: either order is the same one tap (fd's order-proof cancel, H15 and H16).

  /// A finger comes down on the chart (`onHitDown`): a new press, its token the next touch's.
  @discardableResult
  static func press(_ state: inout State, x: Double, y: Double) -> Int {
    state.touches += 1
    state.press = State.Press(x: x, y: y, token: state.touches)
    return state.touches
  }

  /// A finger lifts from the chart (`onHitUp`), ending the press it names, once: an older press's lift, or a second,
  /// taps nothing. A press that travelled more than 4 pt is no tap: nothing pans the window, and a stray drag sets
  /// nothing. A line within reach opens (its id is returned for the host to open); empty chart sets the moment there,
  /// and a tap on the moment lets it go.
  static func lift(_ frame: Frame, _ state: inout State, x: Double, y: Double, token: Int) -> String? {
    guard let from = state.press, from.token == token else { return nil }
    state.press = nil
    guard abs(x - from.x) <= 4, abs(y - from.y) <= 4 else { return nil }
    let t = tAt(frame, x)
    if let near = nearest(frame, t, y) { return near }
    if let pinned = frame.pinned, abs(xOf(frame.g, frame.span, t) - xOf(frame.g, frame.span, pinned)) < 8 {
      state.held = nil
    } else {
      state.held = t
    }
    return nil
  }

  /// The touch's gesture is over (its reset), lifted or not; a cancelled touch's only end (the window's
  /// `onPointerCancel`). The finger is gone. It acts only on the press it names, and only while that press is open:
  /// after its lift, or once a newer press began, it does nothing. It leaves the press for its own lift, so a reset
  /// that comes first still lets that lift tap, once; a cancelled touch never lifts, so it taps nothing, and the next
  /// press takes its place.
  static func cancel(_ state: inout State, token: Int) {
    guard state.press?.token == token else { return }
    state.pointer = nil
    state.hover = nil
  }

  /// The finger leaves the chart (`onHitLeave`).
  static func leave(_ state: inout State) {
    state.press = nil
    state.pointer = nil
    state.hover = nil
  }

  /// The Now pill: let go of the moment (`release`).
  static func release(_ state: inout State) {
    state.held = nil
  }

  /// A finger on the list holds its order: rows never move under it (SV-D12); it lets go as the finger leaves.
  static func holdList(_ frame: Frame, _ state: inout State) {
    state.listHeld = frame.order
  }

  static func letGoOfList(_ state: inout State) {
    state.listHeld = nil
    state.hover = nil
  }

  /// A finger comes down on the list: it holds the order (SV-D12) and lights the row it is on (the row's
  /// `onPointerEnter`, which a touch fires as it comes down). Its token names its drag, its lift and its reset.
  @discardableResult
  static func touchList(_ frame: Frame, _ state: inout State, x: Double, y: Double) -> Int {
    state.touches += 1
    let row = frame.rows.first {
      !$0.hidden && x >= $0.x && x < $0.x + $0.width && y >= $0.top && y < $0.top + $0.height
    }
    state.list = State.ListTouch(token: state.touches, x: x, y: y, row: row?.id, applied: 0, down: true)
    holdList(frame, &state)
    if let row { state.hover = row.id }
    return state.touches
  }

  /// The finger on the list moves: every whole row of travel from where it came down is one step of the wheel
  /// (`listSteps`, then `scrollList` on the frame each step starts from). Only the touch it names.
  static func dragList(_ input: Input, _ state: inout State, token: Int, y: Double) {
    guard var touch = state.list, touch.token == token else { return }
    let steps = listSteps(from: touch.y, to: y, rowH: geometryFor(width: input.width, height: input.height).rowH)
    while touch.applied != steps {
      let step = steps > touch.applied ? 1 : -1
      scrollList(frame(input, state), &state, deltaY: Double(step))
      touch.applied += step
    }
    state.list = touch
  }

  /// The finger lifts from the list, ending the touch it names, once. A touch that stepped no row and travelled no
  /// more than 4 pt is a tap on the row it came down on (its id is returned for the host to open). The list lets go.
  static func liftList(_ state: inout State, token: Int, x: Double, y: Double) -> String? {
    guard let touch = state.list, touch.token == token else { return nil }
    state.list = nil
    if touch.down { letGoOfList(&state) }
    guard touch.applied == 0, abs(x - touch.x) <= 4, abs(y - touch.y) <= 4 else { return nil }
    return touch.row
  }

  /// The list touch's gesture is over (its reset), lifted or not: the list lets go. It acts only on the touch it
  /// names, while its finger is down. The touch stays for its own lift, so a reset that comes first still lets that
  /// lift tap, once.
  static func cancelList(_ state: inout State, token: Int) {
    guard var touch = state.list, touch.token == token, touch.down else { return }
    touch.down = false
    state.list = touch
    letGoOfList(&state)
  }

  /// A step of the list by one whole row in `deltaY`'s direction (the wheel's `Math.sign`), only while it has more
  /// rows than slots, never past its ends. A NaN steps nowhere.
  static func scrollList(_ frame: Frame, _ state: inout State, deltaY: Double) {
    guard frame.fit.more else { return }
    let step = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0
    state.listOffset = Swift.min(frame.fit.maxOffset, Swift.max(0, frame.fit.offset + step))
  }

  /// The view's effects after a frame: a set moment the window has slid past lets go, and the top eases toward its
  /// target a frame at a time (still, it lands at once).
  static func settle(_ frame: Frame, _ state: inout State, motion: Bool) {
    if state.held != nil && frame.pinned == nil { state.held = nil }
    guard state.yShown != frame.target.max else { return }
    state.yShown =
      state.yShown == nil || !motion
      ? frame.target.max : SpendScale.easeTop(shown: state.yShown, target: frame.target.max)
  }
}
