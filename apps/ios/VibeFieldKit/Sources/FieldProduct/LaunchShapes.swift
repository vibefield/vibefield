import Foundation

// PJ-7 (2026-10-14) — what the phone's launch sheet reads and sends (PJ-6's
// shapes, `packages/contracts/src/agent-session.ts` and `agent-index.ts`):
// `agent.models` (one agent's own picker under one Agent Profile),
// `agents.profileSets.list` (the Agent Profiles), and `agent.spawn` /
// `agent.resume` as the phone asks them. Every id the agent owns — a model's,
// a control's, a value's, a profile set's — is carried OPAQUE (AR-L1): read as
// a string, sent back as it came, never compared to a literal. The goldens
// under `Tests/FieldProductTests/Fixtures` are the contracts' own bytes
// (`pnpm check:ios-fixtures` names the launch set REQUIRED).

/// A launch's model, puppeteer's `AgentModelSelection` carried OPAQUE: the
/// keys this build reads and every key it does not, sent back whole (a newer
/// fieldd's key must reach the spawn — the record it is kept in is signed).
public struct AgentModelSelection: Sendable, Equatable {
  public let modelId: String
  public let custom: Bool?
  public let controls: [String: String]
  public let unknownFields: [String]
  private let extra: [String: JSONValue]

  public init(modelId: String, controls: [String: String] = [:], custom: Bool? = nil) {
    self.modelId = modelId
    self.controls = controls
    self.custom = custom
    unknownFields = []
    extra = [:]
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelSelection", value: json)
    modelId = try object.requiredString("modelId")
    custom = object.bool("custom")
    controls = (object.value("controls")?.objectValue ?? [:]).compactMapValues(\.stringValue)
    let unknown = object.unknownFields
    unknownFields = unknown
    extra = object.fields.filter { unknown.contains($0.key) }
  }

  public var json: JSONValue {
    var fields = extra
    fields["modelId"] = .string(modelId)
    if let custom { fields["custom"] = .bool(custom) }
    fields["controls"] = .object(controls.mapValues(JSONValue.string))
    return .object(fields)
  }
}

/// One value a control offers: its id (what a selection carries) and its label.
public struct AgentModelControlValue: Sendable, Equatable, Identifiable {
  public let id: String
  public let label: String

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelControlValue", value: json)
    id = try object.requiredString("id")
    label = object.string("label") ?? id
  }
}

/// One of a model's own controls: `role` names what it is (`effort` today; an
/// OPEN word — a role a newer agent adds is drawn by its label, never refused).
public struct AgentModelControl: Sendable, Equatable, Identifiable {
  public let id: String
  public let label: String
  public let role: String
  public let values: [AgentModelControlValue]
  public let defaultValue: String?

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelControl", value: json)
    id = try object.requiredString("id")
    label = object.string("label") ?? id
    role = object.string("role") ?? ""
    var dropped: [String] = []
    values = object.optionalRows("values", AgentModelControlValue.init(json:), dropped: &dropped)
    defaultValue = object.string("defaultValue")
  }
}

/// One model the agent's picker offers.
public struct AgentModelChoice: Sendable, Equatable, Identifiable {
  public let id: String
  public let label: String
  public let description: String?
  public let controls: [AgentModelControl]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelChoice", value: json)
    id = try object.requiredString("id")
    label = object.string("label") ?? id
    description = object.string("description")
    _ = object.string("group")
    var dropped: [String] = []
    controls = object.optionalRows("controls", AgentModelControl.init(json:), dropped: &dropped)
  }

  /// The control whose role is `effort`, when the model has one.
  public var effort: AgentModelControl? { controls.first { $0.role == "effort" } }
}

/// The picker as one read found it. The folder the read ran in is the
/// desktop's fact; the phone does not draw it.
public struct AgentModelCatalog: Sendable, Equatable {
  public let provider: String
  public let observedAt: String
  /// whether the agent answered from its own cache (open)
  public let freshness: String
  public let completeness: String
  public let customModels: Bool
  public let models: [AgentModelChoice]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelCatalog", value: json)
    provider = try object.requiredString("provider")
    _ = object.string("profileId")
    _ = object.string("cwd")
    observedAt = object.string("observedAt") ?? ""
    var source = object.object("source")
    freshness = source.string("freshness") ?? "unknown"
    _ = source.string("kind")
    _ = source.string("nativeVersion")
    completeness = object.string("completeness") ?? "complete"
    customModels = object.bool("customModels") ?? false
    var dropped: [String] = []
    models = object.optionalRows("models", AgentModelChoice.init(json:), dropped: &dropped)
  }
}

/// A read that found no picker, in puppeteer's words: `status` (open:
/// `auth-required`, `unsupported`, `unavailable`, …), `code`, the sentence.
public struct AgentModelsFailure: Sendable, Equatable {
  public let status: String
  public let code: String
  public let message: String
  public let at: String

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelsFailure", value: json)
    status = try object.requiredString("status")
    code = object.string("code") ?? status
    message = object.string("message") ?? ""
    at = object.string("at") ?? ""
  }
}

