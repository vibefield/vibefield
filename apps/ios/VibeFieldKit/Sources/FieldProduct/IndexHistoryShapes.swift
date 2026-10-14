import Foundation

// SP-6 (2026-10-04) — the HISTORY reads, as the phone READS them (H-D2, H-D3):
// `index.status` · `index.projects` · `index.sessions` · `index.session` ·
// `index.project` · `index.search` · `index.timeline`, and the tail
// `index.session.subscribe`'s two frames. Hand-written tolerant readers of the
// contracts' shapes (`packages/contracts/src/agent-index.ts`): every accessor
// records the key it touched, so an unknown field is NAMED rather than refused
// (P3), and the goldens under `Tests/FieldProductTests/Fixtures` are the
// contracts' own bytes (`pnpm check:ios-fixtures` keeps the word "copy" true).
//
// Narrowed, as every reader in this target is: a row is read for what a
// History screen DRAWS — a project's name, counts and last activity; a
// session's title, agent, activity and state; a transcript row's kind, stamps,
// words, a tool line's facts, attachments as REFS (what was attached and
// whether its bytes exist upstream — never the bytes, never an address: H-D9,
// EL2). Figures rosetta could not price stay absent, never zero.

/// `IndexCatalogProject` — one project of `index.projects`' page, keyed
/// `{device, projectId}` (identity is `{device, path}`, D30; the family only
/// groups).
public struct IndexProjectRow: Sendable, Equatable, Identifiable, Decodable {
  public let device: String
  public let projectId: String
  public let name: String
  public let rootPaths: [String]
  public let gitRepo: String?
  public let family: String?
  public let sessionCount: Int64
  /// epoch ms, the owner's clock; absent while no session has activity
  public let lastActivityAt: Int64?
  public let unknownFields: [String]

  public var id: String { "\(device)/\(projectId)" }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexCatalogProject", value: json)
    device = try object.requiredString("device")
    projectId = try object.requiredString("projectId")
    name = object.string("name") ?? ""
    rootPaths = (object.array("rootPaths") ?? []).compactMap(\.stringValue)
    gitRepo = object.string("gitRepo")
    family = object.string("family")
    sessionCount = object.int("sessionCount") ?? 0
    lastActivityAt = object.int("lastActivityAt")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexProjectsResult` — a page of projects; `cursor` continues it.
public struct IndexProjectsResult: Sendable, Equatable, Decodable {
  public let rows: [IndexProjectRow]
  public let cursor: String?
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexProjectsResult", value: json)
    var dropped: [String] = []
    rows = try object.rows("rows", IndexProjectRow.init(json:), dropped: &dropped)
    cursor = object.string("cursor")
    _ = object.array("sources")
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// AR-4's evidence, folded: the bounds of recorded conversation activity.
public struct IndexSessionActivity: Sendable, Equatable, Decodable {
  public let firstAt: Int64
  public let lastAt: Int64

  public init(firstAt: Int64, lastAt: Int64) {
    self.firstAt = firstAt
    self.lastAt = lastAt
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSessionActivity", value: json)
    firstAt = try object.requiredInt("firstAt")
    lastAt = try object.requiredInt("lastAt")
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexSession` (a listing's or a lookup's row) and `IndexSessionHeader`
/// (`index.session`'s answer: the same columns with the joins filled — the
/// parent, the persona, the project's name). One reader for both: the header's
/// extra columns are optional on a listing row.
public struct IndexSessionRow: Sendable, Equatable, Identifiable, Decodable {
  public let sessionId: String
  public let nativeSessionId: String
  public let rootSessionId: String
  public let title: String?
  public let summary: String?
  public let cwd: String?
  /// SOURCE freshness (epoch ms), never conversation activity
  public let updatedAt: Int64?
  /// null is "no evidence" — a listing never invents idleness
  public let activity: IndexSessionActivity?
  /// rosetta's ingest state (`pending` · `streaming` · `indexed`, open)
  public let streamState: String
  public let device: String?
  public let projectId: String?
  public let family: String?
  /// the catalog agent id (AC-D2), absent when no row maps the kind
  public let provider: String?
  public let startedAt: Int64?
  public let parentSessionId: String?
  public let profileId: String?
  /// `project.name` on a header; absent on a listing row
  public let projectName: String?
  /// PJ-4 / PJ-7 — the PJ project whose place holds the cwd (`index.sessions`
  /// as a window reads it; absent where no place holds it yet)
  public let projectKey: String?
  /// PJ-7 — the place that holds the cwd (`project.sessions` always says it)
  public let place: PlaceRef?
  /// every desktop that indexed it (DS-D10); `device` is the copy that speaks
  public let devices: [String]
  public let unknownFields: [String]

