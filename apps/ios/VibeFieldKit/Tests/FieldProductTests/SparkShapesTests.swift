import Foundation
import Testing

@testable import FieldProduct

/// IOS-12b (PC-L2; `packages/contracts/src/compose.ts`) — Chat on the phone reads the home's two lists: the sparks
/// (`compose.sparks.list`) and the needs-you queue (`needs.list`), each asked with `scope: "mesh"`, so every row names
/// the desktop it lives on and `desktops` says how each self desktop answered the merge. The readers keep the remote
/// cut's posture: a row is refused where zod would refuse it, an OPEN word is kept as it came, and a refused row costs
/// only itself (named, by its id when it has one), never the list.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the phone reads the home's sparks and its needs-you queue")
struct SparkShapesTests {
  @Test("the merged list: each spark names its desktop, and the desktops say how each answered")
  func mergedSparks() throws {
    let list = try ComposeSparksList(json: try Fixture.json("compose-sparks-list.merged"))
    #expect(list.refused.isEmpty)
    #expect(list.unknownFields.isEmpty)
    let ids = list.sparks.map { $0.id }
    #expect(ids == ["sp-7k2m9q4x", "sp-9q2wloft1"])
    let vela = try #require(list.sparks.first)
    #expect(vela.name == "Vela")
    #expect(vela.seed == 2_846_113_027)
    #expect(vela.agent == "claude")
    #expect(vela.device == "dev-01HQ9S7UD1")
    #expect(vela.updatedAt == "2026-10-29T11:02:10.118Z")
    #expect(vela.turned == .unknown)
    #expect(vela.unknownFields.isEmpty)
    let session = try #require(vela.session)
    #expect(session.runtimeRunId == "run-12")
    #expect(session.terminalSessionId == "sess-01JB7Q2V")
    #expect(session.live)
    let kiwi = try #require(list.sparks.last)
    let kiwiSession = try #require(kiwi.session)
    #expect(kiwi.device == "dev-01HQ9S7XZ2")
    #expect(!kiwiSession.live && kiwiSession.terminalSessionId == nil)
    let desktops = list.desktops.map { "\($0.device) \($0.state)" }
    #expect(desktops == ["dev-01HQ9S7UD1 answered", "dev-01HQ9S7XZ2 answered", "dev-01HQ9S7Y44 asleep"])
    let known = list.desktops.map { $0.known }
    #expect(known == [.answered, .answered, .asleep])
  }

  @Test("a list from one desktop names none: no device, no desktops")
  func localSparks() throws {
    let list = try ComposeSparksList(json: try Fixture.json("compose-sparks-list.valid"))
    let names = list.sparks.map { $0.name }
    #expect(names == ["Vela", "Lyra"])
    #expect(list.sparks.allSatisfy { $0.device == nil })
    #expect(list.desktops.isEmpty)
    #expect(list.refused.isEmpty)
  }

  /// TU-1 (Q1): a time, `null` (hatched and never worked) and absent (from before TU-1: unknown) are three answers.
  @Test("whether a spark has worked: a time, never, or unknown")
  func turned() throws {
    let list = try ComposeSparksList(json: try Fixture.json("compose-sparks-list.turned"))
    let turned = list.sparks.map { $0.turned }
    #expect(turned == [.at("2026-11-01T08:40:12.000Z"), .never, .unknown])
    // the fixture's own `//` note is a key nobody reads on the envelope: named, never fatal
    #expect(list.unknownFields == ["//"])
  }

