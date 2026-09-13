import Testing

@testable import FieldInput

/// Lines as a person counts them — the number the review threshold is a
/// threshold on, and the number the sheet puts on screen.
@Suite("counting a paste's lines")
struct PasteLineCountTests {
  @Test("a trailing newline ends the last line, it does not start a new one")
  func trailingNewlineDoesNotCount() {
    #expect(pasteLineCount("a\nb\nc\nd") == 4)
    #expect(pasteLineCount("a\nb\nc\nd\n") == 4)
    #expect(pasteLineCount("one line") == 1)
    #expect(pasteLineCount("one line\n") == 1)
    #expect(pasteLineCount("") == 0)
    #expect(pasteLineCount("\n") == 1)
  }

  /// An interior blank line is a line — it is in the block that gets sent.
  @Test("blank lines inside the block are lines")
  func interiorBlanksCount() {
    #expect(pasteLineCount("a\n\nb") == 3)
  }

  /// `\r\n` is one line ending, not two: both halves answer `isNewline`, so a
  /// naive split doubles every line of anything copied off a Windows host.
  @Test("a Windows line ending counts once")
  func windowsLineEndings() {
    #expect(pasteLineCount("a\r\nb\r\nc") == 3)
    #expect(pasteLineCount("a\r\nb\r\n") == 2)
  }
}

/// What the paste chip's text does, per mode.
@MainActor
@Suite("accepting a paste")
struct AcceptPasteTests {
  private func card() -> (InputCardModel, Recorder) {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    return (model, recorder)
  }

  final class Recorder {
    var acts: [InputAct] = []
  }

  /// Four lines, the longest thing that goes straight through.
  private let short = "one\ntwo\nthree\nfour"
  /// Five, the shortest thing that gets a look first.
  private let long = "one\ntwo\nthree\nfour\nfive"

  // MARK: - Draft

  @Test("a paste into an empty draft is the draft")
  func intoEmptyDraft() {
    let (model, recorder) = card()
    model.acceptPaste("git status")
    #expect(model.draft == "git status")
    // Nothing leaves the phone: the draft is local until Send.
    #expect(recorder.acts.isEmpty)
  }

  /// A paste is usually the second half of a thought whose first half is
  /// already typed, and the two were composed apart — running them together on
  /// one line is never what was meant.
  @Test("a paste onto a draft lands on its own line")
  func appendsOnItsOwnLine() {
    let (model, _) = card()
    model.draft = "curl -s"
    model.acceptPaste("https://example.test/x")
    #expect(model.draft == "curl -s\nhttps://example.test/x")
  }

  /// One separator, not two: a draft that already ends in a newline has its
  /// line break.
  @Test("a draft that already ends in a newline gets no second one")
  func doesNotDoubleTheSeparator() {
    let (model, _) = card()
    model.draft = "line one\n"
    model.acceptPaste("line two")
    #expect(model.draft == "line one\nline two")
  }

  /// The review is the terminal path's alone. A long paste into the draft is
  /// already visible, already editable, and has not left the phone.
  @Test("length never opens the review in the draft")
  func draftNeverReviews() {
    let (model, recorder) = card()
    model.acceptPaste(long)
    #expect(model.pendingPasteReview == nil)
    #expect(model.draft == long)
    #expect(recorder.acts.isEmpty)
  }

  // MARK: - The terminal

  @Test("a short paste goes straight through as one block")
  func shortGoesThrough() {
    let (model, recorder) = card()
    model.toggleMode()
    model.acceptPaste(short)
    #expect(recorder.acts == [.paste(short)])
    #expect(model.pendingPasteReview == nil)
    // No Enter behind it: what was pasted is the user's to finish.
    #expect(recorder.acts.contains(.sendDraft(short)) == false)
  }

  @Test("five lines is where it stops and asks")
  func longIsReviewed() {
    let (model, recorder) = card()
    model.toggleMode()
    model.acceptPaste(long)
    #expect(model.pendingPasteReview?.text == long)
    #expect(recorder.acts.isEmpty)
  }

  @Test("SEND on the review is what sends it")
  func confirmSends() {
    let (model, recorder) = card()
    model.toggleMode()
    model.acceptPaste(long)
    model.confirmPasteReview()
    #expect(recorder.acts == [.paste(long)])
    #expect(model.pendingPasteReview == nil)
  }

  @Test("CANCEL sends nothing and keeps nothing")
  func cancelSendsNothing() {
    let (model, recorder) = card()
    model.toggleMode()
    model.acceptPaste(long)
    model.cancelPasteReview()
    #expect(recorder.acts.isEmpty)
    #expect(model.pendingPasteReview == nil)
    // The pasteboard still holds it; there is nothing here worth keeping.
    #expect(model.draft.isEmpty)
  }

  /// Confirming a sheet that is not up would send the last thing reviewed a
  /// second time.
  @Test("confirming with nothing pending sends nothing")
  func confirmingNothingIsSilent() {
    let (model, recorder) = card()
    model.confirmPasteReview()
    #expect(recorder.acts.isEmpty)
  }

  /// An empty pasteboard string is not an act in either mode.
  @Test("an empty paste does nothing")
  func emptyIsNothing() {
    let (model, recorder) = card()
    model.acceptPaste("")
    model.toggleMode()
    model.acceptPaste("")
    #expect(model.draft.isEmpty)
    #expect(recorder.acts.isEmpty)
    #expect(model.pendingPasteReview == nil)
  }

  /// A paste held for review belongs to the session it was aimed at.
  @Test("closing the card drops a paste that was still being reviewed")
  func resetDropsTheReview() {
    let (model, _) = card()
    model.toggleMode()
    model.acceptPaste(long)
    model.reset()
    #expect(model.pendingPasteReview == nil)
  }
}
