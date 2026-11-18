import FieldDesign
import SwiftUI

// Item 417 (asked for 2026-11-14: a message view's first load adopts the desktop's latest design, the one with
// our logo mark) — A SESSION'S FIRST READING IS THE HOLD. While a session's document is first
// read from its desktop, its page is the hold the desktop's History stands a conversation's wait in: the mark at the
// centre of the page's place and the room's line under it. DESIGN.md §8 "The phone's session document", "Its first
// reading is the hold"; the motion is §6's "History's holds".
//
// The rule is pure: when a page waits, what the hold says, how long it is late, how long it stands, and every
// figure of its fades and its box. The views under it draw what the rule answers. The figures are the desktop's
// (rosetta's room, `hold.css` and `use-standing-hold.ts`), so one of them changed here is changed against it.
//
// Item 417b (2026-11-14) — the mark is the design kit's living mark (`LivingMark`, FieldDesign), which moves as the
// desktop's does: it is the desktop's generated SVG, drawn by the phone. Until that item the hold wore the
// launch's still (`SplashMark`, the app's own asset), at rest, which by the desktop's rule says a wait is paused.
//
// Item 516 (asked for 2026-11-17: the phone's History loads in the living mark) — HISTORY'S OWN WAITS STAND IN THE SAME
// HOLD. The ledger's first read (P1) and a project's
// list of sessions (P3) hold where a sentence stood at the top left, and with no desktop answering and nothing kept
// the ledger's place holds with the mark at rest (P4; HG-L1, motion means working). A hold is CARRIED: while its
// wait goes on in other words the mark stays and only the line changes, and a count or the desktop stands under the
// line. DESIGN.md §8 "The phone's History waits in the hold".

