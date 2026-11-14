import FieldDesign
import SwiftUI

// Item 417 (James, 2026-11-14 08:13:38Z, session qa-01: "message view initial loading should adopt latest desktop
// design that uses our logo mark") — A SESSION'S FIRST READING IS THE HOLD. While a session's document is first
// read from its desktop, its page is the hold the desktop's History stands a conversation's wait in: the mark at the
// centre of the page's place and the room's line under it. DESIGN.md §8 "The phone's session document", "Its first
// reading is the hold"; the motion is §6's "History's holds".
//
// The rule is pure: when a page waits, what the hold says, how long it is late, how long it stands, and every
// figure of its fades and its box. The views under it draw what the rule answers. The figures are the desktop's
// (rosetta's room, `hold.css` and `use-standing-hold.ts`), so one of them changed here is changed against it.
//
// The mark is the launch's still, at rest, and that is short of the desktop, where the mark turns while the work
// moves. The phone's moving mark is the splash's own drawing (FieldSplash), which this module does not take, and
// the design kit has none. The still is the app's own asset, read by its name as the splash reads it.

/// The hold a session's first reading stands in.
enum HistoryOpening {
  /// What a session's page waits on.
  enum Wait: Equatable, Sendable {
    /// Its document is being read.
    case loading
    /// Its document is being read for the message a search landed on.
    case finding
  }

  /// What a hold does once its wait is over.
  enum After: Equatable, Sendable {
    /// It never began to show: nothing stands, and nothing leaves.
    case gone
    /// It stands on for what is left of its floor, and then leaves.
    case stands(Duration)
    /// It leaves now.
    case leaves
  }

  /// Nothing shows for this long: a session read sooner shows no hold at all.
  static let late: Duration = .milliseconds(120)
  /// A hold that has begun to show stands at least this long: the mark's coming in, then a beat to read the line.
  /// So a hold never flashes.
  static let floor: Duration = .milliseconds(800)

  /// The mark's box, the desktop's. The launch's still is drawn at its own size on the box's centre: its ∞ is
  /// about 95 pt wide, and the clear margin it carries hangs over the box's edges, where nothing else stands.
  static let markBox = CGSize(width: 99, height: 44)
  /// The line's distance under the mark's box.
  static let wordsUnder: CGFloat = 26
  /// The line's size: 14 regular, in the secondary ink.
  static let lineSize: CGFloat = 14
  /// What the hold keeps clear at each side of its place.
  static let side: CGFloat = 24
  /// The launch's still of the mark, by its name in the app's own asset catalog: black ink by day, white by night
  /// (DESIGN.md §8 "The phone's splash"). A host without the app's assets (a test's, a preview's) draws no mark.
  static let markAsset = "SplashMark"

  /// What the page of a session waits on: whether its document is `held`, whether its desktop is `awake`, and
  /// whether a search `landed` in it. A session whose document is held has no hold. Neither has one whose desktop
  /// does not answer: the page's own note says so, and that is no wait.
  static func wait(held: Bool, awake: Bool, landed: Bool) -> Wait? {
    guard !held, awake else { return nil }
    return landed ? .finding : .loading
  }

  /// The hold's line, in the room's words.
  static func line(_ wait: Wait) -> String {
    switch wait {
    case .loading: return "Loading messages…"
    case .finding: return "Finding message…"
    }
  }

  /// What a hold does once its wait is over, having shown for `shownFor`; nil never began to show.
  static func after(shownFor: Duration?) -> After {
    guard let shownFor else { return .gone }
    return shownFor < floor ? .stands(floor - shownFor) : .leaves
  }

  /// The mark's fade in, in seconds, on the plain ease.
  static func markIn(reduceMotion: Bool) -> Double {
    reduceMotion ? 0.16 : 0.4
  }

  /// The line's fade in, in seconds, on the plain ease.
  static func wordsIn(reduceMotion: Bool) -> Double {
    reduceMotion ? 0.12 : 0.18
  }

  /// The hold's fade out, in seconds, on the plain ease.
  static func leave(reduceMotion: Bool) -> Double {
    reduceMotion ? 0.12 : 0.28
  }
}

