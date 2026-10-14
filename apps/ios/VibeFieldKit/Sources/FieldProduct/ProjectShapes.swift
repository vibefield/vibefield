import Foundation

// PJ-7 (2026-10-14) — the `project.*` doors as the phone READS them (PJ-3,
// PJ-4, PJ-6; `packages/contracts/src/project-doors.ts`): a project is a set
// of places grouped across every self desktop, and every desktop answers the
// same grouping, so History reads ONE door for the ledger. Hand-written
// tolerant readers like every reader in this target: an unknown key is NAMED,
// never refused, and the goldens under `Tests/FieldProductTests/Fixtures` are
// the contracts' own bytes (`pnpm check:ios-fixtures` names the project set
// REQUIRED).
//
// P1 (a), James 2026-10-08: a REQUEST names a place by `PlaceRef {device,
// placeId}` and never by its path — no params shape below can carry one. An
// ANSWER to the person's own phone may carry a place's `path`; the phone does
// not draw it (TP §6.3: the folder's name, never its path).

/// How a reader names a place: its device and its opaque id, never its path.
public struct PlaceRef: Sendable, Equatable, Hashable, Codable {
  public let device: String
  public let placeId: String

  public init(device: String, placeId: String) {
    self.device = device
    self.placeId = placeId
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "PlaceRef", value: json)
    device = try object.requiredString("device")
    placeId = try object.requiredString("placeId")
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }

  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }

  public var json: JSONValue { .object(["device": .string(device), "placeId": .string(placeId)]) }
}

/// One place of a project (`ProjectPlace`): its folder's own name, its class,
/// its branch, whether its folder is there. `path` rides an answer to the
/// person's own devices only, and the phone never draws it.
public struct ProjectPlace: Sendable, Equatable, Identifiable {
  public let ref: PlaceRef
  public let name: String
  public let path: String?
  /// repo · local · folder · home · temp — open; an unknown class reads `folder`
  public let placeClass: String
  public let branch: String?
  public let worktreeOf: PlaceRef?
  public let exists: Bool
  public let mounted: Bool
  public let sessions: Int64
  /// epoch ms, the owner's clock
  public let lastAt: Int64?
  public let unknownFields: [String]

  public var id: String { "\(ref.device)/\(ref.placeId)" }
  /// Whether a launch can land there: the folder is there and its volume is in.
  public var canTakeLaunch: Bool { exists && mounted }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectPlace", value: json)
    guard let ref = try object.decodeObject("ref", PlaceRef.init(json:)) else {
      throw WireDecodeError(shape: "ProjectPlace", reason: "missing `ref`")
    }
    self.ref = ref
    name = object.string("name") ?? ""
    path = object.string("path")
    placeClass = object.string("class") ?? "folder"
    branch = object.string("branch")
    worktreeOf = try? object.decodeObject("worktreeOf", PlaceRef.init(json:))
    exists = object.bool("exists") ?? true
    mounted = object.bool("mounted") ?? true
    sessions = object.int("sessions") ?? 0
    lastAt = object.int("lastAt")
    unknownFields = object.unknownFields
  }
}

/// PJ-6 — the project's launch recipe: the last launch from VibeField's own
/// controls into one of its places. Every id is the agent's own, OPAQUE
/// (AR-L1). PJ-7 — `place`, the place that launch entered (PJ-D6's "your last
/// launch's place"), when the desktop that wrote it knew it.
public struct ProjectRecipe: Sendable, Equatable {
  public let provider: String
  public let profileSet: String
  public let selection: AgentModelSelection?
  public let controlsByModel: [String: [String: String]]
  public let at: Int64
  public let place: PlaceRef?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectRecipe", value: json)
    provider = try object.requiredString("provider")
    profileSet = try object.requiredString("profileSet")
    selection = try object.decodeObject("selection", AgentModelSelection.init(json:))
    var controls: [String: [String: String]] = [:]
    for (model, values) in object.value("controlsByModel")?.objectValue ?? [:] {
      controls[model] = (values.objectValue ?? [:]).compactMapValues(\.stringValue)
    }
    controlsByModel = controls
    at = object.int("at") ?? 0
    place = try object.decodeObject("place", PlaceRef.init(json:))
    unknownFields = object.unknownFields
  }
}

