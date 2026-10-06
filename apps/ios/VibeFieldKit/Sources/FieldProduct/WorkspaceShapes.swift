import Foundation

// FS-2: the row tier only. Requests use export ids and relative paths; answers
// carry the desktop's absolute paths. Original JSON is kept for Codable's
// round trip, including fields from a newer desktop (EL9 / tolerant reader).
public protocol WorkspaceWireShape: Codable, Sendable {
  var wire: JSONValue { get }
  init(json: JSONValue) throws
}

extension WorkspaceWireShape {
  public init(from decoder: any Decoder) throws {
    try self.init(json: JSONValue(from: decoder))
  }
  public func encode(to encoder: any Encoder) throws { try wire.encode(to: encoder) }
}

public struct WorkspaceRoot: WorkspaceWireShape, Equatable, Identifiable {
  public let wire: JSONValue
  public let rootId: String
  public let name: String
  public let path: String
  public let device: String
  public let kind: String
  public let browse: String?
  public let missing: Bool
  public let lastActiveAt: String?
  public let unknownFields: [String]
  public var id: String { rootId }

  public init(json: JSONValue) throws {
    wire = json
    var o = try WireObject(shape: "WorkspaceRoot", value: json)
    rootId = try o.requiredString("rootId")
    name = try o.requiredString("name")
    path = try o.requiredString("path")
    device = try o.requiredString("device")
    kind = try o.requiredString("kind")
    browse = o.string("browse")
    missing = try o.requiredBool("missing")
    lastActiveAt = o.string("lastActiveAt")
    unknownFields = o.unknownFields
  }
}

/// List entries and search hits have the same presentation. Only a search
/// hit carries `relativePath`; kinds stay open and only `dir` is traversable.
public struct WorkspaceEntry: WorkspaceWireShape, Equatable, Identifiable {
  public let wire: JSONValue
  public let id: Int64
  public let name: String
  public let path: String
  public let kind: String
  public let relativePath: String?
  public let childCount: Int64?
  public let size: Int64?
  public let mtime: Double?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    wire = json
    var o = try WireObject(shape: "WorkspaceEntry", value: json)
    id = try o.requiredInt("id")
    name = try o.requiredString("name")
    path = try o.requiredString("path")
    kind = try o.requiredString("kind")
    relativePath = o.string("relativePath")
    childCount = o.int("childCount")
    size = o.int("size")
    mtime = o.double("mtime")
    unknownFields = o.unknownFields
  }
}

public struct WorkspaceRootsResult: WorkspaceWireShape, Equatable {
  public let wire: JSONValue
  public let roots: [WorkspaceRoot]
  public let clipped: Bool
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    wire = json
    var o = try WireObject(shape: "WorkspaceRootsResult", value: json)
    var dropped: [String] = []
    roots = try o.rows("roots", WorkspaceRoot.init(json:), dropped: &dropped)
    clipped = try o.requiredBool("clipped")
    droppedRows = dropped
    unknownFields = o.unknownFields
  }
}

public struct WorkspaceListResult: WorkspaceWireShape, Equatable {
  public let wire: JSONValue
  public let rootId: String
  public let path: String
  public let entries: [WorkspaceEntry]
  public let nextCursor: String?
  public let clipped: Bool
  public let total: Int64
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    wire = json
    var o = try WireObject(shape: "WorkspaceListResult", value: json)
    rootId = try o.requiredString("rootId")
    path = try o.requiredString("path")
    var dropped: [String] = []
    entries = try o.rows("entries", WorkspaceEntry.init(json:), dropped: &dropped)
    nextCursor = o.string("nextCursor")
    clipped = try o.requiredBool("clipped")
    total = try o.requiredInt("total")
    droppedRows = dropped
    unknownFields = o.unknownFields
  }
}

public struct WorkspaceSearchResult: WorkspaceWireShape, Equatable {
  public let wire: JSONValue
  public let rootId: String
  public let hits: [WorkspaceEntry]
  public let clipped: Bool
  public let complete: Bool
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    wire = json
    var o = try WireObject(shape: "WorkspaceSearchResult", value: json)
    rootId = try o.requiredString("rootId")
    var dropped: [String] = []
    hits = try o.rows("hits", WorkspaceEntry.init(json:), dropped: &dropped)
    clipped = try o.requiredBool("clipped")
    complete = try o.requiredBool("complete")
    droppedRows = dropped
    unknownFields = o.unknownFields
  }
}

public struct WorkspaceListParams: Codable, Sendable, Equatable {
  public let rootId: String
  public let path: String
  public let cursor: String?
  public let kinds: String
  public init(rootId: String, path: String = "", cursor: String? = nil, kinds: String = "dirs") {
    self.rootId = rootId; self.path = path; self.cursor = cursor; self.kinds = kinds
  }
  public var json: JSONValue {
    var fields: [String: JSONValue] = [
      "rootId": .string(rootId), "path": .string(path), "kinds": .string(kinds),
    ]
    if let cursor { fields["cursor"] = .string(cursor) }
    return .object(fields)
  }
}

public struct WorkspaceSearchParams: Codable, Sendable, Equatable {
  public let rootId: String
  public let path: String
  public let q: String
  public let kinds: String
  public init(rootId: String, path: String = "", q: String, kinds: String = "dirs") {
    self.rootId = rootId; self.path = path; self.q = q; self.kinds = kinds
  }
  public var json: JSONValue {
    .object(["rootId": .string(rootId), "path": .string(path), "q": .string(q), "kinds": .string(kinds)])
  }
}

public struct AgentSpawnParams: Codable, Sendable, Equatable {
  public let provider: String
  public let cwd: String
  public init(provider: String, cwd: String) { self.provider = provider; self.cwd = cwd }
  public var json: JSONValue { .object(["provider": .string(provider), "cwd": .string(cwd)]) }
}