extension View {
  /// Item 417 — over a pushed screen: the hold, while `wait` says the screen's session is being read
  /// (`HistoryOpening.wait`). It is late to show. Once it has shown it stands out its floor over whatever the
  /// screen has become, and then fades from over it. A screen that never waits is not touched.
  func historyOpening(_ wait: HistoryOpening.Wait?) -> some View {
    modifier(HistoryOpeningModifier(wait: wait))
  }
}

/// The hold over its screen, following its wait. Every time and every decision is `HistoryOpening`'s.
private struct HistoryOpeningModifier: ViewModifier {
  let wait: HistoryOpening.Wait?

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// When the hold began to show; nil while none stands.
  @State private var shownAt: ContinuousClock.Instant?
  /// The hold is on its way out.
  @State private var leaving = false
  /// The wait whose words the hold says: the last one, kept while the hold stands out its floor and leaves.
  @State private var said = HistoryOpening.Wait.loading

  func body(content: Content) -> some View {
    content
      .overlay {
        if shownAt != nil {
          HistoryOpeningFace(line: HistoryOpening.line(wait ?? said))
            .opacity(leaving ? 0 : 1)
            // whole, it takes the touch: nothing under it is seen. Leaving, the screen under it is the reader's.
            .allowsHitTesting(!leaving)
        }
      }
      .onChange(of: wait, initial: true) { _, now in
        if let now { said = now }
      }
      .task(id: wait != nil) { await follow() }
  }

  /// One turn of the wait, on or off. On: the hold shows once it is late, unless the wait is over first. Off: a
  /// hold that has shown stands out its floor and leaves (`HistoryOpening.after`).
  private func follow() async {
    if wait != nil {
      guard shownAt == nil else {
        // a wait again under a hold that still stands: it stays, on the clock it has
        if leaving {
          withAnimation(FieldMotion.plainEase(HistoryOpening.leave(reduceMotion: reduceMotion))) { leaving = false }
        }
        return
      }
      try? await Task.sleep(for: HistoryOpening.late)
      guard !Task.isCancelled else { return }
      shownAt = .now
      return
    }
    switch HistoryOpening.after(shownFor: shownAt.map { ContinuousClock.now - $0 }) {
    case .gone:
      return
    case .stands(let left):
      try? await Task.sleep(for: left)
      guard !Task.isCancelled else { return }
    case .leaves:
      break
    }
    let leave = HistoryOpening.leave(reduceMotion: reduceMotion)
    withAnimation(FieldMotion.plainEase(leave)) { leaving = true }
    try? await Task.sleep(for: .seconds(leave))
    guard !Task.isCancelled else { return }
    shownAt = nil
    leaving = false
  }
}

/// The hold drawn: rows `1fr | the mark | 1fr`, so the mark stands at the centre of its place whatever is said
/// under it, and the line at the top of the third row. Its ground is the page's paper, whole, so a document laid out
/// under it is not seen until the hold leaves. The mark and the line come in when the hold is first drawn, each
/// over its own time; the mark only ever fades.
private struct HistoryOpeningFace: View {
  let line: String

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The home screen's measures: the hold's place ends at the top of what stands over the page's foot.
  @Environment(\.rootHead) private var rootHead
  @State private var markShown = false
  @State private var wordsShown = false

  var body: some View {
    VStack(spacing: 0) {
      Color.clear
      Image(HistoryOpening.markAsset, bundle: .main)
        .frame(width: HistoryOpening.markBox.width, height: HistoryOpening.markBox.height)
        .opacity(markShown ? 1 : 0)
      Color.clear
        .overlay(alignment: .top) {
          Text(line)
            .font(ChromeType.sans(HistoryOpening.lineSize))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1)
            .padding(.top, HistoryOpening.wordsUnder)
            .opacity(wordsShown ? 1 : 0)
        }
    }
    .padding(.horizontal, HistoryOpening.side)
    .padding(.bottom, rootHead.bar)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ChromePalette.paper.ignoresSafeArea())
    // the mark is decoration: the line says what loads
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(line)
    .onAppear {
      withAnimation(FieldMotion.plainEase(HistoryOpening.markIn(reduceMotion: reduceMotion))) { markShown = true }
      withAnimation(FieldMotion.plainEase(HistoryOpening.wordsIn(reduceMotion: reduceMotion))) { wordsShown = true }
    }
  }
}
