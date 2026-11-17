import FieldDesign
import SwiftUI

// Item 418 (James, 2026-11-14 08:13:38Z, session qa-01: "…there should be a clear pull down action like real world
// chat apps, you pull down for load more, there will be visual indicator when you pull down, there will be loading
// indicator when you release, all these motions should designs intuitively and nicely with clear feedbacks") — THE
// PULL, DRAWN: the mark over the gap the pull opens, and the rule under the document's head. The rule that decides
// both, and every number, is `HistoryOlderPull` (HistoryOlderPull.swift); nothing here decides anything. DESIGN.md
// §8 "The phone's session document", "The rows above are read in when you pull down at the top".
//
// HOW THE PAGE FEEDS IT. The pull is the scroll view's own travel past its top, the system's rubber band, read from
// the scroll's geometry and its phases (HistorySessionView.swift). No gesture of ours is added to the scroll view,
// so nothing here can take a touch from it, and the Apps door's pull, which the home screen offers on a root's list
// alone, is never in play on this pushed screen.

/// Item 418 — the pull's standing, held for the two views that draw it. Only the mark reads `mark`, and only the
/// line reads `reads` and `failed`, so a pull under the finger draws the mark again and never the document.
@MainActor
@Observable
final class HistoryOlderSight {
  /// What the mark over the document's top draws.
  private(set) var mark = HistoryOlderPull.Mark.nothing
  /// A read is owed or running, and the last read brought nothing: what the line at the top says.
  private(set) var reads = false
  private(set) var failed = false

  @ObservationIgnored private var pull = HistoryOlderPull()
  /// The wait for the read an ask is owed (`HistoryOlderPull.heardWithin`).
  @ObservationIgnored private var waiting: Task<Void, Never>?

  /// A finger came down on the page, or left it.
  func touch(_ down: Bool) {
    pull.touch(down)
    said()
  }

  /// The page stands `depth` past its top.
  func moved(to depth: CGFloat, ready: Bool) {
    pull.moved(to: depth, ready: ready)
    said()
  }

  /// The page came to rest. True when the batch above is to be asked for now.
  func rested(ready: Bool) -> Bool {
    let asks = pull.rested(ready: ready)
    said()
    if asks { wait() }
    return asks
  }

  /// A press asked for the batch above. True when it is to be asked for now.
  func pressed(ready: Bool) -> Bool {
    let asks = pull.pressed(ready: ready)
    said()
    if asks { wait() }
    return asks
  }

  /// The read began.
  func began() {
    pull.began()
    said()
  }

  /// The document's top moved.
  func landed() {
    pull.landed()
    said()
  }

  /// The read ended.
  func ended() {
    pull.ended()
    said()
  }

  /// What the pull answers now, written only where it changed: an observed property set to the value it holds
  /// would still draw its readers again.
  private func said() {
    let now = pull.mark
    if mark != now { mark = now }
    if reads != pull.reads { reads = pull.reads }
    if failed != pull.failed { failed = pull.failed }
  }

  /// An ask went out: if no read has begun `heardWithin` from now, the ask is ended, so the mark never turns for
  /// good over a document nothing reads.
  private func wait() {
    waiting?.cancel()
    waiting = Task { [weak self] in
      try? await Task.sleep(for: HistoryOlderPull.heardWithin)
      guard !Task.isCancelled, let self else { return }
      self.pull.unheard()
      self.said()
    }
  }
}

/// Item 418 — the mark over a session document's top: a glass pill, 36 pt high and 8 pt under the navigation
/// bar's foot, that comes in over the gap a pull opens. Its ring fills with the pull and its words say what the
/// finger is to do (`Pull down for earlier messages`); at the arm the ring is closed, its arrow turns up, a light
/// haptic ticks and it says `Release for earlier messages`; let go there it stays and says `Reading earlier
/// messages…` until the read ends, when it fades. It follows the finger with no animation of its own, and eases
/// only between its faces. It takes no touch and is not read out: the line under the document's head says the same
/// to VoiceOver, and takes its press.
///
/// Item 516 (P2; James, 2026-11-17 18:40:49Z, session vibe-field-d5: "all go with lean, work and land soon") — while
/// the batch is read the living mark stands in the ring's place, 40 wide and the ring's own height, moving while the
/// read does; the ring and the mark cross over the pill's own ease. The ring that measured the finger is no wait,
/// so it keeps the pull and the release. Until that item the ring stayed, an arc that turned.
struct HistoryOlderMark: View {
  let sight: HistoryOlderSight

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let mark = sight.mark
    let strong = HistoryOlderPull.strong(mark.face)
    ZStack {
      if let words = HistoryOlderPull.words(mark.face) {
        HStack(spacing: HistoryOlderPull.gap) {
          if mark.face == .reading {
            LivingMark(ground: LivingMark.Ground(scheme), width: HistoryOlderPull.markWidth)
              .transition(.opacity)
          } else {
            HistoryOlderRing(mark: mark, strong: strong)
              .transition(.opacity)
          }
          Text(words)
            .font(ChromeType.sans(HistoryOlderPull.type, .medium))
            .foregroundStyle(strong ? ChromePalette.ink : ChromePalette.inkSecondary)
            .lineLimit(1)
            .fixedSize()
        }
        .padding(.horizontal, HistoryOlderPull.padding)
        .frame(height: HistoryOlderPull.pill)
        .liquidGlassCapsule(interactive: false)
        .scaleEffect(reduceMotion ? 1 : HistoryOlderPull.size(presence: mark.presence), anchor: .top)
        .opacity(mark.presence)
        .transition(.opacity)
      }
    }
    .animation(FieldMotion.plainEase(HistoryOlderPull.fade), value: mark.face)
    .padding(.top, HistoryOlderPull.inset)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    // the tick at the arm: the texture the Apps door ticks with (impact, light)
    .sensoryFeedback(.impact(weight: .light), trigger: mark.face) { _, face in face == .armed }
  }
}

