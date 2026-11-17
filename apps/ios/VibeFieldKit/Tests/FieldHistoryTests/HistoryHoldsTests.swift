import CoreGraphics
import Foundation
import Testing

@testable import FieldHistory

/// Item 516 (James, 2026-11-17 18:40:49Z, session vibe-field-d5: "all go with lean, work and land soon", on the page
/// "The Mark in a Pocket") — History's own waits on the phone stand in the hold a session's first reading stands in
/// (item 417): the ledger's first read (P1) and a project's list of sessions (P3), and, with no desktop answering and
/// nothing kept, the ledger's place with the mark at rest (P4). DESIGN.md §8 "The phone's History waits in the hold".
///
/// These rows hold the RULE: which places hold, what each hold says and whether its mark moves, and the figures of
/// what stands under the line. How the hold looks on the page is his to see.
@Suite("item 516 — History's waits stand in the hold: its first read, a project's list, no desktop at rest")
struct HistoryHoldsTests {
  private typealias Words = HistoryOpening.Words

  private func ledger(
    projects: Bool = false, standing: FieldHistoryModel.DesktopStanding = .connected, answered: Bool = false,
    index: FieldHistoryModel.IndexStanding? = nil
  ) -> Words? {
    HistoryOpening.ledger(
      hasProjects: projects, standing: standing, answered: answered, index: index, desktop: "studio")
  }

  @Test("before its door has answered the listing once, an empty ledger is History opening: one line, the mark moving")
  func opening() {
    #expect(ledger() == Words(line: "Opening History…"))
    #expect(ledger(index: .ready) == Words(line: "Opening History…"), "the index is read, the listing not yet")
    #expect(ledger()?.resting == false)
    #expect(ledger()?.sub == nil)
  }

  @Test("while the desktop's History opens, updates or reads, the hold says so, the desktop or the count under it")
  func theFirstRead() {
    #expect(ledger(index: .starting(detail: nil)) == Words(line: "Finding your history…", sub: "on studio"))
    let detail = ledger(index: .starting(detail: "the history daemon restarted"))
    #expect(detail == Words(line: "Finding your history…", sub: "on studio"), "fieldd's detail is insides")
    #expect(ledger(index: .rebuilding(detail: nil)) == Words(line: "Updating your history…", sub: "on studio"))
    let reading = ledger(index: .indexing(percent: 21, done: "214", total: "1,033"))
    #expect(reading == Words(line: "Discovering conversations…", sub: "214 of 1,033 sessions on studio"))
    #expect(reading?.resting == false)
    // the index's wait outlasts the listing's first, empty answer: the hold is carried on its words
    let after = ledger(answered: true, index: .starting(detail: nil))
    #expect(after == Words(line: "Finding your history…", sub: "on studio"))
  }

  @Test("once the door has answered, an empty ledger with a ready index is no wait: its own note says what is there")
  func answeredEmpty() {
    #expect(ledger(answered: true) == nil)
    #expect(ledger(answered: true, index: .ready) == nil)
  }

  @Test("an index that failed, stopped or keeps no history is no wait: no hold, and its note says what to do")
  func noWaitWhenStopped() {
    #expect(ledger(index: .failed(reason: "the index failed")) == nil)
    #expect(ledger(index: .unconfigured(reason: nil)) == nil)
    #expect(ledger(index: .stopped) == nil)
  }

  @Test("no desktop answering and nothing kept: the hold's place, the mark at rest, and why")
  func nothingAnswers() {
    let rest = Words(line: "No desktop is answering", sub: "History opens when one wakes.", resting: true)
    #expect(ledger(standing: .asleep) == rest)
    #expect(ledger(standing: .asleep, answered: true, index: .starting(detail: nil)) == rest, "asleep, nothing moves")
    #expect(ledger(standing: .asleep)?.resting == true)
  }

  @Test("a desktop that speaks another VibeField is no wait: no hold, the head says what to do")
  func incompatible() {
    #expect(ledger(standing: .incompatible(theirs: "21", ours: "20")) == nil)
  }

  @Test("a ledger with a project never holds: what the phone kept, or read, opens at once")
  func projectsOpenAtOnce() {
    #expect(ledger(projects: true) == nil)
    #expect(ledger(projects: true, standing: .asleep) == nil)
    #expect(ledger(projects: true, index: .indexing(percent: 4, done: "40", total: "1,033")) == nil)
  }

  @Test("a project's list holds while none of its sessions has arrived and its desktop answers")
  func theList() {
    let reading = HistoryOpening.sessions(listed: false, awake: true, desktop: "studio")
    #expect(reading == Words(line: "Reading the conversations…", sub: "from studio"))
    #expect(HistoryOpening.sessions(listed: true, awake: true, desktop: "studio") == nil)
    let asleep = HistoryOpening.sessions(listed: false, awake: false, desktop: "studio")
    #expect(asleep == nil, "asleep, the list's note says what it waits for")
  }

  @Test("the holds name no machinery and never the device: what a person waits for, in History's words")
  func noInsides() {
    let words: [Words?] = [
      ledger(), ledger(index: .starting(detail: "waking the index")), ledger(index: .rebuilding(detail: "schema 7")),
      ledger(index: .indexing(percent: 21, done: "214", total: "1,033")), ledger(standing: .asleep),
      HistoryOpening.sessions(listed: false, awake: true, desktop: "studio"),
    ]
    #expect(words.allSatisfy { $0 != nil })
    for said in words.compactMap({ $0 }) {
      for text in [said.line, said.sub ?? ""] {
        // item 505 — how History is reached and kept is its insides (DESIGN.md §9, items 280 and 282)
        for inside in ["door", "index", "ledger", "phone", "daemon", "schema"] {
          #expect(!text.localizedCaseInsensitiveContains(inside), "\(text)")
        }
      }
    }
  }

  @Test("a session's hold says its line alone, its mark moving")
  func aSessionsWords() {
    #expect(HistoryOpening.words(.loading) == Words(line: "Loading messages…"))
    #expect(HistoryOpening.words(.finding) == Words(line: "Finding message…"))
  }

  @Test("what stands under the line is 4 under it, at 12.5; a line that changes goes over 140 ms, the next over 240")
  func theSubAndTheCarry() {
    #expect(HistoryOpening.subUnder == 4)
    #expect(HistoryOpening.subSize == 12.5)
    #expect(HistoryOpening.lineOut == 0.14)
    #expect(HistoryOpening.lineIn == 0.24)
    #expect(HistoryOpening.lineOut < HistoryOpening.lineIn)
  }

  @Test("a project's list holds in a box 280 tall: the mark at its middle, the line and the desktop under it")
  func theListsBox() {
    #expect(HistoryOpening.listBox == 280)
    // the mark's lower half, the gap, a line of 14 and the sub's gap and line of 12.5, each about 1.3 of its size
    let under = HistoryOpening.markBox.height / 2 + HistoryOpening.wordsUnder + CGFloat(18) + HistoryOpening.subUnder
      + CGFloat(17)
    #expect(HistoryOpening.listBox / 2 > under, "the words fit under the mark inside the box")
  }
}
