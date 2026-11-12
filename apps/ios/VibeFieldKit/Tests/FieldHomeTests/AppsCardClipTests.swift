import CoreGraphics
import SwiftUI
import Testing

@testable import FieldHome

/// MA-6e's bands (DESIGN.md §8 "The phone's Apps", amended 2026-11-12; James's screenshot, 12 Nov): the receded card
/// clips the pages only while the tab is receded. Closed, the clip reaches past the pages' bounds, which are the safe
/// area, so the full-bleed field draws under the status bar and the home indicator. Open, it is the card M272 built.
@Suite("the receded card's clip: nothing while the shelf is closed, the rounded card while it is open")
@MainActor
struct AppsCardClipTests {
  /// The pages' bounds on an iPhone 17 Pro: its 874 points less the 62 and 34 of its safe area.
  private let bounds = CGRect(x: 0, y: 0, width: 402, height: 778)

  @Test("closed, the clip reaches past the safe area above and below, so the full-bleed field is not cut")
  func closedCutsNothing() {
    let clip = AppsCardClip.shape(open: false).path(in: bounds)
    #expect(clip.contains(CGPoint(x: 201, y: -50)), "under the status bar")
    #expect(clip.contains(CGPoint(x: 201, y: bounds.maxY + 30)), "under the home indicator")
  }

  @Test("open, the card is MA-6's: the pages' bounds, its top corners rounded at 44")
  func openKeepsTheCard() {
    let clip = AppsCardClip.shape(open: true).path(in: bounds)
    #expect(clip.contains(CGPoint(x: 201, y: bounds.midY)))
    #expect(!clip.contains(CGPoint(x: 201, y: -1)))
    #expect(!clip.contains(CGPoint(x: 201, y: bounds.maxY + 1)))
    #expect(!clip.contains(CGPoint(x: 2, y: 2)), "the top-leading corner is rounded")
    #expect(clip.contains(CGPoint(x: 2, y: bounds.maxY - 2)), "the foot's corners are square")
  }
}
