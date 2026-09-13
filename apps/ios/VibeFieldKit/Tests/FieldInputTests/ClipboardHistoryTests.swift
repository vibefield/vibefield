import Foundation
import Testing

@testable import FieldInput

/// The ring of pasted text: its cap, its de-duplication, and the fact that
/// nothing fills it except the card's own paste path.
@MainActor
@Suite("the clipboard history")
struct ClipboardHistoryTests {

  private func suite(_ name: String) -> UserDefaults {
    let full = "vf.tests.history.\(name)"
    UserDefaults().removePersistentDomain(forName: full)
    let defaults = UserDefaults(suiteName: full)!
    defaults.removePersistentDomain(forName: full)
    return defaults
  }

  @Test("it starts empty and stays empty until something is pasted")
  func startsEmpty() {
    #expect(ClipboardHistory(defaults: suite("empty")).entries.isEmpty)
  }

  @Test("newest first")
  func newestFirst() {
    let history = ClipboardHistory(defaults: suite("order"))
    history.record("one")
    history.record("two")
    #expect(history.entries == ["two", "one"])
  }

  /// Twenty. The twenty-first push drops the oldest rather than growing what
  /// this app keeps of somebody's clipboard.
  @Test("it holds twenty and drops the oldest")
  func ringCap() {
    let history = ClipboardHistory(defaults: suite("cap"))
    for index in 1...25 {
      history.record("line \(index)")
    }
    #expect(history.entries.count == ClipboardHistory.capacity)
    #expect(history.entries.first == "line 25")
    #expect(history.entries.last == "line 6")
  }

  /// The same text twice is one thing the user has, not two — and it moves to
  /// the front, because that is when it was last wanted.
  @Test("a repeat is moved, not added")
  func deDuplicates() {
    let history = ClipboardHistory(defaults: suite("dedup"))
    history.record("one")
    history.record("two")
    history.record("one")
    #expect(history.entries == ["one", "two"])
  }

  @Test("the immediate repeat is a no-op on the order")
  func repeatOfTheHead() {
    let history = ClipboardHistory(defaults: suite("head"))
    history.record("one")
    history.record("one")
    #expect(history.entries == ["one"])
  }

  @Test("empty text is not an entry")
  func ignoresEmpty() {
    let history = ClipboardHistory(defaults: suite("blank"))
    history.record("")
    #expect(history.entries.isEmpty)
  }

  @Test("what was recorded comes back from a fresh store")
  func roundTrip() {
    let defaults = suite("roundtrip")
    let history = ClipboardHistory(defaults: defaults)
    history.record("git push --force-with-lease")
    #expect(ClipboardHistory(defaults: defaults).entries == ["git push --force-with-lease"])
  }

  @Test("the swipe and CLEAR both persist")
  func removalPersists() {
    let defaults = suite("clear")
    let history = ClipboardHistory(defaults: defaults)
    history.record("one")
    history.record("two")
    history.delete(atOffsets: IndexSet(integer: 0))
    #expect(ClipboardHistory(defaults: defaults).entries == ["one"])
    history.clear()
    #expect(ClipboardHistory(defaults: defaults).entries.isEmpty)
  }

  // MARK: - The card's own feed

  /// The ring is fed by the card's paste path and by nothing else. Nothing
  /// here reads `UIPasteboard.general.string`, on a timer or otherwise — that
  /// is the alert the design's paste chip exists to avoid, and an app that
  /// polls for it is surveillance the OS is right to announce.
  @Test("a paste through the card is recorded")
  func acceptPasteRecords() {
    let model = InputCardModel()
    let history = ClipboardHistory(defaults: suite("card"))
    model.history = history
    model.acceptPaste("error: could not read Username")
    #expect(history.entries == ["error: could not read Username"])
  }

  /// A card with no ring installed — the demo fixture, and any host that has
  /// not asked for one — works exactly the same and records nothing.
  @Test("a card with no history still pastes")
  func historyIsOptional() {
    let model = InputCardModel()
    model.acceptPaste("git status")
    #expect(model.draft == "git status")
  }

  /// Tapping an old entry brings it back to the top, which is the same rule
  /// as pasting it again — because it is the same act.
  @Test("using an entry moves it to the front")
  func reuseReorders() {
    let model = InputCardModel()
    let history = ClipboardHistory(defaults: suite("reuse"))
    model.history = history
    model.acceptPaste("one")
    model.acceptPaste("two")
    model.acceptPaste("one")
    #expect(history.entries == ["one", "two"])
  }
}
