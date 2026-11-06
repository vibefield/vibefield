import Foundation
import Testing

@testable import FieldProduct

/// IOS-12d (PC-L1, one Chat; Q1 (a), VF-PM 2026-11-06 19:12Z) — the phone's needs-you card is the Mac's. Each golden is
/// written by field-app's own card (`packages/field-app/test/needs-card-goldens.test.ts`) and copied here byte for
/// byte (`pnpm check:ios-fixtures`): what the card reads of Vela's entry (her id and name, the runs that are her own
/// session, her open items) and the item it draws, in; the card's facts and its words, out. The order a thread stands
/// its cards in, what an answer came to, a refusal and the card's times are goldens too. Each item is the golden's own,
/// decoded as the phone decodes one. The catalog's label for a held spawn's agent is the golden's `labels`, which a row
/// below holds to the kit's own copy of the contracts' catalog.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("IOS-12d — the phone's needs-you card is the Mac's: the needs-card goldens")
struct NeedsCardGoldenTests {
  @Test("each item's card: its facts and its words, field by field")
  func words() throws {
    let golden = try Self.golden("needs-card.words.golden")
    let labels = try Self.labels(golden)
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 21)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let reading = try Self.reading(try #require(each["entry"]))
      let item = try NeedsItem(json: try #require(each["item"]))
      let card = NeedsCards.card(reading, item: item)
      let facts = try #require(each["card"])
      #expect(.bool(card.own) == facts["own"], "\(name): own")
      #expect(.int(Int64(card.of)) == facts["of"], "\(name): of")
      #expect(.bool(card.waits) == facts["waits"], "\(name): waits")
      #expect(.string(card.names.from) == facts["names"]?["from"], "\(name): names.from")
      let to: JSONValue = card.names.to.map { .string($0) } ?? .null
      #expect(to == facts["names"]?["to"], "\(name): names.to")
      let words = NeedsCards.words(card, label: { labels[$0] })
      let want = try #require(each["words"])
      #expect(Self.json(words) == want, "\(name): words")
    }
  }

  @Test("the order a thread stands its cards in: its own run's ask first, then the oldest")
  func order() throws {
    let golden = try Self.golden("needs-card.order.golden")
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 4)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let reading = try Self.reading(try #require(each["entry"]))
      let card = NeedsCards.waiting(reading)
      let want = each["card"] ?? .null
      guard let card else {
        #expect(want == .null, "\(name): a card was wanted")
        continue
      }
      #expect(.string(card.item.id) == want["item"], "\(name): item")
      #expect(.bool(card.own) == want["own"], "\(name): own")
      #expect(.int(Int64(card.of)) == want["of"], "\(name): of")
      let place: JSONValue = NeedsCards.words(card).place.map { .string($0) } ?? .null
      #expect(place == want["place"], "\(name): place")
    }
  }

  @Test("what an answer came to, a refusal, and the card's times")
  func said() throws {
    let golden = try Self.golden("needs-card.said.golden")
    let times = try #require(golden["times"])
    #expect(times["saidMs"] == .int(Int64(NeedsCards.saidMs)))
    #expect(times["leaveMs"] == .int(Int64(NeedsCards.leaveMs)))
    #expect(times["fadeMs"] == .int(Int64(NeedsCards.fadeMs)))
    let cases = try #require(golden["said"]?.arrayValue)
    #expect(cases.count == 10)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let item = try NeedsItem(json: try #require(each["item"]))
      let choice = try #require(each["choice"]?.intValue)
      let said = NeedsCards.said(item, choice: Int(choice))
      let want = try #require(each["said"])
      #expect(.string(said.text) == want["text"], "\(name): text")
      #expect(.string(said.tone.rawValue) == want["tone"], "\(name): tone")
    }
    let refusals = try #require(golden["refused"]?.arrayValue)
    #expect(refusals.count == 2)
    for each in refusals {
      let reason = try #require(each["reason"]?.stringValue)
      #expect(.string(NeedsCards.refused(reason)) == each["said"])
    }
  }

  @Test("the golden's labels are the kit's catalog's: a lookup, never a literal (R23b)")
  func labelsAreTheCatalogs() throws {
    let golden = try Self.golden("needs-card.words.golden")
    let labels = try Self.labels(golden)
    #expect(!labels.isEmpty)
    let catalog = try AgentCatalogResult(json: try Fixture.json("agent-catalog.valid"))
    for (agent, label) in labels {
      let row = catalog.catalog.first { $0.id == agent }
      #expect(row?.label == label, "\(agent)")
    }
  }

  // MARK: - Reading a golden

  static func golden(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/needs-card")
    else { throw Fixture.FixtureError.missing(name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  static func labels(_ golden: JSONValue) throws -> [String: String] {
    guard case .object(let fields)? = golden["labels"] else { return [:] }
    return fields.compactMapValues { $0.stringValue }
  }

  /// What the card reads of the entry, as the golden says it.
  static func reading(_ entry: JSONValue) throws -> NeedsReading {
    let spark = try #require(entry["spark"]?["id"]?.stringValue)
    let name = try #require(entry["spark"]?["name"]?.stringValue)
    let ownRuns = (entry["ownRuns"]?.arrayValue ?? []).compactMap { $0.stringValue }
    let items = try (entry["items"]?.arrayValue ?? []).map(NeedsItem.init(json:))
    return NeedsReading(spark: spark, name: name, ownRuns: ownRuns, items: items)
  }

  /// The card's words as the Mac's golden writes them: every field, `null` for one it lacks.
  static func json(_ words: NeedsCardWords) -> JSONValue {
    let optional = { (text: String?) -> JSONValue in text.map { .string($0) } ?? .null }
    return .object([
      "eyebrow": .string(words.eyebrow),
      "question": .string(words.question),
      "words": optional(words.words),
      "more": optional(words.more),
      "sub": optional(words.sub),
      "acts": .array(
        words.acts.map { act in
          .object(["choice": .int(Int64(act.choice)), "word": .string(act.word), "primary": .bool(act.primary)])
        }),
      "show": .bool(words.show),
      "place": optional(words.place),
      "asked": .string(words.asked),
      "label": .string(words.label),
    ])
  }
}
