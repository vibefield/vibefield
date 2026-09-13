import Foundation
import Testing

@testable import FieldInput

/// The snippet store, against a real `UserDefaults` on an injected suite.
///
/// A fake would test the array and skip the half that actually breaks: the
/// encoder, the key, and whether what was written can be read back by a store
/// built fresh — which is what every launch after the first one does.
@MainActor
@Suite("saving snippets")
struct SnippetStoreTests {

  /// A suite per test, wiped either side, so nothing here can see another
  /// test's writes or the machine's own defaults.
  private func suite(_ name: String) -> UserDefaults {
    let full = "vf.tests.snippets.\(name)"
    UserDefaults().removePersistentDomain(forName: full)
    let defaults = UserDefaults(suiteName: full)!
    defaults.removePersistentDomain(forName: full)
    return defaults
  }

  @Test("nothing is seeded")
  func startsEmpty() {
    #expect(SnippetStore(defaults: suite("empty")).snippets.isEmpty)
  }

  @Test("a saved snippet comes back from a fresh store")
  func roundTrip() {
    let defaults = suite("roundtrip")
    let store = SnippetStore(defaults: defaults)
    store.add(Snippet(title: "STATUS", text: "git status --short", sendsEnter: true))

    let reopened = SnippetStore(defaults: defaults)
    #expect(reopened.snippets.count == 1)
    #expect(reopened.snippets[0].title == "STATUS")
    #expect(reopened.snippets[0].text == "git status --short")
    #expect(reopened.snippets[0].sendsEnter)
  }

  /// Newest first: the thing just written down is the thing about to be used.
  @Test("the newest is on top")
  func newestFirst() {
    let store = SnippetStore(defaults: suite("order"))
    store.add(Snippet(title: "ONE", text: "one", sendsEnter: false))
    store.add(Snippet(title: "TWO", text: "two", sendsEnter: false))
    #expect(store.snippets.map(\.title) == ["TWO", "ONE"])
  }

  @Test("an edit is kept in place and persisted")
  func updateInPlace() {
    let defaults = suite("update")
    let store = SnippetStore(defaults: defaults)
    let snippet = Snippet(title: "OLD", text: "one", sendsEnter: false)
    store.add(snippet)
    store.add(Snippet(title: "OTHER", text: "two", sendsEnter: false))
    store.update(Snippet(id: snippet.id, title: "NEW", text: "one!", sendsEnter: true))

    #expect(store.snippets.map(\.title) == ["OTHER", "NEW"])
    #expect(SnippetStore(defaults: defaults).snippets.last?.text == "one!")
  }

  @Test("a delete is a delete, on disk too")
  func deletePersists() {
    let defaults = suite("delete")
    let store = SnippetStore(defaults: defaults)
    let snippet = Snippet(title: "GONE", text: "rm -rf", sendsEnter: false)
    store.add(snippet)
    store.delete(snippet)
    #expect(store.snippets.isEmpty)
    #expect(SnippetStore(defaults: defaults).snippets.isEmpty)
  }

  @Test("the swipe deletes by row")
  func deleteByOffset() {
    let store = SnippetStore(defaults: suite("offsets"))
    store.add(Snippet(title: "ONE", text: "one", sendsEnter: false))
    store.add(Snippet(title: "TWO", text: "two", sendsEnter: false))
    store.delete(atOffsets: IndexSet(integer: 0))
    #expect(store.snippets.map(\.title) == ["ONE"])
  }

  /// A defaults value written by an older build is an empty list, not a
  /// crash — the tolerant-reader law, one store down.
  @Test("junk under the key reads as no snippets")
  func tolerantRead() {
    let defaults = suite("junk")
    defaults.set(Data("not json".utf8), forKey: SnippetStore.defaultsKey)
    #expect(SnippetStore(defaults: defaults).snippets.isEmpty)
  }

  @Test("the row's second line is the snippet's first")
  func firstLine() {
    let snippet = Snippet(title: "T", text: "one\ntwo", sendsEnter: false)
    #expect(snippet.firstLine == "one")
  }
}

/// What tapping a snippet does — which is a different thing in each mode, and
/// a different thing again when it is long enough to be a program.
@MainActor
@Suite("using a snippet")
struct UseSnippetTests {
  final class Recorder {
    var acts: [InputAct] = []
  }

