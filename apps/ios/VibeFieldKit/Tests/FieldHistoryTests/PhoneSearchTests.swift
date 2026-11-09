import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

// SE-2 (SE-D3, SE-D4, SE-D5 A; UM-D28 A; DESIGN.md §8 "The phone's search", §9 "Search's words") — the phone's search
// as decisions over values: Live now's rows, filters, chips, tokens, offer, foot and empty words; Everything's rows
// from the index's groups and, before a word, the sessions the phone holds; and where a tap goes. The drawing is
// `p6-psearch.js`; every word asserted here is §9's.
//
// No agent id is written (R23b's spirit in a test): agents are "Agent"/"Shell" labels, or a label function's echo.
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("the phone's search decides in values")
struct PhoneSearchTests {
  // MARK: - The field these rows read

  static let studio = PhoneSearch.Desk(id: "dev-1", name: "studio", platform: "darwin", asleep: false, isHome: true)
  static let loft = PhoneSearch.Desk(id: "dev-2", name: "loft", platform: "linux", asleep: false, isHome: false)
  static let mini = PhoneSearch.Desk(id: "dev-3", name: "mini", platform: "darwin", asleep: true, isHome: false)

  static func set(_ id: String, _ label: String, kind: String = "managed", glyph: String? = nil) throws -> AgentProfileSet {
    var fields: [String: JSONValue] = [
      "id": .string(id), "kind": .string(kind), "label": .string(label), "default": .bool(kind == "native"),
      "personas": .array([]),
    ]
    if let glyph { fields["glyph"] = .string(glyph) }
    return try AgentProfileSet(json: .object(fields))
  }

  /// The home's three: This Mac, Work and Side.
  static func profiles() throws -> [AgentProfileSet] {
    [try set("native", "This Mac", kind: "native"), try set("work", "Work", glyph: "briefcase"), try set("side", "Side")]
  }

  static func session(
    _ id: String, _ state: PhoneSearch.LiveState, profile: String? = "work",
    on desk: PhoneSearch.Desk = PhoneSearchTests.studio, title: String = "Ready.", folder: String? = "vibe-field",
    agent: String? = "Agent", native: String? = nil, planKey: String? = nil
  ) -> PhoneSearch.LiveSession {
    PhoneSearch.LiveSession(
      id: id, title: title, folder: folder, agent: agent, state: state, profileSet: desk.isHome ? profile : nil,
      device: desk.id, deviceName: desk.name, platform: desk.platform, isHome: desk.isHome, nativeSessionId: native,
      planKey: planKey)
  }

  /// Eight live sessions: six on the home (four under Work, two under This Mac, one a shell), two on the loft.
  static func field(lines: [String: [HistoryHit]] = [:]) throws -> PhoneSearch.Live {
    PhoneSearch.Live(
      sessions: [
        session("a-idle", .idle, title: "Pushed the lane; the gate is green.", native: "n-a"),
        session("b-works", .working, title: "Tracing where the swarm reads the host line.", folder: "puppeteer"),
        session("c-shell", .shell, profile: "native", title: "notes", folder: nil, agent: "Shell"),
        session("d-asks", .blocked, title: "Keep the old ledger format?", folder: "billing-api", native: "n-d"),
        session("e-mine", .idle, profile: "native", title: "Ready.", folder: "dotfiles"),
        session("f-loft", .working, on: loft, title: "Running the long suite.", folder: "rosetta", native: "n-f"),
        session("g-loft", .blocked, on: loft, title: "Which key should the export use?", folder: "vibe-field"),
        session("h-works", .working, title: "Drawing the bands key.", folder: "vibe-field", native: "n-h"),
      ],
      desks: [studio, loft, mini], profiles: try profiles(), lines: lines)
  }

  static func hit(_ id: String, _ text: String, who: HistoryHit.Who = .agent) -> HistoryHit {
    HistoryHit(id: id, anchor: id, who: who, text: text, at: "10:30")
  }

  // MARK: - Live now: the rows

  @Test("Live now without words: every live session, waiting → working → idle → a shell, the field's order kept")
  func liveWithoutWords() throws {
    let rows = PhoneSearch.liveRows(try Self.field(), query: "", profile: nil, desk: nil)
    let ids = rows.map { $0.session.id }
    #expect(ids == ["d-asks", "g-loft", "b-works", "f-loft", "h-works", "a-idle", "e-mine", "c-shell"])
    #expect(rows.allSatisfy { $0.lines.isEmpty })
  }