/// `ProjectSummary` v2 — one project as a door answers it.
public struct ProjectSummary: Sendable, Equatable, Identifiable {
  public let key: String
  public let provisional: Bool
  public let name: String
  /// you · repository · folder · home · bucket — open
  public let nameFrom: String
  public let disambiguation: String?
  /// the deal index of the project's ink (DESIGN.md §2.9)
  public let ink: Int
  /// the place class the project is (`home` is a desktop's Home, J11)
  public let kind: String
  /// `temp` (Temporary) or nil; a value this reader does not know reads nil
  public let bucket: String?
  public let devices: [String]
  /// newest first
  public let places: [ProjectPlace]
  public let sessions: Int64
  public let firstAt: Int64?
  public let lastAt: Int64?
  public let allGone: Bool
  public let anchors: [String]
  /// device → when the answering desktop last heard that device's rows (ISO)
  public let asOf: [String: String]
  public let groupingVersion: Int64
  public let pinned: Bool
  public let hidden: Bool
  /// an unreadable recipe reads as none, never a refused project
  public let recipe: ProjectRecipe?
  public let droppedPlaces: [String]
  public let unknownFields: [String]

  public var id: String { key }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectSummary", value: json)
    key = try object.requiredString("key")
    provisional = object.bool("provisional") ?? true
    name = object.string("name") ?? ""
    nameFrom = object.string("nameFrom") ?? "folder"
    _ = object.array("alsoCalled")
    disambiguation = object.string("disambiguation")
    ink = Int(object.int("ink") ?? 0)
    kind = object.string("kind") ?? "folder"
    bucket = object.string("bucket").flatMap { $0 == "temp" ? $0 : nil }
    devices = (object.array("devices") ?? []).compactMap(\.stringValue)
    var dropped: [String] = []
    places = object.optionalRows("places", ProjectPlace.init(json:), dropped: &dropped)
    sessions = object.int("sessions") ?? 0
    firstAt = object.int("firstAt")
    lastAt = object.int("lastAt")
    allGone = object.bool("allGone") ?? false
    anchors = (object.array("anchors") ?? []).compactMap(\.stringValue)
    asOf = (object.value("asOf")?.objectValue ?? [:]).compactMapValues(\.stringValue)
    groupingVersion = object.int("groupingVersion") ?? 0
    pinned = object.bool("pinned") ?? false
    hidden = object.bool("hidden") ?? false
    recipe = (try? object.decodeObject("recipe", ProjectRecipe.init(json:))) ?? nil
    droppedPlaces = dropped
    unknownFields = object.unknownFields
  }
}

/// `IndexCatalogSource` — one desktop's standing in a merged answer (DS-L8:
/// asleep is a state, never a blank): `live` · `stale` · `asleep` ·
/// `incompatible`, open.
public struct CatalogSource: Sendable, Equatable, Identifiable {
  public let device: String
  public let name: String?
  public let isSelf: Bool
  public let state: String
  public let asOf: String?
  public let rows: Int64

  public var id: String { device }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexCatalogSource", value: json)
    device = try object.requiredString("device")
    name = object.string("name")
    isSelf = object.bool("self") ?? false
    state = object.string("state") ?? "live"
    asOf = object.string("asOf")
    rows = object.int("rows") ?? 0
  }
}

