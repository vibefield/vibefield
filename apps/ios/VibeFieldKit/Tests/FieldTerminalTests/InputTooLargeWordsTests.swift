import FieldRoutedTerminal
import Testing

@testable import FieldTerminal

/// The History lead's D6 (2026-10-17) — an input too large for the link is SAID,
/// in the desktop's own sentence and its numbers, never dropped: its size and how
/// much of it one paste carries, both counted in thousands as Finder counts them
/// (DESIGN.md §9), the size rounded up and what fits down.
@Suite struct InputTooLargeWordsTests {
  @Test("the desktop's sentence, for a paste and for typed text")
  func theSentences() {
    #expect(
      TerminalAttachment.inputTooLargeNote(.init(kind: .pasted, bytes: 300_000, fits: 261_843))
        == "Not pasted into the terminal — 300 KB, and one paste carries 261 KB of it")
    #expect(
      TerminalAttachment.inputTooLargeNote(.init(kind: .typed, bytes: 299_001, fits: 261_999))
        == "Not typed into the terminal — 300 KB, and typed text carries 261 KB of it")
  }

  @Test("sizes in thousands: the size up, what fits down, the unit after the rounding")
  func sizes() {
    #expect(TerminalAttachment.sizeWords(1, up: true) == "1 byte")
    #expect(TerminalAttachment.sizeWords(512, up: false) == "512 bytes")
    #expect(TerminalAttachment.sizeWords(1_001, up: true) == "2 KB")
    #expect(TerminalAttachment.sizeWords(1_999, up: false) == "1 KB")
    #expect(TerminalAttachment.sizeWords(999_999, up: true) == "1 MB")
    #expect(TerminalAttachment.sizeWords(1_250_001, up: true) == "1.3 MB")
    #expect(TerminalAttachment.sizeWords(1_250_001, up: false) == "1.2 MB")
    #expect(TerminalAttachment.sizeWords(4_000_000, up: false) == "4 MB")
    #expect(TerminalAttachment.sizeWords(1_500_000_000, up: true) == "1.5 GB")
  }
}
