import FieldDesign
import Testing

@testable import FieldHistory

/// IOS-9b — the History tab's decisions over the mock corpus: the ranking,
/// the wash, the line under the head (item 390: the scope line's states,
/// less its summary), the search's matching and its
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

  // Item 390 (asked for 2026-11-13) — RE-CUT: this row held the scope line's three states, the
  // first of them the summary `7 projects · 1,405 sessions across 9 agents`. That line was removed from the head, so
  // a desktop that answers has nothing said under the head; the other two states keep the record's words.
  @Test("the line under the head says nothing while the desktop answers, and its other states in the record's words")
  func headNote() {
    #expect(FieldHistoryModel.headNote(corpus, standing: .connected, device: .iPhone) == nil)
    #expect(FieldHistoryModel.headNote(corpus, standing: .asleep, device: .iPhone) == "studio is asleep · read 11:42")
    let indexing = FieldHistoryModel.DesktopStanding.indexing(percent: 61, done: "8,400", total: "13,700")
    #expect(
      FieldHistoryModel.headNote(corpus, standing: indexing, device: .iPhone) == "studio is reading its history · 61%")
    #expect(FieldHistoryModel.indexingDenominator(standing: indexing) == "8,400 of 13,700 sessions")
    #expect(FieldHistoryModel.indexingDenominator(standing: .connected) == nil)
  }

  @Test("L4's word pass: History names the device as its platform does, in every word that names it, never a phone")
  func deviceNamed() {
    let incompatible = FieldHistoryModel.DesktopStanding.incompatible(theirs: "0.2.0", ours: "0.1.0")
    let stopped = FieldHistoryModel.IndexStanding.failed(reason: "rosettad stopped")
    for device in [DeviceWord.iPad, .unknown] {
      let words = [
        FieldHistoryModel.headNote(corpus, standing: incompatible, device: device) ?? "",
        FieldHistoryModel.emptyLedger(standing: incompatible, index: nil, desktop: "studio", device: device)?.text
          ?? "",
        FieldHistoryModel.emptyLedger(standing: .connected, index: stopped, desktop: "studio", device: device)?.text
          ?? "",
        FieldHistoryModel.projectNotRead(device: device).title, FieldHistoryModel.projectNotRead(device: device).text,
        FieldHistoryModel.sessionNotRead(device: device).text,
        FieldHistoryModel.projectSessionsNote(desktop: "studio").text,
      ]
      for word in words {
        #expect(!word.localizedCaseInsensitiveContains("phone"), "\(device): \(word)")
        // item 505 — how History is reached and kept is its insides (DESIGN.md §9, items 280 and 282)
        for inside in ["door", "index", "ledger"] {
          #expect(!word.localizedCaseInsensitiveContains(inside), "\(device): \(word)")
        }
      }
    }
    #expect(
      FieldHistoryModel.headNote(corpus, standing: incompatible, device: .iPad)
        == "studio needs the same VibeField as this iPad")
    // item 516 — a desktop that speaks another VibeField keeps the note; one that does not answer holds instead
    #expect(
      FieldHistoryModel.emptyLedger(standing: incompatible, index: nil, desktop: "studio", device: .iPad)?.text
        == "Nothing of your history is on this iPad yet; your projects arrive when one of your desktops answers.")
    #expect(
      FieldHistoryModel.emptyLedger(standing: .connected, index: stopped, desktop: "studio", device: .unknown)?.text
        == "Nothing new arrives on this device until it runs again. Try again from History on studio.")
    let project = FieldHistoryModel.projectNotRead(device: .iPad)
    #expect(project.title == "This project has not been read here")
    #expect(project.text == "Nothing was read for it on this iPad.")
    let session = FieldHistoryModel.sessionNotRead(device: .iPad)
    #expect(session.title == "This session has no document here")
    #expect(session.text == "Its desktop does not answer, and this iPad has not read its turns before.")
    // item 516 — `noDesktopRead` is retired: with no desktop answering and nothing kept, the ledger's place holds
    // (HistoryHoldsTests)
  }

  @Test("item 505: a project's empty session list names its desktop, and never how it is reached")
  func projectSessionsWait() {
    // item 516 — only while its desktop does not answer: while it answers, the list holds (HistoryHoldsTests)
    let asleep = FieldHistoryModel.projectSessionsNote(desktop: "studio")
    #expect(asleep.title == "No sessions read for this project")
    #expect(asleep.text == "They arrive once studio answers.")
  }

  @Test("item 505: the line under a page's head says how History stands on the desktop, never its index")
  func indexSentenceWords() {
    let says: [(FieldHistoryModel.IndexStanding?, String?)] = [
      (nil, nil), (.ready, nil),
      (.starting(detail: "waking the index"), "History on studio is opening"),
      (.rebuilding(detail: "schema 7 to 8"), "History on studio is updating"),
      (.indexing(percent: 61, done: "8,400", total: "13,700"), "studio is reading its history · 61%"),
      (.failed(reason: "rosettad stopped"), "History on studio has stopped"),
      (.unconfigured(reason: "no index configured"), "studio keeps no history"),
      (.stopped, "History on studio is stopped"),
    ]
    for (index, said) in says {
      #expect(FieldHistoryModel.indexSentence(index, desktop: "studio") == said, "\(String(describing: index))")
    }
  }

  @Test("item 505: an empty ledger says how History stands in its own words, and fieldd's words stay off the screen")
  func emptyLedgerWords() {
    // item 516 — History opening, updating or reading, and no desktop answering, say no note: the place holds
    let waits: [FieldHistoryModel.IndexStanding] = [
      .starting(detail: "waking the index"), .rebuilding(detail: "schema 7 to 8"),
      .indexing(percent: 61, done: "8,400", total: "13,700"),
    ]
    for index in waits {
      let note = FieldHistoryModel.emptyLedger(standing: .connected, index: index, desktop: "studio", device: .iPad)
      #expect(note?.title == nil, "\(String(describing: index))")
    }
    let asleep = FieldHistoryModel.emptyLedger(standing: .asleep, index: nil, desktop: "studio", device: .iPad)
    #expect(asleep?.title == nil)
    let says: [(FieldHistoryModel.IndexStanding?, String, String)] = [
      (
        .failed(reason: "rosettad stopped"), "History on studio has stopped",
        "Nothing new arrives on this iPad until it runs again. Try again from History on studio."
      ),
      (.unconfigured(reason: "no index configured"), "studio keeps no history", "History is off on studio."),
      (.unconfigured(reason: nil), "studio keeps no history", "History is off on studio."),
      (.stopped, "History on studio is stopped", "Its projects arrive when it runs again."),
      (
        .ready, "No projects yet",
        "Your desktops have recorded none. Choose whose history they keep on a desktop (Settings → Agents)."
      ),
      (
        nil, "No projects yet",
        "Your desktops have recorded none. Choose whose history they keep on a desktop (Settings → Agents)."
      ),
    ]
    for (index, title, text) in says {
      let note = FieldHistoryModel.emptyLedger(standing: .connected, index: index, desktop: "studio", device: .iPad)
      #expect(note?.title == title, "\(String(describing: index))")
      #expect(note?.text == text, "\(String(describing: index))")
    }
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
    let anyLines = any.reduce(0) { $0 + $1.rows.count }
    #expect(anyLines == 5)
    let both = FieldHistoryModel.hits(for: "BADGE 12px", kind: .any, in: corpus)
    let bothLines = both.reduce(0) { $0 + $1.rows.count }
    #expect(bothLines == 4)
    #expect(both.flatMap(\.rows).map(\.id) == ["h1", "h2", "h3", "mh2"])
    let prompts = FieldHistoryModel.hits(for: "badge", kind: .prompts, in: corpus)
    #expect(prompts.flatMap(\.rows).map(\.id) == ["h1", "mh1"])
    let replies = FieldHistoryModel.hits(for: "badge", kind: .replies, in: corpus)
    #expect(replies.flatMap(\.rows).map(\.id) == ["h2", "h3", "mh2"])
    #expect(FieldHistoryModel.hits(for: "   ", kind: .any, in: corpus).isEmpty)
    #expect(FieldHistoryModel.hits(for: "zebra", kind: .any, in: corpus).isEmpty)
  }

  // RETIRED 2026-11-06 (SE-2): "the foot and the quiet states say what happened" — search's page's foot, quiet states
  // and group heads retired with the page; the sheet's words are `PhoneSearchTests`' (liveFoot, pastFoot, the empties).

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
        == .session(device: corpus.deviceId, projectId: "vf", sessionId: "mt-2", ring: ["h1", "h2", "h3"], at: 1))
    let mille = corpus.hits[1]
    #expect(
      FieldHistoryModel.landing(for: mille.rows[1], in: mille, corpus: corpus)
        == .project(projectId: "mille", sessionId: "m2"))
    // SP-6 — over a door the document is read when the session opens, so a
    // group without one still lands in the document
    var asked = corpus
    asked.searchedQuery = "badge"
    #expect(
      FieldHistoryModel.landing(for: mille.rows[1], in: mille, corpus: asked)
        == .session(device: corpus.deviceId, projectId: "mille", sessionId: "m2", ring: ["m2"], at: 0))
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

  @Test("a scroll folds the bar after 28 pt down from its highest point and opens it 28 pt back up")
  func barFold() {
    // Near the top the bar is always open, whatever it was.
    #expect(FieldHistoryModel.barFold(minimized: true, anchor: 300, offset: 5) == (false, 5))
    // Going down from 20: 20 pt is not enough, 29 is.
    #expect(FieldHistoryModel.barFold(minimized: false, anchor: 20, offset: 40) == (false, 20))
    #expect(FieldHistoryModel.barFold(minimized: false, anchor: 20, offset: 49) == (true, 49))
    // Open, going up: the anchor follows the lowest point.
    #expect(FieldHistoryModel.barFold(minimized: false, anchor: 100, offset: 80) == (false, 80))
    // Folded, still going down: the anchor follows; back up 20 stays folded, 29 opens.
    #expect(FieldHistoryModel.barFold(minimized: true, anchor: 200, offset: 250) == (true, 250))
    #expect(FieldHistoryModel.barFold(minimized: true, anchor: 250, offset: 230) == (true, 250))
    #expect(FieldHistoryModel.barFold(minimized: true, anchor: 250, offset: 221) == (false, 221))
  }

  @Test("a landing opens a folded bar")
  @MainActor
  func landingOpensTheBar() {
    let router = HistoryRouter()
    router.barMinimized = true
    router.land(.project(projectId: "mille", sessionId: "m2"), query: "badge")
    #expect(!router.barMinimized)
  }

  @Test("the router lands a hit, walks the ring while the document is on top, and forgets it after")
  @MainActor
  func theRouter() {
    let router = HistoryRouter()
    router.land(.session(device: "dev-1", projectId: "vf", sessionId: "mt-2", ring: ["h1", "h2", "h3"], at: 1), query: "badge")
    #expect(router.path == [.project(id: "vf"), .session(device: "dev-1", id: "mt-2")])
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
    #expect(router.path == [.project(id: "mille")])
    #expect(router.rungSession == "m2")
    #expect(router.landed == nil)
    // SP-6 — a hit whose project the corpus has not named lands straight in
    // the document, and the stepper stands only for its own device
    router.land(.session(device: "dev-2", projectId: "", sessionId: "s9", ring: ["t1"], at: 0), query: "x")
    #expect(router.path == [.session(device: "dev-2", id: "s9")])
    #expect(router.stepperShowing)
    router.path = [.session(device: "dev-1", id: "s9")]
    #expect(!router.stepperShowing)
  }

  @Test("PJ-7 — a project's key that regrouped re-keys the route that names it, and only that one")
  @MainActor
  func aRegroupedKeyRekeysTheRoute() {
    let router = HistoryRouter()
    router.path = [.project(id: "p1:old"), .session(device: "dev-1", id: "s1")]
    router.rekey(from: "p1:other", to: "r:x")
    #expect(router.path == [.project(id: "p1:old"), .session(device: "dev-1", id: "s1")])
    router.rekey(from: "p1:old", to: "r:new")
    #expect(router.path == [.project(id: "r:new"), .session(device: "dev-1", id: "s1")])
  }
}
