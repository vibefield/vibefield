import Foundation
import Testing

@testable import FieldProduct

// PJ-7 — EL9 on the third side for the `project.*` doors (PJ-3, PJ-4, PJ-6):
// every golden under `Fixtures/` is the contracts' own bytes (`pnpm
// check:ios-fixtures` names the project set REQUIRED), and the tolerant
// readers read them as the TypeScript parsers do — every unknown key NAMED,
// never refused. A request names a place by `PlaceRef` only (P1): no params
// shape here can carry a path.

/// A fixture's object without its `//` note — the commentary a params golden
/// carries beside the fields a request sends.
private func withoutNote(_ value: JSONValue) -> JSONValue {
  var fields = value.objectValue ?? [:]
  fields["//"] = nil
  return .object(fields)
}

@Suite struct ProjectShapeTests {
  @Test func aPlaceIsNamedByItsDeviceAndItsOpaqueId() throws {
    let golden = try Fixture.json("place-ref.valid")
    let ref = try PlaceRef(json: golden)
    #expect(ref.device == "01J9ZK3M5Q8XR2V7N4B6C1D0EF")
    #expect(ref.placeId == "pl_4c1e9a0b7d2f6e8a1b3c5d7e")
    #expect(ref.json == withoutNote(golden))
    #expect(throws: WireDecodeError.self) { try PlaceRef(json: .object(["device": .string("d")])) }
  }

  @Test func theListReadsEveryProjectItsPlacesAndEveryDesktopsStanding() throws {
    let page = try ProjectListResult(json: try Fixture.json("project-list.valid"))
    #expect(page.rows.map(\.name) == ["vibe-field", "Home"])
    #expect(page.cursor != nil)
    #expect(page.groupingVersion == 1)
    #expect(page.droppedRows.isEmpty)
    #expect(page.unknownFields == ["//"])
    let project = try #require(page.rows.first)
    #expect(project.key == "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
    #expect(project.provisional)
    #expect(project.ink == 412)
    #expect(project.kind == "repo")
    #expect(project.bucket == nil)
    #expect(project.devices == ["01J9ZK3M5Q8XR2V7N4B6C1D0EF", "01J9ZM0PQ7W3E6R8T2Y4U1I5O9"])
    #expect(project.sessions == 449)
    #expect(project.lastAt == 1_759_276_800_000)
    #expect(!project.allGone)
    #expect(project.asOf["01J9ZM0PQ7W3E6R8T2Y4U1I5O9"] == "2026-09-30T02:12:44.000Z")
    #expect(project.recipe == nil)
    #expect(project.unknownFields.isEmpty)
    let docs = try #require(project.places.last)
    #expect(docs.name == "vf-docs")
    #expect(docs.path == "/Users/me/code/vf-docs")
    #expect(docs.placeClass == "repo")
    #expect(docs.branch == "docs")
    #expect(docs.worktreeOf == PlaceRef(device: "01J9ZM0PQ7W3E6R8T2Y4U1I5O9", placeId: "pl_0a2b4c6d8e1f3a5b7c9d0e2f"))
    #expect(docs.exists && docs.mounted && docs.sessions == 37)
    let laptop = try #require(page.sources.last)
    #expect(laptop.name == "laptop")
    #expect(!laptop.isSelf)
    #expect(laptop.state == "asleep")
    #expect(laptop.asOf == "2026-09-30T02:12:44.000Z")
    #expect(laptop.rows == 58)
  }

  @Test func aTailnetAnswerCarriesNoPathAndReadsWhole() throws {
    let page = try ProjectListResult(json: try Fixture.json("project-list.tailnet"))
    #expect(page.rows.count == 1)
    #expect(page.rows[0].places.allSatisfy { $0.path == nil })
    #expect(page.rows[0].anchors.allSatisfy { $0.hasPrefix("place:") })
    let summary = try ProjectSummary(json: try Fixture.json("project-summary.tailnet"))
    #expect(summary.places.map(\.name) == ["vibe-field", "vf-docs"])
    #expect(summary.places.allSatisfy { $0.path == nil })
  }

  @Test func aDesktopsHomeIsAProjectOfOneDevice() throws {
    let home = try ProjectSummary(json: try Fixture.json("project-summary.home"))
    #expect(home.kind == "home")
    #expect(home.nameFrom == "home")
    #expect(home.devices.count == 1)
    #expect(home.places.first?.placeClass == "home")
    let valid = try ProjectSummary(json: try Fixture.json("project-summary.valid"))
    #expect(valid.key == "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
  }

