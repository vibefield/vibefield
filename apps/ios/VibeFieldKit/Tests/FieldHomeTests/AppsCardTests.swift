import CoreGraphics
import SwiftUI
import Testing

@testable import FieldHome

/// Item 348 (DESIGN.md §8 "The phone's Apps": "One pull on every tab", "As you pull", "Open", "The first peek") —
/// where the one pull may begin on each tab, and the one card the tabs stand in, by the finger's travel: its numbers,
/// its outline and where it is drawn. How it looks under a finger is to be seen on a device; the answers are in the
/// item's commit.
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first.
@Suite("item 348 — one pull on every tab, and the one card it moves")
@MainActor
struct AppsCardTests {
  private static let safeTop: CGFloat = 59
  /// The pages' bounds on an iPhone 17 Pro: its 874 points less the 62 and 34 of its safe area.
  private let bounds = CGRect(x: 0, y: 0, width: 402, height: 778)

  private static func begins(
    _ ground: AppsPull.Ground, y: CGFloat = 400, down: CGFloat = 40, across: CGFloat = 0
  ) -> Bool {
    AppsPull.begins(
      start: CGPoint(x: 200, y: y), translation: CGSize(width: across, height: down), safeTop: safeTop,
      ground: ground)
  }

  // MARK: - Where the pull begins

  @Test("on Field's swarm the pull starts anywhere under the status bar, but never on a touch the swarm has taken")
  func swarm() {
    #expect(Self.begins(.swarm(taken: false)))
    #expect(Self.begins(.swarm(taken: false), y: 70), "on the Stories row, on a circle or between two")
    #expect(Self.begins(.swarm(taken: false), y: 800))
    #expect(Self.begins(.swarm(taken: true)) == false, "a bubble keeps its finger, and a bloom its own")
    #expect(Self.begins(.swarm(taken: false), y: 40) == false, "the status bar's is the system's")
  }

  @Test("on another Godview view the pull starts in the Stories row's band, down to its reserve")
  func band() {
    #expect(Self.begins(.band(reserve: 108), y: 80))
    #expect(Self.begins(.band(reserve: 108), y: 108))
    #expect(Self.begins(.band(reserve: 108), y: 109) == false, "under the row the view scrolls and scrubs")
    #expect(Self.begins(.band(reserve: 108), y: 40) == false, "the status bar's is the system's")
  }

  @Test("on History and Chat the pull starts anywhere while the root list stands at its top")
  func list() {
    #expect(Self.begins(.list(atTop: true)))
    #expect(Self.begins(.list(atTop: true), y: 800))
    #expect(Self.begins(.list(atTop: false)) == false, "a list scrolled down scrolls")
    #expect(Self.begins(.list(atTop: true), y: 40) == false, "the status bar's is the system's")
  }

  @Test("on every ground the drag is the door's once it is 12 down and more than twice as far down as across")
  func travel() {
    let grounds: [(ground: AppsPull.Ground, y: CGFloat)] = [
      (.swarm(taken: false), 400), (.band(reserve: 108), 80), (.list(atTop: true), 400),
    ]
    for (ground, y) in grounds {
      #expect(Self.begins(ground, y: y, down: 11) == false, "\(ground): not yet 12 down")
      #expect(Self.begins(ground, y: y, down: 12), "\(ground)")
      #expect(Self.begins(ground, y: y, down: 40, across: 20) == false, "\(ground): not twice as far down as across")
      #expect(Self.begins(ground, y: y, down: 41, across: 20), "\(ground)")
    }
  }

  // MARK: - The card by the finger's travel

