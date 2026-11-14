import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 396 (James, 2026-11-13 23:38:00Z, session qa-01: "a good addition design should be added to both desktop and
/// mobile is that we should have a floating button on the side for user to quick jump to previous user message so user
/// can quick navigate, help me design and implement nicely") — a round button at the document's side goes to the
/// nearest message of the person's own that begins above the top of the view, and is there only while a press has
/// somewhere to go.
///
/// These rows hold the RULE: given the document's rows and where each laid-out row begins, where a press goes.
/// That a row on a phone says where it begins, and where the page then stands, is his to see.
@Suite("item 396 — a button at the side goes to the message before")
struct HistoryBeforeTests {
  private func prose(_ id: String) -> HistorySegment {
    .prose(id: id, at: "12:00", text: "words of \(id)", anchor: nil)
  }

  private func turn(_ id: String, prompt: String = "a prompt", anchor: String? = nil) -> HistoryTurn {
    HistoryTurn(
      id: id, at: "12:00", prompt: prompt, promptAnchor: anchor, model: "a model", facts: "3 tools",
      segments: [prose("a")])
  }

  private func rows(_ turns: [HistoryTurn]) -> [HistoryRow] {
    HistoryRow.of(turns, desktop: "studio")
  }

  /// Three turns, each a prompt and a reply. A turn's rows: the room above, the prompt, the head, the reply.
  private var three: [HistoryRow] { rows([turn("t1"), turn("t2"), turn("t3")]) }

  private func before(
    _ rows: [HistoryRow], _ standing: [String: HistoryRow.Standing], unread: Bool = false
  ) -> HistoryBefore {
    HistoryRow.before(rows, standing: standing, unread: unread)
  }

  @Test("in a reply, a press goes to the reply's own prompt: the nearest message that begins above the top")
  func aMessageAbove() {
    let standing: [String: HistoryRow.Standing] = [
      "gap/t3": .above, "prompt/t3": .above, "head/t3": .above, "segment/t3/a": .below,
    ]
    #expect(before(three, standing) == .message("prompt-t3", near: true))
    #expect(before(three, standing).shows)
  }

  @Test("a message the top of the view cuts begins above it, and is the one gone to")
  func aCutMessage() {
    #expect(before(three, ["prompt/t2": .above, "head/t2": .below]) == .message("prompt-t2", near: true))
  }

  @Test("a message that begins in the view is not gone to: the one before it is")
  func aMessageInView() {
    let standing: [String: HistoryRow.Standing] = [
      "segment/t1/a": .above, "gap/t2": .above, "prompt/t2": .below, "head/t2": .below,
    ]
    #expect(before(three, standing) == .message("prompt-t1", near: false))
  }

  @Test("pressed again it goes to the one before that, and at the first message the button is gone")
  func pressedAgain() {
    // reading the third reply
    #expect(before(three, ["head/t3": .above, "segment/t3/a": .below]) == .message("prompt-t3", near: false))
    // the press stood the third prompt under the head: the room above it is above the top, and it is not
    let third: [String: HistoryRow.Standing] = [
      "segment/t2/a": .above, "gap/t3": .above, "prompt/t3": .below, "head/t3": .below,
    ]
    #expect(before(three, third) == .message("prompt-t2", near: false))
    let second: [String: HistoryRow.Standing] = [
      "segment/t1/a": .above, "gap/t2": .above, "prompt/t2": .below, "head/t2": .below,
    ]
    #expect(before(three, second) == .message("prompt-t1", near: false))
    // the first prompt under the head: nothing of the person's own is above it
    #expect(before(three, ["gap/t1": .above, "prompt/t1": .below, "head/t1": .below]) == .nothing)
  }

  @Test("a message a screen above at most is near; one further off, or not laid out, is not")
  func nearAndFar() {
    #expect(before(three, ["prompt/t3": .above, "segment/t3/a": .above]) == .message("prompt-t3", near: true))
    #expect(before(three, ["prompt/t3": .away, "segment/t3/a": .above]) == .message("prompt-t3", near: false))
    #expect(before(three, ["segment/t3/a": .above]) == .message("prompt-t3", near: false))
  }

  @Test("with no message above and every row read, the button is gone")
  func nothingAbove() {
    // at the document's top
    #expect(before(three, ["gap/t1": .below, "prompt/t1": .below, "head/t1": .below]) == .nothing)
    #expect(before(three, ["gap/t1": .below, "prompt/t1": .below]).shows == false)
    // rows above the top, and none of them a message of the person's own
    #expect(before(three, ["gap/t1": .above, "prompt/t1": .below]) == .nothing)
    // a document that begins inside a reply
    let headless = rows([turn("t0", prompt: ""), turn("t1")])
    #expect(before(headless, ["head/t0": .above, "segment/t0/a": .below]) == .nothing)
  }

  @Test("with no message above and rows above not yet read, it stays and a press goes to the document's top")
  func rowsUnread() {
    #expect(before(three, ["gap/t1": .below, "prompt/t1": .below], unread: true) == .top)
    #expect(before(three, ["gap/t1": .above, "prompt/t1": .below], unread: true) == .top)
    #expect(before(three, ["gap/t1": .above, "prompt/t1": .below], unread: true).shows)
    // while a message is above, rows not yet read change nothing
    #expect(
      before(three, ["prompt/t1": .above, "head/t1": .below], unread: true) == .message("prompt-t1", near: true))
  }

  @Test("an empty document has no button, unless rows above it are not yet read")
  func anEmptyDocument() {
    #expect(before([], [:]) == .nothing)
    #expect(before([], [:]).shows == false)
    #expect(before([], [:], unread: true) == .top)
  }

  @Test("before a row has said where it begins nothing is above; a row no longer in the document says nothing")
  func nothingSaid() {
    #expect(before(three, [:]) == .nothing)
    #expect(before(three, ["segment/gone/a": .above]) == .nothing)
    #expect(before(three, ["segment/gone/a": .above], unread: true) == .top)
  }

  @Test("a turn with no prompt is passed over: the message before it is the one")
  func aTurnWithNoPrompt() {
    let turns = rows([turn("t1"), turn("t2", prompt: "")])
    #expect(before(turns, ["head/t2": .above, "segment/t2/a": .below]) == .message("prompt-t1", near: false))
  }

  @Test("a prompt's row is found by the hit's id where a search landed on it, else by its turn's")
  func thePromptsMark() {
    #expect(HistoryRow.promptMark(turn("t1")) == "prompt-t1")
    #expect(HistoryRow.promptMark(turn("t1", anchor: "hit-1")) == "hit-1")
    let landed = rows([turn("t1", anchor: "hit-1"), turn("t2")])
    #expect(before(landed, ["head/t1": .above, "segment/t1/a": .below]) == .message("hit-1", near: false))
  }

  @Test("a row begins above the top of the view past a point of slack, and away past a screen")
  func whereARowBegins() {
    // a view 600 pt tall; `top` is the row's top below the top of the view
    #expect(HistoryBefore.slack == 1)
    #expect(HistoryRow.standing(top: 240, screen: 600) == .below)
    #expect(HistoryRow.standing(top: 12, screen: 600) == .below, "a message a press stood under the head")
    #expect(HistoryRow.standing(top: 0, screen: 600) == .below)
    #expect(HistoryRow.standing(top: -1, screen: 600) == .below, "within the slack")
    #expect(HistoryRow.standing(top: -1.5, screen: 600) == .above)
    #expect(HistoryRow.standing(top: -600, screen: 600) == .above, "exactly a screen")
    #expect(HistoryRow.standing(top: -601, screen: 600) == .away)
    // the view's height not known: every row above is gone to at once
    #expect(HistoryRow.standing(top: -40, screen: 0) == .away)
    #expect(HistoryRow.standing(top: 40, screen: 0) == .below)
  }

  @Test("the button: 40 pt with a 44 pt hit area, 16 pt in, its centre on the pill's centre line")
  func theButtonsMeasures() {
    #expect(HistoryBefore.size == 40)
    #expect(HistoryBefore.reach == 44)
    #expect(HistoryBefore.glyph == 15)
    #expect(HistoryBefore.side == 16)
    // over the bar alone the pill's foot is 92 above the safe area's line and its centre 110
    #expect(HistoryBefore.foot(bar: 57) == 90)
    #expect(HistoryBefore.foot(bar: 57) + HistoryBefore.size / 2 == HistoryFollow.pillFoot(bar: 57) + 18)
    // with the slot above the bar it rises with the pill
    #expect(HistoryBefore.foot(bar: 115) == 148)
    #expect(HistoryBefore.foot(bar: 115) + HistoryBefore.size / 2 == HistoryFollow.pillFoot(bar: 115) + 18)
  }

  @Test("the message's top is stood 12 pt under the head, as a share of the view's height")
  func theAir() {
    #expect(HistoryBefore.air == 12)
    #expect(HistoryBefore.anchor(screen: 600) == 0.02)
    #expect(HistoryBefore.anchor(screen: 600) * 600 == 12)
    // the view's height not known, or no taller than the air: the top itself
    #expect(HistoryBefore.anchor(screen: 0) == 0)
    #expect(HistoryBefore.anchor(screen: 12) == 0)
  }

  @Test("the page eases over 300 ms to a place a screen away at most, and never under Reduce Motion")
  func howItGoes() {
    #expect(HistoryBefore.ease == 0.3)
    #expect(HistoryBefore.fade == 0.2)
    #expect(HistoryBefore.eases(near: true, reduceMotion: false))
    #expect(HistoryBefore.eases(near: false, reduceMotion: false) == false)
    #expect(HistoryBefore.eases(near: true, reduceMotion: true) == false)
    #expect(HistoryBefore.eases(near: false, reduceMotion: true) == false)
  }
}

