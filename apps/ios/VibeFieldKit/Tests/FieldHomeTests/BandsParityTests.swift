import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4 (UM-D3, one meter everywhere) — THE PHONE'S METERS AND BANDS ARE THE DESKTOP'S: every meters record, every
/// circle and the forecast vector of the usage bands golden (`packages/field-app/test/fixtures/usage/
/// usage-bands.golden.json`, computed by field-app's `src/usage/golden.ts`, mirrored here byte for byte) recomputed by
/// `MeterModel` and `BandsLayout` over the same contracts fixtures (the golden's `inputs`, mirrored beside it) and the
/// same catalog (`agent-catalog.valid.json`, the table's projection), each batch read at the golden's own `nows`, or
/// at a record's own `at` (hours later, after a reset: the phone's common case, UM-D8).
///
/// The phone's answer is written in the golden's own record shape (the encoders below are this suite's, never the
/// product's) and compared field by field: the same keys on both sides, words and flags equal, every number within
/// 0.011 (the golden is written to the hundredth). A plan is titled as the golden titles it, by its company's label.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the phone's meters and Bands circles are the desktop's, held to the usage bands golden")
struct BandsParityTests {
  static func golden() throws -> JSONValue { try HomeFixture.json("usage-bands.golden") }

  /// The golden's title: a plan by its company's label (`GOLDEN_PLAN_TITLE`).
  static let goldenTitle: PlanTitle = { plan, _ in plan.service.label }

  static func catalog() throws -> MeterCatalog {
    MeterCatalog(rows: try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog)
  }

  /// A fixture by the golden's input name (`agents-profile-sets.meters.json`).
  static func input(_ file: String) throws -> JSONValue {
    try HomeFixture.json(String(file.dropLast(".json".count)))
  }

  /// One record's meters, as the golden computed them.
  static func meters(_ record: JSONValue, nows: JSONValue) throws -> ProfileMeters {
    let setsFile = try #require(record["sets"]?.stringValue)
    let batchFile = try #require(record["batch"]?.stringValue)
    let of = try #require(record["of"]?.stringValue)
    // a record that names a now of its own (`at`) is read then, else at its batch's (`nows`)
    let at = try #require(record["at"]?.stringValue ?? nows[batchFile]?.stringValue)
    let now = try #require(parseWireDate(at))
    let sets = try AgentProfileSetsResult(json: try input(setsFile)).sets
    let rows = try AgentAccountUsageBatch(json: try input(batchFile)).entries
    let options = MetersOptions(
      catalog: try catalog(), title: goldenTitle, usageReadable: record["usage"]?.stringValue != "unavailable")
    if of == "every" { return MeterModel.everyPlan(sets, rows: rows, now: now, options: options) }
    let set = try #require(sets.first { $0.id == of })
    return MeterModel.planMeters(set, rows: rows, now: now, options: options)
  }

  /// A circle's options as the golden records them.
  static func options(_ raw: JSONValue?) -> BandsOptions {
    var options = BandsOptions()
    if let centre = raw?["centre"]?.stringValue.flatMap(BandsOptions.Centre.init(rawValue:)) { options.centre = centre }
    options.hotDot = raw?["hotDot"]?.boolValue ?? false
    options.focus = raw?["focus"]?.stringValue
    options.hit = raw?["hit"]?.boolValue ?? false
    options.crowd = raw?["crowd"]?.boolValue ?? false
    options.every = raw?["every"]?.boolValue ?? false
    if let around = raw?["around"], let hole = around["hole"]?.doubleValue, let band = around["band"]?.doubleValue {
      options.around = (hole, band)
    }
    return options
  }

  @Test("every meters record: each profile's entries in UM-D15's order, its tightest plan and its hot rule")
  func metersRecords() throws {
    let golden = try Self.golden()
    let nows = try #require(golden["nows"])
    let records = try #require(golden["meters"]?.arrayValue)
    #expect(records.count == 9)
    for record in records {
      let meters = try Self.meters(record, nows: nows)
      var ours: [String: JSONValue] = [
        "entries": .array(meters.entries.map(Self.entry)),
        "tightest": meters.tightest.map { JSONValue.string($0.key) } ?? JSONValue.null,
        "hot": .bool(meters.hot),
      ]
      for key in ["sets", "batch", "of", "usage", "at"] { ours[key] = record[key] }
      let differences = Self.differences(record, .object(ours), at: Self.name(record))
      #expect(differences.isEmpty, "\(differences.prefix(8).joined(separator: "\n"))")
    }
  }

