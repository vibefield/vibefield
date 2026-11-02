import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-4s — THE GODVIEW TOOLKIT, HELD TO THE SDK'S OWN WORDS: every row reads `phone-toolkit.golden.json` (field-app's
// `phoneToolkitGolden()`, puppeteer-view-sdk 0.3.2's `./toolkit` over a fixed vector), mirrored into this bundle byte
// for byte; no hand-copied value stands in a parity row. The few HAND rows are what JSON cannot carry (−0, NaN
// beside a number) or a phone-only bound, each said where it stands.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum ToolkitGolden {
  static func load() throws -> JSONValue { try HomeFixture.json("phone-toolkit.golden") }

  /// The recorded calls of one toolkit word.
  static func calls(_ name: String) throws -> [JSONValue] {
    let golden = try load()
    let entries = golden["calls"]?[name]?.arrayValue ?? []
    return try #require(entries.isEmpty ? nil : entries, "the toolkit golden records no \(name)")
  }

  /// A number the golden carries: JSON's own, or a tag for what JSON cannot hold; nil is `undefined`.
  static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .string("NaN")?: .nan
    case .string("Infinity")?: .infinity
    case .string("-Infinity")?: -.infinity
    case .string("undefined")?, nil: nil
    case let other?: other.doubleValue
    }
  }

  /// The recorded inputs of one word, as numbers, to say a vector still holds the edges a row names.
  static func inputs(_ entries: [JSONValue]) -> [Double] {
    entries.compactMap { number($0["in"]) }
  }
}

@Suite("PG-4s — the Godview toolkit's parity")
struct GodviewToolkitParityTests {
  /// K1 — `formatShort` says every recorded length as the SDK does: the ties 499/500 and 59 499/59 500 (round, then
  /// floor), the negative clamp, the hour edges, absurd lengths (JavaScript's whole-number printing) and the
  /// non-finite (`NaNh`, `Infinityh`, `0s`).
  @Test func formatShortSaysTheSDKsWords() throws {
    let entries = try ToolkitGolden.calls("formatShort")
    let inputs = ToolkitGolden.inputs(entries)
    for edge in [499.0, 500, 59_499, 59_500, -5_000] {
      #expect(inputs.contains(edge), "the vector keeps the edge \(edge)")
    }
    for entry in entries {
      let ms = ToolkitGolden.number(entry["in"]) ?? .nan
      let said = GodviewFormat.formatShort(ms: ms)
      let out = entry["out"]?.stringValue
      #expect(said == out, "formatShort(\(ms))")
    }
  }

  /// K2 — `formatWords`: `under a minute` below 30 s, the plural edges, and the non-finite.
  @Test func formatWordsSaysTheSDKsWords() throws {
    let entries = try ToolkitGolden.calls("formatWords")
    let inputs = ToolkitGolden.inputs(entries)
    for edge in [29_999.0, 30_000, 60_000, 3_660_000, 7_200_000] {
      #expect(inputs.contains(edge), "the vector keeps the edge \(edge)")
    }
    for entry in entries {
      let ms = ToolkitGolden.number(entry["in"]) ?? .nan
      let said = GodviewFormat.formatWords(ms: ms)
      let out = entry["out"]?.stringValue
      #expect(said == out, "formatWords(\(ms))")
    }
  }

  /// K3 — `formatClock` from the recorded WALL components, built in UTC and read in UTC (the golden built them in its
  /// own zone and read them there, so no instant is ever compared): with and without seconds, and a fraction of a ms
  /// truncated (TimeClip).
  @Test func formatClockSaysTheWallClock() throws {
    let entries = try ToolkitGolden.calls("formatClock")
    let utc = try #require(TimeZone(identifier: "UTC"))
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    var fractions = 0
    for entry in entries {
      let wall = (entry["wall"]?.arrayValue ?? []).compactMap { $0.intValue }.map(Int.init)
      try #require(wall.count == 7, "a wall is [y, mo, d, h, mi, s, ms]")
      let components = DateComponents(
        year: wall[0], month: wall[1], day: wall[2], hour: wall[3], minute: wall[4], second: wall[5])
      let date = try #require(calendar.date(from: components))
      let frac = entry["frac"]?.doubleValue ?? 0
      if frac > 0 { fractions += 1 }
      let ms = date.timeIntervalSince1970 * 1000 + Double(wall[6]) + frac
      let withSeconds = entry["withSeconds"]?.boolValue ?? false
      let said = GodviewFormat.formatClock(ms: ms, withSeconds: withSeconds, timeZone: utc)
      let out = entry["out"]?.stringValue
      #expect(said == out, "formatClock(\(wall), \(frac), withSeconds: \(withSeconds))")
    }
    #expect(fractions > 0, "the vector keeps a fraction of a ms")
  }

