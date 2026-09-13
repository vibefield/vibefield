import Testing

@testable import FieldInput

/// Dictation, as the only part of it a machine with no microphone can judge:
/// the string rules.
///
/// Speech itself is device-gated — a simulator's audio input reports zero
/// channels and no partial ever arrives — so nothing here touches
/// `DictationSession`'s framework half. What IS testable is the whole of what
/// the card promises: heard words land in the DRAFT, a refinement replaces
/// what the last one put there rather than repeating it, and everything the
/// user typed around it survives.
@MainActor
@Suite("dictation lands in the draft")
struct DictationTests {

  // MARK: - Where the words go

  @Test("dictation into an empty draft gets no leading space")
  func emptyDraft() {
    let model = InputCardModel()
    model.appendDictation("git status")
    #expect(model.draft == "git status")
  }

  @Test("dictation after a word gets one separating space")
  func afterAWord() {
    let model = InputCardModel()
    model.draft = "sudo"
    model.appendDictation("restart the daemon")
    #expect(model.draft == "sudo restart the daemon")
  }

  /// A draft that already ends in a space gets no second one — the user put
  /// that space there, and dictation adding another would be the card typing.
  @Test("a draft already ending in whitespace gets no second space")
  func trailingSpace() {
    let model = InputCardModel()
    model.draft = "git "
    model.appendDictation("status")
    #expect(model.draft == "git status")
  }

  @Test("a draft ending in a newline gets no space either")
  func trailingNewline() {
    let model = InputCardModel()
    model.draft = "git status\n"
    model.appendDictation("git log")
    #expect(model.draft == "git status\ngit log")
  }

  /// Nothing heard is nothing appended: an empty first partial must not leave
  /// a separator behind for words that never arrived.
  @Test("an empty partial appends nothing, separator included")
  func emptyPartial() {
    let model = InputCardModel()
    model.draft = "git"
    model.appendDictation("")
    #expect(model.draft == "git")
  }

  // MARK: - Refinement

  /// The whole reason the span exists. Recognition re-reads the phrase rather
  /// than streaming words, so the second partial must REPLACE the first.
  @Test("a refinement replaces the heard span rather than repeating it")
  func refinementReplaces() {
    let model = InputCardModel()
    model.appendDictation("get status")
    model.appendDictation("git status")
    #expect(model.draft == "git status")
  }

  @Test("a refinement leaves the typed prefix alone")
  func refinementKeepsThePrefix() {
    let model = InputCardModel()
    model.draft = "cd repo &&"
    model.appendDictation("get")
    model.appendDictation("git status --short")
    #expect(model.draft == "cd repo && git status --short")
  }

  @Test("a refinement that shortens the phrase shortens the draft")
  func refinementShortens() {
    let model = InputCardModel()
    model.appendDictation("run the whole suite twice")
    model.appendDictation("run the suite")
    #expect(model.draft == "run the suite")
  }

  @Test("many partials in a row leave exactly one phrase")
  func manyPartials() {
    let model = InputCardModel()
    model.draft = "echo"
    for partial in ["h", "he", "hell", "hello world"] {
      model.appendDictation(partial)
    }
    #expect(model.draft == "echo hello world")
  }

  // MARK: - The commit

  /// After the run ends the heard words are ordinary draft: the next dictation
  /// appends AFTER them, with its own separator, instead of overwriting words
  /// the user already watched settle.
  @Test("a committed tail is appended after, not written over")
  func commitClosesTheSpan() {
    let model = InputCardModel()
    model.appendDictation("git status")
    model.commitDictation()
    model.appendDictation("git log")
    #expect(model.draft == "git status git log")
  }

  @Test("replacing a tail nobody started does nothing")
  func replaceWithoutASpan() {
    let model = InputCardModel()
    model.draft = "git status"
    model.replaceDictationTail("rm -rf /")
    #expect(model.draft == "git status")
  }

  @Test("replacing a tail after the commit does nothing")
  func replaceAfterCommit() {
    let model = InputCardModel()
    model.appendDictation("git status")
    model.commitDictation()
    model.replaceDictationTail("git log")
    #expect(model.draft == "git status")
  }

  // MARK: - The draft moving underneath

  /// Send clears the draft while the mic may still be open. The span is proved
  /// against the draft every time it is used, so the stale one is dropped and
  /// the next partial starts a fresh phrase rather than indexing into a string
  /// that no longer has those characters.
  @Test("a draft cleared by Send leaves no stale span behind")
  func sendClearsTheSpan() {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    model.appendDictation("git status")
    model.tapSend()
    #expect(recorder.acts == [.sendDraft("git status")])
    model.appendDictation("git log")
    #expect(model.draft == "git log")
  }

  @Test("a draft the user shortened past the span appends fresh")
  func editedDraft() {
    let model = InputCardModel()
    model.draft = "cd repo"
    model.appendDictation("and run the tests")
    model.draft = "cd"
    model.appendDictation("and run the tests")
    #expect(model.draft == "cd and run the tests")
  }

  /// The span is counted in Characters, so a grapheme that is several scalars
  /// wide still moves the offsets by one. Getting this wrong crashes rather
  /// than misplaces, which is why it is pinned.
  @Test("offsets are characters, not bytes or scalars")
  func graphemes() {
    let model = InputCardModel()
    model.draft = "echo 👩‍👩‍👧‍👦"
    model.appendDictation("hello")
    model.appendDictation("hello world")
    #expect(model.draft == "echo 👩‍👩‍👧‍👦 hello world")
  }

  /// The dictated tail is draft like any other: Send commits it as one act,
  /// which is the whole point of landing it there instead of on the wire.
  @Test("what was heard is what Send sends")
  func dictationReachesSend() {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    model.draft = "cd repo &&"
    model.appendDictation("get status")
    model.appendDictation("git status")
    model.commitDictation()
    model.tapSend()
    #expect(recorder.acts == [.sendDraft("cd repo && git status")])
  }

  // MARK: - The states, in words

  /// D-i6 on the mic: what it cannot do, it says. Both failures carry a line
  /// and neither of the working states does, because the key's own fill is
  /// already saying those.
  @Test("only the honest failures carry a line")
  func noticeCopy() {
    #expect(DictationSession.State.idle.notice == nil)
    #expect(DictationSession.State.listening.notice == nil)
    #expect(
      DictationSession.State.denied(DictationSession.microphoneDenied).notice
        == "microphone access is off for VibeField — Settings › Privacy")
    #expect(
      DictationSession.State.unavailable(DictationSession.noRecognizer).notice
        == "speech recognition is not available on this device")
  }

  @Test("listening is the only state that reads as listening")
  func listeningIsOneState() {
    #expect(DictationSession.State.listening.isListening)
    #expect(!DictationSession.State.idle.isListening)
    #expect(!DictationSession.State.denied(DictationSession.speechDenied).isListening)
    #expect(!DictationSession.State.unavailable(DictationSession.noMicrophone).isListening)
  }

  final class Recorder {
    var acts: [InputAct] = []
  }
}
