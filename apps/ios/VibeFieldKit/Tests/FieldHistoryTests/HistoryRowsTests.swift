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

  /// The rows of a document read from the desktop these rows name, `studio`.
  private func rows(_ turns: [HistoryTurn]) -> [HistoryRow] {
    HistoryRow.of(turns, desktop: "studio")
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
      rows([one]) == [
        .gap(turn: "t1"), .prompt(one), .head(one), .segment(prose("a"), turn: one),
        .segment(group("b"), turn: one), .segment(prose("c"), turn: one),
      ])
  }

  @Test("a turn that opens a sitting has the sitting's pill in place of the room above")
  func aSittingsPill() {
    let pill = HistoryDayPill(lead: "12:31", after: "after 44m")
    let one = turn("t1", pill: pill, segments: [prose("a")])
    #expect(
      rows([one]) == [
        .sitting(turn: "t1", pill: pill), .prompt(one), .head(one), .segment(prose("a"), turn: one),
      ])
  }

  @Test("a later part of a reply that time cut has no prompt and no second head")
  func aContinuedPart() {
    let pill = HistoryDayPill(lead: "Tue 1 Sep · 00:02", after: "after 44m")
    let later = turn("t1/2", prompt: "", pill: pill, segments: [prose("d")], continues: true)
    #expect(rows([later]) == [.sitting(turn: "t1/2", pill: pill), .segment(prose("d"), turn: later)])
  }

  @Test("the cut's note, then one strip of what was attached, in the order it was attached, follow the prompt")
  func underThePrompt() {
    let one = turn(
      "t1", segments: [prose("a")], attachments: ["image shot.png on studio", "file notes.txt on studio"],
      clipped: "clipped · 14 KB on studio")
    #expect(
      rows([one]) == [
        .gap(turn: "t1"), .prompt(one), .promptClipped(turn: "t1", words: "clipped · 14 KB on studio"),
        // item 362g — one row, a strip; a document that carries no ids for them asks for no picture
        .promptStrip(
          turn: "t1",
          [
            HistoryAttached(id: "t1/prompt/0", picture: nil, words: "image shot.png on studio"),
            HistoryAttached(id: "t1/prompt/1", picture: nil, words: "file notes.txt on studio"),
          ]),
        .head(one), .segment(prose("a"), turn: one),
      ])
  }

  @Test("item 362g — a run of the reply's attachments is one row, a strip, under the reply or the group before it")
  func aRepliesStrips() {
    let shot = HistorySegment.attachment(id: "a/i1", kind: "image", label: "image shot.png on studio")
    let unnamed = HistorySegment.attachment(id: "a/d1", kind: "document", label: nil)
    let tools = HistorySegment.attachment(id: "b/i1", kind: "image", label: "image on studio")
    let one = turn("t1", segments: [prose("a"), shot, unnamed, group("b"), tools])
    #expect(
      rows([one]) == [
        .gap(turn: "t1"), .prompt(one), .head(one), .segment(prose("a"), turn: one),
        .strip(
          turn: "t1",
          [
            HistoryAttached(id: "a/i1", picture: "a/i1", words: "image shot.png on studio"),
            HistoryAttached(id: "a/d1", picture: nil, words: "attachment on studio"),
          ]),
        .segment(group("b"), turn: one),
        .strip(turn: "t1", [HistoryAttached(id: "b/i1", picture: "b/i1", words: "image on studio")]),
      ])
    // two strips of one turn, and a prompt's beside them, each have an id of their own
    let both = turn("t2", segments: [prose("a"), shot, group("b"), tools], attachments: ["image on studio"])
    let ids = rows([both]).map(\.id)
    #expect(ids.count == 8 && Set(ids).count == ids.count)
  }

  @Test("a turn with no prompt has no prompt row; a prompt of no words that a search landed on has one")
  func noPrompt() {
    let none = turn("t1", prompt: "", segments: [prose("a")])
    #expect(rows([none]) == [.gap(turn: "t1"), .head(none), .segment(prose("a"), turn: none)])
    let landed = turn("t2", prompt: "", anchor: "hit-1", segments: [prose("a")])
    #expect(
      rows([landed]) == [
        .gap(turn: "t2"), .prompt(landed), .head(landed), .segment(prose("a"), turn: landed),
      ])
  }

  @Test("a turn of a prompt alone has no head")
  func aPromptAlone() {
    let one = turn("t1")
    #expect(rows([one]) == [.gap(turn: "t1"), .prompt(one)])
  }

  @Test("the turns keep their order, and each its own")
  func twoTurns() {
    let one = turn("t1", segments: [prose("a")])
    let two = turn("t2", segments: [group("b"), prose("c")])
    #expect(
      rows([one, two]) == [
        .gap(turn: "t1"), .prompt(one), .head(one), .segment(prose("a"), turn: one),
        .gap(turn: "t2"), .prompt(two), .head(two), .segment(group("b"), turn: two),
        .segment(prose("c"), turn: two),
      ])
  }

  @Test("every row's id is its own, across turns whose parts share an id and prompts with several attachments")
  func idsAreTheirOwn() {
    let one = turn("t1", segments: [prose("a"), prose("b")], attachments: ["one", "two"], clipped: "clipped")
    let two = turn("t2", segments: [prose("a"), prose("b")], attachments: ["one", "two"], clipped: "clipped")
    let ids = rows([one, two]).map(\.id)
    // item 362g — seven rows a turn: what is attached to a prompt is one strip's row, where it was a row each
    #expect(ids.count == 14)
    #expect(Set(ids).count == ids.count)
  }

  @Test("no turns, no rows")
  func noTurns() {
    #expect(rows([]).isEmpty)
  }

  @Test("the room above a turn is 30 pt, as it was")
  func theRoomAbove() {
    #expect(HistoryRow.turnGap == 30)
  }
}
