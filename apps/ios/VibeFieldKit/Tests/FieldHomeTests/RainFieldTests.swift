import FieldMesh
import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-8 — THE RAIN'S FIELD AND ITS ARM (pair 5, read-pg8 §7): the reference model the surface draws from, held to the
// golden through the field's own order of events (rows before a stage, then the stage), and the arm that names the
// view. The field's rows: H12 (the empty stage), H13 (the lifetime), H15 (the tap), and the loop's start and stop.
// The surface's own rows (the font, the device, the elements) are the kit's (`RainKitTests.swift`).

extension RainViewTests {
  @Suite("the field and the arm")
  @MainActor
  struct Field {
    /// The witness open's drawn rows.
    static func openRows() throws -> [RemoteFieldRow] {
      let steps = try HomeFixture.witnessSteps()
      return try #require(steps.first?.rows, "the open's rows")
    }

    /// A field at the golden's full-bleed stage, rolled by mulberry32(seed).
    static func field(_ rows: [RemoteFieldRow], seed: UInt32 = 1) -> RainField {
      let field = RainField(dice: .seeded(Mulberry32(seed: seed)))
      field.resize(width: 402, height: 781)
      field.show(rows: rows, activeId: nil)
      return field
    }

    /// H12 — an empty window: no stream, no element to say, the bare stage, and the desktop's two lines
    /// (RainView.js:261; fd's Q8) — the second with the phone's words, as the list and spend say it: the desktop's
    /// "Launch an agent from a terminal pane." names a pane, which the phone has none of (the words rule; a draft
    /// word for James's eye). The mock fleet draws this.
    @Test func anEmptyWindowShowsTheDesktopsWords() {
      let field = Self.field([])
      #expect(field.isEmpty)
      #expect(field.frame.drops.isEmpty)
      #expect(field.agents.isEmpty, "no row, no accessibility element")
      let still = field.still()
      #expect(still == [.stage(width: 402, height: 781, fill: RainPalette.rain.stage)])
      #expect(RainField.emptyTitle == "NO ACTIVE AGENTS")
      #expect(RainField.emptyLine == "Launch an agent from a terminal.")
    }

    /// H18 — the words rule: on the phone no word the rain says of its own names a key, hover or a pane — its empty
    /// stage, a lit row's value, the fallback name, the status words and MonitorWords' fixed lines its button lines
    /// carry. A row's reply and detail are the agent's own text, data the rain passes on, not its words.
    @Test func noWordTheRainSaysNamesAKeyHoverOrAPane() {
      let words: [String] = [
        RainField.emptyTitle, RainField.emptyLine, "open", MonitorWords.terminalName, MonitorWords.pendingLine,
        MonitorWords.startingLine, MonitorWords.StateWords.blocked,
      ] + [MonitorRowStatus.idle, .working, .blocked].map { $0.rawValue }
      let banned: Set<String> = ["key", "keys", "hover", "hovers", "hovered", "pane", "panes"]
      for line in words {
        let found = line.lowercased().split { !$0.isLetter }.map(String.init).filter { banned.contains($0) }
        #expect(found.isEmpty, "\"\(line)\" names \(found)")
      }
    }