  @Test("Live now with words: every word in the facts or the matched lines, the most lines first, three at most")
  func liveWithWords() throws {
    let lines: [String: [HistoryHit]] = [
      "n-a": [Self.hit("1", "the bands key passes"), Self.hit("2", "bands key 2"), Self.hit("3", "bands 3"),
              Self.hit("4", "bands 4")],
      "n-f": [Self.hit("5", "bands key in the suite")],
    ]
    let rows = PhoneSearch.liveRows(try Self.field(lines: lines), query: "Bands KEY", profile: nil, desk: nil)
    let ids = rows.map { $0.session.id }
    // a-idle: four lines, three kept; f-loft: one line; h-works: its title holds both words, no line
    #expect(ids == ["a-idle", "f-loft", "h-works"])
    #expect(rows.first?.lines.count == PhoneSearch.rowLines)
    // a word in the folder and one in the agent's label: held across the facts
    let mixed = PhoneSearch.liveRows(try Self.field(), query: "billing agent", profile: nil, desk: nil)
    let mixedIds = mixed.map { $0.session.id }
    #expect(mixedIds == ["d-asks"])
  }

  /// The lens is self-only (the lead's rulings 16 and 17; ‹for James›): under a profile only the home's runs under it
  /// stay, so a peer's run leaves Live now; the desktop token keeps one desktop's runs.
  @Test("a profile keeps the home's runs under it — a peer's run leaves; a desktop keeps its own")
  func liveFilters() throws {
    let field = try Self.field()
    let work = PhoneSearch.liveRows(field, query: "", profile: "work", desk: nil).map { $0.session.id }
    #expect(work == ["d-asks", "b-works", "h-works", "a-idle"])
    #expect(!work.contains("f-loft") && !work.contains("g-loft"), "a peer's run carries no profile of the home's")
    let loft = PhoneSearch.liveRows(field, query: "", profile: nil, desk: "dev-2").map { $0.session.id }
    #expect(loft == ["g-loft", "f-loft"])
    let both = PhoneSearch.liveRows(field, query: "", profile: "work", desk: "dev-2")
    #expect(both.isEmpty)
  }

  // MARK: - Live now: chips, tokens, the offer

  @Test("Live now's chips: the profiles less the chosen one with their sessions and the waiting dot, then the desktops")
  func liveChips() throws {
    let groups = PhoneSearch.liveChips(try Self.field(), profile: "native", desk: nil)
    #expect(groups.count == 2)
    let profiles = try #require(groups.first)
    let labels = profiles.map { $0.label }
    #expect(labels == ["Work", "Side"])
    let work = try #require(profiles.first)
    let side = try #require(profiles.last)
    #expect(work.note == "4" && work.waiting)
    #expect(side.note == "0" && !side.waiting)
    let desks = try #require(groups.last)
    let names = desks.map { $0.label }
    #expect(names == ["studio", "loft", "mini"])
    let notes = desks.map { $0.note }
    #expect(notes == ["6", "2", "asleep"])
    #expect(desks.allSatisfy { !$0.waiting })
    // the chosen desktop leaves its group
    let narrowed = PhoneSearch.liveChips(try Self.field(), profile: nil, desk: "dev-1")
    let deskNames = (narrowed.last ?? []).map { $0.label }
    #expect(deskNames == ["loft", "mini"])
  }

  /// SE-2l (the S2 review's finding 11; §9 "The phone's chips and offers": "A chip's count is its sessions, or
  /// 'asleep'") — a chip is spoken with its count's noun, never a bare figure, and the waiting dot in words.
  @Test("a chip is spoken with its sessions or asleep, and its waiting; who said it and a project by name")
  func chipsSpeak() throws {
    let groups = PhoneSearch.liveChips(try Self.field(), profile: nil, desk: nil)
    let profiles = (groups.first ?? []).map { $0.spoken }
    #expect(profiles == ["This Mac, 2 sessions", "Work, 4 sessions, waiting on you", "Side, 0 sessions"])
    let desks = (groups.last ?? []).map { $0.spoken }
    #expect(desks == ["studio, 6 sessions", "loft, 2 sessions", "mini, asleep"])
    let billing = PhoneSearch.Project(key: "k1", name: "billing-api")
    let past = PhoneSearch.pastChips(projects: [billing], kind: .any, project: nil)
    let said = past.joined().map { $0.spoken }
    #expect(said == ["Prompts", "Replies", "billing-api"])
  }