/// Item 396 — a press on the button is the reader's own move up the page: the document stops following, as it
/// does for a finger, and the rows above are read in at its top, even in a document a search landed in.
@Suite("item 396 — a press on the button at the side stops the following")
struct HistoryJumpFollowTests {
  @Test("a press stops a document that was following, and a row arriving below then leaves the place alone")
  func stopsTheFollowing() {
    var follow = HistoryFollow(landed: false)
    follow.jumped()
    #expect(follow.following == false)
    #expect(follow.growth == .head)
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: true) == .latest, "the way back is offered")
  }

  @Test("a press ends a return to the end: the rest that follows is the reader's own")
  func endsAReturn() {
    var follow = HistoryFollow(landed: false)
    follow.pressed()
    follow.jumped()
    follow.rested(atFoot: false)
    #expect(follow.following == false)
  }

  @Test("a press counts as moving the page by hand: at the top the rows above are read in, in a landed document too")
  func readsTheRowsAbove() {
    var follow = HistoryFollow(landed: true)
    #expect(
      follow.asksEarlier(nearTop: true, cursor: "c1", stalled: nil, awake: true, reading: false) == false,
      "a landed document waits for the reader to move it")
    follow.jumped()
    #expect(follow.touched)
    #expect(follow.asksEarlier(nearTop: true, cursor: "c1", stalled: nil, awake: true, reading: false))
    #expect(follow.opening == .landing, "where it opened is not rewritten")
  }
}
