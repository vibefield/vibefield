import Foundation

// IOS-12b — THE SPARKS AND THE NEEDS-YOU QUEUE, read on the phone (`packages/contracts/src/compose.ts`: `SparkSummary`,
// `ComposeSparksListResult`, `ComposeDesktop`, `NeedsItem`, `NeedsFrom`, `NeedsListResult`). Chat asks its home for
// both lists with `scope: "mesh"` (IOS-12a, PC-L2): every row names the desktop it lives on (`device`), and `desktops`
// says how each self desktop answered the merge, so a desktop that did not answer is said as such, never as one with
// no sparks.
//
// The remote cut's posture (`AgentRemoteShapes.swift`): a row is refused where zod would refuse it — a required field
// missing or of another type, `null` at a key zod reads as `.optional()` (only `turnedAt` is nullable), a bound or a
// pattern broken — and never for an OPEN word (a desktop's state, an item's kind and state, an ask), which is kept as
// it came. A refused row costs only itself and is named by its id; an envelope's own fault throws the list.

// MARK: - Ids and bounds (compose.ts, agent-index.ts, agent-session.ts)

enum SparkWire {
  /// `SparkId`: `/^sp-[0-9a-z]{6,32}$/`.
  static func isSparkId(_ text: String) -> Bool { isId(text, prefix: "sp-") }
  /// `NeedsItemId`: `/^ny-[0-9a-z]{6,32}$/`.
  static func isNeedsId(_ text: String) -> Bool { isId(text, prefix: "ny-") }

  private static func isId(_ text: String, prefix: String) -> Bool {
    let bytes = Array(text.utf8)
    let tail = bytes.dropFirst(prefix.utf8.count)
    return bytes.starts(with: Array(prefix.utf8)) && (6...32).contains(tail.count)
      && tail.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x7A).contains($0) }
  }

  /// `AgentProfileSetId`: `/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/`.
  static func isProfileSetId(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    let edge = { (byte: UInt8) in (0x30...0x39).contains(byte) || (0x61...0x7A).contains(byte) }
    guard let first = bytes.first, let last = bytes.last, (1...48).contains(bytes.count) else { return false }
    return edge(first) && edge(last) && bytes.allSatisfy { edge($0) || $0 == 0x2D }
  }

  /// `SparkName` (`z.string().min(1).max(32).regex(/^\S(?:.*\S)?$/)`): no blank at either end.
  static func isSparkName(_ text: String) -> Bool {
    guard let first = text.unicodeScalars.first, let last = text.unicodeScalars.last else { return false }
    return !first.properties.isWhitespace && !last.properties.isWhitespace
      && !text.unicodeScalars.contains { $0 == "\n" || $0 == "\r" || $0 == "\u{2028}" || $0 == "\u{2029}" }
  }

  /// `ComposeDevice`.
  static let device = 1...128
  static let needsName = 1...64
  static let needsWords = 1...2_000
  static let needsChoice = 1...40
  /// `NEEDS_CHOICES_MAX + 1`: the acts, and the one that says no.
  static let needsChoices = 1...5
  static let needsReason = 1...256
  static let desktopsMax = 64

  /// A known key's id, read strictly: absent → nil, anything but an id of `valid`'s pattern → refused.
  static func id(
    _ object: inout WireObject, _ key: String, shape: String, _ valid: (String) -> Bool, _ what: String
  ) throws -> String? {
    try object.strict(key) { raw in
      guard let text = raw.stringValue else { throw WireDecodeError(shape: shape, reason: "`\(key)` is not a string") }
      guard valid(text) else { throw WireDecodeError(shape: shape, reason: "`\(key)` is not \(what)") }
      return text
    }
  }

  /// A row's own id when it is one (a refusal's name), else nil: keyless.
  static func key(_ element: JSONValue, _ valid: (String) -> Bool) -> String? {
    guard let text = element["id"]?.stringValue, valid(text) else { return nil }
    return text
  }
}

/// A row of a list this build could not read: its id when it had a readable one, and why.
public struct SparkRowRefusal: Sendable, Equatable {
  public let key: String?
  public let reason: String
}

// MARK: - The desktops

/// How a self desktop answered the home's merge (`COMPOSE_DESKTOP_STATES`, OPEN).
public enum ComposeDesktopState: String, Sendable, Equatable, CaseIterable {
  case answered, asleep, timeout, incompatible, unreachable
}