/// `project.list`'s page.
public struct ProjectListResult: Sendable, Equatable {
  public let rows: [ProjectSummary]
  public let cursor: String?
  public let sources: [CatalogSource]
  public let groupingVersion: Int64
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectListResult", value: json)
    var dropped: [String] = []
    rows = try object.rows("rows", ProjectSummary.init(json:), dropped: &dropped)
    cursor = object.string("cursor")
    sources = object.optionalRows("sources", CatalogSource.init(json:), dropped: &dropped)
    groupingVersion = object.int("groupingVersion") ?? 0
    droppedRows = dropped
    unknownFields = object.unknownFields
  }
}

/// `project.get` — the project, and where a key that regrouped moved (D9).
/// The suggestions and the edges are a desktop window's (the phone has no
/// act on them, Q2): counted, never read for meaning.
public struct ProjectGetResult: Sendable, Equatable {
  public let project: ProjectSummary
  public let movedTo: String?
  public let suggestions: Int
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectGetResult", value: json)
    guard let project = try object.decodeObject("project", ProjectSummary.init(json:)) else {
      throw WireDecodeError(shape: "ProjectGetResult", reason: "missing `project`")
    }
    self.project = project
    movedTo = object.string("movedTo")
    suggestions = object.array("suggestions")?.count ?? 0
    _ = object.array("edges")
    unknownFields = object.unknownFields
  }
}

/// `project.sessions` — a project's sessions, each joined to its place and
/// naming the desktop whose copy speaks (`device`: whose door holds its
/// document). A row with no place is not a `project.sessions` row: dropped
/// and named.
public struct ProjectSessionsResult: Sendable, Equatable {
  public let key: String
  public let movedTo: String?
  public let rows: [IndexSessionRow]
  public let cursor: String?
  public let sources: [CatalogSource]
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectSessionsResult", value: json)
    key = try object.requiredString("key")
    movedTo = object.string("movedTo")
    var dropped: [String] = []
    rows = try object.rows(
      "rows",
      { value in
        let row = try IndexSessionRow(json: value)
        guard row.place != nil, row.device != nil else {
          throw WireDecodeError(shape: "ProjectSessionRow", reason: "missing `place`")
        }
        return row
      }, dropped: &dropped)
    cursor = object.string("cursor")
    sources = object.optionalRows("sources", CatalogSource.init(json:), dropped: &dropped)
    droppedRows = dropped
    unknownFields = object.unknownFields
  }
}

/// How one desktop took part in a merged figure (`ProjectFiguresSource`).
public struct FiguresSource: Sendable, Equatable {
  public let device: String
  /// answered · building · asleep · timeout · incompatible, open
  public let state: String
  public let detail: String?
  public let projects: Int64
  public let split: Int64

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectFiguresSource", value: json)
    device = try object.requiredString("device")
    state = object.string("state") ?? "answered"
    _ = object.int("tookMs")
    _ = object.bool("clipped")
    detail = object.string("detail")
    projects = object.int("projects") ?? 0
    split = object.int("split") ?? 0
  }
}

/// `project.figures` — one merged figure across every desktop, honest when
/// partial: the heatmap and its models (daily), each session's contribution
/// with the desktop that recorded it (lifetime).
public struct ProjectFiguresResult: Sendable, Equatable {
  public let key: String
  public let movedTo: String?
  public let heatmap: [IndexHeatmapDay]
  public let models: [IndexModelDay]
  public let contribution: [IndexContribution]
  public let sources: [FiguresSource]
  public let partial: Bool
  public let lifetimePartial: Bool
  public let clipped: Bool
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectFiguresResult", value: json)
    key = try object.requiredString("key")
    movedTo = object.string("movedTo")
    var dropped: [String] = []
    heatmap = object.optionalRows("heatmap", IndexHeatmapDay.init(json:), dropped: &dropped)
    var usage = object.object("usage")
    models = usage.optionalRows("models", IndexModelDay.init(json:), dropped: &dropped)
    _ = usage.array("hours")
    contribution = object.optionalRows("contribution", IndexContribution.init(json:), dropped: &dropped)
    sources = object.optionalRows("sources", FiguresSource.init(json:), dropped: &dropped)
    partial = object.bool("partial") ?? false
    lifetimePartial = object.bool("lifetimePartial") ?? false
    clipped = object.bool("clipped") ?? false
    droppedRows = dropped
    unknownFields = object.unknownFields
  }
}

