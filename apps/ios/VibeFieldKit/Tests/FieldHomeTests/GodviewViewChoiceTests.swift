import FieldAgents
import FieldMesh
import Foundation
import Testing

@testable import FieldHome
@testable import FieldProduct

// PG-4s — THE VIEW CHOICE AND THE STAGE'S INPUTS (host + kit): the launch flags a still is taken under, and the pure
// facts every view reads from the home screen.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4s — the Godview view choice")
struct GodviewViewChoiceTests {
  /// V1 — `-vf-godview-view=swarm` names the swarm.
  @Test func theFlagNamesAView() {
    let chosen = GodviewViewChoice.launch(["VibeField", "-vf-godview-view=swarm"])
    #expect(chosen == .swarm)
  }

  /// V2 — absent, a view no one has, a bare flag and an empty value name none: nil, and the caller keeps the swarm.
  @Test func noViewIsNamedWithoutAKnownId() {
    let named = GodviewViewChoice.launch(["-vf-godview-view=swarm"])
    #expect(named == .swarm, "the positive case first")
    for arguments in [[], ["-vf-godview-view=bogus"], ["-vf-godview-view"], ["-vf-godview-view="], ["swarm"]] {
      let chosen = GodviewViewChoice.launch(arguments)
      #expect(chosen == nil, "\(arguments)")
    }
  }

  /// V3 — the first `-vf-godview-view=` wins, whether or not it names a view.
  @Test func theFirstFlagWins() {
    let first = GodviewViewChoice.launch(["-vf-godview-view=swarm", "-vf-godview-view=bogus"])
    #expect(first == .swarm)
    let bogusFirst = GodviewViewChoice.launch(["-vf-godview-view=bogus", "-vf-godview-view=swarm"])
    #expect(bogusFirst == nil)
  }

  /// V4 — every case is one of puppeteer-views' five manifest ids (PV `views/*/index.js:12-13`: swarm, list, rain,
  /// timeline, spend). A PIN, green from C6: it guards the cases PG-5…8 add.
  @Test func everyCaseIsAManifestId() {
    let manifestIds: Set<String> = ["swarm", "list", "rain", "timeline", "spend"]
    let raws = GodviewViewChoice.allCases.map { $0.rawValue }
    for raw in raws {
      #expect(manifestIds.contains(raw), "\(raw)")
    }
    #expect(GodviewViewChoice.argument == "-vf-godview-view")
    #expect(GodviewViewChoice.nowArgument == "-vf-godview-now")
  }

  /// V5 — `-vf-godview-now=<epoch ms>` freezes the clock at that instant: the phone goldens' `PHONE_BODY_NOW_MS`.
  @Test func theNowFlagFreezesTheClock() {
    let frozen = GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"])
    #expect(frozen == Date(timeIntervalSince1970: 1_790_803_300))
  }

  /// V6 — a value that is not a whole number of ms, a missing value and an absent flag freeze nothing.
  @Test func noClockIsFrozenWithoutANumber() {
    let frozen = GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"])
    #expect(frozen != nil, "the positive case first")
    for arguments in [[], ["-vf-godview-now=abc"], ["-vf-godview-now="], ["-vf-godview-now"], ["-vf-godview-now=1.5"]] {
      let none = GodviewViewChoice.frozenNow(arguments)
      #expect(none == nil, "\(arguments)")
    }
  }

  /// V7 — the two parsers ignore each other's flag, the demo door's and a longer flag that starts like theirs (the
  /// design check's N7: `-vf-godview-viewport` is not a view).
  @Test func theParsersIgnoreEveryOtherFlag() {
    let both = ["-vf-demo-field-slice", "-vf-godview-now=1790803300000", "-vf-godview-view=swarm"]
    let view = GodviewViewChoice.launch(both)
    let now = GodviewViewChoice.frozenNow(both)
    #expect(view == .swarm, "the positive cases first")
    #expect(now != nil)
    let others = ["-vf-demo-field-slice", "-vf-godview-viewport=swarm", "-vf-godview-nowish=1790803300000"]
    let noView = GodviewViewChoice.launch(others + ["-vf-godview-now=1790803300000"])
    #expect(noView == nil)
    let noNow = GodviewViewChoice.frozenNow(others + ["-vf-godview-view=swarm"])
    #expect(noNow == nil)
  }
}

/// The witness's rows, and one hand-edited (each such row is said where it is used).
enum StageRows {
  static let home = "dev-01HQ9S7UD1"

  /// A witness open row's board JSON, by its key.
  static func json(_ key: String) throws -> JSONValue {
    let open = try HomeFixture.json("agent-remote-mesh-open.witness")
    let rows = (open["devices"]?.arrayValue ?? []).flatMap { $0["snapshot"]?["rows"]?.arrayValue ?? [] }
    let found = rows.first { $0["runtimeRunId"]?.stringValue == key }
    return try #require(found, "no witness row \(key)")
  }

  /// `json` with the value at the key path set.
  static func edited(_ json: JSONValue, _ path: [String], _ value: JSONValue) -> JSONValue {
    guard let key = path.first, case .object(var fields) = json else { return path.isEmpty ? value : json }
    fields[key] = edited(fields[key] ?? .object([:]), Array(path.dropFirst()), value)
    return .object(fields)
  }

