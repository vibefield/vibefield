import CoreGraphics
import Foundation
import ImageIO
import UIKit

// Item 362g (picked 2026-11-12: pictures come through a rosetta release; decided further
// 2026-11-13) — A RECORDED PICTURE IN THE DOCUMENT, AS VALUES. What the view decides about a picture is
// decided here, so `FieldHistoryTests` holds it without a screen (H-D4): which attachments stand together as one
// strip, which of them is asked for as a picture and under what key it is found, what a cell draws for the face
// its reader holds and how much room that takes, where the cells of a strip stand, how many pixels a picture is
// read to, and how a picture is zoomed. The viewer a pressed tile opens has its own part below (item 384).
//
// The strip is the room's (rosetta's clients/room: components/transcript/Attachments.tsx and
// styles/attachments.css, read at the pin, 811e554c6), at the figures ruled for a phone
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
  /// The most a pinch zooms a picture in its viewer: this many times its size fitted inside its page.
  static let zoomMost: CGFloat = 4
  /// What a double tap zooms a fitted picture to. A double tap on a zoomed one goes back to fitted.
  static let zoomTap: CGFloat = 2
}

// MARK: - The rules

extension HistoryPictureLayout {
  /// The key a session's reader holds a picture under: the attachment's id, then the size asked.
  static func key(_ id: String, _ size: HistoryPictureSize) -> String { "\(id)/\(size.rawValue)" }

  /// What a cell draws for the face its reader holds, and for what the held bytes read as (`read`: nil while they
  /// are not read yet, false when they are no picture the phone reads).
  ///
  /// A held picture that reads as one is its tile. One that is on its way is the tile's square with its waiting
  /// mark: asked and not yet answered, or answered and not yet read. Everything else is the placeholder's line as
  /// it always was: a read that failed, bytes that are no picture, and an attachment the reader holds nothing
  /// for, which is every attachment of a session read through the home desktop.
  static func draws(_ face: HistoryPictureFace?, read: Bool?) -> HistoryPictureDraws {
    guard let face else { return .placeholder }
    switch face {
    case .held:
      if read == true { return .tile }
      return read == false ? .placeholder : .waiting
    case .waiting:
      return .waiting
    case .failed:
      return .placeholder
    }
  }

  /// The side of the square a cell holds for what it draws; nil for the placeholder, which is a line as wide as
  /// its strip. A picture on its way holds the square its tile will fill, so its row is the height it will be
  /// when the picture lands: a row changes height once, as it comes on screen and its picture is asked for, and
  /// never when the bytes arrive (DESIGN.md §8, item 362a: up the page nothing moves under the reader).
  static func side(_ draws: HistoryPictureDraws) -> CGFloat? {
    switch draws {
    case .tile, .waiting: tile
    case .placeholder: nil
    }
  }

  /// A turn's segments as the view draws them: every run of attachment segments gathered into one strip, in
  /// order, and every other segment as it was. The fold puts a reply's attachments after its words and a group's
  /// images after the group, so a strip stands under the message or the group it belongs to.
  ///
  /// Only an image is asked for as a picture (the room's tile asks for nothing else: Attachments.tsx,
  /// `fact.kind === "image"`); a document, a file, a sound and a video keep their placeholder. An attachment the
  /// document has no words for says where it is, as it did.
  static func pieces(_ segments: [HistorySegment], desktop: String) -> [HistoryPiece] {
    var out: [HistoryPiece] = []
    var strip: [HistoryAttached] = []
    func close() {
      if !strip.isEmpty { out.append(.strip(strip)) }
      strip.removeAll()
    }
    for segment in segments {
      guard case .attachment(let id, let kind, let label) = segment else {
        close()
        out.append(.segment(segment))
        continue
      }
      strip.append(
        HistoryAttached(id: id, picture: kind == "image" ? id : nil, words: label ?? "attachment on \(desktop)"))
    }
    close()
    return out
  }

  /// A prompt's attachments as a strip draws them: each placeholder's words, with its id where the document holds
  /// one. A document kept before item 362g holds none, and its placeholders stand as they did, asking for nothing.
  ///
  /// The document names no kind for a prompt's attachment, so each is asked for by its id; what is no picture
  /// finds none, because a reader knows a picture only by the image its entry stored.
  static func attached(to turn: HistoryTurn) -> [HistoryAttached] {
    turn.promptAttachments.enumerated().map { index, words in
      let id: String? = turn.promptAttachmentIds.flatMap { $0.indices.contains(index) ? $0[index] : nil }
      return HistoryAttached(id: id ?? "\(turn.id)/prompt/\(index)", picture: id, words: words)
    }
  }