/// The hold a session's first reading stands in, and since item 516 every wait of History's that fills a place.
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

  /// Item 516 — what a hold says: its line, what stands under it (a count, or where the words come from), and
  /// whether its work moves.
  struct Words: Equatable, Sendable {
    let line: String
    var sub: String? = nil
    /// Nothing is working: the mark stands still, in the pose it rests in (HG-L1).
    var resting = false
  }

  /// Item 516 — where a hold stands over what it holds.
  enum Place: Equatable, Sendable {
    /// Over a pushed screen: its place ends over what stands at the page's foot, and it takes the touch, since
    /// nothing under it is seen (a session's first reading).
    case pushed
    /// Over a root page, between its head and its foot (the ledger). It takes no touch, so the page's own pulls work.
    case root
    /// In a box this tall at the top of what it stands over (a project's list of sessions). It takes no touch.
    case box(CGFloat)
  }

  /// Nothing shows for this long: a session read sooner shows no hold at all.
  static let late: Duration = .milliseconds(120)
  /// A hold that has begun to show stands at least this long: the mark's coming in, then a beat to read the line.
  /// So a hold never flashes.
  static let floor: Duration = .milliseconds(800)

  /// The mark's box, the desktop's: the living mark's own size, 99 by 44, its ∞ about 94 pt wide in it.
  static let markBox = LivingMark.size
  /// The line's distance under the mark's box.
  static let wordsUnder: CGFloat = 26
  /// The line's size: 14 regular, in the secondary ink.
  static let lineSize: CGFloat = 14
  /// Item 516 — what stands under the line, this far under it: 12.5 regular and tabular, in the tertiary ink.
  static let subUnder: CGFloat = 4
  static let subSize: CGFloat = 12.5
  /// What the hold keeps clear at each side of its place.
  static let side: CGFloat = 24
  /// Item 516 — a line that changes under a hold that stands goes over this long, and the next comes in over this
  /// long after it; the mark does not move from its place.
  static let lineOut: Double = 0.14
  static let lineIn: Double = 0.24
  /// Item 516 — the box a project's list of sessions holds in, at the top of the list: the mark at its middle, and
  /// room under it for the line and the desktop.
  static let listBox: CGFloat = 280

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

  /// Item 516 — a session's hold says its line alone, and its mark moves.
  static func words(_ wait: Wait) -> Words {
    Words(line: line(wait))
  }

  /// Item 516 (P1, P4) — what the ledger's place holds while it shows no project, or nil where it holds nothing and
  /// its own note says what is there.
  /// - No desktop answers (`asleep`) and nothing was kept: the hold's place, the mark at rest, and why.
  /// - Its door answers: while the desktop's History starts, updates or reads, the hold in the Setup Assistant's
  ///   words, the desktop (or the count) under the line; before the door has answered the listing once, "Opening
  ///   History…". An index that stopped, failed or keeps no history is no wait, and neither is a ledger the door
  ///   has answered empty.
  /// - A desktop that speaks another VibeField is no wait: the head says so.
  /// A ledger with a project never holds: what the phone kept, or read, opens at once.
  static func ledger(
    hasProjects: Bool, standing: FieldHistoryModel.DesktopStanding, answered: Bool,
    index: FieldHistoryModel.IndexStanding?, desktop: String
  ) -> Words? {
    guard !hasProjects else { return nil }
    switch standing {
    case .asleep:
      return Words(line: "No desktop is answering", sub: "History opens when one wakes.", resting: true)
    case .incompatible:
      return nil
    case .connected, .indexing:
      break
    }
    switch index {
    case .starting?:
      return Words(line: "Finding your history…", sub: "on \(desktop)")
    case .rebuilding?:
      return Words(line: "Updating your history…", sub: "on \(desktop)")
    case .indexing(_, let done, let total)?:
      return Words(line: "Discovering conversations…", sub: "\(done) of \(total) sessions on \(desktop)")
    case .failed?, .unconfigured?, .stopped?:
      return nil
    case nil, .ready?:
      return answered ? nil : Words(line: "Opening History…")
    }
  }

  /// Item 516 (P3) — a project's list while none of its sessions has arrived and its desktop answers: the hold, in
  /// the list's box, saying where they come from. Asleep, the list's note says what it waits for, and that is no
  /// wait.
  static func sessions(listed: Bool, awake: Bool, desktop: String) -> Words? {
    guard !listed, awake else { return nil }
    return Words(line: "Reading the conversations…", sub: "from \(desktop)")
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
    historyHold(wait.map(HistoryOpening.words), place: .pushed)
  }

  /// Item 516 — the hold, at `place` over this view, while `words` says it waits; nil says it does not. It is late,
  /// and stands out its floor, as a session's does. While the wait goes on in other words the hold is carried: the
  /// mark stays and the line changes.
  func historyHold(_ words: HistoryOpening.Words?, place: HistoryOpening.Place) -> some View {
    modifier(HistoryOpeningModifier(words: words, place: place))
  }
}

/// The hold over its place, following its wait. Every time and every decision is `HistoryOpening`'s.
private struct HistoryOpeningModifier: ViewModifier {
  let words: HistoryOpening.Words?
  let place: HistoryOpening.Place

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// When the hold began to show; nil while none stands.
  @State private var shownAt: ContinuousClock.Instant?
  /// The hold is on its way out.
  @State private var leaving = false
  /// The words the hold says: the last a wait said, kept while the hold stands out its floor and leaves.
  @State private var said = HistoryOpening.Words(line: "")

  func body(content: Content) -> some View {
    content
      .overlay(alignment: .top) {
        if shownAt != nil {
          face
            .opacity(leaving ? 0 : 1)
            // whole over a pushed screen, it takes the touch: nothing under it is seen. Leaving, the screen under it
            // is the reader's. Over a root page or in a box it takes none.
            .allowsHitTesting(place == .pushed && !leaving)
        }
      }
      .onChange(of: words, initial: true) { _, now in
        if let now { said = now }
      }
      .task(id: words != nil) { await follow() }
  }