/// One desktop the merge asked, or would have (`ComposeDesktop`).
public struct ComposeDesktop: Sendable, Equatable {
  public let device: String
  /// The word as it came, a newer home's included.
  public let state: String
  public let unknownFields: [String]

  /// The word as this build names it, else nil (`composeDesktopStateOf`).
  public var known: ComposeDesktopState? { ComposeDesktopState(rawValue: state) }

  init(json: JSONValue) throws {
    var object = try WireObject(shape: "ComposeDesktop", value: json)
    device = try object.text("device", SparkWire.device)
    state = try object.text("state", 1...32)
    unknownFields = object.unknownFields
  }

  /// A list's `desktops`, absent on a desktop's own: a malformed entry, or more than 64, is the envelope's fault.
  static func list(_ object: inout WireObject, shape: String) throws -> [ComposeDesktop] {
    guard let raw = try object.present("desktops") else { return [] }
    guard let elements = raw.arrayValue else {
      throw WireDecodeError(shape: shape, reason: "`desktops` is not an array")
    }
    guard elements.count <= SparkWire.desktopsMax else {
      throw WireDecodeError(shape: shape, reason: "`desktops` holds \(elements.count), over 64")
    }
    return try elements.map(ComposeDesktop.init(json:))
  }
}

// MARK: - A spark

/// Whether a spark has worked (TU-1, Q1): the time fieldd first saw one of its sessions take a turn; `never` (hatched
/// and not yet); `unknown` (a spark from before TU-1, which once started is never said to be new).
public enum SparkTurned: Sendable, Equatable {
  case unknown
  case never
  case at(String)
}

/// A spark's session as its record says (`SparkSummary.session`).
public struct SparkSession: Sendable, Equatable {
  public let runtimeRunId: String
  /// The pane its session lives in, while it has one.
  public let terminalSessionId: String?
  /// Awake: its session's process is running. Asleep otherwise (CP-D14); a message or `open` wakes it.
  public let live: Bool
  public let unknownFields: [String]

  init(json: JSONValue) throws {
    var object = try WireObject(shape: "SparkSummary.session", value: json)
    runtimeRunId = try object.text("runtimeRunId", 1...Int.max)
    terminalSessionId = try object.typedString("terminalSessionId", 1...Int.max)
    live = try object.flag("live")
    unknownFields = object.unknownFields
  }
}

/// One spark, as the doors answer it (`SparkSummary`): its record and whether its session runs now. The phone reads
/// what Chat draws and acts on; the rest of the record (its model, its profiles, its folder) is held to the contract
/// and passed over.
public struct SparkSummary: Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  /// Its face's seed in the spark engine (`agentDNA(seed)`, `SparkEngine`).
  public let seed: UInt32
  /// The agent it thinks with (an AR-L1 id: compared to nothing here).
  public let agent: String
  /// The desktop it lives on, the one that hatched it; nil from a daemon before IOS-12a (the desktop asked).
  public let device: String?
  public let session: SparkSession?
  public let createdAt: String
  public let updatedAt: String
  public let turned: SparkTurned
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    let shape = "SparkSummary"
    var object = try WireObject(shape: shape, value: json)
    guard let id = try SparkWire.id(&object, "id", shape: shape, SparkWire.isSparkId, "a spark id") else {
      throw object.missing("id")
    }
    self.id = id
    name = try object.text("name", 1...32)
    guard SparkWire.isSparkName(name) else { throw WireDecodeError(shape: shape, reason: "`name` is not a name") }
    seed = try object.requiredObject("face") { raw in
      var face = try WireObject(shape: "SparkFace", value: raw)
      let seed = try face.integer("seed", atLeast: 0)
      guard seed <= Int64(UInt32.max) else {
        throw WireDecodeError(shape: "SparkFace", reason: "`seed` is past 32 bits")
      }
      return UInt32(seed)
    }
    agent = try object.text("agent", 1...128)
    _ = try object.strictObject("modelSelection") { raw in
      var selection = try WireObject(shape: "AgentModelSelection", value: raw)
      return try selection.text("modelId", 1...1024)
    }
    let profiles = try object.requiredArray(strict: "profiles")
    guard (1...32).contains(profiles.count),
      profiles.allSatisfy({ $0.stringValue.map(SparkWire.isProfileSetId) ?? false })
    else { throw WireDecodeError(shape: shape, reason: "`profiles` is not 1 to 32 profile ids") }
    let thinksUnder = try object.text("thinksUnder")
    guard SparkWire.isProfileSetId(thinksUnder) else {
      throw WireDecodeError(shape: shape, reason: "`thinksUnder` is not a profile id")
    }
    _ = try object.text("folder", 1...Int.max)
    createdAt = try object.text("createdAt", 1...Int.max)
    updatedAt = try object.text("updatedAt", 1...Int.max)
    // `turnedAt` is the one nullable key: null is `never`, absent is `unknown`
    if let raw = object.value("turnedAt") {
      if raw.isNull {
        turned = .never
      } else if let at = raw.stringValue, !at.isEmpty {
        turned = .at(at)
      } else {
        throw object.mismatch("turnedAt", "a time")
      }
    } else {
      turned = .unknown
    }
    device = try object.typedString("device", SparkWire.device)
    session = try object.strictObject("session", SparkSession.init(json:))
    unknownFields = object.unknownFields
  }
}

