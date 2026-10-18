import Foundation

// THE PROJECT'S COLOUR (record §02, D-i13): a project is dealt a SEQUENCE the
// first time an agent runs in it, never reused, and the theme's tint turns the
// sequence into a hue (`projectTint`). A bare terminal belongs to no project
// and wears the ramp. The sequence is the identity that survives everything:
// two runs in one project share a colour, a resumed run keeps its own, and
// across a launch the ledger comes back from the device's own cache. The
// desktop deals this in its renderer, per device (AR5-D3); the phone does the
// same, and the two agree only once a door carries the sequence — D-i13 names
// that follow-up rather than pretending.

public struct ProjectLedger: Equatable, Sendable {
  /// Project key → its dealt sequence, from 0.
  public var seqByKey: [String: Int]
  /// The next sequence to deal; never rewinds, so a retired project's hue stays retired.
  public var next: Int

  public init(seqByKey: [String: Int] = [:], next: Int = 0) {
    self.seqByKey = seqByKey
    self.next = next
  }

  public static let empty = ProjectLedger()

  /// Deal every unseen key the next sequence, in the order given; known keys
  /// keep theirs. Returns the same ledger when nothing was dealt, so nothing
  /// downstream redraws.
  public func dealing(_ keys: [String]) -> ProjectLedger {
    var dealt = self
    var changed = false
    for key in keys where dealt.seqByKey[key] == nil {
      dealt.seqByKey[key] = dealt.next
      dealt.next += 1
      changed = true
    }
    return changed ? dealt : self
  }
}

// MARK: - Persistence (cache, not state)

/// Where the phone keeps the ledger between launches. A missing or unreadable
/// record costs a project its colour continuity and nothing more.
public protocol ProjectLedgerStoring: Sendable {
  func load() -> ProjectLedger
  func save(_ ledger: ProjectLedger)
}

/// The persisted shape, versioned so a later change cannot be misread.
struct StoredProjectLedger: Codable {
  var version: Int
  var next: Int
  var seqs: [[StoredSeq]]

  enum StoredSeq: Codable {
    case key(String)
    case seq(Int)

    init(from decoder: Decoder) throws {
      let container = try decoder.singleValueContainer()
      if let value = try? container.decode(Int.self) {
        self = .seq(value)
      } else {
        self = .key(try container.decode(String.self))
      }
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.singleValueContainer()
      switch self {
      case .key(let key): try container.encode(key)
      case .seq(let seq): try container.encode(seq)
      }
    }
  }
}

/// The ledger as JSON, in the desktop's own stored shape (`version: 1`,
/// `next`, `seqs: [[key, seq]]`) so a record can be read by either side.
public enum ProjectLedgerCodec {
  public static func encode(_ ledger: ProjectLedger) -> Data? {
    let stored = StoredProjectLedger(
      version: 1,
      next: ledger.next,
      seqs: ledger.seqByKey.sorted { $0.value < $1.value }.map { [.key($0.key), .seq($0.value)] })
    return try? JSONEncoder().encode(stored)
  }

  /// `next` is the larger of what was saved and what the dealt sequences imply,
  /// so a truncated record can never deal a sequence twice.
  public static func decode(_ data: Data) -> ProjectLedger {
    guard let stored = try? JSONDecoder().decode(StoredProjectLedger.self, from: data),
      stored.version == 1
    else { return .empty }
    var seqByKey: [String: Int] = [:]
    for entry in stored.seqs {
      guard entry.count == 2, case .key(let key) = entry[0], case .seq(let seq) = entry[1] else {
        continue
      }
      seqByKey[key] = seq
    }
    let dealt = seqByKey.values.max() ?? -1
    return ProjectLedger(seqByKey: seqByKey, next: max(stored.next, dealt + 1))
  }
}

public struct UserDefaultsProjectLedgerStore: ProjectLedgerStoring {
  /// The ledger's key, named so a sign-out (IOS-8d) can clear it: the
  /// colours dealt to one account's projects do not greet the next.
  public static let defaultKey = "vibefield.ios.project-ledger.v1"

  private let suite: String?
  private let key: String

  public init(suite: String? = nil, key: String = defaultKey) {
    self.suite = suite
    self.key = key
  }

  private var defaults: UserDefaults {
    suite.flatMap(UserDefaults.init(suiteName:)) ?? .standard
  }

  public func load() -> ProjectLedger {
    guard let data = defaults.data(forKey: key) else { return .empty }
    return ProjectLedgerCodec.decode(data)
  }

  public func save(_ ledger: ProjectLedger) {
    guard let data = ProjectLedgerCodec.encode(ledger) else { return }
    defaults.set(data, forKey: key)
  }
}

/// A store that keeps nothing: tests, previews, and any run that must not
/// touch what a real user's ledger holds.
public struct EphemeralProjectLedgerStore: ProjectLedgerStoring {
  public init() {}
  public func load() -> ProjectLedger { .empty }
  public func save(_ ledger: ProjectLedger) {}
}