  @Test("a spark the phone cannot read costs only itself, named by its id")
  func refusedSpark() throws {
    let json = try Fixture.json("compose-sparks-list.merged")
    let rows: [(String, [Step], JSONValue?)] = [
      ("an id that is no spark id", [.key("sparks"), .index(0), .key("id")], .string("Vela")),
      ("a seed past 32 bits", [.key("sparks"), .index(0), .key("face"), .key("seed")], .int(4_294_967_296)),
      ("a name longer than 32", [.key("sparks"), .index(0), .key("name")], .string(String(repeating: "v", count: 33))),
      ("no updatedAt", [.key("sparks"), .index(0), .key("updatedAt")], nil),
      ("a session with no live", [.key("sparks"), .index(0), .key("session"), .key("live")], nil),
      ("a null device", [.key("sparks"), .index(0), .key("device")], .null),
    ]
    for (name, path, value) in rows {
      let list = try ComposeSparksList(json: edited(json, path, value))
      let kept = list.sparks.map { $0.id }
      #expect(kept == ["sp-9q2wloft1"], "\(name)")
      #expect(list.refused.count == 1, "\(name)")
    }
    let keyed = try ComposeSparksList(
      json: edited(json, [.key("sparks"), .index(0), .key("updatedAt")], nil))
    let refusal = try #require(keyed.refused.first)
    #expect(refusal.key == "sp-7k2m9q4x")
    let keyless = try ComposeSparksList(json: edited(json, [.key("sparks"), .index(0), .key("id")], .string("Vela")))
    let keylessRefusal = try #require(keyless.refused.first)
    #expect(keylessRefusal.key == nil)
    // a field a newer home adds rides through, named
    let newer = try ComposeSparksList(
      json: edited(json, [.key("sparks"), .index(0), .key("mood")], .string("bright")))
    let vela = try #require(newer.sparks.first)
    #expect(vela.unknownFields == ["mood"])
    // the envelope's own fault throws the list: no `sparks`
    #expect(throws: WireDecodeError.self) {
      _ = try ComposeSparksList(json: edited(json, [.key("sparks")], nil))
    }
  }

  @Test("a desktop's state is an OPEN word: one this build does not know is kept")
  func openDesktopState() throws {
    let json = try Fixture.json("compose-sparks-list.merged")
    let list = try ComposeSparksList(
      json: edited(json, [.key("desktops"), .index(2), .key("state")], .string("dozing")))
    let last = try #require(list.desktops.last)
    #expect(last.state == "dozing")
    #expect(last.known == nil)
  }

  @Test("the needs-you queue: each kind, its asker, its spark and its desktop")
  func needsList() throws {
    let list = try NeedsList(json: try Fixture.json("needs-list.valid"))
    #expect(list.refused.isEmpty)
    let kinds = list.items.map { $0.knownKind }
    #expect(kinds == [.question, .heldSend, .heldSpawn, .agentAsk])
    #expect(list.items.allSatisfy { $0.state == "open" && $0.spark == "sp-7k2m9q4x" })
    let ask = try #require(list.items.last)
    #expect(ask.from.name == "claude·2")
    #expect(ask.from.session == "run-31")
    #expect(ask.from.spark == nil)
    #expect(ask.ask == "permission")
    #expect(ask.asked == "2026-10-31T16:07:40.250Z")
    let question = try #require(list.items.first)
    #expect(question.from.spark == "sp-7k2m9q4x")
    #expect(question.id == "ny-3f9a1c0b7e2d4a61")

    let merged = try NeedsList(json: try Fixture.json("needs-list.merged"))
    #expect(merged.items.allSatisfy { $0.device == "dev-01HQ9S7UD1" })
    let states = merged.desktops.map { $0.known }
    #expect(states == [.answered, .timeout, .asleep])
  }

  @Test("every kind of item reads whole; a kind this build does not know is kept, and its new field named")
  func items() throws {
    // IOS-12d: CP-4's six flow kinds with them, their run and script held to the contract
    let flows = ["flow-proposal", "flow-gate", "flow-changed", "flow-repair", "flow-cap", "flow-lost"]
    for name in ["question", "held-send", "held-send-cut", "held-spawn", "agent-ask"] + flows {
      let item = try NeedsItem(json: try Fixture.json("needs-item.\(name)"))
      #expect(item.knownKind != nil, "\(name)")
      #expect(item.unknownFields.isEmpty, "\(name)")
    }
    let gate = try NeedsItem(json: try Fixture.json("needs-item.unknown-kind"))
    #expect(gate.kind == "gate")
    #expect(gate.knownKind == nil)
    #expect(gate.state == "waiting")
    #expect(gate.spark == nil)
    #expect(gate.unknownFields == ["step"])
  }

  @Test("IOS-12d — what the card says is read: a held send's session, a spawn's agent, folder and count, an answer")
  func cardFacts() throws {
    let send = try NeedsItem(json: try Fixture.json("needs-item.held-send"))
    #expect(send.to?.session == "run-31")
    #expect(send.to?.name == "claude·2")
    #expect(send.count == 2)
    let spawn = try NeedsItem(json: try Fixture.json("needs-item.held-spawn"))
    #expect(spawn.agent == "claude")
    #expect(spawn.folder == "vibe-field")
    #expect(spawn.live == 8)
    let kinds = NeedsItemKind.allCases.map { $0.rawValue }
    #expect(kinds.count == 10)
    let answered = try NeedsAnswerResult(json: try Fixture.json("needs-answer-result.valid")).item
    let answer = try #require(answered.answer)
    #expect(answered.state == "answered")
    #expect(answer.choice == 0 && answer.outcome == "done" && !answer.told)
    #expect(answer.waits == "Vela's session is starting; it hears your answer when it wakes")
    #expect(answer.reason == nil)
    // a script's hash that is no SHA-256 refuses the item, as zod does
    let changed = try Fixture.json("needs-item.flow-changed")
    let bad = edited(changed, [.key("script"), .key("hash")], .string("not-a-hash"))
    #expect(throws: (any Error).self) { try NeedsItem(json: bad) }
  }

  @Test("IOS-12d — an answer goes by the act's place, carried to the item's desktop")
  func answerParams() throws {
    let here = NeedsAnswerParams(item: "ny-3f9a1c0b7e2d4a61", choice: 0, device: nil).json
    let want = try Fixture.json("needs-answer-params.valid")
    #expect(here == want)
    let carried = NeedsAnswerParams(item: "ny-3f9a1c0b7e2d4a61", choice: 1, device: "dev-01HQ9S7XZ2").json
    let fields: JSONValue = .object([
      "item": .string("ny-3f9a1c0b7e2d4a61"), "choice": .int(1), "device": .string("dev-01HQ9S7XZ2"),
    ])
    #expect(carried == fields)
    #expect(NeedsAnswerParams.method == "needs.answer")
  }

  @Test("an item the phone cannot read costs only itself")
  func refusedItem() throws {
    let json = try Fixture.json("needs-list.valid")
    let rows: [(String, [Step], JSONValue?)] = [
      ("an id that is no needs id", [.key("items"), .index(0), .key("id")], .string("q-1")),
      ("no asker", [.key("items"), .index(0), .key("from")], nil),
      ("an asker with no name", [.key("items"), .index(0), .key("from"), .key("name")], nil),
      ("a spark that is no spark id", [.key("items"), .index(0), .key("spark")], .string("Vela")),
      ("no asked", [.key("items"), .index(0), .key("asked")], nil),
    ]
    for (name, path, value) in rows {
      let list = try NeedsList(json: edited(json, path, value))
      #expect(list.items.count == 3, "\(name)")
      #expect(list.refused.count == 1, "\(name)")
    }
  }

  @Test("the phone asks every self desktop's list through its home")
  func params() {
    #expect(ComposeListParams.mesh.json == .object(["scope": .string("mesh")]))
    let open = ComposeSparksOpenParams(spark: "sp-9q2wloft1", device: "dev-01HQ9S7XZ2").json
    #expect(open == .object(["spark": .string("sp-9q2wloft1"), "device": .string("dev-01HQ9S7XZ2")]))
    let local = ComposeSparksOpenParams(spark: "sp-7k2m9q4x", device: nil).json
    #expect(local == .object(["spark": .string("sp-7k2m9q4x")]))
  }
}