/// One hour of one model's tokens on a day (`IndexModelHour`).
public struct IndexModelHour: Sendable, Equatable {
  public let hour: Int64
  public let model: String
  public let tokens: Double

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexModelHour", value: json)
    hour = try object.requiredInt("hour")
    model = object.string("model") ?? "unknown"
    tokens = object.double("tokens") ?? 0
  }
}

/// `project.figuresDay` — one day of a project's hours by model.
public struct ProjectFiguresDayResult: Sendable, Equatable {
  public let key: String
  public let movedTo: String?
  public let day: String
  public let models: [IndexModelHour]
  public let sources: [FiguresSource]
  public let partial: Bool
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectFiguresDayResult", value: json)
    key = try object.requiredString("key")
    movedTo = object.string("movedTo")
    day = try object.requiredString("day")
    var dropped: [String] = []
    models = object.optionalRows("models", IndexModelHour.init(json:), dropped: &dropped)
    sources = object.optionalRows("sources", FiguresSource.init(json:), dropped: &dropped)
    partial = object.bool("partial") ?? false
    droppedRows = dropped
    unknownFields = object.unknownFields
  }
}

/// `project.subscribe`'s open (and a reset): rows are always empty — a ping
/// subscription; the revision is what moves.
public struct ProjectChangesSnapshot: Sendable, Equatable {
  public let epoch: String?
  public let revision: Int64

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectChangesSnapshot", value: json)
    epoch = object.string("epoch")
    revision = try object.requiredInt("revision")
    _ = object.array("rows")
    _ = object.bool("more")
  }
}

/// A key move (D9): `from` regrouped into `to`.
public struct ProjectRegrouped: Sendable, Equatable, Hashable {
  public let from: String
  public let to: String

  public init(from: String, to: String) {
    self.from = from
    self.to = to
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectRegrouped", value: json)
    from = try object.requiredString("from")
    to = try object.requiredString("to")
  }
}

/// A `project.delta` ping: a reader re-asks what it shows; a key it holds
/// that moved arrives as `regrouped`.
public struct ProjectChangesDelta: Sendable, Equatable {
  public let epoch: String?
  public let since: Int64
  public let revision: Int64
  public let regrouped: [ProjectRegrouped]
  public let devices: [String]
  /// which catalog tables moved, when nothing else did; nil: everything moved
  public let tables: [String]?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectChangesDelta", value: json)
    epoch = object.string("epoch")
    since = try object.requiredInt("since")
    revision = try object.requiredInt("revision")
    _ = object.array("upserts")
    _ = object.array("removed")
    var dropped: [String] = []
    regrouped = object.optionalRows("regrouped", ProjectRegrouped.init(json:), dropped: &dropped)
    devices = (object.array("devices") ?? []).compactMap(\.stringValue)
    tables = object.array("tables")?.compactMap(\.stringValue)
    _ = object.string("digest")
    unknownFields = object.unknownFields
  }
}

/// Why a `project.*` door said no (`ProjectRefusal`, beside the error kind):
/// a reason word a reader branches on, never a sentence.
public struct ProjectRefusal: Sendable, Equatable {
  public let reason: String
  public let field: String?
  public let movedTo: String?

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProjectRefusal", value: json)
    reason = try object.requiredString("reason")
    field = object.string("field")
    movedTo = object.string("movedTo")
  }
}

// MARK: - The asks (every place by `PlaceRef`, never a path — P1)

/// `project.list`.
public struct ProjectListParams: Sendable, Equatable {
  public let cursor: String?
  public let limit: Int?
  public let devices: [String]?
  public let q: String?

