import Foundation

// MARK: - The agent catalog (`agent.catalog`, AC-D9)
//
// VibeField's one list of the agents it supports (`packages/contracts/src/
// agent-catalog.ts`, AC-1) reaches the phone OVER THE WIRE, never as a table
// compiled in here: the desktop is the authority, and this phone may be a build
// behind it (AC-D9). `agent.catalog {surface: "phone"}` answers the rows a phone
// may show — `declined` rows never leave fieldd, and the door applies each row's
// `surfaces` for the surface that asked.
//
// Narrowed like every reader in this target: a phone reads a row's id, its
// label, its status, its mark and whether it is a phone's to show. The seam
// columns (`seams`, `layoutRoot`) are fieldd's business and "shown by no
// surface"; `offers`, `admitted` and `decision` have no reader on a phone yet.
// Each of them is CARRIED as an unknown field's name, never refused.

/// `AgentCatalogParams` (`agent-catalog.ts`) — which surface is asking, so the
/// door can apply each row's `surfaces` for it.
public struct AgentCatalogParams: Sendable, Equatable {
  public enum Surface: String, Sendable, Equatable {
    case desktop
    case phone
  }

  public let surface: Surface?

  public init(surface: Surface? = nil) { self.surface = surface }

  /// The phone's own ask.
  public static let phone = AgentCatalogParams(surface: .phone)

  public var json: JSONValue {
    var fields: [String: JSONValue] = [:]
    if let surface { fields["surface"] = .string(surface.rawValue) }
    return .object(fields)
  }
}

/// One catalog row — the contracts' `AgentCatalogEntry` in its tolerant wire
/// form — narrowed to what a phone draws.
public struct AgentCatalogRow: Sendable, Equatable, Decodable, Identifiable {
  /// The catalog id: puppeteer's provider id verbatim (AC-D2), so the same
  /// string a field row's `kind` carries. An OPEN grammar, read as a string and
  /// never compared to a literal (R23b).
  public let id: String
  /// What every surface calls the agent (AC-D4 — VibeField's name, not the
  /// vendor's).
  public let label: String
  /// AC-D3's decision word, CARRIED RAW: `supported`, `preview` or `deprecated`
  /// from today's desktops (`declined` never leaves fieldd). A word a newer
  /// desktop adds is kept as the word it is, never a refused row.
  public let status: String
  /// The presentation key for the mark atlases, when the row names one. Absent
  /// means the id, which is the contract's own default.
  public let mark: String?
  /// `surfaces.phone` — `nil` when the row did not say.
  public let phone: Bool?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentCatalogEntry", value: json)
    id = try object.requiredString("id")
    label = try object.requiredString("label")
    status = try object.requiredString("status")
    mark = object.string("mark").flatMap { $0.isEmpty ? nil : $0 }
    var surfaces = object.object("surfaces")
    phone = surfaces.bool("phone")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `AgentCatalogResult` — `agent.catalog`'s answer: the rows in the catalog's
/// DISPLAY ORDER, which is a decision too (AC-1), so it is kept as sent.
public struct AgentCatalogResult: Sendable, Equatable, Decodable {
  public let catalog: [AgentCatalogRow]
  /// Rows this build could not read, by reason. One unreadable row is not an
  /// unreadable catalog — the agent it named is drawn by its raw id, like any
  /// agent no catalog decided on — but it is named here rather than swallowed.
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentCatalogResult", value: json)
    var dropped: [String] = []
    catalog = try object.rows("catalog", AgentCatalogRow.init(json:), dropped: &dropped)
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}
