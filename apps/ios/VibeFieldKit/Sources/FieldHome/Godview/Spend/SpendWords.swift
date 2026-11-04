import FieldAgents
import FieldMesh
import FieldProduct
import Foundation

// PG-7 — WHAT THE SPEND VIEW SAYS IN WORDS, transcribed from puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend
// module `5abe8f75`): `src/views/spend/spend-words.ts` (dist `spend-words.js` :8-166). Money as the swarm prints it
// (`~$1.84`, `+` when partial, `—` unpriced), the burn by the hour, each row's name and the line under it, and its
// state at a moment. Lengths are short (`11m`, `1h 02m`), never m:ss, which beside a time axis would read as a clock
// time. The facts are the row's; the formats are the toolkit's, reused: `formatUsd` and `formatRatePerHour`
// (FieldAgents, JSNumber since items 164/165), `detailLine` and `projectName` (FieldMesh's MonitorWords), and
// `formatShort` and `formatClock` (GodviewFormat). Held to `phone-spend.golden.json` (SpendParityTests P3, P4, P5b, V1,
// V5, V6, V7).
//
// JavaScript's strings, kept: a split, a trim and a word boundary are read on Unicode scalars with JavaScript's own
// whitespace (a Swift Character joins "\r\n" into one, so `split("\n")` would keep it whole), and `===` compares
// UTF-16 units (Swift's `==` would call two canonically equivalent spellings one).

enum SpendWords {
  /// Below this a working agent's burn is said as how long it has worked (`BURN_FLOOR_PER_MIN`).
  static let burnFloorPerMinute = 0.0005

  enum Tone: String, Sendable { case muted, attention, info, live }

  /// A state's words and their tone (§2.5).
  struct Said: Equatable, Sendable {
    let text: String
    let tone: Tone
  }

  enum Glyph: String, Sendable { case question, failure, permission, reply }

  /// What a row was doing at a moment (`SpendRowState`).
  struct State: Equatable, Sendable {
    enum Key: String, Sendable { case before, unknown, blocked, unseen, idle, working }
    let key: Key
    let sinceMs: Double
    var glyph: Glyph?
    var words: String?
  }

  /// The names a row goes by (`SpendName`): its project, the one-line form, its task line, its model.
  struct Name: Equatable, Sendable {
    let name: String
    let one: String
    let task: String
    let model: String
  }

  /// A started row whose money then nobody recorded: another desktop's row carries its total, never its buckets.
  static let notRecorded = Said(text: "not recorded", tone: .muted)

  // MARK: - Money

  /// `money` (:9): the toolkit's `formatUsd`, with thousands as whole dollars.
  static func money(_ value: Double?) -> String {
    guard let value, value.isFinite else { return "—" }
    if value >= 1000 { return "$" + grouped(JSNumber.round(value)) }
    return formatUsd(value)
  }

  /// `est` (:17): the swarm's own figure — a tilde because it is an estimate, a plus when some work went unpriced.
  static func est(_ value: Double?, partial: Bool) -> String {
    guard let value else { return "—" }
    return "~\(money(value))\(partial ? "+" : "")"
  }

  /// `perHour` (:19): the burn as people price work, by the hour, from USD a minute. Past spend's two edges it is the
  /// toolkit's `formatRatePerHour`: none burned says `$0/hr` (the toolkit would say `$0.00/hr`), and NaN is `money`'s
  /// dash.
  static func perHour(_ perMinute: Double?) -> String {
    guard let perMinute else { return "—/hr" }
    let hour = perMinute * 60
    if hour <= 0 { return "$0/hr" }
    if hour.isNaN { return "—/hr" }
    return formatRatePerHour(perHour: hour)
  }

  /// `axisMoney` (:32): an axis tick, as short as the step allows.
  static func axisMoney(_ value: Double, step: Double) -> String {
    if value == 0 { return "$0" }
    if step >= 1 { return "$" + grouped(JSNumber.round(value)) }
    if step >= 0.1 { return "$" + SpendNumber.fixed(value, 1) }
    if step >= 0.01 { return "$" + SpendNumber.fixed(value, 2) }
    return "$" + SpendNumber.fixed(value, 3)
  }