  @Test func pinnedAndHiddenRideTheRecord() throws {
    let hidden = try ProjectSummary(json: try Fixture.json("project-summary.hidden"))
    #expect(hidden.pinned && hidden.hidden)
    let plain = try ProjectSummary(json: try Fixture.json("project-summary.home"))
    #expect(!plain.pinned && !plain.hidden)
  }

  @Test func theRecipeKeepsTheProfileTheModelAndEachModelsControlsOpaque() throws {
    let project = try ProjectSummary(json: try Fixture.json("project-summary.recipe"))
    let recipe = try #require(project.recipe)
    #expect(recipe.provider == "claude")
    #expect(recipe.profileSet == "work-7f3a")
    #expect(recipe.selection?.modelId == "opus")
    #expect(recipe.controlsByModel["opus"] == ["effort": "high"])
    #expect(recipe.controlsByModel["sonnet"] == ["effort": "low"])
    #expect(recipe.controlsByModel["haiku"] == [:])
    #expect(recipe.at == 1_759_276_800_000)
  }

  @Test func anUnreadableRecipeReadsAsNoneNeverARefusedProject() throws {
    var fields = try #require(try Fixture.json("project-summary.recipe").objectValue)
    fields["recipe"] = .object(["provider": .int(7)])
    let project = try ProjectSummary(json: .object(fields))
    #expect(project.recipe == nil)
    #expect(project.name == "vibe-field")
  }

  @Test func aKeyThatRegroupedAnswersWhereItMoved() throws {
    let get = try ProjectGetResult(json: try Fixture.json("project-get.moved"))
    #expect(get.movedTo == "r:01JA0B1C2D3E4F5G6H7J8K9M0N")
    #expect(get.project.key == "r:01JA0B1C2D3E4F5G6H7J8K9M0N")
    #expect(get.project.nameFrom == "you")
    let valid = try ProjectGetResult(json: try Fixture.json("project-get.valid"))
    #expect(valid.movedTo == nil)
    #expect(valid.project.places.count == 2)
    #expect(valid.suggestions == 1)
  }

  @Test func aSessionRowNamesItsOwnerItsPlaceAndItsNativeId() throws {
    let page = try ProjectSessionsResult(json: try Fixture.json("project-sessions.valid"))
    #expect(page.key == "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
    #expect(page.movedTo == nil)
    #expect(page.cursor != nil)
    #expect(page.sources.count == 2)
    let row = try #require(page.rows.first)
    #expect(row.device == "01J9ZK3M5Q8XR2V7N4B6C1D0EF")
    #expect(row.nativeSessionId == "665e3e71-7c12-4810-925a-e8b92cb6f29d")
    #expect(row.provider == "claude")
    #expect(row.place == PlaceRef(device: "01J9ZK3M5Q8XR2V7N4B6C1D0EF", placeId: "pl_4c1e9a0b7d2f6e8a1b3c5d7e"))
    #expect(row.devices == ["01J9ZK3M5Q8XR2V7N4B6C1D0EF"])
    #expect(row.cwd == "/Users/me/Projects/vibe-field/packages/fieldd")
    #expect(row.unknownFields.isEmpty)
  }

  @Test func aSessionRowWithNoPlaceIsDroppedAndNamedNotTheWholePage() throws {
    var fields = try #require(try Fixture.json("project-sessions.valid").objectValue)
    var row = try #require(fields["rows"]?.arrayValue?.first?.objectValue)
    row["place"] = nil
    fields["rows"] = .array([.object(row)])
    let page = try ProjectSessionsResult(json: .object(fields))
    #expect(page.rows.isEmpty)
    #expect(page.droppedRows.count == 1)
  }

  @Test func theKeyedListingCarriesTheProjectKeyAndThePlace() throws {
    let listing = try IndexSessionsResult(json: try Fixture.json("index-sessions.keyed"))
    #expect(listing.rows.count == 3)
    #expect(listing.rows[0].projectKey == "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
    #expect(listing.rows[0].place?.placeId == "pl_4c1e9a0b7d2f6e8a1b3c5d7e")
    #expect(listing.rows[2].projectKey == nil && listing.rows[2].place == nil)
    #expect(listing.rows.allSatisfy { $0.unknownFields.isEmpty })
  }

