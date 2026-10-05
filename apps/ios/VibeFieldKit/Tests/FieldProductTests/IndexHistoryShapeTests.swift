import Foundation
import Testing

@testable import FieldProduct

// SP-6 — EL9 on the third side for the History reads: every golden under
// `Fixtures/` is the contracts' own bytes (`pnpm check:ios-fixtures`), and the
// hand-written tolerant readers read them as the TypeScript parsers do — the
// columns a History screen draws, every unknown key NAMED, never refused.

@Suite struct IndexHistoryShapeTests {
  @Test func theStatusReadsItsPhaseAndTheSearchBuild() throws {
    let status = try IndexStatusResult(json: try Fixture.json("index-status.valid"))
    #expect(status.phase == "live")
    #expect(status.daemonPhase == "ready")
    #expect(status.protocolVersion == 20)
    #expect(status.searchReachable == true)
    #expect(status.searchReadiness == "ready")
    #expect(status.searchDone == 90411 && status.searchTotal == 90411)
    #expect(status.runtimeCount == 1)
    #expect(status.enabledKinds == ["claude-code"])
    #expect(status.unknownFields.isEmpty)
  }

  @Test func theProjectsPageReadsEveryRowAndItsCursor() throws {
    let page = try IndexProjectsResult(json: try Fixture.json("index-projects.mesh"))
    #expect(page.rows.count == 2)
    #expect(page.cursor != nil)
    #expect(page.droppedRows.isEmpty)
    let first = try #require(page.rows.first)
    #expect(first.projectId == "p-4f1c2a9e")
    #expect(first.name == "vibe-field")
    #expect(first.rootPaths == ["/Users/me/Projects/vibe-field"])
    #expect(first.family == "github.com/jamesyong42/vibe-field")
    #expect(first.sessionCount == 412)
    #expect(first.lastActivityAt == 1_759_276_800_000)
    // the `//` note is the fixture's own commentary: carried, named, never fatal
    #expect(page.unknownFields == ["//"])
  }

  @Test func aListingRowAndAHeaderReadTheSameColumns() throws {
    let listing = try IndexSessionsResult(json: try Fixture.json("index-sessions.valid"))
    #expect(listing.rows.map(\.sessionId) == ["s_7c1e2f9a", "s_0a4b5c6d"])
    let row = try #require(listing.rows.first)
    #expect(row.title == "Port the swarm to WebGPU")
    #expect(row.activity?.firstAt == 1_789_231_000_000)
    #expect(row.cwd == "/Users/kim/Projects/vibe-field")
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    #expect(header.sessionId == "s1")
    #expect(header.rootSessionId == "s0")
    #expect(header.parentSessionId == "s0")
    #expect(header.projectId == "p1")
    #expect(header.provider == "claude")
    #expect(header.projectName == "rosetta")
    #expect(header.activity?.lastAt == 19000)
  }

  @Test func aRowWithoutItsIdentityIsUnreadableNotEmpty() {
    #expect(throws: WireDecodeError.self) {
      try IndexSessionRow(json: .object(["title": .string("no id")]))
    }
    #expect(throws: WireDecodeError.self) {
      try IndexTimelineRow(json: .object(["timelineId": .string("t1"), "sessionId": .string("s1")]))
    }
  }

  @Test func theProjectFiguresReadTheHeatmapTheModelsAndTheContribution() throws {
    let project = try IndexProjectResult(json: try Fixture.json("index-project.valid"))
    #expect(project.projectId == "p1")
    #expect(project.heatmap.count == 1)
    #expect(project.models.count == 2)
    #expect(project.contribution.count == 1)
    #expect(project.clipped == false)
    // a figure rosetta could not price stays absent, never zero
    #expect(project.heatmap.first?.costMicroUsd != 0 || project.heatmap.first?.costMicroUsd == nil)
  }

  @Test func theSearchAnswerReadsItsHitsAndItsState() throws {
    let search = try IndexSearchResult(json: try Fixture.json("index-search-result.valid"))
    #expect(search.answered)
    #expect(search.readiness == "catching-up")
    #expect(search.clipped == false)
    let hit = try #require(search.hits.first)
    #expect(hit.sessionId == "s1" && hit.rootSessionId == "s0")
    #expect(hit.timelineId == "t1")
    #expect(hit.kind == "user")
    #expect(hit.snippet == "[needle] in a haystack")
  }

  @Test func theTimelinePageReadsEveryKindAndNeverAnAddress() throws {
    let page = try IndexTimelineResult(json: try Fixture.json("index-timeline.valid"))
    #expect(page.sessionId == "s1")
    #expect(page.clipped)
    #expect(page.nextCursor != nil)
    #expect(page.watermark == "1.2.3")
    #expect(page.entries.map(\.kind) == ["user", "tool_use", "agent", "collaboration"])
    let tool = try #require(page.entries[1].tool)
    #expect(tool.name == "Bash" && tool.family == "shell" && tool.status == "succeeded")
    #expect(tool.failed == false)
    #expect(tool.object == "one" && tool.result == "exit 0")
    #expect(tool.attachments.map(\.id) == ["tool-image-1"])
    #expect(tool.attachments.first?.available == true)
    let reply = page.entries[2]
    #expect(reply.text?.hasPrefix("Rendering every row") == true)
    #expect(reply.usage?.input == 10 && reply.usage?.output == 5)
    #expect(reply.usage?.total == 15)
    #expect(reply.costMicroUsd == 175)
    #expect(reply.attachments.first?.name == "specimen.png")
    #expect(reply.attachments.first?.byteLen == 48211)
    #expect(page.entries[3].text == "design docs updated")
    #expect(page.entries[0].responseId == nil && page.entries[1].responseId == "response-1")
    for row in page.entries { #expect(row.unknownFields.isEmpty, "\(row.timelineId): \(row.unknownFields)") }
  }

  @Test func theTailsOpenAndDeltaReadAsRows() throws {
    let open = try Fixture.json("index-session-tail-open.snapshot")
    let snapshot = try IndexSessionTailSnapshot(json: try #require(open["snapshot"]))
    #expect(snapshot.epoch == "tail-s1-3f9a1c2e.1")
    #expect(snapshot.revision == 1)
    #expect(snapshot.rows.count == 4)
    let delta = try IndexSessionTailDelta(json: try Fixture.json("index-session-tail-delta.valid"))
    #expect(delta.epoch == snapshot.epoch)
    #expect(delta.since == 1 && delta.revision == 2)
    #expect(delta.upserts.map(\.timelineId) == ["t1"])
    #expect(delta.upserts.first?.costMicroUsd == 175)
    #expect(delta.removed.isEmpty)
  }

  @Test func theCursorRefusalReadsAsAnErrorAReaderBranchesOn() throws {
    let refusal = try Fixture.json("error-data.index-timeline-cursor-expired")
    #expect(refusal["kind"]?.stringValue == "PRECONDITION_FAILED")
    #expect(refusal["details"]?["reason"]?.stringValue == "cursor-expired")
  }
}