    /// H13 — the lifetime. The field waits for its stage (the desktop's sync bails with no container), so rows that
    /// arrive before the first layout roll nothing, and the stage's arrival places them exactly as the golden's still
    /// frame records. Rows going to none (sign-out: a fresh copy, `input.rows` empty) clear the streams and the
    /// weights; rows coming back are rolled afresh.
    @Test func theFieldWaitsForItsStageAndForgetsAnEmptyWindow() throws {
      let rows = try Self.openRows()
      let field = RainField(dice: .seeded(Mulberry32(seed: 1)))
      field.show(rows: rows, activeId: nil)
      #expect(field.frame.drops.isEmpty, "no drop is rolled for a stage not laid out")
      field.resize(width: 402, height: 781)
      #expect(field.frame.drops.count == 22, "two streams for each of the eleven rows")
      let open = try RainGolden.open()
      let theirs = try (open["ops"]?.arrayValue ?? []).map(RainGolden.op)
      let mine = field.still().map(RainGolden.recorded)
      #expect(mine == theirs, "the field's still is the golden's, rolled in the field's own order")
      let born = field.frame.drops.entries.map { $0.drop }

      field.show(rows: [], activeId: nil)
      let empty = field.still()
      #expect(field.frame.drops.isEmpty)
      #expect(field.frame.recedes.isEmpty)
      #expect(empty.count == 1, "the bare stage")
      field.show(rows: rows, activeId: nil)
      let reborn = field.frame.drops.entries.map { $0.drop }
      #expect(reborn.count == 22)
      let shared = reborn.filter { drop in born.contains { $0 === drop } }
      #expect(shared.isEmpty, "no drop survives the empty window")
    }

    /// H15 — a tap opens the row under it, its own `RemoteFieldRow`: by x alone, in any of its streams' columns; a
    /// column with no stream, past the last whole column or off the stage opens nothing. A row's element stands in
    /// its first stream's column.
    @Test func aTapOpensTheRowUnderIt() throws {
      let rows = try Self.openRows()
      let field = Self.field(rows)
      for (column, drop) in field.frame.drops.entries {
        let opened = field.row(atX: Double(column) * 12 + 6)?.id
        #expect(opened == drop.agentId, "column \(column)")
      }
      let freeColumn = (0..<33).first { !field.frame.drops.has($0) }
      let free = try #require(freeColumn)
      #expect(field.row(atX: Double(free) * 12 + 6) == nil)
      #expect(field.row(atX: 400) == nil, "past the last whole column")
      #expect(field.row(atX: -1) == nil, "off the stage")
      let first = try #require(rows.first)
      let columns = field.columns(of: first.id)
      let expected = field.frame.drops.entries.filter { $0.drop.agentId == first.id }.map { $0.column }
      #expect(columns == expected)
      #expect(columns.count == 2)
    }

    /// The loop at the field: stopped until it is asked to run; running, it draws on the cap's ticks (H16's); stopped
    /// again, no tick draws; a still rolls nothing and moves nothing.
    @Test func theLoopRunsOnlyWhileAsked() throws {
      let field = Self.field(try Self.openRows())
      #expect(!field.running)
      #expect(field.tick(1000) == nil, "a stopped loop draws no frame")
      field.run(true, now: 0)
      #expect(field.running)
      var drawn: [Int] = []
      for k in 1...8 where field.tick((Double(k) * 1000) / 120) != nil { drawn.append(k) }
      #expect(drawn == [4, 8], "30 fps over a 120 Hz display")
      field.run(false, now: 0)
      #expect(!field.running)
      #expect(field.tick(2000) == nil)
      let once = field.still()
      let twice = field.still()
      #expect(once == twice, "a still moves nothing and rolls nothing")
    }

    /// The arm: `rain` is the manifest's id, it launches by `-vf-godview-view=rain`, the row draws it in the
    /// registry's order, its stage is `.flow`, and it wears no atmosphere (J-S3, drop).
    @Test func theRainIsAViewThePhoneHas() {
      let rain = GodviewViewChoice(rawValue: "rain")
      #expect(rain?.rawValue == "rain")
      let launched = GodviewViewChoice.launch(["-vf-demo-field-slice", "-vf-godview-view=rain"])
      #expect(launched?.rawValue == "rain")
      let shown = GodviewViewChoice.shown.map { $0.rawValue }
      #expect(shown.contains("rain"))
      #expect(shown == GodviewViewChoice.ordered(Set(shown)), "the registry's order")
      #expect(rain?.allocation == .flow)
      #expect(rain?.wearsAtmosphere == false)
    }
  }
}