/// `agent.models`' answer: the last picker a read found and, beside it, why
/// the last read failed — a failed read is a `failure`, never an empty list.
public struct AgentModelsResult: Sendable, Equatable {
  public let provider: String
  public let profileSet: String?
  public let catalog: AgentModelCatalog?
  public let failure: AgentModelsFailure?
  public let refreshing: Bool
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentModelsResult", value: json)
    provider = try object.requiredString("provider")
    profileSet = object.string("profileSet")
    catalog = try object.decodeObject("catalog", AgentModelCatalog.init(json:))
    failure = try object.decodeObject("failure", AgentModelsFailure.init(json:))
    refreshing = object.bool("refreshing") ?? false
    unknownFields = object.unknownFields
  }
}

/// `agent.models` as the phone asks it: the agent and the Agent Profile, and
/// NEVER a folder (P1) — fieldd reads in the desktop's home.
public struct AgentModelsParams: Sendable, Equatable {
  public let provider: String
  public let profileSet: String?
  public let refresh: Bool?

  public init(provider: String, profileSet: String? = nil, refresh: Bool? = nil) {
    self.provider = provider
    self.profileSet = profileSet
    self.refresh = refresh
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["provider": .string(provider)]
    if let profileSet { fields["profileSet"] = .string(profileSet) }
    if let refresh { fields["refresh"] = .bool(refresh) }
    return .object(fields)
  }
}

/// One Agent Profile (`AgentProfileSet`), narrowed to what a launch reads: its
/// id, kind (`native` is the agents' own folders), label, glyph, whether it is
/// the default, and which agents it holds a sign-in for. The personas' folders,
/// emails and plans are a Settings page's, not the sheet's.
public struct AgentProfileSet: Sendable, Equatable, Identifiable {
  public let id: String
  public let kind: String
  public let label: String
  public let glyph: String?
  public let isDefault: Bool
  /// the agents (catalog ids) this profile holds a persona for, in its order
  public let providers: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentProfileSet", value: json)
    id = try object.requiredString("id")
    kind = object.string("kind") ?? "managed"
    label = object.string("label") ?? id
    glyph = object.string("glyph")
    isDefault = object.bool("default") ?? false
    var providers: [String] = []
    for persona in object.array("personas") ?? [] {
      if let provider = persona["provider"]?.stringValue, !providers.contains(provider) { providers.append(provider) }
    }
    self.providers = providers
  }
}

/// `agents.profileSets.list`'s answer.
public struct AgentProfileSetsResult: Sendable, Equatable {
  public let sets: [AgentProfileSet]
  /// fieldd is still reading the agents' own folders' identities
  public let reading: Bool
  public let droppedRows: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentProfileSetsResult", value: json)
    var dropped: [String] = []
    sets = try object.rows("sets", AgentProfileSet.init(json:), dropped: &dropped)
    reading = object.bool("reading") ?? false
    droppedRows = dropped
  }
}

/// `agent.spawn` as the phone asks it: the agent, WHERE — a place by its ref
/// (History's and the bloom's launches, PJ-7 Q1) or a folder by its path (FS-2's
/// Browse, until PJ-8) — and, when chosen, the Agent Profile and the model.
public struct AgentSpawnParams: Codable, Sendable, Equatable {
  public let provider: String
  public let cwd: String?
  public let place: PlaceRef?
  public let profileSet: String?
  public let modelSelection: AgentModelSelection?

  public init(
    provider: String, cwd: String? = nil, place: PlaceRef? = nil, profileSet: String? = nil,
    modelSelection: AgentModelSelection? = nil
  ) {
    self.provider = provider
    self.cwd = cwd
    self.place = place
    self.profileSet = profileSet
    self.modelSelection = modelSelection
  }

  public init(from decoder: any Decoder) throws {
    let json = try JSONValue(from: decoder)
    var object = try WireObject(shape: "AgentSpawnParams", value: json)
    provider = try object.requiredString("provider")
    cwd = object.string("cwd")
    place = try object.decodeObject("place", PlaceRef.init(json:))
    profileSet = object.string("profileSet")
    modelSelection = try object.decodeObject("modelSelection", AgentModelSelection.init(json:))
  }

  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["provider": .string(provider)]
    if let cwd { fields["cwd"] = .string(cwd) }
    if let place { fields["place"] = place.json }
    if let profileSet { fields["profileSet"] = .string(profileSet) }
    if let modelSelection { fields["modelSelection"] = modelSelection.json }
    return .object(fields)
  }
}

/// `agent.resume`'s native form as History's Resume asks it (PJ-D10 (a)): the
/// conversation by the agent's own id, on its OWN desktop's door, with no path
/// — that desktop fills the folder from its own index (PJ-7 Q3).
public struct AgentResumeNativeParams: Sendable, Equatable {
  public let provider: String
  public let nativeSessionId: String

  public init(provider: String, nativeSessionId: String) {
    self.provider = provider
    self.nativeSessionId = nativeSessionId
  }

  public var json: JSONValue {
    .object(["provider": .string(provider), "nativeSessionId": .string(nativeSessionId)])
  }
}
