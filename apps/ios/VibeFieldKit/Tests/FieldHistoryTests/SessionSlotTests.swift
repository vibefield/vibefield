import Testing

@testable import FieldHistory

/// Item 388 (James, 2026-11-13 23:18:12Z, of the slot over the bar on a session's document: "this is too busy
/// [Image #14] just make it a resume button, no need for the device stuff") — the slot carries the session's act
/// and nothing beside it: the act's word, and after it only what the act itself has to say. Where the session runs
/// (the desktop's mark and name, the folder) is not part of it: the rule is handed neither, so it cannot say them.
///
/// These rows hold the WORDS. That the button is as wide as they are, and unbroken with the bar folded, is the
/// view's, and his to see.
@Suite("item 388 — a session's act in the slot is its word, and what it has to say")
struct SessionSlotTests {
  @Test("Resume stands alone until it has an answer; its answer stands after it")
  func resume() {
    #expect(FieldHistoryModel.slotWords(.resume, answer: nil) == SessionSlotWords(word: "Resume", note: nil))
    #expect(
      FieldHistoryModel.slotWords(.resume, answer: "Resuming on studio")
        == SessionSlotWords(word: "Resume", note: "Resuming on studio"))
    #expect(
      FieldHistoryModel.slotWords(.resume, answer: "The folder is gone")
        == SessionSlotWords(word: "Resume", note: "The folder is gone"))
    // no answer in words is no answer
    #expect(FieldHistoryModel.slotWords(.resume, answer: "") == SessionSlotWords(word: "Resume", note: nil))
  }

  @Test("Jump to stands alone: a Resume's answer is not its own")
  func jump() {
    #expect(FieldHistoryModel.slotWords(.jump, answer: nil) == SessionSlotWords(word: "Jump to", note: nil))
    #expect(
      FieldHistoryModel.slotWords(.jump, answer: "Resuming on studio") == SessionSlotWords(word: "Jump to", note: nil))
  }

  @Test("an act that cannot be pressed says why after its word, whatever was answered before")
  func why() {
    #expect(
      FieldHistoryModel.slotWords(.why("asleep"), answer: nil) == SessionSlotWords(word: "Resume", note: "asleep"))
    #expect(
      FieldHistoryModel.slotWords(.why("asleep"), answer: "Resuming on studio")
        == SessionSlotWords(word: "Resume", note: "asleep"))
  }
}