  @Test("every circle: the level, the centre and its items, each plan's arcs, notches, mark and hit, the ring, the dot and the words")
  func circles() throws {
    let golden = try Self.golden()
    let nows = try #require(golden["nows"])
    let circles = try #require(golden["circles"]?.arrayValue)
    #expect(circles.count == 26)
    for circle in circles {
      let meters = try Self.meters(circle, nows: nows)
      let size = try #require(circle["size"]?.doubleValue)
      let geometry = BandsLayout.geometry(size, meters.entries, Self.options(circle["options"]))
      var ours = Self.geometry(geometry)
      for key in ["name", "where", "sets", "batch", "of", "usage", "at", "options"] { ours[key] = circle[key] }
      let differences = Self.differences(circle, .object(ours), at: circle["name"]?.stringValue ?? "?")
      #expect(differences.isEmpty, "\(differences.prefix(8).joined(separator: "\n"))")
    }
  }

  @Test("every phone placement draws with its golden case's options, so the circle the parity holds is the one drawn")
  func placements() throws {
    let golden = try Self.golden()
    let circles = try #require(golden["circles"]?.arrayValue)
    let drawn: [(name: String, options: BandsOptions)] = [
      ("one profile, nothing in the middle", .menuRow(every: false)),
      ("every profile, nothing in the middle", .menuRow(every: true)),
      ("several plans on a profile's row", .profileRow),
      ("every profile at the All profiles row", .allProfilesRow),
      (
        "every profile opened: a shared plan once, the crowded agents in their profiles' glyphs",
        .page(every: true, several: true, focus: nil)
      ),
      (
        "one profile chosen, a need pointed at: the others dim and the middle asks for it",
        .page(every: false, several: true, focus: "plan:openai")
      ),
      ("several plans as a bud", .bud),
      ("several plans held", .held(every: false)),
      ("every profile around the face", .faceRing(every: true)),
    ]
    for place in drawn {
      let circle = try #require(
        circles.first { $0["name"]?.stringValue == place.name }, "no golden case: \(place.name)")
      let recorded = Self.options(circle["options"])
      #expect(recorded == place.options, "\(place.name)")
    }
  }

  @Test("UM-D4's forecast over the golden's fixed vector")
  func forecasts() throws {
    let golden = try Self.golden()
    let calls = try #require(golden["calls"]?["forecast"]?.arrayValue)
    #expect(calls.count == 13)
    for call in calls {
      let input = try #require(call["in"])
      let asked = ForecastInput(
        usedPercent: input["usedPercent"]?.doubleValue ?? 0, elapsedPercent: input["elapsedPercent"]?.doubleValue,
        durationMinutes: input["durationMinutes"]?.intValue.map { Int($0) }, resetIn: input["resetIn"]?.doubleValue,
        budget: input["budget"]?.boolValue ?? false, hot: input["hot"]?.boolValue ?? false)
      let out = MeterRules.forecast(asked).map(Self.forecast) ?? .null
      let differences = Self.differences(call["out"] ?? .null, out, at: "forecast \(input)")
      #expect(differences.isEmpty, "\(differences.joined(separator: "\n"))")
    }
  }

  // MARK: - The comparison

  static func name(_ record: JSONValue) -> String {
    ["sets", "batch", "of", "usage", "at"].compactMap { record[$0]?.stringValue }.joined(separator: " · ")
  }

  /// Where the golden and the phone differ: a key on one side only, another word or flag, a number past 0.011.
  static func differences(_ golden: JSONValue, _ ours: JSONValue, at path: String) -> [String] {
    switch (golden, ours) {
    case (.object(let a), .object(let b)):
      return Set(a.keys).union(b.keys).sorted().flatMap { key -> [String] in
        guard let left = a[key] else { return ["\(path).\(key): only the phone has it (\(b[key] ?? .null))"] }
        guard let right = b[key] else { return ["\(path).\(key): only the golden has it (\(left))"] }
        return differences(left, right, at: "\(path).\(key)")
      }
    case (.array(let a), .array(let b)):
      guard a.count == b.count else { return ["\(path): \(a.count) items in the golden, \(b.count) on the phone"] }
      return zip(a, b).enumerated().flatMap { index, pair in differences(pair.0, pair.1, at: "\(path)[\(index)]") }
    default:
      if let left = golden.doubleValue, let right = ours.doubleValue {
        return abs(left - right) <= 0.011 ? [] : ["\(path): \(left) in the golden, \(right) on the phone"]
      }
      return golden == ours ? [] : ["\(path): \(golden) in the golden, \(ours) on the phone"]
    }
  }

  // MARK: - The golden's record shape (golden.ts' entryRecord, windowRecord; bands.ts' BandsGeometry)

  static func forecast(_ forecast: MeterForecast) -> JSONValue {
    .object([
      "minutes": .double(forecast.minutes), "words": .string(forecast.words), "short": .string(forecast.short),
      "long": .string(forecast.long),
    ])
  }

  static func profile(_ profile: MeterProfile) -> JSONValue {
    var fields: [String: JSONValue] = [
      "setId": .string(profile.setId), "kind": .string(profile.kind), "filled": .bool(profile.filled),
      "label": .string(profile.label),
    ]
    if let glyph = profile.glyph { fields["glyph"] = .string(glyph) }
    return .object(fields)
  }

  static func window(_ window: MeterWindow) -> JSONValue {
    let line = window.line
    var fields: [String: JSONValue] = [
      "id": .string(line.id), "label": .string(line.label), "usedPercent": .double(line.usedPercent),
      "resets": .bool(line.resets), "hot": .bool(line.hot), "budget": .bool(window.budget),
      "lengthWords": .string(window.lengthWords), "pressure": .double(window.pressure),
      "passed": .bool(window.passed),
    ]
    if let group = line.group { fields["group"] = .object(["id": .string(group.id), "label": .string(group.label)]) }
    if let elapsed = line.elapsedPercent { fields["elapsedPercent"] = .double(elapsed) }
    let form = window.resetForm
    if let reset = line.reset, form != .day { fields["reset"] = .string(reset) }
    if let form { fields["resetForm"] = .string(form.rawValue) }
    if let minutes = window.metric.durationMinutes { fields["durationMinutes"] = .int(Int64(minutes)) }
    if let resetIn = window.resetIn { fields["resetIn"] = .double(resetIn) }
    if let forecast = window.forecast { fields["forecast"] = Self.forecast(forecast) }
    return .object(fields)
  }

  static func right(_ right: MeterRight, dayReset: Bool) -> JSONValue {
    if dayReset {
      return .object([
        "kind": .string(right.kind.rawValue), "resetForm": .string("day"), "hot": .bool(right.hot),
        "icon": .bool(right.icon),
      ])
    }
    return .object([
      "kind": .string(right.kind.rawValue), "words": .string(right.words), "hot": .bool(right.hot),
      "icon": .bool(right.icon),
    ])
  }

  static func entry(_ entry: PlanMeter) -> JSONValue {
    var fields: [String: JSONValue] = [
      "key": .string(entry.key), "provider": .string(entry.provider), "agent": .string(entry.agent),
      "title": .string(entry.title), "profiles": .array(entry.profiles.map(profile)),
      "kind": .string(entry.kind.rawValue),
    ]
    if let plan = entry.plan {
      var planFields: [String: JSONValue] = [
        "id": .string(plan.id),
        "service": .object(["id": .string(plan.service.id), "label": .string(plan.service.label)]),
      ]
      if let account = plan.account { planFields["account"] = .string(account) }
      fields["plan"] = .object(planFields)
    }
    if let profileId = entry.profileId { fields["profileId"] = .string(profileId) }
    switch entry.state {
    case .reading(let reading):
      fields["windows"] = .array(reading.windows.map(window))
      fields["tightest"] = .string(reading.tightest.line.id)
      fields["hot"] = .bool(reading.hot)
      fields["stale"] = .bool(reading.stale)
      fields["fetchedAt"] = .string(reading.fetchedAt)
      if let right = entry.right {
        fields["right"] = Self.right(right, dayReset: right.kind == .reset && reading.tightest.resetForm == .day)
      }
    case .firstRead:
      if let right = entry.right { fields["right"] = Self.right(right, dayReset: false) }
    case .needsYou(let need):
      fields["need"] = .string(need.rawValue)
      if let right = entry.right { fields["right"] = Self.right(right, dayReset: false) }
    case .noMeter(let why):
      fields["why"] = .string(why.rawValue)
    }
    return .object(fields)
  }

  static func paint(_ paint: BandsPaint) -> JSONValue {
    switch paint {
    case .ink(let percent): .object(["tone": .string("ink"), "percent": .double(percent)])
    case .hot(let percent): .object(["tone": .string("hot"), "percent": .double(percent)])
    case .light(let percent): .object(["tone": .string("light"), "percent": .double(percent)])
    case .attention: .object(["tone": .string("attention")])
    }
  }

  static func mark(_ mark: BandsMark) -> [String: JSONValue] {
    var fields: [String: JSONValue] = [
      "provider": .string(mark.provider), "x": .double(mark.x), "y": .double(mark.y), "size": .double(mark.size),
      "paint": paint(mark.paint), "opacity": .double(mark.opacity),
    ]
    if let badge = mark.badge {
      fields["badge"] = .object([
        "need": .string(badge.need.rawValue), "x": .double(badge.x), "y": .double(badge.y), "r": .double(badge.r),
      ])
    }
    if let glyph = mark.glyph {
      fields["glyph"] = .object([
        "x": .double(glyph.x), "y": .double(glyph.y), "size": .double(glyph.size), "paint": paint(glyph.paint),
        "profile": profile(glyph.profile),
      ])
    }
    return fields
  }

  static func item(_ item: BandsCentreItem) -> JSONValue {
    switch item {
    case .glyph(let x, let y, let size, let paint):
      return .object([
        "kind": .string("glyph"), "x": .double(x), "y": .double(y), "size": .double(size), "paint": Self.paint(paint),
      ])
    case .mark(let centreMark):
      var fields = mark(centreMark)
      fields["kind"] = .string("mark")
      return .object(fields)
    case .text(let text):
      var fields: [String: JSONValue] = [
        "kind": .string("text"), "role": .string(text.role.rawValue), "text": .string(text.text), "x": .double(text.x),
        "y": .double(text.y), "size": .double(text.size), "font": .string(text.font.rawValue),
        "weight": .double(text.weight), "paint": paint(text.paint),
      ]
      if text.percent { fields["percent"] = .bool(true) }
      return .object(fields)
    }
  }

  static func arc(_ arc: BandsArc) -> JSONValue {
    var fields: [String: JSONValue] = [
      "band": .string(arc.band.rawValue), "part": .string(arc.part.rawValue), "r": .double(arc.r),
      "from": .double(arc.from), "to": .double(arc.to), "width": .double(arc.width), "cap": .string(arc.cap.rawValue),
      "paint": paint(arc.paint), "opacity": .double(arc.opacity),
    ]
    if let dash = arc.dash { fields["dash"] = .array(dash.map { .double($0) }) }
    return .object(fields)
  }

  static func geometry(_ geometry: BandsGeometry) -> [String: JSONValue] {
    var fields: [String: JSONValue] = [
      "size": .double(geometry.size), "level": .int(Int64(geometry.level)),
      "centre": .object([
        "x": .double(geometry.centre.x), "y": .double(geometry.centre.y), "r": .double(geometry.centre.r),
        "items": .array(geometry.centre.items.map(item)),
      ]),
      "plans": .array(
        geometry.plans.map { plan in
          var fields: [String: JSONValue] = [
            "key": .string(plan.key), "from": .double(plan.from), "span": .double(plan.span), "dim": .bool(plan.dim),
            "arcs": .array(plan.arcs.map(arc)),
            "notches": .array(
              plan.notches.map { notch in
                .object([
                  "x1": .double(notch.x1), "y1": .double(notch.y1), "x2": .double(notch.x2), "y2": .double(notch.y2),
                  "width": .double(notch.width), "paint": paint(notch.paint), "opacity": .double(notch.opacity),
                ])
              }),
            "words": .string(plan.words),
          ]
          if let mark = plan.mark { fields["mark"] = .object(Self.mark(mark)) }
          if let hit = plan.hit {
            fields["hit"] = .object([
              "r": .double(hit.r), "width": .double(hit.width), "from": .double(hit.from), "to": .double(hit.to),
            ])
          }
          return .object(fields)
        }),
      "label": .string(geometry.label),
    ]
    if let empty = geometry.empty {
      fields["empty"] = .object([
        "r": .double(empty.r), "width": .double(empty.width), "paint": paint(empty.paint),
        "dash": .array(empty.dash.map { .double($0) }),
      ])
    }
    if let dot = geometry.hotDot {
      fields["hotDot"] = .object(["x": .double(dot.x), "y": .double(dot.y), "r": .double(dot.r), "ring": .double(dot.ring)])
    }
    return fields
  }
}
