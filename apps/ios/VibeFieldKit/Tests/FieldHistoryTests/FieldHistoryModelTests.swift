import Testing

@testable import FieldHistory

/// IOS-9b — the History tab's decisions over the mock corpus: the ranking,
/// the wash, the scope line's three states, the search's matching and its
/// words, where a hit lands, the stepper's ring and the ribbon's determinism.
@Suite("the History tab decides in words")
struct FieldHistoryModelTests {
  private let corpus = HistoryCorpus.mock

  @Test("the corpus is the page's: seven projects, two live, the document MT-2 opens")
  func theCorpus() throws {
    #expect(corpus.projects.count == 7)
    #expect(corpus.live.count == 2)
    #expect(corpus.sessions(of: "vf").count == 5)
    #expect(corpus.document("mt-2") != nil)
    #expect(corpus.document("m2") == nil)
    let ids = corpus.hits.flatMap(\.rows).map(\.id)
    #expect(Set(ids).count == ids.count, "every hit has its own id even where two share an anchor")
  }

  @Test("ranked by spend the biggest project leads; ranked by recency the live ones do")
  func ranking() {
    let bySpend = FieldHistoryModel.projects(corpus.projects, rankedBy: .spend).map(\.id)
    #expect(bySpend.first == "vf")
    #expect(bySpend.last == "jabali")
    let byRecent = FieldHistoryModel.projects(corpus.projects, rankedBy: .recent).map(\.id)
    #expect(Array(byRecent.prefix(3)) == ["vf", "mille", "chop"])
  }

  @Test("the wash is spend scaled to the biggest project")
  func theWash() throws {
    let vf = try #require(corpus.project("vf"))
    let ice = try #require(corpus.project("ice"))
    #expect(FieldHistoryModel.share(of: vf, among: corpus.projects) == 1)
    #expect(abs(FieldHistoryModel.share(of: ice, among: corpus.projects) - 386.0 / 1240.0) < 0.0001)
    #expect(FieldHistoryModel.share(of: vf, among: []) == 0)
  }

  @Test("the scope line says the three states in the record's words")
  func scopeLine() {
    #expect(FieldHistoryModel.scopeLine(corpus, standing: .connected) == "7 projects · 1,405 sessions across 9 agents")
    #expect(FieldHistoryModel.scopeLine(corpus, standing: .asleep) == "studio is asleep · read 11:42")
    let indexing = FieldHistoryModel.DesktopStanding.indexing(percent: 61, done: "8,400", total: "13,700")
    #expect(FieldHistoryModel.scopeLine(corpus, standing: indexing) == "studio is indexing · 61%")
    #expect(FieldHistoryModel.indexingDenominator(standing: indexing) == "8,400 of 13,700 sessions")
    #expect(FieldHistoryModel.indexingDenominator(standing: .connected) == nil)
  }

  @Test("the live head counts while the desktop is awake and remembers the read while it sleeps")
  func liveHead() {
    let awake = FieldHistoryModel.liveHeader(corpus, standing: .connected)
    #expect(awake.label == "Live now" && awake.count == 2)
    let asleep = FieldHistoryModel.liveHeader(corpus, standing: .asleep)
    #expect(asleep.label == "Last seen live · 11:42" && asleep.count == nil)
  }

  @Test("every term has to appear, in the kind asked for")
  func matching() {
    let any = FieldHistoryModel.hits(for: "badge", kind: .any, in: corpus)
    #expect(any.count == 2)
    #expect(FieldHistoryModel.matchCount(any) == 5)
    let both = FieldHistoryModel.hits(for: "BADGE 12px", kind: .any, in: corpus)
    #expect(FieldHistoryModel.matchCount(both) == 4)
    #expect(both.flatMap(\.rows).map(\.id) == ["h1", "h2", "h3", "mh2"])
    let prompts = FieldHistoryModel.hits(for: "badge", kind: .prompts, in: corpus)
    #expect(prompts.flatMap(\.rows).map(\.id) == ["h1", "mh1"])
    let replies = FieldHistoryModel.hits(for: "badge", kind: .replies, in: corpus)
    #expect(replies.flatMap(\.rows).map(\.id) == ["h2", "h3", "mh2"])
    #expect(FieldHistoryModel.hits(for: "   ", kind: .any, in: corpus).isEmpty)
    #expect(FieldHistoryModel.hits(for: "zebra", kind: .any, in: corpus).isEmpty)
  }