  /// K4 — `formatPercent`: nil, NaN and ±Infinity say `missing`, the floors match, a custom `missing` is honoured.
  /// HAND rows, said: −0 prints `0%` (JSON cannot carry −0), and 2^53 or more says `missing` (a phone-only bound at
  /// absurd values, as the body's `flooredPercent` is; JavaScript would print the digits).
  @Test func formatPercentSaysTheSDKsWords() throws {
    let entries = try ToolkitGolden.calls("formatPercent")
    var custom = 0
    for entry in entries {
      let value = ToolkitGolden.number(entry["in"])
      let missing = entry["missing"]?.stringValue
      if missing != nil { custom += 1 }
      let said =
        missing.map { GodviewFormat.formatPercent(value, missing: $0) } ?? GodviewFormat.formatPercent(value)
      let out = entry["out"]?.stringValue
      #expect(said == out, "formatPercent(\(String(describing: value)), missing: \(String(describing: missing)))")
    }
    #expect(custom > 0, "the vector keeps a custom missing")
    let negativeZero = GodviewFormat.formatPercent(-0.0)
    #expect(negativeZero == "0%")
    let bound = GodviewFormat.formatPercent(9_007_199_254_740_992)
    #expect(bound == "—")
    let below = GodviewFormat.formatPercent(9_007_199_254_740_991)
    #expect(below == "9007199254740991%")
  }

  /// The Swift side of `STATE_WORDS`: MonitorWords' four (FieldMesh, PG-3e) and the views' ten (FieldHome, PG-4s).
  static let stateWords: [String: [String: String]] = [
    "status": [
      "idle": MonitorWords.StateWords.idle,
      "working": MonitorWords.StateWords.working,
      "blocked": MonitorWords.StateWords.blocked,
    ],
    "terminal": [
      "running": MonitorWords.StateWords.running,
      "quiet": MonitorWords.StateWords.quiet,
      "empty": MonitorWords.StateWords.empty,
      "opening": MonitorWords.StateWords.opening,
    ],
    "wait": [
      "permission": MonitorWords.StateWords.waitPermission,
      "question": MonitorWords.StateWords.waitQuestion,
      "failure": MonitorWords.StateWords.waitFailure,
    ],
    "unread": [
      "state": MonitorWords.StateWords.unreadState,
      "line": MonitorWords.StateWords.unreadLine,
    ],
    "kind": [
      "terminal": MonitorWords.StateWords.kindTerminal,
      "remote": MonitorWords.StateWords.kindRemote,
    ],
  ]

  static func recordedWords() throws -> [String: [String: String]] {
    let golden = try ToolkitGolden.load()
    let groups = try #require(golden["STATE_WORDS"]?.objectValue, "the golden records STATE_WORDS")
    return groups.mapValues { group in (group.objectValue ?? [:]).compactMapValues { $0.stringValue } }
  }

  /// K5 — the 14 `STATE_WORDS`, each equal to its Swift constant: MonitorWords' four and the extension's ten (M1).
  @Test func everyStateWordIsTheSDKs() throws {
    let recorded = try Self.recordedWords()
    var leaves = 0
    for (group, words) in recorded {
      for (key, word) in words {
        leaves += 1
        let swift = Self.stateWords[group]?[key]
        #expect(swift == word, "STATE_WORDS.\(group).\(key)")
      }
    }
    #expect(leaves == 14)
  }

  /// K5b — the golden's five groups and 14 leaves are the Swift map's key paths, so a word an EL8 adds reds by NAME
  /// (M1), never by a count.
  @Test func theStateWordsKeyPathsAreTheSwiftMaps() throws {
    let recorded = try Self.recordedWords()
    let paths = Set(recorded.flatMap { group, words in words.keys.map { "\(group).\($0)" } })
    let swiftPaths = Set(Self.stateWords.flatMap { group, words in words.keys.map { "\(group).\($0)" } })
    let unknown = paths.subtracting(swiftPaths).sorted()
    let gone = swiftPaths.subtracting(paths).sorted()
    #expect(unknown == [], "the SDK says words the phone does not")
    #expect(gone == [], "the phone says words the SDK no longer does")
    #expect(Set(recorded.keys) == ["status", "terminal", "wait", "unread", "kind"])
  }

