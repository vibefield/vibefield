import Foundation

/// Everything on the History tab that is a DECISION rather than a layout
/// (H-D4): the ledger's order and wash, the scope line's words, the search's
/// matching and its counts, where a hit lands and what the stepper says.
/// Pure functions over the corpus, pinned by `FieldHistoryTests` — IOS-3r's
/// finding applied before the fact: the one module with no test target is
/// where every serious bug lived.
public enum FieldHistoryModel {

  // MARK: - The desktop's standing (H-D7: the record's honest states, verbatim)

  /// What this phone knows about the desktop whose index it reads.
  public enum DesktopStanding: Equatable, Sendable {
    case connected
    /// The desktop's node is off the tailnet, or its door does not answer;
    /// figures dim, green is withheld, what was read stands (H-D7).
    case asleep
    /// The desktop is building its index: a percentage and a denominator.
    case indexing(percent: Int, done: String, total: String)
    /// SP-6 — the desktop's door speaks another contracts version than this
    /// phone (the record's `studio speaks protocol 21 · this phone 20`, named
    /// in the numbers the DOOR compares — contracts, never rosetta's own).
    case incompatible(theirs: String, ours: String)

    /// Whether the desktop can answer right now: the figures are live.
    public var isAwake: Bool {
      switch self {
      case .connected, .indexing: true
      case .asleep, .incompatible: false
      }
    }
  }

  public enum Rank: String, CaseIterable, Sendable {
    case spend
    case recent
  }

  /// The ledger, ranked: by spend (the corpus's own order) or by recency.
  public static func projects(_ projects: [HistoryProject], rankedBy rank: Rank) -> [HistoryProject] {
    switch rank {
    case .spend: projects.sorted { $0.spend > $1.spend }
    case .recent: projects.sorted { $0.recencyMinutes < $1.recencyMinutes }
    }
  }

  /// The wash behind a row: spend, scaled to the biggest project (0…1).
  public static func share(of project: HistoryProject, among projects: [HistoryProject]) -> Double {
    let max = projects.map(\.spend).max() ?? 0
    guard max > 0 else { return 0 }
    return project.spend / max
  }

  /// The line under the title.
  public static func scopeLine(_ corpus: HistoryCorpus, standing: DesktopStanding) -> String {
    switch standing {
    case .connected:
      return "\(corpus.projects.count) projects · \(figure(corpus.sessionCount)) sessions across \(corpus.agentCount) agents"
    case .asleep:
      return "\(corpus.desktop) is asleep · read \(corpus.readAt)"
    case .indexing(let percent, _, _):
      return "\(corpus.desktop) is indexing · \(percent)%"
    case .incompatible(let theirs, let ours):
      return "\(corpus.desktop) speaks contracts \(theirs) · this phone \(ours)"
    }
  }

  /// The words under an indexing scope line: `8,400 of 13,700 sessions`.
  public static func indexingDenominator(standing: DesktopStanding) -> String? {
    guard case .indexing(_, let done, let total) = standing else { return nil }
    return "\(done) of \(total) sessions"
  }

  /// The group head over the live rows.
  public static func liveHeader(_ corpus: HistoryCorpus, standing: DesktopStanding) -> (label: String, count: Int?) {
    if !standing.isAwake { return ("Last seen live · \(corpus.readAt)", nil) }
    return ("Live now", corpus.live.count)
  }

  /// A count with its thousands separator, as the record writes it.
  public static func figure(_ count: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.groupingSeparator = ","
    formatter.usesGroupingSeparator = true
    return formatter.string(from: NSNumber(value: count)) ?? String(count)
  }

  // MARK: - Search (H-5)

  public enum SearchKind: String, CaseIterable, Sendable {
    case any
    case prompts
    case replies

    public var label: String {
      switch self {
      case .any: "All"
      case .prompts: "Prompts"
      case .replies: "Replies"
      }
    }

    fileprivate func admits(_ who: HistoryHit.Who) -> Bool {
      switch self {
      case .any: true
      case .prompts: who == .you
      case .replies: who == .agent
      }
    }
  }

