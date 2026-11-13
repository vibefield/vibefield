// Item 362g (James's pick on the board, 2026-11-12 20:43Z, as VF-PM relayed it: "Both A and B for 0.9: images
// through a rosetta release, and full detail on the direct road") — WHICH RECORDED PICTURE AN ATTACHMENT IS.
//
// Through the home desktop an attachment is a ref (`IndexTimelineAttachment`): what was attached and whether its
// bytes exist, with no digest and no address, so the document draws a line of words (`image shot.png on studio`).
// Read straight from the desktop's index the phone holds rosetta's whole entry, and the entry names the stored
// member: its address on rosettad, its digest, its type and its size. A picture is that naming, kept BESIDE the row
// (`HistoryLineDetail.pictures`) and never in it, so the row stays the row the door would have sent.
//
// A picture is not the image. No bytes are here, and nothing in this file reads any. It says which bytes the
// desktop's record holds, so it is never drawn, never logged and never encoded: it stays in memory beside its row,
// for as long as that row is the row held (`HistoryLineDetail.live`).
//
// Neither type is Codable, and that is deliberate. `HistoryDocument`, `HistoryTurn` and `HistorySegment` are, by
// the compiler's own conformance, and they are written to the phone's cache (`HistoryCache`). That conformance
// cannot be made over a member that is not Codable, so a picture put inside one of them does not build. What a
// document carries of an attachment is its id, which a reply's `.attachment` segment already has.
//
// Which attachments are pictures is the room's rule, read in `HistoryProjection.pictures(entry:)`.
// DESIGN.md §8 "The phone's session document" → a recorded picture is shown.

/// One stored image member, as the entry names it. Never drawn, never logged, never encoded.
struct HistoryPictureMember: Equatable, Sendable {
  /// A path on rosettad, exactly `/api/assets/<digest>.<ext>`: no host, no query.
  let url: String
  /// The stored bytes' digest: sixty-four lowercase hex digits.
  let digest: String
  let mediaType: String
  /// How many bytes are stored: above zero.
  let byteLen: Int
}

/// A recorded picture an entry carries, read beside its row on the direct read.
struct HistoryPicture: Equatable, Sendable {
  /// The attachment's id within its entry. After the row's id it is the id the document has for the attachment
  /// (`<timelineId>/<attachmentId>`, `HistoryLineDetail.pictured`).
  let attachmentId: String
  /// The stored member: a recorded original in one of rosetta's six image formats, or a legacy bundle's own WebP.
  let base: HistoryPictureMember
  /// A legacy WebP bundle's sized members by rosetta's variant name (rail, tile, tile2x, preview). Empty for a
  /// recorded original, whose sizes rosettad renders on request.
  let variants: [String: HistoryPictureMember]
}