  /// K6 — `deviceWord`: self says `This desktop` (MonitorWords' constant, the SDK's THIS_DESKTOP); a peer its name.
  @Test func deviceWordSaysThisDesktopOrTheName() throws {
    let golden = try ToolkitGolden.load()
    let thisDesktop = golden["constants"]?["THIS_DESKTOP"]?.stringValue
    #expect(thisDesktop == MonitorWords.thisDesktop)
    let entries = try ToolkitGolden.calls("deviceWord")
    var selves = 0
    for entry in entries {
      let isSelf = entry["self"]?.boolValue ?? false
      if isSelf { selves += 1 }
      let name = entry["name"]?.stringValue ?? ""
      let said = MonitorWords.deviceWord(name: name, isSelf: isSelf)
      let out = entry["out"]?.stringValue
      #expect(said == out, "deviceWord(\(name), self: \(isSelf))")
    }
    #expect(selves > 0 && selves < entries.count, "a self and a peer")
  }

  /// K7 — `stateTone` over the 12 recorded (status, kind, unread): status first, and a terminal is never `unread`.
  @Test func stateToneIsTheSDKs() throws {
    let entries = try ToolkitGolden.calls("stateTone")
    #expect(entries.count == 12)
    for entry in entries {
      let raw = entry["status"]?.stringValue ?? ""
      let status = try #require(MonitorRowStatus(rawValue: raw), "status \(raw)")
      let isAgent = entry["kind"]?.stringValue == "agent"
      let unread = entry["unread"]?.boolValue ?? false
      let tone = GodviewTone.of(status: status, isAgent: isAgent, unread: unread).rawValue
      let out = entry["out"]?.stringValue
      #expect(tone == out, "stateTone(\(raw), agent: \(isAgent), unread: \(unread))")
    }
  }

  /// K8 — the three constants, `target` (4 cases) and `every` (empty is false, one row not receded is false, all
  /// receded is true).
  @Test func theRecedeConstantsTargetsAndEvery() throws {
    let golden = try ToolkitGolden.load()
    let constants = golden["constants"]
    let receded = constants?["RECEDED_OPACITY"]?.doubleValue
    let recededEmpty = constants?["RECEDED_EMPTY_OPACITY"]?.doubleValue
    let ms = constants?["RECEDE_MS"]?.doubleValue
    #expect(GodviewRecede.receded == receded)
    #expect(GodviewRecede.recededEmpty == recededEmpty)
    #expect(GodviewRecede.ms == ms)
    let targets = try ToolkitGolden.calls("recedeTarget")
    #expect(targets.count == 4)
    for entry in targets {
      let isReceded = entry["receded"]?.boolValue ?? false
      let every = entry["every"]?.boolValue ?? false
      let target = GodviewRecede.target(receded: isReceded, every: every)
      let out = entry["out"]?.doubleValue
      #expect(target == out, "recedeTarget(\(isReceded), \(every))")
    }
    let everies = try ToolkitGolden.calls("everyReceded")
    #expect(everies.count == 4)
    for entry in everies {
      let rows = (entry["in"]?.arrayValue ?? []).compactMap { $0.boolValue }
      let every = GodviewRecede.every(rows)
      let out = entry["out"]?.boolValue
      #expect(every == out, "everyReceded(\(rows))")
    }
  }

  /// K9 — `approach` over the 6 recorded steps: a step each way, the snap inside one step, at rest, a negative delta
  /// that does not move. HAND row, said: a NaN delta answers NaN (JSON cannot carry it beside a number).
  @Test func approachStepsAsTheSDKDoes() throws {
    let entries = try ToolkitGolden.calls("approachRecede")
    #expect(entries.count == 6)
    for entry in entries {
      let current = entry["current"]?.doubleValue ?? .nan
      let target = entry["target"]?.doubleValue ?? .nan
      let deltaMs = entry["deltaMs"]?.doubleValue ?? .nan
      let stepped = GodviewRecede.approach(current, toward: target, deltaMs: deltaMs)
      let out = entry["out"]?.doubleValue
      #expect(stepped == out, "approachRecede(\(current), \(target), \(deltaMs))")
    }
    let nan = GodviewRecede.approach(1, toward: 0.22, deltaMs: .nan)
    #expect(nan.isNaN)
  }
}