  /// UM-D12 — with one profile nothing names a profile: the caller hands none (the lens's `offersProfiles`), so no
  /// chip, no token and no offer names one.
  @Test("with one profile, no profile chip, token or offer")
  func oneProfileNamesNone() throws {
    var field = try Self.field()
    field.profiles = []
    let groups = PhoneSearch.liveChips(field, profile: nil, desk: nil)
    #expect(groups.count == 1)
    let first = groups.first?.first?.filter
    #expect(first == .desk("dev-1"))
    let tokens = PhoneSearch.liveTokens(field, profile: "work", desk: nil)
    #expect(tokens.isEmpty)
    let offer = PhoneSearch.liveOffer(field, query: "wo", profile: nil, desk: nil)
    #expect(offer == nil)
  }

  @Test("Live now's tokens: the profile, then the desktop; the placeholder is Search, and none with two tokens")
  func liveTokens() throws {
    let tokens = PhoneSearch.liveTokens(try Self.field(), profile: "work", desk: "dev-2")
    let labels = tokens.map { $0.label }
    #expect(labels == ["Work", "loft"])
    let leads = tokens.map { $0.lead }
    #expect(leads == [.profile(glyph: "briefcase", native: false, filled: false), .desk(platform: "linux")])
    #expect(PhoneSearch.placeholder(tokens: 0) == "Search")
    #expect(PhoneSearch.placeholder(tokens: 1) == "Search")
    #expect(PhoneSearch.placeholder(tokens: 2) == nil)
  }

