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

/// One Agent Profile (`AgentProfileSet`), narrowed to what a launch and the
/// meters read: its id, kind (`native` is the agents' own folders), label,
/// glyph, whether it is the default, and which agents it holds a sign-in for;
/// and, for the meters (UM-4, UM-D8 A), its sign-ins (`personas`), the plans
/// they run on (`plans`, absent from an older fieldd) and whether it is a draft
/// no agent has signed in to yet (AO-D14). The personas' folders and holdings
/// are a Settings page's, not the phone's.
public struct AgentProfileSet: Sendable, Equatable, Identifiable {
  public let id: String
  public let kind: String
  public let label: String
  public let glyph: String?
  public let isDefault: Bool
  /// the agents (catalog ids) this profile holds a persona for, in its order
  public let providers: [String]
  /// its sign-ins, each as the meters read it
  public let personas: [AgentPersona]
  /// the plans it runs on, in the order its agents first hold them; nil from a fieldd that names none
  public let plans: [AgentPlan]?
  /// AO-D14 — made by Add a profile… and not kept yet
  public let draft: Bool
  /// sign-ins and plans this build could not read (logs, never the page)
  public let droppedRows: [String]

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
    var dropped: [String] = []
    personas = object.optionalRows("personas", AgentPersona.init(json:), dropped: &dropped)
    plans =
      object.array("plans") == nil ? nil : object.optionalRows("plans", AgentPlan.init(json:), dropped: &dropped)
    draft = object.bool("draft") ?? false
    droppedRows = dropped
  }
}

/// One sign-in of an Agent Profile (`AgentPersona`), as the meters read it: whose reading is its, and whether it is
/// signed in or signing in.
public struct AgentPersona: Sendable, Equatable {
  public let profileId: String
  public let provider: String
  public let label: String
  /// `native-default` (an agent's own folder) or `managed`
  public let kind: String
  /// what the agent's own status said at the last verify; nil before it was read
  public let identity: AgentPersonaIdentity?
  /// its login pane is open
  public let signingIn: Bool
  /// UM-5b — the sign-ins it holds, placed on its profile's plans (`holds`), as the plan filter's join reads them; nil
  /// from a fieldd that names none (the tolerant reader), where the plans' `holders` decide
  public let holds: [AgentHolding]?

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentPersona", value: json)
    profileId = try object.requiredString("profileId")
    provider = try object.requiredString("provider")
    label = object.string("label") ?? profileId
    kind = object.string("kind") ?? "managed"
    // an identity is read only with the one fact it is for, whether someone is signed in
    var said = object.object("identity")
    if let loggedIn = said.bool("loggedIn") {
      identity = AgentPersonaIdentity(
        loggedIn: loggedIn, email: said.string("email"), account: said.string("account"),
        organization: said.string("organization"), plan: said.string("plan"))
    } else {
      identity = nil
    }
    signingIn = object.value("signingIn")?.objectValue != nil
    holds = object.array("holds")?.map(AgentHolding.init(json:))
  }
}

/// One sign-in a persona holds (`AgentHolding`), narrowed to what the plan filter's join reads: whether the agent runs
/// on it, whether it is a pay-per-use key, and the plan it is on.
public struct AgentHolding: Sendable, Equatable {
  /// the one the agent runs on
  public let runsOn: Bool
  /// a pay-per-use key, on no plan
  public let key: Bool
  /// the set's plan it is on; nil for a key
  public let planId: String?

  public init(json: JSONValue) {
    runsOn = json["runsOn"]?.boolValue ?? false
    key = json["key"]?.boolValue ?? false
    planId = json["planId"]?.stringValue
  }
}

/// Who signed in to a persona, as its agent said it.
public struct AgentPersonaIdentity: Sendable, Equatable {
  public let loggedIn: Bool
  public let email: String?
  public let account: String?
  public let organization: String?
  public let plan: String?
}

/// The company a sign-in is billed through (`AgentSignInService`).
public struct AgentSignInService: Sendable, Equatable {
  public let id: String
  public let label: String
}