  /// Where each of `sizes` stands in a strip `width` wide, and the size of the whole: left to right, `gap` apart,
  /// on a further row where the next would not fit, rows `gap` apart. A cell as wide as the strip (a placeholder)
  /// never shares a row.
  static func flow(_ sizes: [CGSize], width: CGFloat, gap: CGFloat) -> (origins: [CGPoint], size: CGSize) {
    var origins: [CGPoint] = []
    var x: CGFloat = 0
    var y: CGFloat = 0
    var rowHeight: CGFloat = 0
    var widest: CGFloat = 0
    for size in sizes {
      if x > 0, x + size.width > width {
        x = 0
        y += rowHeight + gap
        rowHeight = 0
      }
      origins.append(CGPoint(x: x, y: y))
      rowHeight = max(rowHeight, size.height)
      widest = max(widest, x + size.width)
      x += size.width + gap
    }
    return (origins, CGSize(width: widest, height: sizes.isEmpty ? 0 : y + rowHeight))
  }

  /// A length in points as whole pixels on a screen of `scale`, rounded up; never less than one, and a scale that
  /// is not a scale counts as 1.
  static func pixels(_ points: CGFloat, scale: CGFloat) -> Int {
    guard points.isFinite, points > 0 else { return 1 }
    return max(1, Int((points * (scale.isFinite && scale > 0 ? scale : 1)).rounded(.up)))
  }

  /// The longer side, in pixels, that a picture of `width` by `height` pixels is read to when it is drawn `across`
  /// pixels wide: its own longer side scaled as its width is, and never more than it has, so nothing is read
  /// larger than it is drawn and nothing is enlarged. A picture whose size is not known is read at `across`.
  static func longSide(width: Int, height: Int, across: Int) -> Int {
    guard width > 0, height > 0, across > 0 else { return max(across, 1) }
    let long = max(width, height)
    guard across < width else { return long }
    return max(1, Int((Double(long) * Double(across) / Double(width)).rounded(.up)))
  }

  /// The zoom a double tap goes to from `zoom`: `zoomTap` from fitted, and fitted (1) from any zoom past it,
  /// whether a tap or a pinch made it.
  static func tapped(from zoom: CGFloat) -> CGFloat { zoom > 1.01 ? 1 : zoomTap }

  /// The part of a fitted picture a double tap zooms to, in the picture's own points: as much of it as a page of
  /// `page` shows at `zoom`, about the point tapped. The scroll view keeps it inside the picture.
  static func zoomRect(around point: CGPoint, page: CGSize, zoom: CGFloat) -> CGRect {
    guard zoom > 0 else { return .zero }
    let size = CGSize(width: page.width / zoom, height: page.height / zoom)
    return CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height)
  }
}

// MARK: - The viewer (item 384)

// Item 384 (asked for 2026-11-13: a proper viewer that shows a picture at full size, to pan and zoom, with a rail
// of thumbnails of the row's other pictures, each a tap away, and a swipe left or right between them; and not a
// card) — A ROW'S PICTURES
// IN A VIEWER THAT IS THE WHOLE SCREEN, AS VALUES: which of a row's attachments it shows, the one it opens on,
// what its rail counts, which pictures are read at the larger size, how a picture is fitted inside its page and
// where it stands there. The rail is the room's (rosetta's clients/room, components/file-viewer/
// ImageGalleryDialog.tsx and styles/image-gallery.css, read at the pin, 00221b5b70f6).
// DESIGN.md §8 "The phone's session document".
extension HistoryPictureLayout {
  /// A thumbnail's side on the viewer's rail, in points: the room's in a column of 600 px or less
  /// (image-gallery.css, `@media (max-width: 600px) { .ah-image-gallery__thumb { width: 52px; height: 52px } }`).
  /// Two thumbnails stand `gap` apart, the room's `gap: 8px` on its rail.
  static let thumb: CGFloat = 52
  /// The room between a thumbnail's edge and its picture (`.ah-image-gallery__thumb { padding: 3px }`).
  static let thumbInset: CGFloat = 3
  /// The least room around a fitted picture on its page, on every side.
  static let pageMargin: CGFloat = 12

  /// The pictures a row's viewer shows, in the row's order: the attachments asked for as pictures whose tile the
  /// reader holds or is reading (`faces`, by `key`). A line that is no picture is not among them, nor one whose
  /// tile was not read: a prompt's attachments are all asked for by id, whatever they are, and what is no
  /// picture ends failed. The room keeps an unrecorded image's place on its rail, disabled; the phone cannot
  /// tell such an image from a document, so its rail holds pictures only. Every one of them has a picture's id,
  /// and that id is its `id`.
  static func gallery(_ attached: [HistoryAttached], faces: [String: HistoryPictureFace]) -> [HistoryAttached] {
    attached.filter { one in
      guard let id = one.picture, let face = faces[key(id, .tile)] else { return false }
      return face != .failed
    }
  }