/// `compose.sparks.list`'s answer: the sparks of every self desktop (`mesh`) or of the one asked, and how each desktop
/// answered.
public struct ComposeSparksList: Sendable, Equatable {
  public let sparks: [SparkSummary]
  /// Sparks this build could not read, by id. The list stands without them.
  public let refused: [SparkRowRefusal]
  /// Empty on a desktop's own list.
  public let desktops: [ComposeDesktop]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ComposeSparksListResult", value: json)
    var sparks: [SparkSummary] = []
    var refused: [SparkRowRefusal] = []
    for element in try object.requiredArray(strict: "sparks") {
      do {
        sparks.append(try SparkSummary(json: element))
      } catch {
        refused.append(SparkRowRefusal(key: SparkWire.key(element, SparkWire.isSparkId), reason: "\(error)"))
      }
    }
    self.sparks = sparks
    self.refused = refused
    desktops = try ComposeDesktop.list(&object, shape: "ComposeSparksListResult")
    unknownFields = object.unknownFields
  }
}

// MARK: - The needs-you queue

/// An item's kind as this build names it (`NEEDS_ITEM_KINDS`, OPEN).
public enum NeedsItemKind: String, Sendable, Equatable, CaseIterable {
  case question
  case heldSend = "held-send"
  case heldSpawn = "held-spawn"
  case agentAsk = "agent-ask"
}

/// Who asks or tells (`NeedsFrom`): named as fieldd names it, its session, and the spark when the teller IS it.
public struct NeedsFrom: Sendable, Equatable {
  public let name: String
  public let session: String?
  public let spark: String?
  public let unknownFields: [String]

  init(json: JSONValue) throws {
    let shape = "NeedsFrom"
    var object = try WireObject(shape: shape, value: json)
    name = try object.text("name", SparkWire.needsName)
    session = try object.typedString("session", 1...Int.max)
    spark = try SparkWire.id(&object, "spark", shape: shape, SparkWire.isSparkId, "a spark id")
    unknownFields = object.unknownFields
  }
}

/// One item of the needs-you queue (`NeedsItem`, CP-3): a question, a held send or spawn, or an agent's own ask. The
/// phone reads what Chat's list and its thread say; the item's other facts (the held send's session, the spawn's
/// folder, an answer) are held to the contract and passed over.
public struct NeedsItem: Sendable, Equatable, Identifiable {
  public let id: String
  /// The kind as it came (OPEN).
  public let kind: String
  /// The state as it came (OPEN).
  public let state: String
  public let from: NeedsFrom
  /// The spark whose thread shows it: the asker, or the spark that started the asking agent.
  public let spark: String?
  /// The desktop whose queue holds it, where an answer goes; nil from a daemon before IOS-12a.
  public let device: String?
  /// When it was asked (ISO).
  public let asked: String
  /// The asker's own words, cut at 2,000 when `cut`.
  public let words: String?
  public let cut: Bool
  public let choices: [String]?
  public let count: Int64?
  /// An agent's own ask: its blocker's kind (`permission` | `question`, OPEN), and a permission's tool.
  public let ask: String?
  public let tool: String?
  public let unknownFields: [String]

  /// The kind as this build names it, else nil (`needsKindOf`).
  public var knownKind: NeedsItemKind? { NeedsItemKind(rawValue: kind) }