  /// The query's terms, lowercased: every one has to appear.
  public static func terms(_ query: String) -> [String] {
    query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
  }

  /// The hits that say every term, in the kind asked for, grouped as the
  /// corpus groups them (a group with no surviving rows is not shown).
  public static func hits(for query: String, kind: SearchKind, in corpus: HistoryCorpus) -> [HistoryHitGroup] {
    let terms = terms(query)
    guard !terms.isEmpty else { return [] }
    return corpus.hits.compactMap { group in
      let rows = group.rows.filter { row in
        kind.admits(row.who) && terms.allSatisfy { row.text.lowercased().contains($0) }
      }
      guard !rows.isEmpty else { return nil }
      return HistoryHitGroup(
        id: group.id, projectId: group.projectId, sessionId: group.sessionId, sessionTitle: group.sessionTitle,
        agent: group.agent, day: group.day, rows: rows)
    }
  }

  public static func matchCount(_ groups: [HistoryHitGroup]) -> Int { groups.reduce(0) { $0 + $1.rows.count } }

  /// The head of a group: `3 hits · Today`.
  public static func groupWords(_ group: HistoryHitGroup) -> String {
    "\(group.rows.count) \(group.rows.count == 1 ? "hit" : "hits") · \(group.day)"
  }

  /// The foot's count: what the search found, or why it could not look.
  public static func searchFoot(query: String, matches: Int, standing: DesktopStanding, desktop: String) -> String {
    if !standing.isAwake { return "Search needs \(desktop)" }
    if terms(query).isEmpty { return "Recent searches" }
    return "\(matches) \(matches == 1 ? "match" : "matches")"
  }

  /// The quiet state in the list, when there is one to say.
  public struct Quiet: Equatable, Sendable {
    public let title: String
    public let body: String
  }

  public static func quiet(query: String, kind: SearchKind, matches: Int, corpus: HistoryCorpus, standing: DesktopStanding) -> Quiet? {
    if !standing.isAwake {
      return Quiet(
        title: "\(corpus.desktop) is asleep",
        body:
          "Search runs on the desktop's index, so it answers again when \(corpus.desktop) wakes. Everything you already opened is still on screen.")
    }
    guard !terms(query).isEmpty, matches == 0 else { return nil }
    let what: String =
      switch kind {
      case .prompts: "prompts"
      case .replies: "replies"
      case .any: "prompts or replies"
      }
    return Quiet(
      title: "No \(what) say “\(query.trimmingCharacters(in: .whitespaces))”",
      body:
        "Searched \(figure(corpus.sessionCount)) sessions across \(corpus.agentCount) agents on \(corpus.desktop). Every word has to appear — try fewer.")
  }

  /// The pieces of a hit's text, with the terms marked, so the row can draw
  /// a `mark` per term without regexes in the view.
  public struct TextRun: Equatable, Sendable {
    public let text: String
    public let marked: Bool
  }

  public static func marked(_ text: String, terms: [String]) -> [TextRun] {
    guard !terms.isEmpty else { return [TextRun(text: text, marked: false)] }
    var runs: [TextRun] = []
    let lower = text.lowercased()
    // Both strings index the same characters: lowercasing changes no count
    // for the corpus's own text, and a term is matched in the lowered copy
    // and cut from the original at the same offsets.
    let lowerChars = Array(lower)
    let chars = Array(text)
    guard lowerChars.count == chars.count else { return [TextRun(text: text, marked: false)] }
    var i = 0
    var plain = ""
    while i < chars.count {
      var matched: Int? = nil
      for term in terms {
        let termChars = Array(term)
        if i + termChars.count <= chars.count, Array(lowerChars[i..<i + termChars.count]) == termChars {
          matched = termChars.count
          break
        }
      }
      if let matched {
        if !plain.isEmpty {
          runs.append(TextRun(text: plain, marked: false))
          plain = ""
        }
        runs.append(TextRun(text: String(chars[i..<i + matched]), marked: true))
        i += matched
      } else {
        plain.append(chars[i])
        i += 1
      }
    }
    if !plain.isEmpty { runs.append(TextRun(text: plain, marked: false)) }
    return runs
  }