/// Whose a plan is, when an agent in the profile named it, and its tier beside the plan word.
public struct AgentPlanAccount: Sendable, Equatable {
  public let email: String?
  public let account: String?
  public let organization: String?
  public let plan: String?
  /// nil: the tier was not read (or could not be)
  public let planTier: AgentPlanTier?
}

/// A plan's tier (`AgentPlanTier`), carried beside the plan word: the short label a face draws exactly as given
/// ("20x", "200"), made by the agent's adapter. The phone never parses, cases or compares it, and never derives it from
/// the plan word (AR-L1). Three cases, as the desktop's contract has them: no tier at all (nil where it is carried) is
/// not read; a tier with no label is the agent saying this plan has none; a label is the badge.
public struct AgentPlanTier: Sendable, Equatable {
  /// The longest label the contract carries (`PLAN_TIER_LABEL_MAX`; check-ios-fixtures pins the two together).
  public static let labelMax = 8
  public let label: String?

  /// `AgentPlanTier()` is the agent saying the plan has none.
  public init(label: String? = nil) {
    self.label = label
  }

  /// The tier the wire carries, read as the desktop's contract reads it (`.optional().catch(undefined)`): a value that
  /// is not an object, or a label that is not one to `labelMax` letters, digits, `.`, `+` or `-`, is not read (nil),
  /// never "none", and never costs the plan. Neither the drop nor a newer field inside it is logged, as no key of
  /// `AgentPlan.account` is.
  public static func read(_ json: JSONValue) -> AgentPlanTier? {
    guard let fields = json.objectValue else { return nil }
    guard let raw = fields["label"] else { return AgentPlanTier(label: nil) }
    guard let label = raw.stringValue, isLabel(label) else { return nil }
    return AgentPlanTier(label: label)
  }

  private static let lower: ClosedRange<Unicode.Scalar> = "a"..."z"
  private static let upper: ClosedRange<Unicode.Scalar> = "A"..."Z"
  private static let digits: ClosedRange<Unicode.Scalar> = "0"..."9"
  private static let marks: Set<Unicode.Scalar> = [".", "+", "-"]

  /// The contract's `PLAN_TIER_LABEL` within its cap. LaunchShapeTests holds it to the tier golden both sides read and
  /// to the contracts' test's own cases.
  static func isLabel(_ text: String) -> Bool {
    let scalars = text.unicodeScalars
    guard (1...labelMax).contains(scalars.count) else { return false }
    return scalars.allSatisfy { scalar in
      lower.contains(scalar) || upper.contains(scalar) || digits.contains(scalar) || marks.contains(scalar)
    }
  }
}

/// One plan an Agent Profile runs on (`AgentPlan`): its company, whose it is, the sign-in that named it (whose reading
/// is the plan's), the sign-ins on it, and the other profiles with the same account.
public struct AgentPlan: Sendable, Equatable {
  public let id: String
  public let service: AgentSignInService
  public let account: AgentPlanAccount?
  public let namedBy: String?
  public let borrowedFrom: String?
  public let holders: [String]
  public let alsoIn: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentPlan", value: json)
    id = try object.requiredString("id")
    var company = object.object("service")
    let serviceId = try company.requiredString("id")
    service = AgentSignInService(id: serviceId, label: company.string("label") ?? serviceId)
    account = try object.decodeObject("account") { raw in
      var whose = try WireObject(shape: "AgentPlan.account", value: raw)
      return AgentPlanAccount(
        email: whose.string("email"), account: whose.string("account"),
        organization: whose.string("organization"), plan: whose.string("plan"),
        planTier: whose.value("planTier").flatMap(AgentPlanTier.read))
    }
    namedBy = object.string("namedBy")
    borrowedFrom = object.string("borrowedFrom")
    holders = (object.array("holders") ?? []).compactMap(\.stringValue)
    alsoIn = (object.array("alsoIn") ?? []).compactMap(\.stringValue)
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