  public init(json: JSONValue) throws {
    let shape = "NeedsItem"
    var object = try WireObject(shape: shape, value: json)
    guard let id = try SparkWire.id(&object, "id", shape: shape, SparkWire.isNeedsId, "a needs id") else {
      throw object.missing("id")
    }
    self.id = id
    kind = try object.text("kind", 1...32)
    state = try object.text("state", 1...32)
    from = try object.requiredObject("from", NeedsFrom.init(json:))
    spark = try SparkWire.id(&object, "spark", shape: shape, SparkWire.isSparkId, "a spark id")
    device = try object.typedString("device", SparkWire.device)
    asked = try object.text("asked", 1...Int.max)
    words = try object.typedString("words", SparkWire.needsWords)
    cut = try object.strict("cut") { raw in
      guard raw.boolValue == true else { throw WireDecodeError(shape: shape, reason: "`cut` is not true") }
      return true
    } ?? false
    choices = try object.strict("choices") { raw in
      guard let elements = raw.arrayValue, SparkWire.needsChoices.contains(elements.count) else {
        throw WireDecodeError(shape: shape, reason: "`choices` is not 1 to 5 choices")
      }
      return try elements.map { element in
        guard let text = element.stringValue, SparkWire.needsChoice.contains(text.utf16.count) else {
          throw WireDecodeError(shape: shape, reason: "a choice is not 1 to 40 characters")
        }
        return text
      }
    }
    count = try object.typedInt("count", atLeast: 1)
    _ = try object.strictObject("to") { raw in
      var to = try WireObject(shape: "NeedsItem.to", value: raw)
      return (try to.text("session", 1...Int.max), try to.text("name", SparkWire.needsName))
    }
    _ = try object.typedString("agent", 1...128)
    _ = try object.typedString("folder", 1...255)
    _ = try object.typedInt("live", atLeast: 0)
    ask = try object.typedString("ask", 1...32)
    tool = try object.typedString("tool", 1...128)
    _ = try object.strictObject("answer") { raw in
      var answer = try WireObject(shape: "NeedsAnswer", value: raw)
      let choice = try answer.integer("choice", atLeast: 0)
      guard choice <= 4 else { throw WireDecodeError(shape: "NeedsAnswer", reason: "`choice` is past 4") }
      _ = try answer.text("at", 1...Int.max)
      _ = try answer.text("outcome", 1...32)
      _ = try answer.typedString("reason", SparkWire.needsReason)
      _ = try answer.flag("told")
      _ = try answer.typedString("waits", SparkWire.needsReason)
      return choice
    }
    unknownFields = object.unknownFields
  }
}

/// `needs.list`'s answer (and every `needs.subscribe` frame, one desktop's): the open items, oldest first, whole.
public struct NeedsList: Sendable, Equatable {
  public let items: [NeedsItem]
  /// Items this build could not read, by id. The list stands without them.
  public let refused: [SparkRowRefusal]
  public let desktops: [ComposeDesktop]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "NeedsListResult", value: json)
    var items: [NeedsItem] = []
    var refused: [SparkRowRefusal] = []
    for element in try object.requiredArray(strict: "items") {
      do {
        items.append(try NeedsItem(json: element))
      } catch {
        refused.append(SparkRowRefusal(key: SparkWire.key(element, SparkWire.isNeedsId), reason: "\(error)"))
      }
    }
    self.items = items
    self.refused = refused
    desktops = try ComposeDesktop.list(&object, shape: "NeedsListResult")
    unknownFields = object.unknownFields
  }
}

// MARK: - What the phone asks

/// `compose.sparks.list` and `needs.list`'s params: the phone asks its home for every self desktop's (`mesh`).
public struct ComposeListParams: Sendable, Equatable {
  public enum Scope: String, Sendable { case local, mesh }
  public let scope: Scope?

  public static let mesh = ComposeListParams(scope: .mesh)

  public var json: JSONValue {
    var fields: [String: JSONValue] = [:]
    if let scope { fields["scope"] = .string(scope.rawValue) }
    return .object(fields)
  }
}

/// `compose.sparks.open`'s params: wake a spark, on the desktop it lives on (the home forwards; PC-L2).
public struct ComposeSparksOpenParams: Sendable, Equatable {
  public let spark: String
  public let device: String?

  public init(spark: String, device: String?) {
    self.spark = spark
    self.device = device
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["spark": .string(spark)]
    if let device { fields["device"] = .string(device) }
    return .object(fields)
  }
}
