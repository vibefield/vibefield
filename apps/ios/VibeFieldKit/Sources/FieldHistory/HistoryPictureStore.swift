import Foundation

// Item 362g (James's board pick, 2026-11-12 20:43Z: "images through a rosetta release, and full detail on the direct
// road") — THE PICTURES A SESSION RECORDED, AS THE PHONE HOLDS THEM.
//
// Read straight from the desktop's index, an entry names its recorded pictures (`HistoryPicture`, beside the row),
// and the direct read fetches one rendition of one when its tile asks (`HistoryDirectRead.picture`). What comes
// back is a WebP that rosettad encoded, never the recorded original. This file is what the phone does with those
// bytes: the size a picture is asked at, the face the view is told, and the memory the bytes are kept in.
//
// MEMORY ONLY. The bytes are never written to the phone's disk, and nothing here is Codable: the document and
// its cache (`HistoryDocument`, `HistoryCache`) carry an attachment's id and no more. The memory has a bound in
// bytes; past it the picture used longest ago goes, and is read again when its tile next asks. Sign-out drops
// every one (`HistoryDesktops.signedOut`).
//
// ONE STORE A DESKTOP'S READER (`HistoryDesktopReader`). A phone reads one to three desktops, so the most it holds
// is three stores at their bound: 3 × 16 MiB, 48 MiB of encoded pictures.
//
// The bytes are kept ENCODED, as they were answered. Decoding is the view's, off the main actor, and what it
// decodes to is not counted here.

/// The size a picture is asked at.
public enum HistoryPictureSize: String, Sendable, CaseIterable {
  /// A row's square tile: rosetta's `tile2x`, a centred square of at most 640 px.
  case tile
  /// The full-size sheet: rosetta's `preview`, at most 1600 px on the long edge. Never rosetta's `full`.
  case preview
}

/// What the view is told of one picture at one size.
enum HistoryPictureFace: Equatable, Sendable {
  /// Asked for: being read, or waiting its turn to be.
  case waiting
  /// The bytes as rosettad answered them: a WebP, not decoded.
  case held(Data)
  /// Asked for and not read. The next ask tries again.
  case failed
}

/// Encoded bytes by key, least recently used out first, under `limit` bytes. Never written anywhere.
struct HistoryPictureStore {
  /// 16 MiB. A tile is a 640 px square at WebP quality 80, some tens of kilobytes (not measured on real records
  /// yet), so this holds the tiles of a few hundred pictures: a long session's worth. And it is four previews at
  /// their bound (`HistoryDirectRead.previewBytes`), so the picture a reader is looking at full size is never the
  /// one that goes to make room for the next. One store a desktop's reader, so 48 MiB on a phone of three desktops.
  static let limit = 16 * 1024 * 1024

  /// Which picture, at which size, of which session.
  struct Key: Hashable, Sendable {
    let session: String
    /// The face's key in its session: "<timelineId>/<attachmentId>/<size>".
    let face: String
  }

  private let bound: Int
  private var held: [Key: Data] = [:]
  /// The keys held, the one used longest ago first.
  private var order: [Key] = []
  /// Every byte held.
  private(set) var bytes = 0

  init(limit: Int = HistoryPictureStore.limit) {
    bound = limit
  }

  /// Keep `data` under `key`, as the most recently used, in place of whatever the key held. Answers the keys let
  /// go to stay under the bound, the one used longest ago first. Bytes larger than the whole bound are not kept:
  /// the answer is then the key itself, and nothing already held is let go for them.
  @discardableResult
  mutating func put(_ data: Data, for key: Key) -> [Key] {
    drop(key)
    guard data.count <= bound else { return [key] }
    held[key] = data
    order.append(key)
    bytes += data.count
    var gone: [Key] = []
    while bytes > bound, let oldest = order.first {
      drop(oldest)
      gone.append(oldest)
    }
    return gone
  }

  /// The bytes under `key`, which is now the most recently used; nil when none are held.
  mutating func get(_ key: Key) -> Data? {
    guard let data = held[key] else { return nil }
    order.removeAll { $0 == key }
    order.append(key)
    return data
  }

  /// Let go of everything one session holds.
  mutating func remove(session: String) {
    let gone = order.filter { $0.session == session }
    for key in gone { drop(key) }
  }

  /// Let go of everything.
  mutating func clear() {
    held.removeAll()
    order.removeAll()
    bytes = 0
  }

  private mutating func drop(_ key: Key) {
    guard let data = held.removeValue(forKey: key) else { return }
    bytes -= data.count
    order.removeAll { $0 == key }
  }
}
