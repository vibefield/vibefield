import FieldAgents
import FieldProduct

// `agent.catalog`'s answer → the field's `AgentCatalog` (AC-D9). It lives in
// FieldMesh for the reason the board's fold does: this is the one module that
// sees both vocabularies, so FieldAgents never learns a wire type and
// FieldProduct never learns what a field is.

extension AgentCatalog {
  /// The door's rows, in the order it sent them — the catalog's display order.
  /// A row the reader could not read is not here; its agent is drawn by its raw
  /// id like any agent no catalog decided on.
  public init(_ result: AgentCatalogResult) {
    self.init(
      entries: result.catalog.map { row in
        AgentCatalogEntry(
          id: AgentProvider(rawValue: row.id), label: row.label, status: row.status,
          mark: row.mark, onPhone: row.phone)
      })
  }
}
