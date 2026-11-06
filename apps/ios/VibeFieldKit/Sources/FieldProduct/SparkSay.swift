import Foundation

// SKELETON (M-c1's c2, red first): the types the rows read; nothing is checked, encoded or read yet.
// IOS-12c (M-c1; PC-D3 A; IOS-12a §C) — YOUR WORDS TO A SPARK, on the wire: `compose.sparks.say`'s params and its
// receipt (`ComposeSparksSayParams` and `ComposeSparksSayResult`, packages/contracts/src/compose.ts), held to the
// contracts' own fixtures (SparkSayTests). The words join the spark's session's input queue as yours and unmarked, and
// land at its next idle moment; a spark asleep is woken first. Asking again with the same request id reads that send's
// receipt instead of queueing the words twice, so a retry after a lost answer keeps its id. A request id this build
// would send malformed is refused here, before any call.

extension SparkTranscriptChip {
  /// A chip the composer lays in your words: `start` and `length` in UTF-16 units, as the window counts.
  public init(start: Int, length: Int, kind: String) {
    self.start = start
    self.length = length
    self.kind = kind
  }

  var json: JSONValue {
    .object(["start": .int(Int64(start)), "length": .int(Int64(length)), "kind": .string(kind)])
  }
}

/// Why a say was not sent: refused here, before any call.
public enum SparkSayRefusal: Error, Equatable, Sendable {
  /// Not `[A-Za-z0-9_-]{8,64}`.
  case requestId(String)
  /// Empty, or past `COMPOSE_TEXT_MAX` UTF-16 units.
  case words
  /// More than `COMPOSE_SAY_CHIPS_MAX`, or not each inside the words, in order, none overlapping.
  case chips
}

public enum SparkSay {
  public static let method = "compose.sparks.say"
  /// `COMPOSE_TEXT_MAX`.
  public static let wordsMax = 32_000
  /// `COMPOSE_SAY_CHIPS_MAX`.
  public static let chipsMax = 64

  /// `ComposeSayRequestId`: `/^[A-Za-z0-9_-]{8,64}$/`, ASCII only.
  public static func isRequestId(_ id: String) -> Bool { false }

  public static func requestId() -> String { "" }
}

/// `compose.sparks.say`'s params: the spark, your words, the request id, the spark's desktop when this phone is not
/// its home (the home forwards there, PC-L2), and the chips in your words, in order.
public struct SparkSayParams: Sendable, Equatable {
  public let spark: String
  public let text: String
  public let requestId: String
  public let device: String?
  public let chips: [SparkTranscriptChip]?

  public init(
    spark: String, text: String, requestId: String, device: String? = nil, chips: [SparkTranscriptChip]? = nil
  ) throws {
    self.spark = spark
    self.text = text
    self.requestId = requestId
    self.device = device
    self.chips = chips
  }

  /// The params as they ride: a key only where it has a value.
  public var json: JSONValue { .object([:]) }
}

/// A send's receipt (`ComposeSparksSayResult`). `state` is OPEN (`ChatFlows.sayStates` names the ones this build
/// says; any other says nothing). `position`: its place in the session's queue, 1 being next, while it waits.
public struct SparkSayResult: Sendable, Equatable {
  public let spark: String
  public let requestId: String
  public let state: String
  public let position: Int64?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    spark = ""
    requestId = ""
    state = ""
    position = nil
    unknownFields = []
  }
}
