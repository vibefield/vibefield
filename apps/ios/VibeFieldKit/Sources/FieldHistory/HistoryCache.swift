import Foundation

/// SP-6 — the phone's History CACHE (thinking-sync-planes.md §5.4 "The phone's
/// cache"; the slice table's "LRU keyed {device, session, stamp}"): what this
/// phone last read from each desktop, kept in the app's caches directory so
/// airplane mode replays it under H-D7's words (`studio is asleep · read
/// 11:42`) with the desktop's NAME. A CACHE, never a replica: no search over
/// it, no sync, no merge — a desktop that answers replaces it, and the OS may
/// purge the caches directory at any time, which this survives by holding
/// nothing it cannot read again.
///
/// Two kinds of entry, both JSON:
///  - a desktop's LEDGER (`<device>/ledger.json`): the corpus without its
///    documents, and when it was read;
///  - a DOCUMENT (`<device>/<session hash>.<stamp hash>.json`), keyed by the
///    device, the session and its STAMP — the session row's `updatedAt` (its
///    source freshness) with the page's watermark beside it: a session whose
///    stamp moved is read again, and an older entry is just an older entry
///    until the sweep takes it.
///
/// The bound is `limitBytes` over every file, swept least-recently-READ first
/// (a read touches the file's modification date — the LRU's clock is the
/// file system's, so a cache that survives a relaunch keeps its order).
public final class HistoryCache: @unchecked Sendable {
  /// 24 MiB: a document page over the door is at most some 200 KB (a hundred
  /// rows at the text bound), so this holds a hundred-odd documents — a week
  /// of reading on a train — and stays an order below a phone's caches budget
  /// (iOS purges the caches directory under pressure; a larger figure would
  /// be purged sooner, not kept longer).
  public static let limitBytes = 24 * 1024 * 1024

  public struct Key: Hashable, Sendable {
    public let device: String
    public let session: String
    public let stamp: String

    public init(device: String, session: String, stamp: String) {
      self.device = device
      self.session = session
      self.stamp = stamp
    }
  }

  /// A kept ledger: the corpus (documents apart) and when it was read.
  public struct KeptLedger: Codable, Equatable, Sendable {
    public var corpus: HistoryCorpus
    public var readAt: Date

    public init(corpus: HistoryCorpus, readAt: Date) {
      self.corpus = corpus
      self.readAt = readAt
    }
  }

  /// A kept document and when it was read.
  public struct KeptDocument: Codable, Equatable, Sendable {
    public var document: HistoryDocument
    public var readAt: Date

    public init(document: HistoryDocument, readAt: Date) {
      self.document = document
      self.readAt = readAt
    }
  }

  private let root: URL
  private let limit: Int
  private let files = FileManager.default
  private let lock = NSLock()

  /// The app's own caches directory by default; a test hands a scratch one.
  public init(directory: URL? = nil, limitBytes: Int = HistoryCache.limitBytes) {
    let caches =
      files.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSTemporaryDirectory())
    root = directory ?? caches.appendingPathComponent("history", isDirectory: true)
    limit = limitBytes
  }

  public var directory: URL { root }

  // MARK: Ledgers

  public func keepLedger(_ corpus: HistoryCorpus, device: String, readAt: Date = Date()) {
    var trimmed = corpus
    trimmed.documents = [:]
    trimmed.hits = []
    trimmed.searchedQuery = nil
    write(KeptLedger(corpus: trimmed, readAt: readAt), to: ledgerURL(device))
  }

  public func ledger(device: String) -> KeptLedger? {
    read(KeptLedger.self, from: ledgerURL(device))
  }

  // MARK: Documents

  public func keep(_ document: HistoryDocument, key: Key, readAt: Date = Date()) {
    write(KeptDocument(document: document, readAt: readAt), to: documentURL(key))
  }

  /// The document under exactly this key.
  public func document(key: Key) -> KeptDocument? {
    read(KeptDocument.self, from: documentURL(key))
  }

  /// The newest kept document of a session, whatever its stamp — what an
  /// offline replay shows when it cannot ask for the stamp.
  public func latestDocument(device: String, session: String) -> KeptDocument? {
    let prefix = "\(hash(session))."
    let dir = deviceURL(device)
    guard let names = try? files.contentsOfDirectory(atPath: dir.path) else { return nil }
    let candidates = names.filter { $0.hasPrefix(prefix) && $0.hasSuffix(".json") }
    return candidates.compactMap { read(KeptDocument.self, from: dir.appendingPathComponent($0)) }
      .max { $0.readAt < $1.readAt }
  }

  /// Every byte this cache holds.
  public func bytes() -> Int {
    lock.withLock { unsafeBytes() }
  }

  /// Drop everything (sign out: what the field taught this phone goes).
  public func clear() {
    lock.withLock { try? files.removeItem(at: root) }
  }

  // MARK: Files

  private func ledgerURL(_ device: String) -> URL {
    deviceURL(device).appendingPathComponent("ledger.json")
  }

  private func documentURL(_ key: Key) -> URL {
    deviceURL(key.device).appendingPathComponent("\(hash(key.session)).\(hash(key.stamp)).json")
  }

  private func deviceURL(_ device: String) -> URL {
    root.appendingPathComponent(hash(device), isDirectory: true)
  }

  /// A file-system-safe name for any id (a session id may hold `/`).
  private func hash(_ text: String) -> String {
    // FNV-1a 64, hex: stable across launches, no crypto needed for a name
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in text.utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 0x0000_0100_0000_01b3
    }
    return String(hash, radix: 16)
  }

  private func write<T: Encodable>(_ value: T, to url: URL) {
    lock.withLock {
      do {
        try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(value)
        try data.write(to: url, options: .atomic)
        unsafeTrim(sparing: url)
      } catch {
        // a cache that cannot be written is a cache that holds less; nothing
        // downstream depends on it being there
      }
    }
  }

  private func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
    lock.withLock {
      guard let data = try? Data(contentsOf: url) else { return nil }
      guard let value = try? JSONDecoder().decode(type, from: data) else {
        try? files.removeItem(at: url)
        return nil
      }
      // a read is a use: the LRU's clock is the modification date
      try? files.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
      return value
    }
  }

  private func allFiles() -> [(url: URL, bytes: Int, touched: Date)] {
    guard let enumerator = files.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return [] }
    var out: [(URL, Int, Date)] = []
    for case let url as URL in enumerator {
      guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]),
        values.isRegularFile == true
      else { continue }
      out.append((url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast))
    }
    return out
  }

  private func unsafeBytes() -> Int { allFiles().reduce(0) { $0 + $1.bytes } }

  /// Least recently used first, until under the bound; the file just written
  /// is spared (a document larger than the whole bound would otherwise evict
  /// itself and nothing would ever be kept).
  private func unsafeTrim(sparing: URL) {
    var entries = allFiles().sorted { $0.touched < $1.touched }
    var total = entries.reduce(0) { $0 + $1.bytes }
    while total > limit, let oldest = entries.first {
      entries.removeFirst()
      if oldest.url.standardizedFileURL == sparing.standardizedFileURL { continue }
      try? files.removeItem(at: oldest.url)
      total -= oldest.bytes
    }
  }
}