  // MARK: - Landing (H-5): where a tapped hit goes

  public enum Landing: Equatable, Sendable {
    /// The session's document, with the ring of hits to step through.
    case session(device: String, projectId: String, sessionId: String, ring: [String], at: Int)
    /// The project, with the session row to ring: the corpus holds no document
    /// (the mock's rows without one; a door's rows name no project yet).
    case project(device: String, projectId: String, sessionId: String)
  }

  /// Where a tapped hit goes. Over a DOOR (SP-6) a document is read when the
  /// session opens, so a group whose session the corpus does not hold yet
  /// still lands in the document — the reader fills it; only the mock's
  /// rows without a document land on the project.
  public static func landing(for hit: HistoryHit, in group: HistoryHitGroup, corpus: HistoryCorpus) -> Landing {
    let readsOnOpen = corpus.searchedQuery != nil
    guard readsOnOpen || corpus.document(group.sessionId) != nil else {
      return .project(device: corpus.deviceId, projectId: group.projectId, sessionId: group.sessionId)
    }
    var ring: [String] = []
    for row in group.rows where !ring.contains(row.anchor) { ring.append(row.anchor) }
    let at = ring.firstIndex(of: hit.anchor) ?? 0
    let projectId = group.projectId.isEmpty ? (corpus.documents[group.sessionId]?.projectId ?? "") : group.projectId
    return .session(device: corpus.deviceId, projectId: projectId, sessionId: group.sessionId, ring: ring, at: at)
  }

  /// The stepper's words: `2 of 3`.
  public static func stepWords(at: Int, of count: Int) -> String { "\(at + 1) of \(count)" }

  /// The next stop on the ring, wrapping — the island's own stepper law.
  public static func step(_ at: Int, by delta: Int, of count: Int) -> Int {
    guard count > 0 else { return 0 }
    return ((at + delta) % count + count) % count
  }

  // MARK: - The bar's fold on scroll (IOS-9e)

  /// Whether a scroll folds the app's bar to its selected glyph — iOS 26's
  /// `.tabBarMinimizeBehavior(.onScrollDown)`, which the phone's own bar
  /// reimplements now that the account stands in it. `anchor` follows the
  /// extreme of the current direction, so the bar folds after `threshold`
  /// points of travel down from the highest point and opens after `threshold`
  /// points back up from the lowest; within `top` of the top it is open.
  public static func barFold(
    minimized: Bool, anchor: CGFloat, offset: CGFloat, threshold: CGFloat = 28, top: CGFloat = 12
  ) -> (minimized: Bool, anchor: CGFloat) {
    if offset <= top { return (false, offset) }
    if minimized {
      if offset > anchor { return (true, offset) }
      if anchor - offset > threshold { return (false, offset) }
      return (true, anchor)
    }
    if offset < anchor { return (false, offset) }
    if offset - anchor > threshold { return (true, offset) }
    return (false, anchor)
  }

  // MARK: - The ribbon (a project's 53 weeks)

  /// The record's own seeded pattern, so the ribbon a screenshot shows is
  /// the page's (`rng(p.seq * 7919 + 17)`, mulberry32).
  public static func ribbon(seq: Int, start: Int) -> [[Int]] {
    var state = UInt32(truncatingIfNeeded: seq * 7919 + 17)
    func next() -> Double {
      state = state &+ 0x6D2B_79F5
      var t = state ^ (state >> 15)
      t = t &* (1 | state)
      t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
      return Double((t ^ (t >> 14))) / 4_294_967_296
    }
    var weeks: [[Int]] = []
    for w in 0..<53 {
      let env = 0.3 + 0.7 * pow(sin((Double(w) / 53) * .pi * 1.25 + Double(seq)), 2)
      var days: [Int] = []
      for d in 0..<7 {
        if w < start {
          days.append(0)
          continue
        }
        let weekend = d == 0 || d == 6
        let on = next() < (weekend ? 0.42 : 0.78) * env
        days.append(on ? min(4, 1 + Int(next() * 4 * env)) : 0)
      }
      weeks.append(days)
    }
    return weeks
  }
}