  private func card() -> (InputCardModel, Recorder) {
    let model = InputCardModel()
    let recorder = Recorder()
    model.sink = { recorder.acts.append($0) }
    return (model, recorder)
  }

  private let short = Snippet(title: "S", text: "git status", sendsEnter: true)
  private let quiet = Snippet(title: "Q", text: "ssh studio", sendsEnter: false)
  private let long = Snippet(
    title: "L", text: "one\ntwo\nthree\nfour\nfive", sendsEnter: true)

  /// Draft NEVER sends, whatever the snippet says: the whole point of the mode
  /// is that the user finishes the line themselves.
  @Test("in Draft it lands in the draft, even when it sends Enter")
  func draftNeverSends() {
    let (model, recorder) = card()
    model.useSnippet(short)
    #expect(model.draft == "git status")
    #expect(recorder.acts.isEmpty)
  }

  /// It appends on its own line, like every other text this card accepts: the
  /// two halves were composed apart and running them together is never meant.
  @Test("it appends to a draft already in progress")
  func draftAppends() {
    let (model, _) = card()
    model.draft = "cd /tmp"
    model.useSnippet(quiet)
    #expect(model.draft == "cd /tmp\nssh studio")
  }

  /// A snippet is already saved under `+`; listing it back as something the
  /// user "pasted" would be the history repeating itself.
  @Test("a snippet does not enter the clipboard history")
  func snippetsAreNotPastes() {
    let (model, _) = card()
    let history = ClipboardHistory(defaults: UserDefaults(suiteName: "vf.tests.snip.history")!)
    history.clear()
    model.history = history
    model.useSnippet(quiet)
    #expect(history.entries.isEmpty)
  }

  @Test("in the other mode, sends Enter means run")
  func liveRuns() {
    let (model, recorder) = card()
    model.toggleMode()
    model.useSnippet(short)
    #expect(recorder.acts == [.sendDraft("git status")])
  }

  /// Without the mark it is typed and left for the user to finish — which is
  /// exactly what a half-written `ssh ` is for.
  @Test("without the mark it is typed and not run")
  func liveTypes() {
    let (model, recorder) = card()
    model.toggleMode()
    model.useSnippet(quiet)
    #expect(recorder.acts == [.typeText("ssh studio")])
  }

  /// Five lines is where a snippet stops being a command and starts being a
  /// program — the same threshold, and the same danger, as a long paste.
  @Test("five lines goes through the review, carrying what SEND will do")
  func longGoesThroughReview() {
    let (model, recorder) = card()
    model.toggleMode()
    model.useSnippet(long)
    #expect(recorder.acts.isEmpty)
    #expect(model.pendingPasteReview?.text == long.text)
    #expect(model.pendingPasteReview?.commit == .run)

    model.confirmPasteReview()
    #expect(recorder.acts == [.sendDraft(long.text)])
  }

  @Test("a long snippet without the mark reviews as a typed block")
  func longQuietSnippet() {
    let (model, recorder) = card()
    model.toggleMode()
    model.useSnippet(
      Snippet(title: "L", text: "a\nb\nc\nd\ne", sendsEnter: false))
    #expect(model.pendingPasteReview?.commit == .type)
    model.confirmPasteReview()
    #expect(recorder.acts == [.typeText("a\nb\nc\nd\ne")])
  }

  /// A paste is still a paste: IOS-5c's own path must not have changed under
  /// it when the commit was added.
  @Test("a reviewed PASTE still commits as a paste")
  func pasteStillPastes() {
    let (model, recorder) = card()
    model.toggleMode()
    model.acceptPaste("a\nb\nc\nd\ne")
    #expect(model.pendingPasteReview?.commit == .paste)
    model.confirmPasteReview()
    #expect(recorder.acts == [.paste("a\nb\nc\nd\ne")])
  }

  @Test("an empty snippet does nothing at all")
  func emptySnippet() {
    let (model, recorder) = card()
    model.toggleMode()
    model.useSnippet(Snippet(title: "E", text: "", sendsEnter: true))
    #expect(recorder.acts.isEmpty)
  }
}