  /// `toLocaleString('en-US')` of a whole number: JavaScript's digits for it, its shortest round-trip digits padded
  /// with zeros (ICU writes even 1e21 out, where `String()` turns to an exponent), with a comma every three.
  private static func grouped(_ whole: Double) -> String {
    var digits = JSNumber.whole(whole)
    let negative = digits.hasPrefix("-")
    if negative { digits.removeFirst() }
    if let e = digits.firstIndex(of: "e") {
      let mantissa = digits[..<e]
      let exponent = Int(digits[digits.index(after: e)...].filter { $0 != "+" }) ?? 0
      let integral =
        mantissa.firstIndex(of: ".").map { mantissa.distance(from: mantissa.startIndex, to: $0) } ?? mantissa.count
      let figures = mantissa.filter { $0 != "." }
      digits = figures + String(repeating: "0", count: Swift.max(0, exponent + integral - figures.count))
    }
    var out = ""
    for (index, character) in digits.reversed().enumerated() {
      if index > 0 && index % 3 == 0 { out.append(",") }
      out.append(character)
    }
    return (negative ? "-" : "") + String(out.reversed())
  }

  // MARK: - Names

  /// `taskOf` (:55): what a row says where the held view printed its task — the line under its name by the toolkit's
  /// one rule (`detailLine`), its first line with leading marks off, unless it only repeats the project or the bare
  /// status the state words already print: then nothing, and the row falls back to its model.
  static func taskOf(_ agent: SpendAgent) -> String {
    let detail = MonitorWords.detailLine(agent.monitor, isSelf: agent.isSelf)
    let first = detail.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).first
    let line = trim(dropLeadingMarks(first.map(String.init) ?? ""))
    let repeats = same(line, MonitorWords.projectName(agent.monitor)) || same(line, agent.monitor.status.rawValue)
    return line.isEmpty || repeats ? "" : line
  }

  /// `modelOf` (:63): the run's model (or its provider), then its branch.
  static func modelOf(_ agent: SpendAgent) -> String {
    let row = agent.monitor
    let model = row.model ?? row.provider?.label
    let branch: String? =
      if case .named(let name) = row.project.branch { name } else { nil }
    return [model, branch].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
  }

  /// `spendNames` (:72): the names rows go by. Where two share a project the one-line form adds what tells them
  /// apart: their agent when it differs, else the first words of their task (else the row's id).
  static func spendNames(_ agents: [SpendAgent]) -> [String: Name] {
    let projects = agents.map { MonitorWords.projectName($0.monitor) }
    var out: [String: Name] = [:]
    for (index, agent) in agents.enumerated() {
      let task = taskOf(agent)
      let project = projects[index]
      let siblings = agents.indices.filter { $0 != index && same(projects[$0], project) }
      let provider = agent.monitor.provider?.id ?? ""
      let sameProvider = siblings.contains { same(agents[$0].monitor.provider?.id ?? "", provider) }
      var one = project
      if !siblings.isEmpty {
        let words = firstWords(task, 2)
        one = "\(project) · \(sameProvider || provider.isEmpty ? (words.isEmpty ? agent.id : words) : provider)"
      }
      out[agent.id] = Name(name: project, one: one, task: task, model: modelOf(agent))
    }
    return out
  }

  /// `fitWords` (:88): text fitted to a width at a word boundary, so a cut never lands mid-word.
  static func fitWords(_ text: String, max: Double, measure: (String) -> Double) -> String {
    if text.isEmpty || max <= 0 { return "" }
    if measure(text) <= max { return text }
    var out = ""
    for word in text.unicodeScalars.split(separator: " ", omittingEmptySubsequences: false).map(String.init) {
      let next = out.isEmpty ? word : "\(out) \(word)"
      if measure("\(next)…") > max { break }
      out = next
    }
    return out.isEmpty ? "" : "\(out)…"
  }

  // MARK: - State

  /// `glyphOf` (:102): a wait's glyph; a kind spend does not know asks with the permission's.
  static func glyphOf(_ kind: String?) -> Glyph {
    switch kind {
    case "question": .question
    case "failure": .failure
    default: .permission
    }
  }

  /// `spendStateAt` (:110): what a row was doing at `t`, as far as the live row says. Before it was born it is not yet
  /// anything: it says when it starts. From the moment its current state began it is that state, a reply nobody
  /// opened being `unseen` (the stage's unread, S2). Earlier than that the row does not say: `unknown`.
  static func spendStateAt(bornMs: Double, agent: SpendAgent, t: Double, nowMs: Double) -> State {
    if t < bornMs { return State(key: .before, sinceMs: bornMs) }
    let row = agent.monitor
    // the wire's statusSince is a whole number of ms, so always finite (`Number.isFinite` holds)
    let sinceMs = Swift.max(bornMs, Swift.min(Double(row.statusSince), nowMs))
    if t < sinceMs && t < nowMs - 1000 { return State(key: .unknown, sinceMs: t) }
    switch row.status {
    case .blocked:
      return State(key: .blocked, sinceMs: sinceMs, glyph: glyphOf(row.wait?.kind), words: row.wait?.detail)
    case .idle where agent.unread: return State(key: .unseen, sinceMs: sinceMs, glyph: .reply)
    case .idle: return State(key: .idle, sinceMs: sinceMs)
    case .working: return State(key: .working, sinceMs: sinceMs)
    }
  }

  /// `printedBurn` (:132): the burn a row prints at a moment, per minute — a working row's, or what the buckets show
  /// before its current state began. Nil when its words say something else, or the burn is too small to print.
  static func printedBurn(_ state: State, perMinute: Double?) -> Double? {
    guard state.key == .working || state.key == .unknown, let perMinute, perMinute > burnFloorPerMinute else {
      return nil
    }
    return perMinute
  }

  /// `stateWords` (:138): a state's words for line 2 (or the money slot, for `before` in the one-line form), and their
  /// tone. `timeZone` is the reader's: the start of a row not yet born is a clock time.
  static func stateWords(_ state: State, t: Double, perMinute: Double?, timeZone: TimeZone) -> Said {
    let since = GodviewFormat.formatShort(ms: t - state.sinceMs)
    let burn = printedBurn(state, perMinute: perMinute)
    switch state.key {
    case .before:
      return Said(text: "starts \(GodviewFormat.formatClock(ms: state.sinceMs, timeZone: timeZone))", tone: .muted)
    case .blocked: return Said(text: "waiting · \(since)", tone: .attention)
    case .unseen: return Said(text: "reply unseen · \(since)", tone: .info)
    case .idle: return Said(text: "idle · \(since)", tone: .muted)
    case .working: return Said(text: burn.map { perHour($0) } ?? "working · \(since)", tone: .live)
    case .unknown:
      // before its current state began: what it was doing nobody kept, what it was spending its buckets say
      return burn.map { Said(text: perHour($0), tone: .live) } ?? Said(text: "", tone: .muted)
    }
  }

  /// `waits` (:163): a row that waits on the person never folds out of sight (the list docks it).
  static func waits(_ state: State) -> Bool { state.key == .blocked || state.key == .unseen }

  // MARK: - JavaScript's strings

  /// `===` on strings: the same UTF-16 units.
  static func same(_ a: String, _ b: String) -> Bool { a.utf16.elementsEqual(b.utf16) }

  /// JavaScript's whitespace (`\s`, and what `trim()` takes off): WhiteSpace and LineTerminator.
  private static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }

  /// `trim()`.
  private static func trim(_ text: String) -> String {
    let scalars = text.unicodeScalars
    guard let first = scalars.firstIndex(where: { !isSpace($0) }),
      let last = scalars.lastIndex(where: { !isSpace($0) })
    else { return "" }
    return String(scalars[first...last])
  }

  /// `replace(/^[^\p{L}\p{N}~/.]+/u, '')`: the marks before the first letter, number, `~`, `/` or `.` off.
  private static func dropLeadingMarks(_ text: String) -> String {
    let scalars = text.unicodeScalars
    let start = scalars.firstIndex { scalar in
      switch scalar.properties.generalCategory {
      case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter, .decimalNumber,
        .letterNumber, .otherNumber:
        true
      default: scalar == "~" || scalar == "/" || scalar == "."
      }
    }
    return String(scalars[(start ?? scalars.endIndex)...])
  }

  /// `firstWords` (:66): `text.split(/\s+/).slice(0, count).join(' ')` — a run of whitespace is one cut, and a text
  /// that begins or ends with one keeps an empty word there.
  private static func firstWords(_ text: String, _ count: Int) -> String {
    var words: [String] = []
    var current = String.UnicodeScalarView()
    var inSpace = false
    for scalar in text.unicodeScalars {
      if isSpace(scalar) {
        if !inSpace { words.append(String(current)) }
        current = String.UnicodeScalarView()
        inSpace = true
      } else {
        current.append(scalar)
        inSpace = false
      }
    }
    words.append(String(current))
    return words.prefix(count).joined(separator: " ")
  }
}