  /// The picture a viewer opens on: the one pressed when it is among the row's pictures, and else the first.
  static func opened(_ id: String, among members: [HistoryAttached]) -> String? {
    members.contains { $0.id == id } ? id : members.first?.id
  }

  /// The rail's count, the room's: where the picture shown stands among the row's, `2 / 5`. nil for a row of one
  /// picture, which has no rail, and where the one shown is not the row's.
  static func counter(_ id: String?, among members: [HistoryAttached]) -> String? {
    guard members.count > 1, let index = members.firstIndex(where: { $0.id == id }) else { return nil }
    return "\(index + 1) / \(members.count)"
  }

  /// The pictures asked for at the larger size while `id` is shown, in the order they are asked: itself, then
  /// the next, then the previous, so a swipe either way finds its picture read or on its way. No other is asked
  /// for until it is come to: each is up to `previewBytes` of the reader's memory.
  static func asked(around id: String?, among members: [HistoryAttached]) -> [String] {
    guard let index = members.firstIndex(where: { $0.id == id }) else { return [] }
    return [index, index + 1, index - 1].filter { members.indices.contains($0) }.map { members[$0].id }
  }

  /// Whether a page keeps its larger picture read: the one shown and the one on each side of it do, and a page
  /// further off lets it go, so the viewer holds three pictures' pixels at most whatever the row's length.
  static func near(_ id: String, to shown: String?, among members: [HistoryAttached]) -> Bool {
    guard let at = members.firstIndex(where: { $0.id == id }),
      let index = members.firstIndex(where: { $0.id == shown })
    else { return false }
    return abs(at - index) <= 1
  }

  /// The size a picture of `width` by `height` is drawn at on its page before any zoom: the largest at which it
  /// stands whole inside `page` with `margin` clear on every side, in its own shape. A small picture is drawn
  /// up to that, as the tile's stand-in is. A picture with no size, and a page with no room inside its margins,
  /// take no room.
  static func fitted(width: CGFloat, height: CGFloat, inside page: CGSize, margin: CGFloat) -> CGSize {
    let room = CGSize(width: page.width - 2 * margin, height: page.height - 2 * margin)
    guard width > 0, height > 0, room.width > 0, room.height > 0 else { return .zero }
    // whichever side the page is shorter of, for this shape, is filled exactly; the other follows
    if room.width * height <= room.height * width {
      return CGSize(width: room.width, height: room.width * height / width)
    }
    return CGSize(width: room.height * width / height, height: room.height)
  }

  /// The room left at each side of a picture of `content` (its size at its zoom) on a `page`: half of what the
  /// page has over, across and down, and nothing where the picture is the larger. So a picture smaller than its
  /// page stands at the page's centre, and one zoomed past it pans to its own edges.
  static func centred(_ content: CGSize, on page: CGSize) -> (x: CGFloat, y: CGFloat) {
    (max(0, (page.width - content.width) / 2), max(0, (page.height - content.height) / 2))
  }
}

// MARK: - The decode

/// A picture's bytes read into a picture to draw. The bytes are always a WebP the desktop's index made (rosetta's
/// renditions; its client refuses any other type before the body), read by the system's ImageIO.
enum HistoryPictureDecode {
  /// `read`, off the main actor: reading a picture is the one slow thing a tile does.
  static func image(_ data: Data, across: Int) async -> UIImage? {
    await Task.detached(priority: .userInitiated) { HistoryPictureDecode.read(data, across: across) }.value
  }

  /// The picture in `data`, read no larger than it is drawn `across` pixels wide (`HistoryPictureLayout.longSide`);
  /// nil when the bytes are no picture the system reads. An animation is its first frame.
  ///
  /// The bytes are never decoded whole: the source reads the picture's size from its header, and the one decode
  /// is ImageIO's thumbnail at the size asked, made here and not at the first draw.
  static func read(_ data: Data, across: Int) -> UIImage? {
    let unread = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, unread), CGImageSourceGetCount(source) > 0 else {
      return nil
    }
    let facts = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let width = facts?[kCGImagePropertyPixelWidth] as? Int ?? 0
    let height = facts?[kCGImagePropertyPixelHeight] as? Int ?? 0
    // orientations 5 to 8 lay a picture on its side: drawn, its width is its stored height
    let turned = (facts?[kCGImagePropertyOrientation] as? Int ?? 1) >= 5
    let side = HistoryPictureLayout.longSide(
      width: turned ? height : width, height: turned ? width : height, across: across)
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: side,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
  }
}
