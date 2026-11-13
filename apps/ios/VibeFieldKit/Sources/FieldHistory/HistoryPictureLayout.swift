import CoreGraphics
import Foundation
import ImageIO
import UIKit

// Item 362g (James's board pick, 2026-11-12 20:43Z: "images through a rosetta release"; VF-PM's rulings,
// 2026-11-13 00:24Z) — A RECORDED PICTURE IN THE DOCUMENT, AS VALUES. What the view decides about a picture is
// decided here, so `FieldHistoryTests` holds it without a screen (H-D4): which attachments stand together as one
// strip, which of them is asked for as a picture and under what key it is found, what a cell draws for the face
// its reader holds and how much room that takes, where the cells of a strip stand, how many pixels a picture is
// read to, and how a picture is fitted and zoomed on its sheet.
//
// The strip is the room's (rosetta's clients/room: components/transcript/Attachments.tsx and
// styles/attachments.css, read at the pin, 811e554c6), at the figures the art director ruled for a phone
// (2026-11-13). The views that draw from these are in HistoryPictureView.swift.

/// One attachment as a strip draws it.
struct HistoryAttached: Identifiable, Equatable {
  /// Its identity in the strip: the document's id for it, or a stand-in where the document holds none.
  let id: String
  /// The id its picture is asked for and found by, `<timelineId>/<attachmentId>`. nil where there is nothing to ask
  /// for: the attachment is no image, or the document was kept before it carried a prompt's ids.
  let picture: String?
  /// The placeholder's words, `image shot.png on studio`: drawn where no picture is, and a tile's spoken name.
  let words: String
}

/// What a turn draws under its head, in order.
enum HistoryPiece: Identifiable, Equatable {
  /// A segment, drawn as it always was.
  case segment(HistorySegment)
  /// A run of attachments, drawn as one strip.
  case strip([HistoryAttached])

  /// A segment's own id; a strip's is its first attachment's, the id that attachment's row had.
  var id: String {
    switch self {
    case .segment(let segment): segment.id
    case .strip(let attached): attached.first?.id ?? ""
    }
  }
}

/// What one attachment's cell draws.
enum HistoryPictureDraws: Equatable {
  /// The picture, as a square tile.
  case tile
  /// A picture on its way: the tile's own square, with the mark that it is coming.
  case waiting
  /// The placeholder's line, as the document always drew it.
  case placeholder
}

enum HistoryPictureLayout {
  /// A tile's side, in points. The room's tile is 112 px in a column of 440 px or less (attachments.css,
  /// `@container (max-width: 440px) { .tr-att figure { flex-basis: 112px; width: 112px } }`), which is every
  /// iPhone's document. At 112 pt a third tile is 2 pt short on a 390 pt phone; 104 pt stands three across every
  /// iPhone the kit runs on (3 × 104 + 2 × 8 = 328, inside the 335 pt a 375 pt phone leaves between the
  /// document's 20 pt margins). A fourth never fits a phone.
  static let tile: CGFloat = 104
  /// The space between two tiles and between two rows of a strip: the room's `gap: 8px` in the same rule, and the
  /// 8 pt the document always kept between two placeholders.
  static let gap: CGFloat = 8
  /// The most a pinch zooms a picture on its sheet: this many times its size fitted to the page's width.
  static let zoomMost: CGFloat = 4
  /// What a double tap zooms a fitted picture to. A double tap on a zoomed one goes back to fitted.
  static let zoomTap: CGFloat = 2
}

// MARK: - The rules

// Item 362g (red) — STUBS so the rows compile: every rule below answers nothing. The green writes the rules and
// the decode in their place and takes these out.
extension HistoryPictureLayout {
  /// Item 362g (red) — a stub: the id alone.
  static func key(_ id: String, _ size: HistoryPictureSize) -> String { id }

  /// Item 362g (red) — a stub: always the placeholder.
  static func draws(_ face: HistoryPictureFace?, read: Bool?) -> HistoryPictureDraws { .placeholder }

  /// Item 362g (red) — a stub: no square.
  static func side(_ draws: HistoryPictureDraws) -> CGFloat? { nil }

  /// Item 362g (red) — a stub: every segment alone, no strip.
  static func pieces(_ segments: [HistorySegment], desktop: String) -> [HistoryPiece] {
    segments.map { HistoryPiece.segment($0) }
  }

  /// Item 362g (red) — a stub: nothing.
  static func attached(to turn: HistoryTurn) -> [HistoryAttached] { [] }

  /// Item 362g (red) — a stub: nothing placed.
  static func flow(_ sizes: [CGSize], width: CGFloat, gap: CGFloat) -> (origins: [CGPoint], size: CGSize) {
    ([], .zero)
  }

  /// Item 362g (red) — a stub: no pixels.
  static func pixels(_ points: CGFloat, scale: CGFloat) -> Int { 0 }

  /// Item 362g (red) — a stub: no side.
  static func longSide(width: Int, height: Int, across: Int) -> Int { 0 }

  /// Item 362g (red) — a stub: no room.
  static func fitted(width: CGFloat, height: CGFloat, across: CGFloat) -> CGSize { .zero }

  /// Item 362g (red) — a stub: the zoom it had.
  static func tapped(from zoom: CGFloat) -> CGFloat { zoom }

  /// Item 362g (red) — a stub: nothing.
  static func zoomRect(around point: CGPoint, page: CGSize, zoom: CGFloat) -> CGRect { .zero }
}

// MARK: - The decode

/// Item 362g (red) — a stub: nothing reads as a picture.
enum HistoryPictureDecode {
  static func read(_ data: Data, across: Int) -> UIImage? { nil }
}
