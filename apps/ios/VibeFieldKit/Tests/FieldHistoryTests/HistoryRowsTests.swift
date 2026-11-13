import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 381 (James, 2026-11-13 05:29:39Z, of the first build that reads a desktop directly: "some long session shows
/// up blank and only shows when i try to scroll") — the session's document is laid out a PART of a turn to a row,
/// never a whole turn to a row. That the blank open came of whole-turn rows is a reading of the code, not yet shown
/// on a device.
///
/// These rows hold which rows a document has and in what order. What a row looks like is the view's.
@Suite("item 381 — a row of the session's document is one part of a turn")
struct HistoryRowsTests {
  private func prose(_ id: String) -> HistorySegment {
    .prose(id: id, at: "12:00", text: "words of \(id)", anchor: nil)
  }

  private func group(_ id: String) -> HistorySegment {
    .ledger(id: id, summary: "Ran 2 commands", duration: "4s", failed: 0, isLive: false, lines: [])
  }

  private func turn(
    _ id: String, prompt: String = "a prompt", anchor: String? = nil, pill: HistoryDayPill? = nil,
    segments: [HistorySegment] = [], attachments: [String] = [], clipped: String? = nil, continues: Bool = false
  ) -> HistoryTurn {
    HistoryTurn(
      id: id, at: "12:00", dayPill: pill, prompt: prompt, promptAnchor: anchor, model: "a model", facts: "3 tools",
      segments: segments, promptAttachments: attachments, promptClipped: clipped, continues: continues)
  }

  @Test("a prompt and a reply in three parts are six rows: the room above, the prompt, the head, each part")
  func aTurnInItsParts() {
    let one = turn("t1", segments: [prose("a"), group("b"), prose("c")])
    #expect(
      HistoryRow.of([one]) == [
        .gap(turn: "t1"), .prompt(one), .head(one), .segment(prose("a"), turn: one),
        .segment(group("b"), turn: one), .segment(prose("c"), turn: one),
      ])
  }

  @Test("a turn that opens a sitting has the sitting's pill in place of the room above")
  func aSittingsPill() {
    let pill = HistoryDayPill(lead: "12:31", after: "after 44m")
    let one = turn("t1", pill: pill, segments: [prose("a")])
    #expect(
      HistoryRow.of([one]) == [
        .sitting(turn: "t1", pill: pill), .prompt(one), .head(one), .segment(prose("a"), turn: one),
      ])
  }

  @Test("a later part of a reply that time cut has no prompt and no second head")
  func aContinuedPart() {
    let pill = HistoryDayPill(lead: "Tue 1 Sep · 00:02", after: "after 44m")
    let later = turn("t1/2", prompt: "", pill: pill, segments: [prose("d")], continues: true)
    #expect(HistoryRow.of([later]) == [.sitting(turn: "t1/2", pill: pill), .segment(prose("d"), turn: later)])
  }

  @Test("the cut's note, then each attachment in the order it was attached, follow the prompt")
  func underThePrompt() {
    let one = turn(
      "t1", segments: [prose("a")], attachments: ["image shot.png on studio", "file notes.txt on studio"],
      clipped: "clipped · 14 KB on studio")
    #expect(
      HistoryRow.of([one]) == [
        .gap(turn: "t1"), .prompt(one), .promptClipped(turn: "t1", words: "clipped · 14 KB on studio"),
        .promptAttachment(turn: "t1", index: 0, words: "image shot.png on studio"),
        .promptAttachment(turn: "t1", index: 1, words: "file notes.txt on studio"),
        .head(one), .segment(prose("a"), turn: one),
      ])
  }

  @Test("a turn with no prompt has no prompt row; a prompt of no words that a search landed on has one")
  func noPrompt() {
    let none = turn("t1", prompt: "", segments: [prose("a")])
    #expect(HistoryRow.of([none]) == [.gap(turn: "t1"), .head(none), .segment(prose("a"), turn: none)])
    let landed = turn("t2", prompt: "", anchor: "hit-1", segments: [prose("a")])
    #expect(
      HistoryRow.of([landed]) == [
        .gap(turn: "t2"), .prompt(landed), .head(landed), .segment(prose("a"), turn: landed),
      ])
  }

  @Test("a turn of a prompt alone has no head")
  func aPromptAlone() {
    let one = turn("t1")
    #expect(HistoryRow.of([one]) == [.gap(turn: "t1"), .prompt(one)])
  }

  @Test("the turns keep their order, and each its own")
  func twoTurns() {
    let one = turn("t1", segments: [prose("a")])
    let two = turn("t2", segments: [group("b"), prose("c")])
    #expect(
      HistoryRow.of([one, two]) == [
        .gap(turn: "t1"), .prompt(one), .head(one), .segment(prose("a"), turn: one),
        .gap(turn: "t2"), .prompt(two), .head(two), .segment(group("b"), turn: two),
        .segment(prose("c"), turn: two),
      ])
  }

  @Test("every row's id is its own, across turns whose parts share an id and prompts with several attachments")
  func idsAreTheirOwn() {
    let one = turn("t1", segments: [prose("a"), prose("b")], attachments: ["one", "two"], clipped: "clipped")
    let two = turn("t2", segments: [prose("a"), prose("b")], attachments: ["one", "two"], clipped: "clipped")
    let ids = HistoryRow.of([one, two]).map(\.id)
    #expect(ids.count == 16)
    #expect(Set(ids).count == ids.count)
  }

  @Test("no turns, no rows")
  func noTurns() {
    #expect(HistoryRow.of([]).isEmpty)
  }

  @Test("the room above a turn is 30 pt, as it was")
  func theRoomAbove() {
    #expect(HistoryRow.turnGap == 30)
  }
}
