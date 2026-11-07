import Foundation

// IOS-12f (PC-D8 A; DESIGN.md §8 "The phone's Chat", New spark) — `agent.providers`' rows, as the New spark sheet
// reads them on the home: each agent the home's catalog lists, whether it is installed there, and fieldd's word on
// whether it may be a spark (`offers.spark`, CP-5a). A row with no claim comes from a daemon older than it, read by
// the briefing it declares (CP-1d). The tolerant reader's rule at every depth: `offers` is partial, and an unknown key
// rides through as an unknown field, never a refusal.

/// The per-run briefing an agent's runtime declares (CP-1d). A missing field claims no support.
public struct AgentBriefing: Sendable, Equatable {
  public let mcpServers: Bool?
  public let allowTools: Bool?
  public let instructions: Bool?
  /// `terminal`, or a topology this build does not know, never read as terminal ancestry
  public let mcpServerProcess: String?

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentBriefing", value: json)
    mcpServers = object.bool("mcpServers")
    allowTools = object.bool("allowTools")
    instructions = object.bool("instructions")
    mcpServerProcess = object.string("mcpServerProcess")
  }
}

/// One row of `agent.providers` (`AgentProviderSummary`): the agent by the catalog's id and label (AR-L1: opaque).
public struct AgentProviderSummary: Sendable, Equatable, Identifiable {
  public let id: String
  public let label: String
  /// installed on the desktop that answered
  public let available: Bool
  public let briefing: AgentBriefing?
  /// fieldd's word on the catalog's spark claim for that desktop; nil from a daemon older than the claim
  public let spark: Bool?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentProviderSummary", value: json)
    id = try object.requiredString("id")
    label = object.string("label") ?? id
    available = object.bool("available") ?? false
    briefing = try object.decodeObject("briefing", AgentBriefing.init(json:))
    var offers = object.object("offers")
    spark = offers.bool("spark")
    _ = object.value("resumable")
    _ = object.value("personas")
    unknownFields = object.unknownFields
  }
}

/// `agent.providers`' answer.
public struct AgentProvidersResult: Sendable, Equatable {
  public let providers: [AgentProviderSummary]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentProvidersResult", value: json)
    providers = try object.requiredArray("providers").map(AgentProviderSummary.init(json:))
  }
}