  @Test func theFiguresAreMergedAndSayWhenTheyArePartial() throws {
    let figures = try ProjectFiguresResult(json: try Fixture.json("project-figures.valid"))
    #expect(figures.key == "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
    #expect(figures.heatmap.map(\.day) == ["2026-09-29", "2026-09-30"])
    #expect(figures.models.map(\.model) == ["claude-opus-5-5", "gpt-6-astra"])
    #expect(figures.contribution.map(\.device) == ["01J9ZK3M5Q8XR2V7N4B6C1D0EF", "01J9ZK3M5Q8XR2V7N4B6C1D0EF"])
    #expect(figures.contribution.first?.messages == 88)
    #expect(figures.partial && figures.lifetimePartial && !figures.clipped)
    #expect(figures.sources.map(\.state) == ["answered", "asleep"])
    #expect(figures.sources.last?.detail == "this desktop is asleep; wake it to search its history")
    #expect(figures.sources.first?.split == 1)
    let day = try ProjectFiguresDayResult(json: try Fixture.json("project-figures-day.valid"))
    #expect(day.day == "2026-09-29")
    #expect(day.models.map(\.hour) == [14, 15])
    #expect(day.models.first?.tokens == 120_000)
    #expect(day.partial)
  }

  @Test func theSubscribeOpensEmptyAndItsPingCarriesTheKeyMoves() throws {
    let open = try ProjectChangesSnapshot(json: try #require(try Fixture.json("project-changes-open.snapshot")["snapshot"]))
    #expect(open.epoch == "projects-3f2a9c1e-5b7d-4e0a-9c8b-1d2e3f4a5b6c")
    #expect(open.revision == 43)
    let delta = try ProjectChangesDelta(json: try Fixture.json("project-changes-delta.regrouped"))
    #expect(delta.since == 41 && delta.revision == 43)
    #expect(delta.regrouped == [ProjectRegrouped(from: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8", to: "r:01JA0B1C2D3E4F5G6H7J8K9M0N")])
    #expect(delta.devices == ["01J9ZK3M5Q8XR2V7N4B6C1D0EF"])
    #expect(delta.tables == nil)
  }

  @Test func theRefusalsReadAsReasonsAReaderBranchesOn() throws {
    let path = try ProjectRefusal(json: try Fixture.json("project-refusal.path-in-request"))
    #expect(path.reason == "path-in-request" && path.field == "places.0.path")
    let moved = try ProjectRefusal(json: try Fixture.json("project-refusal.key-moved"))
    #expect(moved.reason == "key-moved" && moved.movedTo == "r:01JA0B1C2D3E4F5G6H7J8K9M0N")
    let grouping = try Fixture.json("error-data.projects-grouping")
    let error = FieldProductError(
      kind: grouping["kind"]?.stringValue ?? "", message: "grouping", retryable: true, details: grouping["details"])
    #expect(error.unavailable?.service == "projects")
    #expect(error.unavailable?.state == "grouping")
  }

  @Test func everyRequestNamesPlacesByRefAndMatchesItsGolden() throws {
    let list = try Fixture.json("project-list-params.valid")
    #expect(
      ProjectListParams(
        cursor: list["cursor"]?.stringValue, limit: 50, devices: ["01J9ZK3M5Q8XR2V7N4B6C1D0EF"], q: "vibe"
      ).json == withoutNote(list))
    #expect(ProjectGetParams.key("p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8").json == withoutNote(try Fixture.json("project-get-params.key")))
    #expect(ProjectGetParams.anchor("place:pl_4c1e9a0b7d2f6e8a1b3c5d7e").json == withoutNote(try Fixture.json("project-get-params.anchor")))
    let sessions = try Fixture.json("project-sessions-params.valid")
    #expect(
      ProjectSessionsParams(
        key: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8",
        places: [PlaceRef(device: "01J9ZK3M5Q8XR2V7N4B6C1D0EF", placeId: "pl_4c1e9a0b7d2f6e8a1b3c5d7e")],
        agents: ["claude"], limit: 25
      ).json == withoutNote(sessions))
    #expect(
      ProjectFiguresParams(key: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8", sinceMs: 1_727_568_000_000, offsetMinutes: -420).json
        == withoutNote(try Fixture.json("project-figures-params.valid")))
    #expect(
      ProjectFiguresDayParams(key: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8", day: "2026-09-29", offsetMinutes: -420).json
        == withoutNote(try Fixture.json("project-figures-day-params.valid")))
    #expect(
      ProjectSubscribeParams(
        since: .init(epoch: "projects-3f2a9c1e-5b7d-4e0a-9c8b-1d2e3f4a5b6c", revision: 41), minIntervalMs: 1000
      ).json == withoutNote(try Fixture.json("project-subscribe-params.valid")))
  }
}