  /// A drawn row built by hand from a board row (3d's memberwise `RemoteFieldRow`), on the home.
  static func fieldRow(_ json: JSONValue, visualId: String? = nil) throws -> RemoteFieldRow {
    let board = try AgentRemoteRow(json: json)
    let row = RemoteModelRow(board.monitorRow, here: home)
    return RemoteFieldRow(row: row, board: board, stale: row.monitor.stale, visualId: visualId ?? row.id)
  }

  /// The swarm's bubbles over `rows`, dressed by `FieldAssembly.fold` as HS's refold dresses them.
  static func dressed(_ rows: [RemoteFieldRow], tint: ProjectTint) -> ([FieldBubble], ProjectLedger) {
    let bubbles = rows.map { fieldBubble(from: $0, fieldIsLive: true, catalog: .empty, suppressUnread: false) }
    var assembly = FieldAssembly(tint: tint)
    let folded = assembly.fold(bubbles, cardSubjectID: nil)
    return (folded, assembly.projects)
  }
}

@Suite("PG-4s — the Godview stage's inputs")
struct GodviewStageInputTests {
  /// I1 — the open card's row by MODEL id: the drawn row whose VISUAL id is the card's subject. The witness's rows
  /// all wear their own id as their visual id, so a HAND row (said) wears another: the witness's `run-h-root` drawn
  /// as visual `body-of-root`.
  @Test func theOpenCardsRowIsFoundByItsVisualId() throws {
    var rows = try HomeFixture.witnessRows()
    let root = try StageRows.fieldRow(try StageRows.json("run-h-root"), visualId: "body-of-root")
    rows.removeAll { $0.id == "run-h-root" }
    rows.append(root)
    let active = GodviewStageInput.activeId(rows: rows, cardSubject: "body-of-root")
    #expect(active == "run-h-root")
    let plain = GodviewStageInput.activeId(rows: rows, cardSubject: "pty-p3")
    #expect(plain == "pty-p3")
    let byModelId = GodviewStageInput.activeId(rows: rows, cardSubject: "run-h-root")
    #expect(byModelId == nil, "a model id is not a visual id")
    let none = GodviewStageInput.activeId(rows: rows, cardSubject: nil)
    #expect(none == nil)
    let unknown = GodviewStageInput.activeId(rows: rows, cardSubject: "nobody")
    #expect(unknown == nil)
  }

  /// I2 — every witness row's colour is the swarm's own dress (`FieldAssembly.fold`, the bubble's `color`), in both
  /// tints: a dealt agent its project's, a terminal none.
  @Test func aRowsColourIsTheSwarmsDeal() throws {
    let rows = try HomeFixture.witnessRows()
    for tint in [ProjectTint.light, .dark] {
      let (bubbles, projects) = StageRows.dressed(rows, tint: tint)
      var dealt = 0
      for row in rows {
        let colour = GodviewStageInput.colour(of: row, projects: projects, tint: tint)
        let swarm = bubbles.first { $0.modelId == row.id }?.color
        #expect(colour == swarm, "\(row.id)")
        if colour != nil { dealt += 1 }
      }
      #expect(dealt > 0, "an agent is dealt")
      let terminal = try #require(rows.first { $0.id == "pty-h2" })
      let none = GodviewStageInput.colour(of: terminal, projects: projects, tint: tint)
      #expect(none == nil, "a terminal wears no deal")
    }
  }

  /// I2b (S3) — an agent in no folder is dealt by its provider's label, as its bubble is: a HAND row (said), the
  /// witness's `run-h-root` with its folder's name emptied.
  @Test func aFolderlessAgentIsDealtAsItsBubbleIs() throws {
    var rows = try HomeFixture.witnessRows()
    let folderless = try StageRows.fieldRow(
      StageRows.edited(try StageRows.json("run-h-root"), ["monitorRow", "project", "name"], .string("")))
    rows.removeAll { $0.id == "run-h-root" }
    rows.append(folderless)
    let (bubbles, projects) = StageRows.dressed(rows, tint: .light)
    let swarm = bubbles.first { $0.modelId == "run-h-root" }?.color
    let colour = GodviewStageInput.colour(of: folderless, projects: projects, tint: .light)
    #expect(swarm != nil, "the bubble is dealt")
    #expect(colour == swarm)
  }

  /// I4 (S2) — the rows drawn unread are the swarm's: an unread bubble's model id, never a held-out one, a terminal's
  /// or a mock body's (no model id); over the witness, its two unread agents.
  @Test func theUnreadRowsAreTheSwarmsUnreadBodies() throws {
    func bubble(_ id: String, unread: Bool, modelId: String?) -> FieldBubble {
      FieldBubble(
        id: id, project: "p", detail: "", status: .idle, identityKey: id, createdAt: Date(timeIntervalSince1970: 0),
        unread: unread, modelId: modelId)
    }
    let hand = [
      bubble("vis-a", unread: true, modelId: "model-a"),
      bubble("vis-b", unread: false, modelId: "model-b"),
      bubble("vis-c", unread: false, modelId: "model-c"),
      bubble("vis-d", unread: true, modelId: nil),
    ]
    let ids = GodviewStageInput.unreadIds(bubbles: hand)
    #expect(ids == ["model-a"])
    let rows = try HomeFixture.witnessRows()
    let (bubbles, _) = StageRows.dressed(rows, tint: .light)
    let witness = GodviewStageInput.unreadIds(bubbles: bubbles)
    #expect(witness == ["pty-h1", "run-p-done"])
  }
}