  /// DESIGN.md §8 "Search — the Peek" (a token leads with "the profile's glyph (filled for the default)"), the
  /// drawing's `pg(v.glyph, v.isDefault, …)` and `ProfileGlyphSymbols`' own rule: a profile's lead carries whether it
  /// is the default, so a chip, a token, an offer, a pill and the token's menu draw it filled (the M-phone review's
  /// m2).
  @Test("a profile's lead is filled while it is the default profile, This Mac's and a managed one's alike")
  func leadFillsTheDefault() throws {
    let leads = try Self.profiles().map(PhoneSearch.lead)
    #expect(leads == [
      .profile(glyph: nil, native: true, filled: true),
      .profile(glyph: "briefcase", native: false, filled: false),
      .profile(glyph: nil, native: false, filled: false),
    ])
    let work = try AgentProfileSet(
      json: .object([
        "id": .string("work"), "kind": .string("managed"), "label": .string("Work"), "default": .bool(true),
        "glyph": .string("briefcase"), "personas": .array([]),
      ]))
    let lead = PhoneSearch.lead(work)
    #expect(lead == .profile(glyph: "briefcase", native: false, filled: true))
  }

  @Test("a typed name offers its filter: a profile while none is chosen, else a desktop; two letters at least")
  func liveOffer() throws {
    let field = try Self.field()
    let work = PhoneSearch.liveOffer(field, query: "billing wo", profile: nil, desk: nil)
    #expect(work == PhoneSearch.Offer(
      filter: .profile("work"), lead: .profile(glyph: "briefcase", native: false, filled: false),
      title: "Show only Work's sessions", note: "a filter · 4 sessions"))
    // a word inside a name: "mac" starts This Mac's second word
    let mac = PhoneSearch.liveOffer(field, query: "mac", profile: nil, desk: nil)
    #expect(mac?.filter == .profile("native"))
    // with a profile chosen, a desktop's name
    let loft = PhoneSearch.liveOffer(field, query: "lo", profile: "work", desk: nil)
    #expect(loft?.title == "Show only what runs on loft")
    #expect(loft?.note == "a filter · 2 sessions")
    let mini = PhoneSearch.liveOffer(field, query: "mi", profile: "work", desk: nil)
    #expect(mini?.note == "a filter · asleep")
    #expect(PhoneSearch.liveOffer(field, query: "w", profile: nil, desk: nil) == nil)
    #expect(PhoneSearch.liveOffer(field, query: "lo", profile: "work", desk: "dev-1") == nil)
    #expect(PhoneSearch.droppingLastWord("billing wo") == "billing")
    #expect(PhoneSearch.droppingLastWord("wo") == "")
  }

  // MARK: - Live now: the foot and the empty lists

  @Test("Live now's foot: the matches with words, K of N while a filter narrows, else N live sessions")
  func liveFoot() throws {
    let field = try Self.field()
    let all = PhoneSearch.liveRows(field, query: "", profile: nil, desk: nil)
    #expect(
      PhoneSearch.liveFoot(all, total: 8, query: "", narrowed: false, feed: .live, asked: .settled)
        == "8 live sessions, waiting first")
    let work = PhoneSearch.liveRows(field, query: "", profile: "work", desk: nil)
    #expect(
      PhoneSearch.liveFoot(work, total: 8, query: "", narrowed: true, feed: .live, asked: .settled)
        == "4 of 8 live sessions, waiting first")
    let lines: [String: [HistoryHit]] = ["n-a": [Self.hit("1", "keep it"), Self.hit("2", "keep")]]
    let found = PhoneSearch.liveRows(try Self.field(lines: lines), query: "keep", profile: nil, desk: nil)
    #expect(
      PhoneSearch.liveFoot(found, total: 8, query: "keep", narrowed: false, feed: .live, asked: .settled)
        == "2 sessions · 2 lines matched")
    let one = [PhoneSearch.LiveRow(session: Self.session("x", .idle), lines: [Self.hit("1", "x")])]
    #expect(
      PhoneSearch.liveFoot(one, total: 8, query: "x", narrowed: false, feed: .live, asked: .settled)
        == "1 session · 1 line matched")
  }

  /// SE-2i (the S2 review's finding 4; §8 "Search — the Peek"'s Live now foot) — the foot says what the world has
  /// answered: "Asking what runs…" until the home's board answers, its refusal in its words, the home asleep by name;
  /// with words, "searching" while the newest ask is out and "the words were not searched" when it came back
  /// unanswered (the last answer's lines stand).
  @Test("Live now's foot is honest: asking, refused, asleep; searching, or the words were not searched")
  func liveFootHonest() throws {
    let all = PhoneSearch.liveRows(try Self.field(), query: "", profile: nil, desk: nil)
    #expect(
      PhoneSearch.liveFoot(all, total: 8, query: "", narrowed: false, feed: .asking, asked: .settled)
        == "Asking what runs…")
    #expect(
      PhoneSearch.liveFoot(all, total: 8, query: "keep", narrowed: false, feed: .refused("the board said no"),
        asked: .settled) == "What runs could not be read — the board said no")
    #expect(
      PhoneSearch.liveFoot(all, total: 8, query: "", narrowed: false, feed: .asleep("studio"), asked: .settled)
        == "studio is asleep")
    let lines: [String: [HistoryHit]] = ["n-a": [Self.hit("1", "keep it"), Self.hit("2", "keep")]]
    let found = PhoneSearch.liveRows(try Self.field(lines: lines), query: "keep", profile: nil, desk: nil)
    let out = PhoneSearch.Asked(asking: true, answered: false)
    #expect(
      PhoneSearch.liveFoot(found, total: 8, query: "keep", narrowed: false, feed: .live, asked: out)
        == "2 sessions · 2 lines matched · searching")
    let back = PhoneSearch.Asked(asking: false, answered: false)
    #expect(
      PhoneSearch.liveFoot(found, total: 8, query: "keep", narrowed: false, feed: .live, asked: back)
        == "2 sessions · 2 lines matched · the words were not searched")
    // before a word nothing is asked, so what was answered says nothing
    #expect(
      PhoneSearch.liveFoot(all, total: 8, query: "", narrowed: false, feed: .live, asked: back)
        == "8 live sessions, waiting first")
  }

  @Test("Live now's empty lists: a filter with Clear the filters, words with Search everything, else nothing runs")
  func liveEmpty() {
    let both = PhoneSearch.liveEmpty(query: "", profile: "Work", desk: "studio", feed: .live, asked: .settled)
    #expect(both == PhoneSearch.Empty(sentence: "No live session in Work runs on studio.", act: .clearFilters))
    let profile = PhoneSearch.liveEmpty(query: " ", profile: "Work", desk: nil, feed: .live, asked: .settled)
    #expect(profile?.sentence == "No live session in Work runs right now.")
    let desk = PhoneSearch.liveEmpty(query: "", profile: nil, desk: "mini", feed: .live, asked: .settled)
    #expect(desk?.sentence == "No live session runs on mini.")
    let words = PhoneSearch.liveEmpty(query: " zebra ", profile: "Work", desk: nil, feed: .live, asked: .settled)
    #expect(words == PhoneSearch.Empty(sentence: "No live session holds every word of “zebra”.", act: .searchEverything))
    let none = PhoneSearch.liveEmpty(query: "", profile: nil, desk: nil, feed: .live, asked: .settled)
    #expect(none == PhoneSearch.Empty(sentence: "Nothing runs right now.", act: nil))
  }

  /// UM-5b (the review's finding; DESIGN.md §9 "The phone's empty lists") — a plan chosen is a filter on: its empty list
  /// says so with Clear the filters, never "Nothing runs right now." over five live sessions the filter does not keep.
  @Test("Live now's empty list under a plan: the plan named, Clear the filters, the profile and the desktop kept in it")
  func liveEmptyPlan() {
    let alone = PhoneSearch.liveEmpty(
      query: "", profile: nil, desk: nil, plan: "Claude Max", feed: .live, asked: .settled)
    #expect(alone == PhoneSearch.Empty(sentence: "No live session on Claude Max runs right now.", act: .clearFilters))
    let all = PhoneSearch.liveEmpty(
      query: " ", profile: "Work", desk: "studio", plan: "Claude Max", feed: .live, asked: .settled)
    #expect(all?.sentence == "No live session in Work on Claude Max runs on studio.")
    #expect(all?.act == .clearFilters)
    let words = PhoneSearch.liveEmpty(
      query: "zebra", profile: nil, desk: nil, plan: "Claude Max", feed: .live, asked: .settled)
    #expect(words?.act == .searchEverything)
  }

  /// SE-2i — an empty list never claims what nobody answered: nothing while what runs is asked or the home sleeps,
  /// the refusal's own short sentence (`peek-live.ts` `liveNone`), and no "holds every word" for unanswered words.
  @Test("Live now's empty lists are honest: none while asking or asleep, the refusal, none for unanswered words")
  func liveEmptyHonest() {
    #expect(PhoneSearch.liveEmpty(query: "", profile: nil, desk: nil, feed: .asking, asked: .settled) == nil)
    #expect(PhoneSearch.liveEmpty(query: "", profile: nil, desk: nil, feed: .asleep("studio"), asked: .settled) == nil)
    let refused = PhoneSearch.liveEmpty(
      query: "keep", profile: nil, desk: nil, feed: .refused("the board said no"), asked: .settled)
    #expect(refused == PhoneSearch.Empty(sentence: "What runs could not be read.", act: nil))
    let out = PhoneSearch.Asked(asking: true, answered: false)
    #expect(PhoneSearch.liveEmpty(query: "zebra", profile: nil, desk: nil, feed: .live, asked: out) == nil)
    let back = PhoneSearch.Asked(asking: false, answered: false)
    #expect(PhoneSearch.liveEmpty(query: "zebra", profile: nil, desk: nil, feed: .live, asked: back) == nil)
    // a filter with no words asks nothing: its sentence stands whatever the last words' answer
    let filtered = PhoneSearch.liveEmpty(query: "", profile: "Work", desk: nil, feed: .live, asked: back)
    #expect(filtered?.act == .clearFilters)
  }

  // MARK: - Everything

  static let now: Date = {
    var parts = DateComponents()
    parts.year = 2025
    parts.month = 10
    parts.day = 1
    parts.hour = 10
    return Calendar.autoupdatingCurrent.date(from: parts)!
  }()

  /// The index's Everything golden, as one desktop's answer.
  static func everything() throws -> (corpus: HistoryCorpus, groups: [HistoryHitGroup]) {
    let answer = try IndexSearchResult(json: try Fixture.json("index-search-result.everything"))
    var corpus = HistoryCorpus.empty(desktop: "studio", deviceId: "dev-1")
    corpus.hits = FieldHistoryModel.hitGroups(answer, now: now)
    corpus.searchedQuery = "migration"
    return (corpus, corpus.hits)
  }

  @Test("Everything with words: one row per session, its lines of the kind asked, three at most, its folder and agent")
  func pastRows() throws {
    let answer = try Self.everything()
    let label: (String) -> String = { "label:\($0)" }
    let rows = PhoneSearch.pastRows([answer], kind: .any, project: nil, agentLabel: label)
    #expect(rows.count == 3)
    let first = try #require(rows.first)
    #expect(first.title == "Page the reader by day")
    #expect(first.folder == "rosetta")
    let provider = answer.groups.first?.provider ?? ""
    #expect(first.agent == "label:\(provider)")
    #expect(first.lines.count == 2)
    #expect(first.device == "dev-1")
    // the unattributed hit: no folder, no agent
    let lost = try #require(rows.last)
    #expect(lost.folder == nil && lost.agent == nil)
    // replies only: the prompt-only session leaves, the first keeps its one reply
    let replies = PhoneSearch.pastRows([answer], kind: .replies, project: nil, agentLabel: label)
    let lineCounts = replies.map { $0.lines.count }
    #expect(lineCounts == [1, 1])
  }

  @Test("Everything's project: the PJ key, else the corpus's own project id, named by the corpus or the folder")
  func pastProjects() throws {
    // the mock's groups name the mock's projects by id
    let corpus = HistoryCorpus.mock
    let rows = PhoneSearch.pastRows(
      [(corpus, corpus.hits)], kind: .any, project: nil, agentLabel: { $0 })
    let projects = PhoneSearch.projects(rows)
    let names = projects.map { $0.name }
    #expect(names.first == corpus.project("vf")?.name)
    let narrowed = PhoneSearch.pastRows([(corpus, corpus.hits)], kind: .any, project: "vf", agentLabel: { $0 })
    #expect(!narrowed.isEmpty && narrowed.allSatisfy { $0.project?.key == "vf" })
  }

  /// PLAN §4 (g), DESIGN.md §8 — before a word, **Your latest sessions**: the sessions the phone holds, merged by when
  /// each last moved, a session with no stamp after them in the ledger's order; at most `latestLimit`.
  @Test("before a word: your latest sessions, newest first across projects, the unstamped after, forty at most")
  func latestSessions() throws {
    func row(_ id: String, _ project: String, at: Int64?) -> HistorySession {
      HistorySession(
        id: id, projectId: project, title: id, agent: "agent-id", meta: "", branch: "", last: "2h", provider: "agent-id",
        lastAt: at)
    }
    func project(_ id: String) -> HistoryProject {
      HistoryProject(
        id: id, name: "\(id)-folder", seq: 1, path: "~/\(id)", figure: "1", unit: "M", spend: 1, last: "2h",
        recencyMinutes: 120, agents: [], spark: [])
    }
    var corpus = HistoryCorpus.empty(desktop: "studio", deviceId: "dev-1")
    corpus.projects = [project("p1"), project("p2")]
    corpus.sessions = [
      "p1": [row("old", "p1", at: 100), row("unstamped", "p1", at: nil)],
      "p2": [row("newest", "p2", at: 300), row("middle", "p2", at: 200)],
    ]
    let rows = PhoneSearch.latestRows(corpus, project: nil, agentLabel: { "label:\($0)" })
    let ids = rows.map { $0.sessionId }
    #expect(ids == ["newest", "middle", "old", "unstamped"])
    #expect(rows.first?.agent == "label:agent-id")
    #expect(rows.first?.project == PhoneSearch.Project(key: "p2", name: "p2-folder"))
    #expect(rows.first?.when == "2h")
    #expect(rows.allSatisfy { $0.lines.isEmpty && $0.group == nil })
    let narrowed = PhoneSearch.latestRows(corpus, project: "p1", agentLabel: { $0 }).map { $0.sessionId }
    #expect(narrowed == ["old", "unstamped"])
    // the mock's corpus: no stamps, the ledger's order, forty at most
    let mock = PhoneSearch.latestRows(.mock, project: nil, agentLabel: { $0 })
    #expect(!mock.isEmpty && mock.count <= PhoneSearch.latestLimit)
    #expect(PhoneSearch.latestLimit == 40)
  }

  /// SE-P2 — the recency `latestRows` merges by is the index's own: a listing's row carries when it last moved.
  @Test("a session row carries when it last moved, as the listing and the ledger read it")
  func sessionRowsCarryLastAt() throws {
    let listing = try IndexSessionsResult(json: try Fixture.json("index-sessions.valid")).rows
    let rows = FieldHistoryModel.sessionRows(listing, projectId: "p", now: Self.now)
    let newest = listing.compactMap { $0.activity?.lastAt }.max()
    #expect(newest != nil)
    #expect(rows.first?.lastAt == newest)
    let page = try ProjectSessionsResult(json: try Fixture.json("project-sessions.valid"))
    let project = try ProjectSummary(json: try Fixture.json("project-summary.valid"))
    let ledger = FieldHistoryModel.projectSessionRows(page.rows, key: page.key, places: project.places, desktops: [], now: Self.now)
    let moved = page.rows.first?.activity?.lastAt
    #expect(ledger.first?.lastAt == moved)
  }

  @Test("Everything's chips: Prompts and Replies while every kind is asked, then the projects less the chosen")
  func pastChips() {
    let projects = [PhoneSearch.Project(key: "k1", name: "billing-api"), PhoneSearch.Project(key: "k2", name: "rosetta")]
    let groups = PhoneSearch.pastChips(projects: projects, kind: .any, project: "k2")
    let labels = groups.map { $0.map { $0.label } }
    #expect(labels == [["Prompts", "Replies"], ["billing-api"]])
    let filters = groups.first?.map { $0.filter }
    #expect(filters == [.kind(.prompts), .kind(.replies)])
    let narrowed = PhoneSearch.pastChips(projects: projects, kind: .replies, project: nil)
    let narrowedLabels = narrowed.map { $0.map { $0.label } }
    #expect(narrowedLabels == [["billing-api", "rosetta"]])
  }

  @Test("Everything's tokens: who said it, then the project; never a profile (UM-D28)")
  func pastTokens() {
    let tokens = PhoneSearch.pastTokens(kind: .prompts, project: PhoneSearch.Project(key: "k1", name: "billing-api"))
    let labels = tokens.map { $0.label }
    #expect(labels == ["Prompts", "billing-api"])
    let leads = tokens.map { $0.lead }
    #expect(leads == [.said, .folder])
    #expect(PhoneSearch.pastTokens(kind: .any, project: nil).isEmpty)
  }

  @Test("Everything's offer: a project's name, while none is chosen")
  func pastOffer() {
    let projects = [PhoneSearch.Project(key: "k1", name: "billing-api")]
    let offer = PhoneSearch.pastOffer(query: "migration bil", projects: projects, project: nil)
    #expect(offer == PhoneSearch.Offer(filter: .project("k1"), lead: .folder, title: "Only in billing-api", note: "a filter"))
    // "api" starts the name's second word, split on its hyphen
    #expect(PhoneSearch.pastOffer(query: "api", projects: projects, project: nil)?.filter == .project("k1"))
    #expect(PhoneSearch.pastOffer(query: "bil", projects: projects, project: "k1") == nil)
  }

  /// §9 "The phone's feet" and UM-D28: Everything says what it matched, or Your latest sessions; the project; the kind
  /// with words; and while the lens stands, that it looks through every profile and the lens comes back on Field.
  @Test("Everything's foot: matched or your latest sessions, in the project, the kind, every profile while the lens stands")
  func pastFoot() {
    let billing = PhoneSearch.Project(key: "k1", name: "billing-api")
    #expect(
      PhoneSearch.pastFoot(rows: 4, query: "migration", project: nil, kind: .any, lens: nil, asked: .settled)
        == "4 sessions matched")
    #expect(
      PhoneSearch.pastFoot(rows: 1, query: "migration", project: nil, kind: .any, lens: nil, asked: .settled)
        == "1 session matched")
    #expect(
      PhoneSearch.pastFoot(rows: 9, query: "", project: nil, kind: .prompts, lens: nil, asked: .settled)
        == "Your latest sessions")
    #expect(
      PhoneSearch.pastFoot(rows: 2, query: "migration", project: billing, kind: .prompts, lens: nil, asked: .settled)
        == "2 sessions matched in billing-api, in your prompts")
    #expect(
      PhoneSearch.pastFoot(rows: 2, query: "migration", project: nil, kind: .replies, lens: "Work", asked: .settled)
        == "2 sessions matched, in their replies · every profile; Work comes back on Field")
    #expect(
      PhoneSearch.pastFoot(rows: 0, query: "", project: billing, kind: .any, lens: "Work", asked: .settled)
        == "Your latest sessions in billing-api · every profile; Work comes back on Field")
  }

  /// UM-5b — the plan's clause on Everything's foot, in its two forms (‹for James›, §9).
  @Test("Everything's foot says a plan comes back on Field, alone and with a profile (UM-5b)")
  func pastFootPlan() {
    let plan = PhoneSearch.pastFoot(rows: 3, query: "", project: nil, kind: .any, lens: nil, plan: "Claude Max", asked: .settled)
    #expect(plan == "Your latest sessions · every plan; Claude Max comes back on Field")
    let both = PhoneSearch.pastFoot(rows: 3, query: "", project: nil, kind: .any, lens: "Work", plan: "Claude Max", asked: .settled)
    #expect(both == "Your latest sessions · every profile; Work and Claude Max come back on Field")
  }

  @Test("a plan keeps the runs on its family, in Live now; its token comes after the profile's (UM-5b)")
  func liveRowsPlan() throws {
    var live = try Self.field()
    live.sessions[0] = Self.session("on", .working, planKey: "work/plan:one")
    live.sessions[1] = Self.session("off", .idle, planKey: "work/plan:two")
    let rows = PhoneSearch.liveRows(live, query: "", profile: nil, desk: nil, plan: Set(["work/plan:one"]))
    let ids = rows.map { $0.session.id }
    #expect(ids == ["on"])
    let plan = PhoneSearch.Plan(key: "work/plan:one", label: "Claude Max", mark: "anthropic")
    let tokens = PhoneSearch.liveTokens(live, profile: "work", desk: nil, plan: plan)
    let filters = tokens.map { $0.filter }
    #expect(filters == [.profile("work"), .plan("work/plan:one")])
    let lead = tokens.last?.lead
    #expect(lead == .agent("anthropic"))
  }

  /// SE-2i (the S2 review's finding 4) — with words, Everything's foot says what was answered as Live now's does:
  /// "searching" while the newest ask is out, "the words were not searched" when it came back unanswered, and each
  /// desktop that could not be asked, "‹desktop› is asleep" — before the lens's clause.
  @Test("Everything's foot is honest: searching, the words were not searched, and each desktop asleep by name")
  func pastFootHonest() {
    let out = PhoneSearch.Asked(asking: true, answered: false)
    #expect(
      PhoneSearch.pastFoot(rows: 0, query: "zebra", project: nil, kind: .any, lens: nil, asked: out)
        == "0 sessions matched · searching")
    let back = PhoneSearch.Asked(asking: false, answered: false)
    #expect(
      PhoneSearch.pastFoot(rows: 2, query: "zebra", project: nil, kind: .prompts, lens: nil, asked: back)
        == "2 sessions matched, in your prompts · the words were not searched")
    let mini = PhoneSearch.Asked(asking: false, answered: true, asleep: ["mini"])
    #expect(
      PhoneSearch.pastFoot(rows: 4, query: "zebra", project: nil, kind: .any, lens: "Work", asked: mini)
        == "4 sessions matched · mini is asleep · every profile; Work comes back on Field")
    // before a word nothing is asked: your latest sessions, whatever the last words' answer
    #expect(
      PhoneSearch.pastFoot(rows: 9, query: "", project: nil, kind: .any, lens: nil, asked: back)
        == "Your latest sessions")
  }

  @Test("Everything's empty list with words; before a word its words are James's, so none is said")
  func pastEmpty() {
    let empty = PhoneSearch.pastEmpty(query: " zebra ", asked: .settled)
    #expect(empty == PhoneSearch.Empty(sentence: "Nothing in your past holds every word of “zebra”. Try fewer words.", act: nil))
    #expect(PhoneSearch.pastEmpty(query: "", asked: .settled) == nil)
  }

  /// SE-2i — never "no matches" for a question nobody answered: no empty words while the words are out or came back
  /// unanswered (the foot says which).
  @Test("Everything's empty list is honest: none while the words are out or came back unanswered")
  func pastEmptyHonest() {
    #expect(PhoneSearch.pastEmpty(query: "zebra", asked: PhoneSearch.Asked(asking: true, answered: false)) == nil)
    #expect(PhoneSearch.pastEmpty(query: "zebra", asked: PhoneSearch.Asked(asking: false, answered: false)) == nil)
  }

  // MARK: - Where a tap goes

  /// PLAN §4 (SE-P2): a live row opens its body's card on Field (by visual id); a matched line lands in History at the
  /// line; a latest session opens in History.
  @Test("a tap: a live row's card on Field, a past line's landing in History, a latest session opened")
  func openTargets() throws {
    let live = PhoneSearch.LiveRow(session: Self.session("visual-7", .blocked), lines: [])
    #expect(PhoneSearch.target(live) == .card("visual-7"))
    let answer = try Self.everything()
    let rows = PhoneSearch.pastRows([answer], kind: .any, project: nil, agentLabel: { $0 })
    let first = try #require(rows.first)
    let group = try #require(first.group)
    let line = try #require(group.rows.first)
    let landing = FieldHistoryModel.landing(for: line, in: group, corpus: answer.corpus)
    #expect(PhoneSearch.target(first, corpus: answer.corpus, query: " migration ") == .landing(landing, query: "migration"))
    let mockProject = try #require(HistoryCorpus.mock.projects.first)
    var corpus = HistoryCorpus.empty(desktop: "studio", deviceId: "dev-1")
    corpus.projects = [mockProject]
    corpus.sessions = HistoryCorpus.mock.sessions.filter { $0.key == mockProject.id }
    let latest = try #require(PhoneSearch.latestRows(corpus, project: nil, agentLabel: { $0 }).first)
    let opened = PhoneSearch.target(latest, corpus: corpus, query: "")
    #expect(opened == .session(device: "dev-1", projectId: mockProject.id, id: latest.sessionId))
  }
}
