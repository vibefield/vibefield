import Foundation
import Testing

@testable import FieldProduct

// AC-5 — `agent.catalog`'s answer on the third side. `agent-catalog.valid.json`
// under `Fixtures/` is a COPY of `packages/contracts/fixtures/` (AC-1 writes it
// from the table in `agent-catalog.ts`), gated byte for byte by
// `pnpm check:ios-fixtures`, so a catalog change upstream is a red here before
// it is a wrong name on a phone.

@Suite struct AgentCatalogShapeTests {
  /// The golden reads whole, in the catalog's display order, with every row's
  /// label and decision as the table wrote them.
  @Test func theGoldenCatalogReadsInItsDisplayOrder() throws {
    let result = try AgentCatalogResult(json: try Fixture.json("agent-catalog.valid"))
    #expect(result.droppedRows.isEmpty)
    #expect(result.unknownFields.isEmpty)
    #expect(
      result.catalog.map(\.id) == [
        "claude", "codex", "grok", "kimi", "opencode", "hermes", "antigravity", "copilot", "pi",
        "acp",
      ])
    #expect(
      result.catalog.map(\.label) == [
        "Claude Code", "Codex", "Grok", "Kimi Code", "OpenCode", "Hermes", "Antigravity",
        "GitHub Copilot", "Pi", "ACP",
      ])
    #expect(result.catalog.prefix(2).allSatisfy { $0.status == "supported" })
    #expect(result.catalog.dropFirst(2).allSatisfy { $0.status == "preview" })
  }

  /// Narrowed on purpose: the seam columns are fieldd's and "shown by no
  /// surface", and the rest has no phone reader yet. Each is NAMED as unread,
  /// never refused.
  @Test func aRowReadsWhatAPhoneDrawsAndNamesTheRest() throws {
    let result = try AgentCatalogResult(json: try Fixture.json("agent-catalog.valid"))
    let claude = try #require(result.catalog.first)
    #expect(claude.mark == nil)  // absent — the id is the mark key
    #expect(claude.phone == true)
    #expect(claude.unknownFields == ["admitted", "decision", "layoutRoot", "offers", "seams"])

    // AC-D7: the protocol agent keeps itself off the phone. Its `mark` is
    // absent too since the review (it equalled the id, the contract's own
    // default) — a row that DOES name one is read as sent:
    let acp = try #require(result.catalog.last)
    #expect(acp.mark == nil)
    #expect(acp.phone == false)
    let named = try AgentCatalogResult(
      json: .object([
        "catalog": .array([
          .object([
            "id": .string("claude-next"), "label": .string("Claude Next"),
            "status": .string("preview"), "mark": .string("claude"),
          ])
        ])
      ]))
    #expect(named.catalog.first?.mark == "claude")
  }

  /// AC-D3's word is carried RAW: a status a newer desktop adds is a row, not a
  /// refusal — and a row that says nothing about surfaces is a row that did not
  /// say, never a `false`.
  @Test func aStatusThisBuildHasNoWordForIsCarriedAsSent() throws {
    let row = try AgentCatalogRow(
      json: .object([
        "id": .string("zed"), "label": .string("Zed"), "status": .string("sunset"),
        "somethingNew": .bool(true),
      ]))
    #expect(row.status == "sunset")
    #expect(row.phone == nil)
    #expect(row.mark == nil)
    #expect(row.unknownFields == ["somethingNew"])
  }

  /// One unreadable row costs that row, named — never the catalog. Its agent is
  /// then drawn by its raw id, like any agent no catalog decided on.
  @Test func aRowWithoutItsIdOrLabelIsDroppedAndNamed() throws {
    let result = try AgentCatalogResult(
      json: .object([
        "catalog": .array([
          .object(["id": .string("codex"), "label": .string("Codex"), "status": .string("supported")]),
          .object(["label": .string("Nameless"), "status": .string("preview")]),
          .object(["id": .string("grok"), "status": .string("preview")]),
        ])
      ]))
    #expect(result.catalog.map(\.id) == ["codex"])
    #expect(result.droppedRows.count == 2)
    #expect(result.droppedRows.allSatisfy { $0.contains("AgentCatalogEntry") })
  }

  @Test func anAnswerWithNoCatalogIsUnreadableRatherThanEmpty() {
    #expect(throws: WireDecodeError.self) {
      try AgentCatalogResult(json: .object(["rows": .array([])]))
    }
  }

  /// The one-line call site reads it through `Decodable`, as every reader here.
  @Test func theClientsDecodablePathReadsTheSameBytes() throws {
    let url = try #require(
      Bundle.module.url(
        forResource: "agent-catalog.valid", withExtension: "json", subdirectory: "Fixtures"))
    let decoded = try JSONDecoder().decode(AgentCatalogResult.self, from: Data(contentsOf: url))
    #expect(decoded == (try AgentCatalogResult(json: try Fixture.json("agent-catalog.valid"))))
  }

  /// The phone names its surface, so the door applies each row's `surfaces`.
  @Test func thePhoneAsksAsAPhone() {
    #expect(AgentCatalogParams.phone.json == .object(["surface": .string("phone")]))
    #expect(AgentCatalogParams().json == .object([:]))
  }
}
