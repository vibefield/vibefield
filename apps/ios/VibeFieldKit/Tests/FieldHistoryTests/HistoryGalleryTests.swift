import CoreGraphics
import Foundation
import Testing

@testable import FieldHistory

/// Item 384 (James, 2026-11-13 23:05:55Z, of the first build that drew a recorded picture on his phone: "it should
/// be a proper image preview ui that has image in full size that are pannable and zoomable, and has row of
/// thumbnails of all other images in the same row that can click and navigate, and i can also swipe left right to
/// navigate images"; 23:06:26Z: "and it should not be a card ui") — a pressed picture opens its ROW's pictures in a
/// viewer that is the whole screen. These rows hold what the viewer decides without a screen: which of the row's
/// attachments are its pictures, the one it opens on, the rail's count, which pictures are read at the larger
/// size, and how a picture is fitted inside its page. The paging, the zoom and the rail's scroll are the view's,
/// and no row holds them.
@Suite("item 384 — a row's pictures open in a viewer: which, in what order, and how one is fitted")
struct HistoryGalleryTests {
  private func one(_ id: String, picture: Bool = true) -> HistoryAttached {
    HistoryAttached(id: id, picture: picture ? id : nil, words: "image \(id) on studio")
  }

  private let held = HistoryPictureFace.held(Data([1]))

  @Test("the viewer shows the row's pictures the reader holds or is reading, in the row's order, and no other line")
  func members() {
    let row = [one("a/1"), one("a/doc", picture: false), one("a/2"), one("a/3"), one("a/4"), one("a/5")]
    let faces: [String: HistoryPictureFace] = [
      "a/1/tile": held, "a/2/tile": .waiting, "a/3/tile": .failed, "a/4/tile": held, "a/4/preview": .failed,
      // a picture of another row is no part of this one, and a larger size held with no tile is not enough
      "b/9/tile": held, "a/5/preview": held,
    ]
    #expect(HistoryPictureLayout.gallery(row, faces: faces).map(\.id) == ["a/1", "a/2", "a/4"])
    // through the home desktop the reader holds nothing, and there is nothing to open
    #expect(HistoryPictureLayout.gallery(row, faces: [:]).isEmpty)
  }

  @Test("it opens on the picture pressed, and on the first when the one pressed is not among them")
  func opens() {
    let members = [one("a/1"), one("a/2"), one("a/3")]
    #expect(HistoryPictureLayout.opened("a/2", among: members) == "a/2")
    #expect(HistoryPictureLayout.opened("a/9", among: members) == "a/1")
    #expect(HistoryPictureLayout.opened("a/1", among: []) == nil)
  }

  @Test("the rail's count is the room's, `2 / 5`; a row of one picture has no rail and no count")
  func counts() {
    let members = (1...5).map { one("a/\($0)") }
    #expect(HistoryPictureLayout.counter("a/2", among: members) == "2 / 5")
    #expect(HistoryPictureLayout.counter("a/5", among: members) == "5 / 5")
    #expect(HistoryPictureLayout.counter("a/1", among: [one("a/1")]) == nil)
    #expect(HistoryPictureLayout.counter("a/9", among: members) == nil)
    #expect(HistoryPictureLayout.counter(nil, among: members) == nil)
  }

  @Test("the picture shown is read at the larger size first, then the next, then the previous, and no other")
  func asks() {
    let members = (1...5).map { one("a/\($0)") }
    #expect(HistoryPictureLayout.asked(around: "a/3", among: members) == ["a/3", "a/4", "a/2"])
    #expect(HistoryPictureLayout.asked(around: "a/1", among: members) == ["a/1", "a/2"])
    #expect(HistoryPictureLayout.asked(around: "a/5", among: members) == ["a/5", "a/4"])
    #expect(HistoryPictureLayout.asked(around: "a/9", among: members).isEmpty)
    #expect(HistoryPictureLayout.asked(around: nil, among: members).isEmpty)
  }

  @Test("a page keeps its larger picture while it is shown or beside the one shown, and lets it go further off")
  func nearness() {
    let members = (1...5).map { one("a/\($0)") }
    #expect(HistoryPictureLayout.near("a/3", to: "a/3", among: members))
    #expect(HistoryPictureLayout.near("a/2", to: "a/3", among: members))
    #expect(HistoryPictureLayout.near("a/4", to: "a/3", among: members))
    #expect(!HistoryPictureLayout.near("a/1", to: "a/3", among: members))
    #expect(!HistoryPictureLayout.near("a/5", to: "a/3", among: members))
    // nothing shown, or a page that is not the row's: not near
    #expect(!HistoryPictureLayout.near("a/3", to: nil, among: members))
    #expect(!HistoryPictureLayout.near("a/9", to: "a/3", among: members))
  }

  @Test("fitted, a picture stands whole inside its page, in its own shape, 12 pt clear of every edge")
  func fits() {
    let page = CGSize(width: 393, height: 600)
    let margin = HistoryPictureLayout.pageMargin
    #expect(margin == 12)
    // a desktop's screenshot of 1,600 by 900: the page's width decides
    let wide = HistoryPictureLayout.fitted(width: 1600, height: 900, inside: page, margin: margin)
    #expect(wide == CGSize(width: 369, height: 207.5625))
    // a phone's of 900 by 1,950: the page's height decides
    let tall = HistoryPictureLayout.fitted(width: 900, height: 1950, inside: page, margin: margin)
    #expect(tall.height == 576 && abs(tall.width - 265.846) < 0.001)
    // a small picture is drawn up to the page, as the tile's stand-in is
    let small = HistoryPictureLayout.fitted(width: 8, height: 4, inside: page, margin: margin)
    #expect(small == CGSize(width: 369, height: 184.5))
    // a picture with no size, and a page with no room inside its margins: no picture
    #expect(HistoryPictureLayout.fitted(width: 0, height: 4, inside: page, margin: margin) == .zero)
    let narrow = CGSize(width: 20, height: 600)
    #expect(HistoryPictureLayout.fitted(width: 8, height: 4, inside: narrow, margin: margin) == .zero)
  }

  @Test("a picture smaller than its page stands at the page's centre; zoomed past the page it pans to its own edges")
  func centres() {
    let page = CGSize(width: 393, height: 600)
    let fitted = HistoryPictureLayout.centred(CGSize(width: 369, height: 207.5), on: page)
    #expect(fitted.x == 12 && fitted.y == 196.25)
    // at four times it is larger than the page both ways: no room around it
    let zoomed = HistoryPictureLayout.centred(CGSize(width: 1476, height: 830), on: page)
    #expect(zoomed.x == 0 && zoomed.y == 0)
    // at twice it is wider than the page and still shorter: centred down the page alone
    let twice = HistoryPictureLayout.centred(CGSize(width: 738, height: 415), on: page)
    #expect(twice.x == 0 && twice.y == 92.5)
  }

  @Test("the rail's thumbnails are the room's in a narrow column: 52 pt, 8 apart, the picture 3 pt inside")
  func theRail() {
    #expect(HistoryPictureLayout.thumb == 52)
    #expect(HistoryPictureLayout.gap == 8)
    #expect(HistoryPictureLayout.thumbInset == 3)
  }
}
