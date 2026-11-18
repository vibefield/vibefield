import CoreGraphics
import SwiftUI
import Testing

@testable import FieldHome

/// The card's outline (DESIGN.md §8 "The phone's Apps", amended 2026-11-12 twice: the phone's bands, a
/// screenshot of 12 Nov; then item 348). The pages' bounds are the safe area, and the field draws past them. At rest
/// the outline reaches past the bounds and cuts nothing, so the full-bleed field draws under the status bar and the
/// home indicator. Open, it is the whole screen as a card: its top is the screen's, its top corners rounded at 44.
/// *(Corrected 2026-11-12, item 348: open, the card was "the pages' bounds", cut at the safe area's top.)*
@Suite("the card's outline: nothing cut at rest, the whole screen with rounded top corners while the shelf is open")
@MainActor
struct AppsCardClipTests {
  /// The pages' bounds on an iPhone 17 Pro: its 874 points less the 62 and 34 of its safe area.
  private let bounds = CGRect(x: 0, y: 0, width: 402, height: 778)

  @Test("at rest, the outline reaches past the safe area above and below, so the full-bleed field is not cut")
  func closedCutsNothing() {
    let clip = AppsCardShape(card: .rest, safeTop: 62).path(in: bounds)
    #expect(clip.contains(CGPoint(x: 201, y: -50)), "under the status bar")
    #expect(clip.contains(CGPoint(x: 201, y: bounds.maxY + 30)), "under the home indicator")
    #expect(clip.contains(CGPoint(x: 2, y: -60)), "no corner is rounded")
  }

  @Test("open, the card is the whole screen: its top the screen's, its top corners rounded at 44")
  func openKeepsTheCard() {
    let card = AppsPull.Card.receded(bounds: bounds.height, safeTop: 62)
    let clip = AppsCardShape(card: card, safeTop: 62).path(in: bounds)
    #expect(clip.contains(CGPoint(x: 201, y: bounds.midY)))
    #expect(clip.contains(CGPoint(x: 201, y: -61)), "the status bar's band of the page is the card's")
    #expect(!clip.contains(CGPoint(x: 201, y: -63)))
    #expect(!clip.contains(CGPoint(x: 2, y: -60)), "the top-leading corner is rounded")
    #expect(clip.contains(CGPoint(x: 2, y: bounds.maxY - 2)), "the foot's corners are square")
  }
}