/// Item 418 — the ring in the mark: a faint track, and over it the ink that fills clockwise from twelve o'clock
/// with the pull. Inside it an arrow points down while the finger has further to go and up once letting go will
/// read. Item 516 — while a batch is read the living mark stands in its place (`HistoryOlderMark`); until that item
/// the arrow went and the ink was an arc that turned.
private struct HistoryOlderRing: View {
  let mark: HistoryOlderPull.Mark
  /// The primary ink: letting go will read.
  let strong: Bool

  var body: some View {
    let ink = strong ? ChromePalette.ink : ChromePalette.inkSecondary
    ZStack {
      Circle().strokeBorder(ChromePalette.ruleStrong, lineWidth: HistoryOlderPull.stroke)
      Circle()
        .inset(by: HistoryOlderPull.stroke / 2)
        .trim(from: 0, to: mark.fill)
        .stroke(ink, style: StrokeStyle(lineWidth: HistoryOlderPull.stroke, lineCap: .round))
        .rotationEffect(.degrees(-90))
      Image(systemName: "arrow.down")
        .font(.system(size: HistoryOlderPull.arrow, weight: .semibold))
        .foregroundStyle(ink)
        .rotationEffect(.degrees(mark.face == .armed ? 180 : 0))
    }
    .frame(width: HistoryOlderPull.ring, height: HistoryOlderPull.ring)
  }
}

/// Item 418 — the rule under a session document's head, which says where the rows above stand
/// (`HistoryOlderPull.top`): `Earlier · pull down` · `Reading earlier…` · `Couldn't read earlier · pull again` ·
/// `Earlier · needs studio` · `Session start · Sat 12 Sep`. It is SP-6's rule with a button in it, and where a
/// pull would read, a press on it reads too (`HistoryOlderPull.presses`), so the rows above never hang on a
/// gesture. It reads the pull's standing itself, so a read beginning or ending draws this line again and not the
/// document.
struct HistoryOlderLine: View {
  let sight: HistoryOlderSight
  /// Rows are above the document's top, and their desktop answers.
  let hasEarlier: Bool
  let awake: Bool
  /// The desktop's name, and the day the session began (`Sat 12 Sep`).
  let desktop: String
  let startDay: String
  /// A press on the line.
  let press: () -> Void

  var body: some View {
    let top = HistoryOlderPull.top(hasEarlier: hasEarlier, awake: awake, reading: sight.reads, failed: sight.failed)
    let words = HistoryOlderPull.line(top, startDay: startDay, desktop: desktop)
    switch top {
    case .start, .reading:
      RuleLine(text: words)
    case .pull, .failed, .asleep:
      let presses = HistoryOlderPull.presses(top)
      HStack(spacing: 10) {
        Rectangle().fill(ChromePalette.ruleStrong).frame(height: 1)
        Button(action: press) {
          Text(words)
            .font(ChromeType.sans(10.5, .medium))
            .textCase(.uppercase)
            .tracking(ChromeType.tracking(0.07, of: 10.5))
            .foregroundStyle(presses ? ChromePalette.inkSecondary : ChromePalette.inkTertiary)
            .fixedSize()
        }
        .buttonStyle(.plain)
        .disabled(!presses)
        .accessibilityLabel(HistoryOlderPull.spoken(top, desktop: desktop) ?? words)
        Rectangle().fill(ChromePalette.ruleStrong).frame(height: 1)
      }
      .padding(.vertical, 18)
    }
  }
}
