import Foundation

// VibeField's agent catalog as a surface receives it (AC-D9) — the domain half
// of `agent.catalog`. The wire half (`AgentCatalogResult`) is FieldProduct's,
// and FieldMesh folds one into the other for the reason it folds a board into
// snapshots: this target stays the pure domain it is and never learns a wire
// type.
//
// What the phone takes from it is PRESENTATION: an agent's name (the catalog's
// label, AC-D4), the key its mark is drawn by, and whether a list on this
// surface may show it. None of it selects behaviour, and nothing here compares
// an id to a literal (R23b) — the catalog is the table, and it arrives from the
// desktop, which is the authority; the phone may be a build behind it.
//
// THE TOLERANT READER STANDS (R4). An id with no row — an older desktop with no
// `agent.catalog` door, a newer peer's agent this desktop never decided on, or
// a row the door keeps off this surface (ACP, AC-D7) — still draws: the label
// its field row carries is its name (fieldd stamps the catalog's since AC-3; an
// older desktop stamps the adapter's), its raw id when the row carries none,
// and its letter is its mark. What it never becomes is a row a picker offers,
// because an offer is a decision and none is known.

/// One row of the catalog, as the field uses it.
public struct AgentCatalogEntry: Sendable, Equatable, Identifiable {
  /// The catalog id — the string a field row's `kind` carries (AC-D2).
  public let id: AgentProvider
  /// What every surface calls the agent (AC-D4).
  public let label: String
  /// AC-D3's decision word, raw: `supported`, `preview` or `deprecated` from
  /// today's desktops. A word this build has no case for is carried as sent.
  public let status: String
  /// The key the mark atlases are read by: the row's `mark`, else its id — the
  /// contract's own default, applied once, here.
  public let mark: String
  /// `surfaces.phone`. `false` keeps the agent off a phone's lists; its sessions
  /// still draw (R4). `nil` is a row that did not say — and the door has already
  /// applied `surfaces` for the phone, so an unsaid row is one it let through.
  public let onPhone: Bool?

  public init(
    id: AgentProvider, label: String, status: String, mark: String? = nil, onPhone: Bool? = nil
  ) {
    self.id = id
    self.label = label
    self.status = status
    self.mark = mark ?? id.rawValue
    self.onPhone = onPhone
  }
}

/// The catalog a surface holds: its rows in the catalog's DISPLAY ORDER (a
/// decision too, AC-1), one per id.
public struct AgentCatalog: Sendable, Equatable {
  public let entries: [AgentCatalogEntry]

  /// One row per id, the FIRST kept. A catalog that named an agent twice would
  /// have two answers to "what is it called", and a lookup that returned the
  /// first match was already this rule, unwritten.
  public init(entries: [AgentCatalogEntry]) {
    var seen = Set<AgentProvider>()
    self.entries = entries.filter { seen.insert($0.id).inserted }
  }

  /// No catalog: nothing asked yet, or a desktop from before the door. Not a
  /// broken state — every agent still draws, by the word its row carries and
  /// its letter.
  public static let empty = AgentCatalog(entries: [])

  public var isEmpty: Bool { entries.isEmpty }

  /// The row for an id, or nil — an id this catalog never decided on.
  public func entry(for provider: AgentProvider) -> AgentCatalogEntry? {
    entries.first { $0.id == provider }
  }

  /// The agents a PHONE lists, in display order: every row except the ones that
  /// keep themselves off it (`surfaces.phone == false` — ACP, a protocol and
  /// desktop-only, AC-D7). This is what a picker or a roster on the phone reads,
  /// and the phone has neither yet; a session of an agent missing from it still
  /// draws on the field (R4), because the field shows what desktops RUN, and a
  /// list shows what the phone may offer.
  public var phoneRoster: [AgentCatalogEntry] {
    entries.filter { $0.onPhone != false }
  }

  /// This catalog, then `other` for every agent this one did not decide on. A
  /// desktop's rows are named by its own door's answer first; a desktop a build
  /// behind has no door, and its agents are still the same agents.
  public func backed(by other: AgentCatalog) -> AgentCatalog {
    AgentCatalog(entries: entries + other.entries)
  }
}

extension AgentProvider {
  /// What a surface calls this agent: its catalog row's label (AC-D4), else
  /// the label the producer stamped on its field row (`orLabel`: fieldd's is
  /// the catalog's since AC-3, an older desktop's the adapter's own — and a
  /// desktop's ACP session reaches a phone this way, the door keeping that row
  /// off the phone's catalog), else the raw id — the only honest name left.
  public func displayName(with entry: AgentCatalogEntry?, orLabel label: String? = nil) -> String
  {
    if let entry, entry.id == self { return entry.label }
    if let label, !label.isEmpty { return label }
    return rawValue
  }

  /// The same, looked up in a whole catalog.
  public func displayName(in catalog: AgentCatalog) -> String {
    displayName(with: catalog.entry(for: self))
  }

  /// The key this agent's mark is drawn by: the catalog's `mark` (which is the
  /// id unless the row names another), else the id.
  public func markKey(with entry: AgentCatalogEntry?) -> String {
    guard let entry, entry.id == self else { return rawValue }
    return entry.mark
  }
}
