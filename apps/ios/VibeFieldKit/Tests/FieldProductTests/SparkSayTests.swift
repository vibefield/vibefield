import Foundation
import Testing

@testable import FieldProduct

/// IOS-12c (M-c1; PC-D3 A; IOS-12a §C) — your words to a spark, on the wire: `compose.sparks.say`'s params encode as
/// the contracts' own fixtures say (EL9, the phone's side), its three receipts read, and a say this build would send
/// malformed is refused before any call.
@Suite("IOS-12c — compose.sparks.say on the phone: its params and its receipt")
struct SparkSayTests {
  @Test("the params encode as the contracts' fixtures: from another screen (device), and with a chip")
  func params() throws {
    let device = try SparkSayParams(
      spark: "sp-9q2wloft1", text: "Run the review loop on ds/c again and tell me what changed",
      requestId: "say-01JC4M8Q2V7T", device: "dev-01HQ9S7XZ2")
    #expect(device.json == (try Fixture.json("compose-sparks-say-params.valid")))
    let chips = try SparkSayParams(
      spark: "sp-9q2wloft1", text: "Have Claude Code in vibe-field (session run-7f3c2a) review the composer test",
      requestId: "say-01JC4N0B6WQZ", chips: [SparkTranscriptChip(start: 5, length: 46, kind: "session")])
    #expect(chips.json == (try Fixture.json("compose-sparks-say-params.chips")))
    #expect(SparkSay.method == "compose.sparks.say")
  }

  @Test("the receipt reads queued, waking and delivered, its place in the queue while it waits")
  func receipts() throws {
    let queued = try SparkSayResult(json: try Fixture.json("compose-sparks-say.queued"))
    #expect(queued.spark == "sp-9q2wloft1" && queued.requestId == "say-01JC4M8Q2V7T")
    #expect(queued.state == "queued" && queued.position == 1 && queued.unknownFields.isEmpty)
    let waking = try SparkSayResult(json: try Fixture.json("compose-sparks-say.waking"))
    #expect(waking.state == "waking" && waking.position == 1)
    let delivered = try SparkSayResult(json: try Fixture.json("compose-sparks-say.delivered"))
    #expect(delivered.state == "delivered" && delivered.position == nil)
    // a state this build does not name is kept as it came: the flow says nothing for it
    let other = try SparkSayResult(
      json: ChatFlowGoldenTests.with(try Fixture.json("compose-sparks-say.queued"), ["state": .string("migrated")]))
    #expect(other.state == "migrated")
    #expect(ChatFlows.receipt(other.state, Self.idle, last: true) == nil)
  }

  @Test("a receipt fieldd could not have sent is refused: not queued, a bad request id, no place at 0")
  func refusedReceipts() throws {
    let queued = try Fixture.json("compose-sparks-say.queued")
    for change: [String: JSONValue] in [
      ["queued": .bool(false)], ["requestId": .string("short")], ["position": .int(0)], ["state": .string("")],
    ] {
      #expect(throws: (any Error).self, "\(change)") {
        try SparkSayResult(json: ChatFlowGoldenTests.with(queued, change))
      }
    }
  }

  @Test("a say this build would send malformed is refused before any call")
  func refused() throws {
    for id in ["short", "has a space1", "é-accented-id", String(repeating: "a", count: 65)] {
      #expect(throws: SparkSayRefusal.requestId(id)) {
        try SparkSayParams(spark: "sp-9q2wloft1", text: "hi", requestId: id)
      }
    }
    #expect(throws: SparkSayRefusal.words) {
      try SparkSayParams(spark: "sp-9q2wloft1", text: "", requestId: "say-00000001")
    }
    #expect(throws: SparkSayRefusal.words) {
      try SparkSayParams(
        spark: "sp-9q2wloft1", text: String(repeating: "x", count: 32_001), requestId: "say-00000001")
    }
    // a chip past the words, and two overlapping
    #expect(throws: SparkSayRefusal.chips) {
      try SparkSayParams(
        spark: "sp-9q2wloft1", text: "hi there", requestId: "say-00000001",
        chips: [SparkTranscriptChip(start: 3, length: 9, kind: "agent")])
    }
    #expect(throws: SparkSayRefusal.chips) {
      try SparkSayParams(
        spark: "sp-9q2wloft1", text: "hi there", requestId: "say-00000001",
        chips: [
          SparkTranscriptChip(start: 0, length: 4, kind: "agent"),
          SparkTranscriptChip(start: 2, length: 3, kind: "agent"),
        ])
    }
  }

  @Test("a press's request id is fresh, and one the contract admits")
  func requestIds() {
    let a = SparkSay.requestId()
    let b = SparkSay.requestId()
    #expect(a != b && SparkSay.isRequestId(a) && SparkSay.isRequestId(b))
    #expect(a.hasPrefix("say-") && a.count == 24)
  }

  static let idle = ChatFlowSpark(
    name: "Vela", seed: 4242, status: .ready, turnedAt: nil, isNew: false, awake: true, blocked: false, waiting: false,
    working: false)
}
