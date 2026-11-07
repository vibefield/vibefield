import Foundation

// IOS-12f (PC-D8 A; NS-D1 A, NS-D2 B, NS-D5; DESIGN.md §8 "The phone's Chat", New spark) — A SPARK MADE ON YOUR HOME,
// on the wire: `compose.sparks.hatch`'s params and its answer (`ComposeSparksHatchParams` and
// `ComposeSparksHatchResult`, packages/contracts/src/compose.ts). The method is `local`: the home the phone asks
// answers it itself, so the params carry no device and nothing is forwarded. A spark lives on the desktop that hatched
// it (PC-L2), and a phone's sparks on its home. Asked on Chat's door, the home's own client (VF-PM 2026-11-07 13:11:45Z:
// zero door changes).
// SKELETON (f2): the params' wire is f3's; the row in ChatFeedTests is red until then.

public enum SparkHatch {
  public static let method = "compose.sparks.hatch"
}

/// `compose.sparks.hatch`'s params: the name, the face dealt, the agent it thinks with, the model chosen (absent: the
/// agent's own), the profiles it sees, and the one it thinks under.
public struct SparkHatchParams: Sendable, Equatable {
  public let name: String
  public let seed: UInt32
  public let agent: String
  public let modelSelection: AgentModelSelection?
  public let profiles: [String]
  public let thinksUnder: String

  public init(
    name: String, seed: UInt32, agent: String, modelSelection: AgentModelSelection? = nil, profiles: [String],
    thinksUnder: String
  ) {
    self.name = name
    self.seed = seed
    self.agent = agent
    self.modelSelection = modelSelection
    self.profiles = profiles
    self.thinksUnder = thinksUnder
  }

  /// The params as they ride: a key only where it has a value.
  public var json: JSONValue { .object([:]) }
}

/// `compose.sparks.hatch`'s answer: the spark made.
public struct SparkHatchResult: Sendable, Equatable {
  public let spark: SparkSummary

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ComposeSparksHatchResult", value: json)
    spark = try SparkSummary(json: object.value("spark") ?? .null)
  }
}
