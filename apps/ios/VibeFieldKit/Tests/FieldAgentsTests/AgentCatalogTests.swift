import Foundation
import Testing

@testable import FieldAgents

// AC-5 — the catalog as the field uses it: a name, a mark key and a phone's
// list, from rows the desktop sent (AC-D9). The rows here are written by hand
// because this target never reads a wire type; the golden's own bytes are
// read through the real reader and fold in `FieldProductTests` and
// `FieldMeshTests`.

private let claudeRow = AgentCatalogEntry(
  id: .claude, label: "Claude Code", status: "supported", onPhone: true)
private let codexRow = AgentCatalogEntry(
  id: .codex, label: "Codex", status: "supported", onPhone: true)
private let acpRow = AgentCatalogEntry(
  id: .acp, label: "ACP", status: "preview", mark: "acp", onPhone: false)

@Suite struct AgentCatalogTests {
  /// AC-D4: what a surface calls an agent is the catalog's label — and with no
  /// row, the raw id, the only honest name there is.
  @Test func anAgentIsNamedByItsRowAndByItsIdWithoutOne() {
    let catalog = AgentCatalog(entries: [claudeRow, codexRow])
    #expect(AgentProvider.claude.displayName(in: catalog) == "Claude Code")
    #expect(AgentProvider.codex.displayName(in: catalog) == "Codex")
    #expect(AgentProvider(rawValue: "hermes").displayName(in: catalog) == "hermes")
    #expect(AgentProvider.claude.displayName(in: .empty) == "claude")
    // A row for a different agent never names this one.
    #expect(AgentProvider.codex.displayName(with: claudeRow) == "codex")
  }

  /// The mark key is the row's `mark`, else its id — the contract's default,
  /// applied once — and the id when there is no row at all.
  @Test func theMarkKeyIsTheRowsMarkElseTheId() {
    #expect(claudeRow.mark == "claude")
    #expect(acpRow.mark == "acp")
    let renamed = AgentCatalogEntry(
      id: AgentProvider(rawValue: "claude-next"), label: "Claude Next", status: "preview",
      mark: "claude")
    #expect(AgentProvider(rawValue: "claude-next").markKey(with: renamed) == "claude")
    #expect(AgentProvider(rawValue: "zed").markKey(with: nil) == "zed")
  }

  /// `surfaces.phone == false` keeps an agent off every list on the phone; an
  /// unsaid row is one the door let through; the order is the catalog's.
  @Test func thePhonesRosterKeepsTheCatalogsOrderAndLeavesOutWhatStaysOffIt() {
    let unsaid = AgentCatalogEntry(id: .grok, label: "Grok", status: "preview")
    let catalog = AgentCatalog(entries: [claudeRow, acpRow, unsaid, codexRow])
    #expect(catalog.phoneRoster.map(\.id) == [.claude, .grok, .codex])
    // …and the row is still there to NAME the agent: a desktop's ACP session
    // draws on the field with its catalog label (R4).
    #expect(AgentProvider.acp.displayName(in: catalog) == "ACP")
  }

  /// AC-D3's word is carried raw; a status this build has no case for is kept
  /// as sent and still names its agent.
  @Test func anUnknownStatusIsCarriedAndStillNames() {
    let row = AgentCatalogEntry(id: .grok, label: "Grok", status: "sunset", onPhone: true)
    let catalog = AgentCatalog(entries: [row])
    #expect(catalog.entry(for: .grok)?.status == "sunset")
    #expect(AgentProvider.grok.displayName(in: catalog) == "Grok")
  }

  /// One row per id, the first kept — the rule a first-match lookup already had.
  @Test func aCatalogThatNamesAnAgentTwiceKeepsTheFirst() {
    let second = AgentCatalogEntry(id: .claude, label: "Claude (again)", status: "preview")
    let catalog = AgentCatalog(entries: [claudeRow, second, codexRow])
    #expect(catalog.entries.map(\.id) == [.claude, .codex])
    #expect(AgentProvider.claude.displayName(in: catalog) == "Claude Code")
  }

  /// A desktop's rows are named by ITS catalog first, then by the others'.
  @Test func aDesktopsOwnCatalogComesFirstAndTheOthersFillTheGaps() {
    let own = AgentCatalog(entries: [
      AgentCatalogEntry(id: .claude, label: "Claude Code (own)", status: "supported")
    ])
    let merged = AgentCatalog(entries: [claudeRow, codexRow])
    let naming = own.backed(by: merged)
    #expect(naming.entries.map(\.id) == [.claude, .codex])
    #expect(AgentProvider.claude.displayName(in: naming) == "Claude Code (own)")
    #expect(AgentProvider.codex.displayName(in: naming) == "Codex")
    #expect(AgentCatalog.empty.backed(by: merged) == merged)
  }

  /// The letter rule (`AgentIcon.tsx`): the first character uppercased, else
  /// `?`. The reference's `acp → A` override is the rule's own answer, which is
  /// why it could go with the statics.
  @Test func theLetterIsTheIdsFirstCharacter() {
    #expect(AgentProvider.acp.markLetter == "A")
    #expect(AgentProvider(rawValue: "zed").markLetter == "Z")
    #expect(AgentProvider(rawValue: "").markLetter == "?")
  }
}

@Suite struct AgentCatalogFacetTests {
  /// The row rides snapshot → bubble → facet, and the facet answers the two
  /// questions the surfaces ask: what is it called, and what does it wear.
  @Test func theSnapshotsRowReachesTheFacet() throws {
    let snapshot = AgentSnapshot(
      id: "run-1", runtimeSessionID: "pty-1", provider: .claude, project: "vibe-field",
      state: AgentRuntimeState(), catalogEntry: claudeRow)
    let facet = try #require(fieldBubble(from: snapshot)?.agent)
    #expect(facet.catalogEntry == claudeRow)
    #expect(facet.providerName == "Claude Code")
    #expect(facet.markKey == "claude")
  }

  /// No row — an older desktop, the scripted fleet, an id no catalog decided
  /// on — is the raw id for a name and the id for a mark: it still draws.
  @Test func withoutARowTheFacetIsItsRawId() throws {
    let snapshot = AgentSnapshot(
      id: "run-2", runtimeSessionID: "pty-2", provider: AgentProvider(rawValue: "hermes"),
      project: "vibe-field", state: AgentRuntimeState())
    let facet = try #require(fieldBubble(from: snapshot)?.agent)
    #expect(facet.catalogEntry == nil)
    #expect(facet.providerName == "hermes")
    #expect(facet.markKey == "hermes")
  }
}
