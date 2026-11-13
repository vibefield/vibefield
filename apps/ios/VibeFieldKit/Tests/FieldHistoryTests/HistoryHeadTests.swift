import Testing

@testable import FieldHistory

/// Item 390 (James, 2026-11-13 23:28:32Z, session qa-01, of History's root on his phone: "[Image #16] redesign the
/// first marked area, to just show Projects and a bubble that shows the project count and thats it, keep it
/// minimal, remove the second marked text") — a head is its title and how many it holds. These rows hold what a
/// head says without a screen: its title, the words in its bubble, and the one line VoiceOver reads for the two.
/// How the bubble sits beside the title is the view's, and his to see.
@Suite("item 390 — a head says its name and how many, and nothing else")
struct HistoryHeadTests {
  @Test("the root's head says Projects and how many the ledger lists, with the ledger's thousands separator")
  func rootCount() {
    #expect(
      FieldHistoryModel.rootHead(projects: 79)
        == FieldHistoryModel.Head(title: "Projects", count: "79", spoken: "Projects, 79"))
    #expect(
      FieldHistoryModel.rootHead(projects: 1_485)
        == FieldHistoryModel.Head(title: "Projects", count: "1,485", spoken: "Projects, 1,485"))
    #expect(FieldHistoryModel.rootHead(projects: 1).count == "1")
  }

  @Test("a ledger that lists no project wears no bubble: the page's note says why, and a 0 would be a claim")
  func rootEmpty() {
    #expect(
      FieldHistoryModel.rootHead(projects: 0)
        == FieldHistoryModel.Head(title: "Projects", count: nil, spoken: "Projects"))
  }

  @Test("a ledger cut at the phone's bound says so in the bubble, as a lower bound does everywhere on the phone")
  func rootCut() {
    #expect(
      FieldHistoryModel.rootHead(projects: 2_000, cut: true)
        == FieldHistoryModel.Head(title: "Projects", count: "2,000+", spoken: "Projects, more than 2,000"))
    #expect(FieldHistoryModel.rootHead(projects: 0, cut: true).count == nil)
  }
}