  /// The hold drawn at its place: the whole place, or a box at the top of it.
  @ViewBuilder private var face: some View {
    let shown = words ?? said
    switch place {
    case .box(let height):
      HistoryOpeningFace(words: shown, clearsBar: false)
        .frame(height: height)
    case .pushed:
      HistoryOpeningFace(words: shown, clearsBar: true)
    case .root:
      HistoryOpeningFace(words: shown, clearsBar: false)
    }
  }

  /// One turn of the wait, on or off. On: the hold shows once it is late, unless the wait is over first. Off: a
  /// hold that has shown stands out its floor and leaves (`HistoryOpening.after`).
  private func follow() async {
    if words != nil {
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
/// under it, and the line at the top of the third row, with what stands under it (item 516). Its ground is the
/// page's paper, whole, so a page laid out under it is not seen until the hold leaves. The mark and the words come
/// in when the hold is first drawn, each over its own time; the mark only ever fades.
///
/// Item 417b — the mark is the kit's living mark, on the ground the page's scheme is: black ink by day, white by
/// night. It moves from the moment it is first drawn, under its fade. Reduce Motion rests it, by the mark's own rule,
/// and so does a hold whose work is not moving (item 516, `resting`).
///
/// Item 516 — a line that changes while the hold stands goes and the next comes, each over its own time
/// (`HistoryOpening.lineOut`, `lineIn`); what stands under it only changes, as a count does.
private struct HistoryOpeningFace: View {
  let words: HistoryOpening.Words
  /// Over a pushed page: its place ends at the top of what stands over the page's foot.
  let clearsBar: Bool

  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The home screen's measures: the hold's place ends at the top of what stands over the page's foot.
  @Environment(\.rootHead) private var rootHead
  @State private var markShown = false
  @State private var wordsShown = false

  /// A changed line: the old one goes, then the new one comes.
  private var lineTurn: AnyTransition {
    .asymmetric(
      insertion: .opacity.animation(FieldMotion.plainEase(HistoryOpening.lineIn).delay(HistoryOpening.lineOut)),
      removal: .opacity.animation(FieldMotion.plainEase(HistoryOpening.lineOut)))
  }

  var body: some View {
    VStack(spacing: 0) {
      Color.clear
      LivingMark(ground: LivingMark.Ground(scheme), width: HistoryOpening.markBox.width, resting: words.resting)
        .frame(width: HistoryOpening.markBox.width, height: HistoryOpening.markBox.height)
        .opacity(markShown ? 1 : 0)
      Color.clear
        .overlay(alignment: .top) {
          VStack(spacing: HistoryOpening.subUnder) {
            Text(words.line)
              .font(ChromeType.sans(HistoryOpening.lineSize))
              .monospacedDigit()
              .foregroundStyle(ChromePalette.inkSecondary)
              .lineLimit(1)
              .id(words.line)
              .transition(lineTurn)
            if let sub = words.sub {
              Text(sub)
                .font(ChromeType.sans(HistoryOpening.subSize))
                .monospacedDigit()
                .foregroundStyle(ChromePalette.inkTertiary)
                .lineLimit(1)
            }
          }
          .padding(.top, HistoryOpening.wordsUnder)
          .opacity(wordsShown ? 1 : 0)
        }
    }
    .padding(.horizontal, HistoryOpening.side)
    .padding(.bottom, clearsBar ? rootHead.bar : 0)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ChromePalette.paper.ignoresSafeArea())
    // the mark is decoration: the words say what loads
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(words.sub.map { "\(words.line) \($0)" } ?? words.line)
    .onAppear {
      withAnimation(FieldMotion.plainEase(HistoryOpening.markIn(reduceMotion: reduceMotion))) { markShown = true }
      withAnimation(FieldMotion.plainEase(HistoryOpening.wordsIn(reduceMotion: reduceMotion))) { wordsShown = true }
    }
  }
}
