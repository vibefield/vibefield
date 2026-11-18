import Testing

@testable import FieldHistory

/// Item 390 (asked for 2026-11-13, of History's root on a phone, the first marked area redrawn: Projects and a
/// bubble with the project count and nothing more, kept minimal, and the second marked text
/// removed) — a head is its title and how many it holds. These rows hold what a
/// head says without a screen: its title, the words in its bubble, and the one line VoiceOver reads for the two.
/// How the bubble sits beside the title is the view's, and to be seen on a device.
///
/// Item 392 (asked for 2026-11-13, of a project's page: this header redrawn to match the same redesign, simple: the
/// project's name and a bubble with the session count, and no other
/// text) — a project's head is the root's over again: its name, and its sessions
/// in the same bubble.
@Suite("items 390 and 392 — a head says its name and how many, and nothing else")
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

  @Test("a project's head says its name and how many sessions its page lists, and is read with what is counted")
  func projectCount() {
    #expect(
      FieldHistoryModel.projectHead(name: "rosetta", sessions: 62)
        == FieldHistoryModel.Head(title: "rosetta", count: "62", spoken: "rosetta, 62 sessions"))
    #expect(
      FieldHistoryModel.projectHead(name: "vibe-field", sessions: 1_485)
        == FieldHistoryModel.Head(title: "vibe-field", count: "1,485", spoken: "vibe-field, 1,485 sessions"))
    #expect(
      FieldHistoryModel.projectHead(name: "mille", sessions: 1)
        == FieldHistoryModel.Head(title: "mille", count: "1", spoken: "mille, 1 session"))
  }

  @Test("a project whose sessions are not read yet wears no bubble, never a 0")
  func projectUnread() {
    #expect(
      FieldHistoryModel.projectHead(name: "rosetta", sessions: 0)
        == FieldHistoryModel.Head(title: "rosetta", count: nil, spoken: "rosetta"))
  }

  @Test("the two heads write a count the same way: one bubble, one separator")
  func oneBubble() {
    for count in [1, 62, 999, 1_000, 1_485, 12_345] {
      #expect(
        FieldHistoryModel.projectHead(name: "p", sessions: count).count
          == FieldHistoryModel.rootHead(projects: count).count)
    }
  }
}
