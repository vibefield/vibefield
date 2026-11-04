import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-8 — THE RAIN, HELD TO THE DESKTOP'S OWN CODE: every row here reads `phone-rain.golden.json` (G1…G7, read-pg8
// §7), the witness run on both sides. The hand rows — what the witness lacks — are `RainViewTests.Hand`.

@Suite("PG-8 — the rain view")
struct RainViewTests {
  @Suite("parity with the desktop's rain")
  struct Parity {
    /// G1 — what each column says, at every step, in the window's order.
    @Test func everyColumnSaysTheDesktopsData() throws {
      for (golden, phone) in try RainGolden.paired() {
        if phone.gap {
          let gap = golden["gap"]?.boolValue
          #expect(gap == true, "step \(phone.at): the gap")
          continue
        }
        let rows = phone.rows
        let expected = golden["rows"]?.arrayValue ?? []
        let ids = rows.map(\.id)
        let goldenIds = expected.map { $0["id"]?.stringValue ?? "" }
        #expect(ids == goldenIds, "step \(phone.at): the window's order")
        for (row, record) in zip(rows, expected) {
          let mine = RainStreams.data(RainAgent(row: row))
          let theirs = Array((record["data"]?.stringValue ?? "").utf16)
          #expect(mine == theirs, "step \(phone.at), \(row.id): its data")
        }
      }
    }

    /// G2 — each column's tail at the golden's row counts.
    @Test func everyTailIsTheDesktops() throws {
      let open = try RainGolden.open()
      let counts = (open["rows"]?.arrayValue?.first?["tails"]?.arrayValue ?? []).count
      #expect(counts == RainGoldenShape.rows.count, "the golden measures the tails at [3, 20, 54, 65]")
      for (golden, phone) in try RainGolden.paired() {
        if phone.gap { continue }
        let rows = phone.rows
        for (row, record) in zip(rows, golden["rows"]?.arrayValue ?? []) {
          let agent = RainAgent(row: row)
          let length = RainStreams.data(agent).count
          let mine = RainGoldenShape.rows.map {
            RainStreams.tailLength(agent, rows: $0, tailMultiplier: 1, dataLength: length)
          }
          let theirs = (record["tails"]?.arrayValue ?? []).map { $0.doubleValue ?? -1 }
          #expect(mine == theirs, "step \(phone.at), \(row.id): its tails")
        }
      }
    }

    /// G3 — the columns each stream takes, carried across the steps as the desktop carries them, with the golden's
    /// counter for a birth.
    @Test func everyColumnIsPlacedAsTheDesktopPlacesIt() throws {
      var previous: [Int: RainColumns] = [:]
      var births: [Int: Double] = [:]
      for (golden, phone) in try RainGolden.paired() {
        if phone.gap { continue }
        let rows = phone.rows
        let expected = golden["columns"]?.arrayValue ?? []
        let counts = expected.map { Int($0["columns"]?.intValue ?? -1) }
        #expect(counts == RainGoldenShape.columns, "step \(phone.at): the column counts")
        for record in expected {
          let count = Int(record["columns"]?.intValue ?? -1)
          let next = RainStreams.reconcile(
            agents: rows.map(\.id), columns: count, previous: previous[count] ?? RainColumns()
          ) { agentId in
            let birth = births[count] ?? 0
            births[count] = birth + 1
            return RainDrop(agentId: agentId, y: birth, speed: 0.5)
          }
          previous[count] = next
          let mine = next.entries.map { "\($0.column) \($0.drop.agentId) \(Int($0.drop.y))" }
          let theirs = (record["streams"]?.arrayValue ?? []).map { stream -> String in
            let parts = stream.arrayValue ?? []
            let column = parts.first?.intValue ?? -1
            let agent = parts.dropFirst().first?.stringValue ?? ""
            let birth = parts.dropFirst(2).first?.intValue ?? -1
            return "\(column) \(agent) \(birth)"
          }
          #expect(mine == theirs, "step \(phone.at), \(count) columns: the streams in the Map's order")
        }
      }
    }

    /// G5 — the eight tunables: the defaults, the groups, and `normalizeRainParameters` over the golden's vector.
    @Test func theParametersAreTheDesktops() throws {
      let open = try RainGolden.open()
      let parameters = open["parameters"]
      let defaults = parameters?["defaults"]?.objectValue ?? [:]
      let keys = RainParameters.groups.flatMap(\.controls).map(\.key)
      #expect(Set(keys) == Set(defaults.keys), "the eight keys")
      for key in keys {
        let mine = RainParameters.defaults.value(key)
        let theirs = defaults[key]?.doubleValue
        #expect(mine == theirs, "the default \(key)")
      }
      let groups = parameters?["groups"]?.arrayValue ?? []
      let titles = groups.map { $0["title"]?.stringValue ?? "" }
      let myTitles = RainParameters.groups.map(\.title)
      #expect(myTitles == titles, "the groups, in order")
      for (group, record) in zip(RainParameters.groups, groups) {
        let controls = record["controls"]?.arrayValue ?? []
        let theirs = controls.map { control -> String in
          let key = control["key"]?.stringValue ?? ""
          let label = control["label"]?.stringValue ?? ""
          let numbers = ["min", "max", "step", "defaultValue"].map { control[$0]?.doubleValue ?? .nan }
          return "\(key)|\(label)|\(numbers)"
        }
        let mine = group.controls.map { "\($0.key)|\($0.label)|\([$0.min, $0.max, $0.step, $0.defaultValue])" }
        #expect(mine == theirs, "the group \(group.title)")
      }
      let vector = open["normalize"]?.arrayValue ?? []
      #expect(!vector.isEmpty, "the golden normalizes a vector")
      for entry in vector {
        var stored: [String: Double] = [:]
        for (key, value) in entry["in"]?.objectValue ?? [:] {
          if let number = RainGolden.number(value) { stored[key] = number }
        }
        let normalized = RainParameters.normalize(stored)
        let out = entry["out"]?.objectValue ?? [:]
        for key in keys {
          let mine = normalized.value(key)
          let theirs = out[key]?.doubleValue
          #expect(mine == theirs, "normalize \(stored): \(key)")
        }
      }
    }
  }
}

/// The golden's own shape, said once: the row counts its tails are measured at and the column counts its streams are
/// placed over (`RAIN_ROWS`, `RAIN_COLUMNS` in `phone-goldens-rain.ts`).
enum RainGoldenShape {
  static let rows = [3, 20, 54, 65]
  static let columns = [33, 16, 8]
}