  @Test("the foot and the quiet states say what happened")
  func words() {
    #expect(FieldHistoryModel.searchFoot(query: "", matches: 0, standing: .connected, desktop: "studio") == "Recent searches")
    #expect(FieldHistoryModel.searchFoot(query: "badge", matches: 1, standing: .connected, desktop: "studio") == "1 match")
    #expect(FieldHistoryModel.searchFoot(query: "badge", matches: 5, standing: .connected, desktop: "studio") == "5 matches")
    #expect(FieldHistoryModel.searchFoot(query: "badge", matches: 5, standing: .asleep, desktop: "studio") == "Search needs studio")
    let none = FieldHistoryModel.quiet(query: "zebra", kind: .prompts, matches: 0, corpus: corpus, standing: .connected)
    #expect(none?.title == "No prompts say “zebra”")
    #expect(none?.body == "Searched 1,405 sessions across 9 agents on studio. Every word has to appear — try fewer.")
    #expect(FieldHistoryModel.quiet(query: "badge", kind: .any, matches: 5, corpus: corpus, standing: .connected) == nil)
    #expect(FieldHistoryModel.quiet(query: "", kind: .any, matches: 0, corpus: corpus, standing: .connected) == nil)
    let asleep = FieldHistoryModel.quiet(query: "", kind: .any, matches: 0, corpus: corpus, standing: .asleep)
    #expect(asleep?.title == "studio is asleep")
    let group = corpus.hits[0]
    #expect(FieldHistoryModel.groupWords(group) == "3 hits · Today")
    #expect(FieldHistoryModel.groupWords(corpus.hits[1]) == "2 hits · Thu")
  }

  @Test("the marks cut the text at the terms, case-insensitively, and leave the rest whole")
  func marks() {
    let runs = FieldHistoryModel.marked("A Badge here, a badge there.", terms: ["badge"])
    #expect(runs.map(\.text) == ["A ", "Badge", " here, a ", "badge", " there."])
    #expect(runs.map(\.marked) == [false, true, false, true, false])
    #expect(FieldHistoryModel.marked("nothing", terms: []) == [.init(text: "nothing", marked: false)])
    #expect(FieldHistoryModel.marked("nothing", terms: ["zebra"]) == [.init(text: "nothing", marked: false)])
  }

  @Test("a hit lands in the document when there is one, and on the project's row when there is not")
  func landing() throws {
    let vf = corpus.hits[0]
    let second = vf.rows[1]
    #expect(
      FieldHistoryModel.landing(for: second, in: vf, corpus: corpus)
        == .session(projectId: "vf", sessionId: "mt-2", ring: ["h1", "h2", "h3"], at: 1))
    let mille = corpus.hits[1]
    #expect(
      FieldHistoryModel.landing(for: mille.rows[1], in: mille, corpus: corpus)
        == .project(projectId: "mille", sessionId: "m2"))
  }

  @Test("the stepper says `n of m` and wraps both ways")
  func stepper() {
    #expect(FieldHistoryModel.stepWords(at: 1, of: 3) == "2 of 3")
    #expect(FieldHistoryModel.step(2, by: 1, of: 3) == 0)
    #expect(FieldHistoryModel.step(0, by: -1, of: 3) == 2)
    #expect(FieldHistoryModel.step(0, by: 1, of: 0) == 0)
  }

  @Test("the ribbon is 53 weeks of 7, deterministic per project, blank before its start")
  func ribbon() {
    let a = FieldHistoryModel.ribbon(seq: 0, start: 3)
    let b = FieldHistoryModel.ribbon(seq: 0, start: 3)
    #expect(a.count == 53 && a.allSatisfy { $0.count == 7 })
    #expect(a == b)
    #expect(a[0].allSatisfy { $0 == 0 } && a[2].allSatisfy { $0 == 0 })
    #expect(a.flatMap { $0 }.contains { $0 > 0 })
    #expect(a.flatMap { $0 }.allSatisfy { (0...4).contains($0) })
    #expect(FieldHistoryModel.ribbon(seq: 2, start: 22) != a)
  }

  @Test("the router lands a hit, walks the ring while the document is on top, and forgets it after")
  @MainActor
  func theRouter() {
    let router = HistoryRouter()
    router.land(.session(projectId: "vf", sessionId: "mt-2", ring: ["h1", "h2", "h3"], at: 1), query: "badge")
    #expect(router.path == [.project("vf"), .session("mt-2")])
    #expect(router.stepperShowing)
    #expect(router.landed?.anchor == "h2")
    #expect(router.landed?.words == "2 of 3")
    router.step(1)
    #expect(router.landed?.anchor == "h3")
    router.step(1)
    #expect(router.landed?.anchor == "h1")
    router.path.removeLast()
    #expect(!router.stepperShowing)
    router.clearLanding()
    #expect(router.landed == nil)
    router.land(.project(projectId: "mille", sessionId: "m2"), query: "badge")
    #expect(router.path == [.project("mille")])
    #expect(router.rungSession == "m2")
    #expect(router.landed == nil)
  }
}