  public init(cursor: String? = nil, limit: Int? = nil, devices: [String]? = nil, q: String? = nil) {
    self.cursor = cursor
    self.limit = limit
    self.devices = devices
    self.q = q
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = [:]
    if let cursor { fields["cursor"] = .string(cursor) }
    if let limit { fields["limit"] = .int(Int64(limit)) }
    if let devices { fields["devices"] = .array(devices.map(JSONValue.string)) }
    if let q { fields["q"] = .string(q) }
    return .object(fields)
  }
}

/// `project.get {key | anchor}` — exactly one.
public enum ProjectGetParams: Sendable, Equatable {
  case key(String)
  case anchor(String)

  public var json: JSONValue {
    switch self {
    case .key(let key): .object(["key": .string(key)])
    case .anchor(let anchor): .object(["anchor": .string(anchor)])
    }
  }
}

/// `project.sessions`.
public struct ProjectSessionsParams: Sendable, Equatable {
  public let key: String
  public let places: [PlaceRef]?
  public let devices: [String]?
  public let agents: [String]?
  public let cursor: String?
  public let limit: Int?

  public init(
    key: String, places: [PlaceRef]? = nil, devices: [String]? = nil, agents: [String]? = nil,
    cursor: String? = nil, limit: Int? = nil
  ) {
    self.key = key
    self.places = places
    self.devices = devices
    self.agents = agents
    self.cursor = cursor
    self.limit = limit
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["key": .string(key)]
    if let places { fields["places"] = .array(places.map(\.json)) }
    if let devices { fields["devices"] = .array(devices.map(JSONValue.string)) }
    if let agents { fields["agents"] = .array(agents.map(JSONValue.string)) }
    if let cursor { fields["cursor"] = .string(cursor) }
    if let limit { fields["limit"] = .int(Int64(limit)) }
    return .object(fields)
  }
}

/// `project.figures`.
public struct ProjectFiguresParams: Sendable, Equatable {
  public let key: String
  public let sinceMs: Int64?
  public let offsetMinutes: Int?

  public init(key: String, sinceMs: Int64? = nil, offsetMinutes: Int? = nil) {
    self.key = key
    self.sinceMs = sinceMs
    self.offsetMinutes = offsetMinutes
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["key": .string(key)]
    if let sinceMs { fields["sinceMs"] = .int(sinceMs) }
    if let offsetMinutes { fields["offsetMinutes"] = .int(Int64(offsetMinutes)) }
    return .object(fields)
  }
}

/// `project.figuresDay`.
public struct ProjectFiguresDayParams: Sendable, Equatable {
  public let key: String
  public let day: String
  public let offsetMinutes: Int?

  public init(key: String, day: String, offsetMinutes: Int? = nil) {
    self.key = key
    self.day = day
    self.offsetMinutes = offsetMinutes
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["key": .string(key), "day": .string(day)]
    if let offsetMinutes { fields["offsetMinutes"] = .int(Int64(offsetMinutes)) }
    return .object(fields)
  }
}

/// `project.subscribe` — resume from a kept cursor, at the reader's own pace.
public struct ProjectSubscribeParams: Sendable, Equatable {
  public struct Cursor: Sendable, Equatable {
    public let epoch: String
    public let revision: Int64

    public init(epoch: String, revision: Int64) {
      self.epoch = epoch
      self.revision = revision
    }
  }

  public let since: Cursor?
  public let minIntervalMs: Int?

  public init(since: Cursor? = nil, minIntervalMs: Int? = nil) {
    self.since = since
    self.minIntervalMs = minIntervalMs
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = [:]
    if let since { fields["since"] = .object(["epoch": .string(since.epoch), "revision": .int(since.revision)]) }
    if let minIntervalMs { fields["minIntervalMs"] = .int(Int64(minIntervalMs)) }
    return .object(fields)
  }
}