  @Test("pulled, the card's top follows the finger while it shrinks toward 0.92 and its corners round toward 44")
  func pulled() {
    let rest = AppsPull.Card.pulled(0)
    #expect(rest == .rest)

    let half = AppsPull.Card.pulled(66)
    #expect(half.offset == 66)
    #expect(abs(half.scale - 0.96) < 1e-9)
    #expect(half.radius == 22)
    #expect(half.shade == 0.5)

    let commit = AppsPull.Card.pulled(132)
    #expect(commit.offset == 132)
    #expect(abs(commit.scale - 0.92) < 1e-9)
    #expect(commit.radius == 44)
    #expect(commit.shade == 1)

    let past = AppsPull.Card.pulled(432)
    #expect(past.offset == 232, "past the commit its top follows at a third")
    #expect(past.scale == commit.scale)
    #expect(past.radius == 44)
    #expect(past.shade == 1)
  }

  @Test("open, the card shows 106 above the home indicator's inset; the first peek stands 136 down, as at the commit")
  func standing() {
    let open = AppsPull.Card.receded(bounds: 778, safeTop: 62)
    // Hoisted into a typed `let` (mini-kit362a, 2026-11-14): #expect reads each side of its comparison alone, and a
    // side that is nothing but integer literals is read as an Int, which a CGFloat never equals. The row said
    // `open.offset == 62 + 778 - 106` and answered false with 734.0 on its left and 734 on its right.
    let shown: CGFloat = 62 + 778 - 106
    #expect(open.offset == shown)
    #expect(open.scale == 0.92)
    #expect(open.radius == 44)
    #expect(open.shade == 1)

    let peek = AppsPull.Card.peek
    #expect(peek.offset == 136)
    #expect(peek.scale == 0.92)
    #expect(peek.radius == 44)
    #expect(peek.shade == 1)

    let opened = AppsPull.Card.standing(open: true, peeking: true, drag: 50, bounds: 778, safeTop: 62)
    #expect(opened == open, "the open shelf's card outranks a peek and a pull")
    let peeking = AppsPull.Card.standing(open: false, peeking: true, drag: 50, bounds: 778, safeTop: 62)
    #expect(peeking == peek)
    let resting = AppsPull.Card.standing(open: false, peeking: false, drag: 0, bounds: 778, safeTop: 62)
    #expect(resting == .rest)
  }

  // MARK: - Its outline, and where it is drawn

  @Test("pulled, the card is the whole screen: its top is the screen's, its top corners round, its foot is not cut")
  func outline() {
    let clip = AppsCardShape(card: .pulled(132), safeTop: 62).path(in: bounds)
    #expect(clip.contains(CGPoint(x: 201, y: -61)), "the status bar's band of the page is the card's")
    #expect(!clip.contains(CGPoint(x: 201, y: -63)))
    #expect(!clip.contains(CGPoint(x: 2, y: -60)), "the top-leading corner is rounded")
    #expect(clip.contains(CGPoint(x: 201, y: bounds.maxY + 30)), "under the home indicator")
    #expect(!clip.contains(CGPoint(x: -1, y: 300)), "its sides are the screen's")
  }

  @Test("the card is drawn about the screen's top centre: its top at the offset, its sides drawn in evenly")
  func place() {
    let m = AppsCardPlace(scale: 0.92, offset: 132, top: 62).effectValue(size: bounds.size)
    func drawn(_ point: CGPoint) -> CGPoint {
      CGPoint(x: m.m11 * point.x + m.m21 * point.y + m.m31, y: m.m12 * point.x + m.m22 * point.y + m.m32)
    }
    // the pages' bounds start 62 under the screen's top, so the screen's top is y -62 here
    let top = drawn(CGPoint(x: 201, y: -62))
    #expect(abs(top.x - 201) < 1e-9)
    #expect(abs(top.y - (132 - 62)) < 1e-9, "the card's top stands 132 from the screen's")
    let corner = drawn(CGPoint(x: 0, y: -62))
    #expect(abs(corner.x - 201 * 0.08) < 1e-9, "each side is drawn in by half of what the card lost")
    let foot = drawn(CGPoint(x: 201, y: 778))
    #expect(abs(foot.y - (132 - 62 + 0.92 * 840)) < 1e-9)
  }
}