  public var id: String { sessionId }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSession", value: json)
    sessionId = try object.requiredString("sessionId")
    nativeSessionId = object.string("nativeSessionId") ?? ""
    rootSessionId = object.string("rootSessionId") ?? sessionId
    title = object.string("title")
    summary = object.string("summary")
    cwd = object.string("cwd")
    updatedAt = object.int("updatedAt")
    activity = try object.decodeObject("activity", IndexSessionActivity.init(json:))
    streamState = object.string("streamState") ?? "indexed"
    device = object.string("device")
    devices = (object.array("devices") ?? []).compactMap(\.stringValue)
    projectKey = object.string("projectKey")
    place = try? object.decodeObject("place", PlaceRef.init(json:))
    projectId = object.string("projectId")
    family = object.string("family")
    // the agent's KIND (`claude-code`); the catalog id below is what the
    // phone names an agent by
    _ = object.string("kind")
    provider = object.string("provider")
    startedAt = object.int("startedAt")
    parentSessionId = object.string("parentSessionId")
    profileId = object.string("profileId")
    var project = object.object("project")
    projectName = project.string("name")
    _ = project.string("id")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexSessionsResult` — a listing (with its cursor) or a lookup's rows.
public struct IndexSessionsResult: Sendable, Equatable, Decodable {
  public let rows: [IndexSessionRow]
  public let cursor: String?
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSessionsResult", value: json)
    var dropped: [String] = []
    rows = try object.rows("rows", IndexSessionRow.init(json:), dropped: &dropped)
    cursor = object.string("cursor")
    _ = object.array("sources")
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexSessionResult` — `index.session`'s answer.
public struct IndexSessionResult: Sendable, Equatable, Decodable {
  public let session: IndexSessionRow
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSessionResult", value: json)
    guard let session = try object.decodeObject("session", IndexSessionRow.init(json:)) else {
      throw WireDecodeError(shape: "IndexSessionResult", reason: "missing `session`")
    }
    self.session = session
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// One day of a project's heatmap: the tokens, and the list-price cost when
/// rosetta priced it (absent when it could not — never zero).
public struct IndexHeatmapDay: Sendable, Equatable, Decodable {
  public let day: String
  public let tokens: Double
  public let costMicroUsd: Double?

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexHeatmapDay", value: json)
    day = try object.requiredString("day")
    tokens = object.double("tokens") ?? 0
    costMicroUsd = object.double("costMicroUsd")
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// One model's tokens on one day (`IndexModelDay`).
public struct IndexModelDay: Sendable, Equatable, Decodable {
  public let day: String
  public let model: String
  public let tokens: Double

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexModelDay", value: json)
    day = try object.requiredString("day")
    model = object.string("model") ?? "unknown"
    tokens = object.double("tokens") ?? 0
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// One session's contribution to its project (`IndexContribution`).
public struct IndexContribution: Sendable, Equatable, Decodable {
  public let sessionId: String
  public let commits: Double
  public let edits: Double
  public let loc: Double
  public let messages: Double
  public let tokens: Double
  public let costMicroUsd: Double?
  /// PJ-4 — the desktop whose index recorded it (`project.figures`' rows)
  public let device: String?

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexContribution", value: json)
    sessionId = try object.requiredString("sessionId")
    _ = object.string("projectId")
    device = object.string("device")
    commits = object.double("commits") ?? 0
    edits = object.double("edits") ?? 0
    loc = object.double("loc") ?? 0
    messages = object.double("messages") ?? 0
    tokens = object.double("tokens") ?? 0
    costMicroUsd = object.double("costMicroUsd")
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexProjectResult` — a project's panels in one answer (AR-8b): the
/// heatmap, its decomposition by model, the per-session contribution, and
/// SP-D13's word for a cut contribution list.
public struct IndexProjectResult: Sendable, Equatable, Decodable {
  public let projectId: String
  public let heatmap: [IndexHeatmapDay]
  public let models: [IndexModelDay]
  public let contribution: [IndexContribution]
  public let clipped: Bool
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexProjectResult", value: json)
    projectId = try object.requiredString("projectId")
    var dropped: [String] = []
    heatmap = object.optionalRows("heatmap", IndexHeatmapDay.init(json:), dropped: &dropped)
    var usage = object.object("usage")
    models = usage.optionalRows("models", IndexModelDay.init(json:), dropped: &dropped)
    _ = usage.array("hours")
    contribution = object.optionalRows("contribution", IndexContribution.init(json:), dropped: &dropped)
    clipped = object.bool("clipped") ?? false
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// One search hit (`IndexSearchHit`), attributed to the root a reader lands in.
public struct IndexSearchHit: Sendable, Equatable, Identifiable, Decodable {
  public let sessionId: String
  public let rootSessionId: String?
  public let nativeSessionId: String?
  public let title: String?
  public let timelineId: String
  /// `user` or `agent` today; anything else is shown as itself
  public let kind: String
  public let at: Int64?
  /// matches marked with `[` and `]`, the way rosetta marks them
  public let snippet: String
  public let device: String?
  public let unknownFields: [String]

  public var id: String { "\(sessionId)/\(timelineId)" }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSearchHit", value: json)
    sessionId = try object.requiredString("sessionId")
    rootSessionId = object.string("rootSessionId")
    nativeSessionId = object.string("nativeSessionId")
    title = object.string("title")
    timelineId = try object.requiredString("timelineId")
    kind = object.string("kind") ?? "agent"
    at = object.int("at")
    snippet = object.string("snippet") ?? ""
    device = object.string("device")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexSearchResult` — `answered: false` is the honest "the index had no
/// answer" (a sheet keeps what it last showed); `clipped` says the daemon
/// stopped at its limit.
public struct IndexSearchResult: Sendable, Equatable, Decodable {
  public let answered: Bool
  public let readiness: String?
  public let detail: String?
  public let hits: [IndexSearchHit]
  public let clipped: Bool
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSearchResult", value: json)
    answered = object.bool("answered") ?? false
    var state = object.object("state")
    readiness = state.string("readiness")
    detail = state.string("detail")
    _ = state.bool("canonicalReady")
    _ = state.object("progress")
    var dropped: [String] = []
    hits = object.optionalRows("hits", IndexSearchHit.init(json:), dropped: &dropped)
    clipped = object.bool("clipped") ?? false
    _ = object.array("sources")
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexStatus`, narrowed to the pill's and the scope line's facts: the
/// folded phase, the daemon's protocol, the search projection's readiness and
/// its counters, and how many runtimes the index lists.
public struct IndexStatusResult: Sendable, Equatable, Decodable {
  public let phase: String
  public let daemonPhase: String?
  public let protocolVersion: Int64?
  public let searchReachable: Bool?
  public let searchReadiness: String?
  public let searchDone: Double?
  public let searchTotal: Double?
  public let searchDetail: String?
  public let runtimeCount: Int
  public let enabledKinds: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexStatus", value: json)
    phase = object.string("phase") ?? "unknown"
    var daemon = object.object("rosettad")
    daemonPhase = daemon.string("phase")
    protocolVersion = daemon.int("protocolVersion")
    _ = daemon.string("detail")
    _ = daemon.int("pid")
    var search = object.object("search")
    searchReachable = search.bool("reachable")
    searchReadiness = search.string("readiness")
    var progress = search.object("progress")
    searchDone = progress.double("done")
    searchTotal = progress.double("total")
    searchDetail = search.string("detail")
    _ = search.object("capabilities")
    _ = search.bool("canonicalReady")
    runtimeCount = object.array("runtimes")?.count ?? 0
    var enrollment = object.object("enrollment")
    enabledKinds = (enrollment.array("enabledKinds") ?? []).compactMap(\.stringValue)
    _ = enrollment.array("runtimes")
    _ = enrollment.array("retired")
    _ = enrollment.string("updatedAt")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

// MARK: - The transcript (SP-6)

/// An attachment as a REF: what was attached, and whether rosetta recorded
/// its bytes — never the bytes, never an address (H-D9, EL2).
public struct IndexTimelineAttachment: Sendable, Equatable, Identifiable, Decodable {
  public let id: String
  /// image · document · audio · video · file (open)
  public let kind: String
  public let name: String?
  public let mediaType: String?
  public let byteLen: Int64?
  public let available: Bool
  public let reason: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexTimelineAttachment", value: json)
    id = try object.requiredString("id")
    kind = object.string("kind") ?? "file"
    name = object.string("name")
    mediaType = object.string("mediaType")
    byteLen = object.int("byteLen")
    available = object.bool("available") ?? false
    reason = object.string("reason")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// A tool line's facts: the native tool's name, the action's family (open),
/// its status (open), the one object it acted on, the result in a few words,
/// the duration, the recorded output as refs.
public struct IndexTimelineTool: Sendable, Equatable, Decodable {
  public let name: String
  public let family: String
  public let status: String
  public let failed: Bool
  public let failure: String?
  public let object: String?
  public let objectClipped: Bool
  public let result: String?
  public let durationMs: Int64?
  public let attachments: [IndexTimelineAttachment]
  public let droppedAttachments: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexTimelineTool", value: json)
    name = object.string("name") ?? "tool"
    family = object.string("family") ?? "unknown"
    status = object.string("status") ?? "unknown"
    failed = object.bool("failed") ?? false
    failure = object.string("failure")
    self.object = object.string("object")
    objectClipped = object.bool("objectClipped") ?? false
    result = object.string("result")
    durationMs = object.int("durationMs")
    var dropped: [String] = []
    attachments = object.optionalRows("attachments", IndexTimelineAttachment.init(json:), dropped: &dropped)
    droppedAttachments = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// The five token buckets a reply's head sums (absent = never reported).
public struct IndexTimelineUsage: Sendable, Equatable, Decodable {
  public let input: Double?
  public let output: Double?
  public let cacheRead: Double?
  public let cacheWrite: Double?
  public let thinking: Double?

  /// Every bucket that was reported, summed — nil when none was.
  public var total: Double? {
    let buckets = [input, output, cacheRead, cacheWrite, thinking].compactMap { $0 }
    return buckets.isEmpty ? nil : buckets.reduce(0, +)
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexTimelineUsage", value: json)
    input = object.double("input")
    output = object.double("output")
    cacheRead = object.double("cacheRead")
    cacheWrite = object.double("cacheWrite")
    thinking = object.double("thinking")
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// One timeline row as the door answers it (`IndexTimelineRow`), keyed by
/// `timelineId` — the tail's deltas upsert by it.
public struct IndexTimelineRow: Sendable, Equatable, Identifiable, Decodable {
  public let timelineId: String
  public let sessionId: String
  public let ordinal: Double
  /// the body's type: user · agent · thinking · tool_use · notice · summary ·
  /// collaboration (open)
  public let kind: String
  public let at: Int64?
  public let model: String?
  public let effort: String?
  public let groupId: String
  /// human_turn · agent_cycle · parent_invocation · system_cycle · synthetic (open)
  public let groupKind: String
  public let responseId: String?
  public let text: String?
  public let textClipped: Bool
  public let textByteLen: Int64?
  public let attachments: [IndexTimelineAttachment]
  public let tool: IndexTimelineTool?
  public let notice: String?
  public let summaryPurpose: String?
  public let usage: IndexTimelineUsage?
  public let costMicroUsd: Double?
  public let droppedAttachments: [String]
  public let unknownFields: [String]

  public var id: String { timelineId }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexTimelineRow", value: json)
    timelineId = try object.requiredString("timelineId")
    sessionId = try object.requiredString("sessionId")
    guard let ordinal = object.double("ordinal") else {
      throw WireDecodeError(shape: "IndexTimelineRow", reason: "missing number `ordinal`")
    }
    self.ordinal = ordinal
    kind = object.string("kind") ?? "unknown"
    at = object.int("at")
    model = object.string("model")
    effort = object.string("effort")
    var group = object.object("group")
    groupId = group.string("id") ?? ""
    groupKind = group.string("kind") ?? "synthetic"
    responseId = object.string("responseId")
    text = object.string("text")
    textClipped = object.bool("textClipped") ?? false
    textByteLen = object.int("textByteLen")
    var dropped: [String] = []
    attachments = object.optionalRows("attachments", IndexTimelineAttachment.init(json:), dropped: &dropped)
    tool = try object.decodeObject("tool", IndexTimelineTool.init(json:))
    notice = object.string("notice")
    summaryPurpose = object.string("summaryPurpose")
    usage = try object.decodeObject("usage", IndexTimelineUsage.init(json:))
    costMicroUsd = object.double("costMicroUsd")
    droppedAttachments = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `IndexTimelineResult` — one backward page: oldest first within the page,
/// `nextCursor` to the older page (nil at the top), `clipped` when a tailnet
/// bound cut it, `watermark` the projection generation the page belongs to.
public struct IndexTimelineResult: Sendable, Equatable, Decodable {
  public let sessionId: String
  public let entries: [IndexTimelineRow]
  public let nextCursor: String?
  public let clipped: Bool
  public let watermark: String
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexTimelineResult", value: json)
    sessionId = try object.requiredString("sessionId")
    var dropped: [String] = []
    entries = try object.rows("entries", IndexTimelineRow.init(json:), dropped: &dropped)
    nextCursor = object.string("nextCursor")
    clipped = object.bool("clipped") ?? false
    watermark = object.string("watermark") ?? ""
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// The tail's open (and a reset): `{epoch, revision, rows}` — the client's
/// subscription table hands a rows snapshot over WHOLE, pages assembled.
public struct IndexSessionTailSnapshot: Sendable, Equatable, Decodable {
  public let epoch: String?
  public let revision: Int64
  public let rows: [IndexTimelineRow]
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSessionTailSnapshot", value: json)
    epoch = object.string("epoch")
    revision = try object.requiredInt("revision")
    var dropped: [String] = []
    rows = try object.rows("rows", IndexTimelineRow.init(json:), dropped: &dropped)
    _ = object.bool("more")
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// The tail's delta: `upserts` keyed by `timelineId`, `removed` their keys.
public struct IndexSessionTailDelta: Sendable, Equatable, Decodable {
  public let epoch: String?
  public let since: Int64
  public let revision: Int64
  public let upserts: [IndexTimelineRow]
  public let removed: [String]
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexSessionTailDelta", value: json)
    epoch = object.string("epoch")
    since = try object.requiredInt("since")
    revision = try object.requiredInt("revision")
    var dropped: [String] = []
    upserts = object.optionalRows("upserts", IndexTimelineRow.init(json:), dropped: &dropped)
    removed = (object.array("removed") ?? []).compactMap(\.stringValue)
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}
