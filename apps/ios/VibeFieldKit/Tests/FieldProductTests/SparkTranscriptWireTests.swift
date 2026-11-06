import Foundation
import Testing

@testable import FieldProduct

/// SP-7a (`packages/contracts/src/spark-transcript.ts`; TH-1, DESIGN.md §8 "Chat's thread") — the spark's transcript,
/// read on the phone: its lines, the transcript worker's frames, the window's one `open`, and the ticket's answer.
/// These rows are the contracts' own (`packages/contracts/test/spark-transcript.test.ts`), read over the same goldens,
/// copied in (EL9 on the third side; `pnpm check:ios-fixtures` keeps the copies the contracts' bytes).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("SP-7a — the spark's transcript, read on the phone")
struct SparkTranscriptWireTests {
  static let lineGoldens = [
    "run", "you", "you-terminal", "outcome", "outcome-uncertain", "reply", "forged", "tool", "tool-ours", "act",
    "act-crew", "turn", "gap", "unknown-kind",
  ]

  static func line(_ name: String) throws -> SparkTranscriptLine {
    try SparkTranscriptLine(json: try Fixture.json("spark-transcript-line.\(name)"))
  }

  /// A golden's object with `changes` laid over it.
  static func edited(_ name: String, _ changes: [String: JSONValue]) throws -> JSONValue {
    let golden = try Fixture.json("spark-transcript-line.\(name)")
    let fields = golden.objectValue ?? [:]
    return .object(fields.merging(changes) { _, new in new })
  }

  @Test("reads every kind this build knows, each from its golden, and skips the one it does not")
  func everyKind() {
    let known = Self.lineGoldens.filter { $0 != "unknown-kind" }
    let kinds = known.map { name in (try? Self.line(name))?.body?.kind }
    #expect(Set(kinds.compactMap { $0 }) == ["run", "you", "outcome", "reply", "tool", "act", "turn", "gap"])
    let unread = kinds.filter { $0 == nil }.count
    #expect(unread == 0, "every known golden reads with its body")
    #expect(SparkTranscriptLimits.format == 1)
  }

  @Test("keeps your words with their chips and request id, and the terminal's with neither")
  func yourWords() throws {
    let line = try? Self.line("you")
    guard case .you(let yours)? = line?.body else {
      Issue.record("the you golden did not read as your words")
      return
    }
    let facts = [yours.via, yours.input, yours.requestId, yours.state]
    #expect(facts == ["chat", "b27e5a90c4d1", "say-01JC4N0B6WQZ", "queued"])
    let chip = try #require(yours.chips?.first)
    let units = Array(yours.text.utf16)
    let words = String(decoding: units[chip.start..<(chip.start + chip.length)], as: UTF16.self)
    #expect(words.hasPrefix("Claude Code in vibe-field (session "))
    #expect(chip.kind == "session")
    let typed = try? Self.line("you-terminal")
    guard case .you(let terminal)? = typed?.body else {
      Issue.record("the you-terminal golden did not read as your words")
      return
    }
    #expect(terminal.via == "terminal")
    #expect(terminal.input == nil && terminal.chips == nil)
  }

  @Test("refuses chips that do not stand inside the words, and a line of another format, whose head still reads")
  func refusedBodies() throws {
    let outside = try Self.edited(
      "you", ["chips": .array([.object(["start": .int(70), "length": .int(20), "kind": .string("session")])])])
    let chipped = try? SparkTranscriptLine(json: outside)
    #expect(chipped != nil, "the head reads")
    #expect(chipped?.body == nil, "chips past the words: no body")
    let format2 = try Self.edited("you", ["v": .int(2)])
    let newer = try? SparkTranscriptLine(json: format2)
    #expect(newer?.v == 2, "a reader counts what it skipped")
    #expect(newer != nil && newer?.body == nil)
  }

  @Test("keeps a tool by its kind and what it touched, never its name")
  func tools() {
    let line = try? Self.line("tool")
    guard case .tool(let tool)? = line?.body else {
      Issue.record("the tool golden did not read as a tool")
      return
    }
    #expect(tool.toolKind == "command")
    #expect(tool.detail == "pnpm --filter @vibefield/field-app test chat-composer")
    #expect(!tool.ours)
    let mine = try? Self.line("tool-ours")
    guard case .tool(let ours)? = mine?.body else {
      Issue.record("the tool-ours golden did not read as a tool")
      return
    }
    #expect(ours.toolKind == "mcp" && ours.ours && ours.detail == nil)
  }

  @Test("keeps a crew's act line with its crew's id, and an act line without one; a crew in words is not this build's")
  func acts() throws {
    let line = try? Self.line("act-crew")
    guard case .act(let what, let text, let crew)? = line?.body else {
      Issue.record("the act-crew golden did not read as an act")
      return
    }
    #expect(what == "crew")
    #expect(crew == "cr-4f1c2a9e0b7d3c61")
    #expect(text == "Started 4 agents · Opus 5.5 · high")
    let notify = try? Self.line("act")
    guard case .act(_, _, let none)? = notify?.body else {
      Issue.record("the act golden did not read as an act")
      return
    }
    #expect(none == nil)
    for words in ["Vela's crew", "", "cr-"] {
      let edited = try Self.edited("act-crew", ["crew": .string(words)])
      let named = try? SparkTranscriptLine(json: edited)
      #expect(named != nil && named?.body == nil, "crew \(words)")
    }
  }

  @Test("skips a kind this build does not know, while its head reads")
  func unknownKind() {
    let line = try? Self.line("unknown-kind")
    #expect(line?.kind == "plan")
    #expect(line != nil && line?.body == nil)
    let unknown = line?.unknownFields ?? []
    #expect(unknown == ["steps"])
  }

  @Test("reads a forged line as any line: its MAC is the worker's to refuse, never the reader's")
  func forged() throws {
    let forged = try? Self.line("forged")
    let reply = try? Self.line("reply")
    #expect(forged != nil && forged?.mac == reply?.mac && forged?.seq == reply?.seq)
    let notHex = try Self.edited("reply", ["mac": .string("not-hex")])
    let seqZero = try Self.edited("reply", ["seq": .int(0)])
    #expect(throws: WireDecodeError.self) { try SparkTranscriptLine(json: notHex) }
    #expect(throws: WireDecodeError.self) { try SparkTranscriptLine(json: seqZero) }
  }

  @Test("says what became of your words in the receipt's words, OPEN")
  func outcomes() {
    let delivered = try? Self.line("outcome")
    let lost = try? Self.line("outcome-uncertain")
    #expect(delivered?.body == .outcome(of: "b27e5a90c4d1", state: "delivered", reason: nil))
    #expect(lost?.body == .outcome(of: "b27e5a90c4d1", state: "uncertain", reason: "no-receipt"))
  }

  @Test("the rest of the kinds: a run, a reply, a turn's edge, a gap")
  func theRest() {
    let run = try? Self.line("run")
    #expect(run?.body == .run(runtimeRunId: "run-01JC4MA2K3", fresh: false))
    let turn = try? Self.line("turn")
    #expect(turn?.body == .turn(edge: "start", turn: "turn-4"))
    let gap = try? Self.line("gap")
    #expect(gap?.body == .gap(since: "2026-11-04T23:16:40.000Z"))
    let reply = try? Self.line("reply")
    guard case .reply(let messageId, let turnId, let text)? = reply?.body else {
      Issue.record("the reply golden did not read as a reply")
      return
    }
    #expect(messageId == "msg_01JC4N3" && turnId == "turn-4")
    #expect(text.hasPrefix("The composer test fails on `main`"))
    #expect(reply?.seq == 7 && reply?.at == "2026-11-04T23:11:20.900Z")
  }

  @Test("the ticket: a loopback endpoint with no credential in it, a single-use ticket, and the spark's runs")
  func ticket() throws {
    let golden = try Fixture.json("spark-transcript-ticket.valid")
    let answer = try? SparkTranscriptTicket(json: golden)
    let fresh = answer?.runs.map { $0.fresh }
    #expect(fresh == [true, false])
    #expect(answer?.spark == "sp-9q2wloft1")
    #expect(answer?.endpoint.absoluteString == "ws://127.0.0.1:53817/transcripts")
    #expect(answer?.generation == 2 && answer?.expiresAt == 1_762_298_000_000)
    let fields = golden.objectValue ?? [:]
    for endpoint in [
      "ws://10.0.0.4:53817/transcripts", "ws://127.0.0.1:53817/transcripts?ticket=x",
      "wss://127.0.0.1:53817/transcripts",
    ] {
      let refused = try? SparkTranscriptTicket(json: .object(fields.merging(["endpoint": .string(endpoint)]) { $1 }))
      #expect(refused == nil, "\(endpoint)")
    }
    let short = try? SparkTranscriptTicket(json: .object(fields.merging(["ticket": .string("short")]) { $1 }))
    #expect(short == nil)
    #expect(SparkTranscriptLimits.runsMax == 256 && SparkTranscriptLimits.ticketTTLMs == 60_000)
    let params = try Fixture.json("spark-transcript-ticket-params.valid")
    #expect(SparkTranscriptReader.ticketParams(spark: "sp-9q2wloft1") == params)
  }

  @Test("the phone's ticket: the worker's routed serve on its tailnet port, never loopback, no other port or path")
  func remoteTicket() throws {
    let golden = try Fixture.json("spark-transcript-ticket.remote")
    let answer = try? SparkTranscriptTicket(json: golden)
    #expect(answer?.endpoint.absoluteString == "ws://studio-mbp.tail9f2c.ts.net:9426/transcripts")
    #expect(answer?.runs.count == 2)
    #expect(SparkTranscriptLimits.servePort == 9426)
    let fields = golden.objectValue ?? [:]
    let host = "studio-mbp.tail9f2c.ts.net"
    let secure = try? SparkTranscriptTicket(
      json: .object(fields.merging(["endpoint": .string("wss://\(host):9426/transcripts")]) { $1 }))
    #expect(secure?.endpoint.scheme == "wss")
    // the contract's own refusals (`spark-transcript.test.ts`), and a user in the host, which no ticket carries
    for endpoint in [
      "ws://\(host):9999/transcripts", "ws://\(host):9426/transcripts?ticket=x", "ws://\(host):9426/transcripts#x",
      "ws://\(host):9426/elsewhere", "ws://localhost:9426/transcripts", "ws://[::1]:9426/transcripts",
      "http://\(host):9426/transcripts", "ws://me@\(host):9426/transcripts",
    ] {
      let refused = try? SparkTranscriptTicket(json: .object(fields.merging(["endpoint": .string(endpoint)]) { $1 }))
      #expect(refused == nil, "\(endpoint)")
    }
    // the ask names the desktop that keeps the spark, and names none when there is none
    let device = try Fixture.json("spark-transcript-ticket-params.device")
    #expect(SparkTranscriptReader.ticketParams(spark: "sp-9q2wloft1", device: "dev-01HQ9S7UD1") == device)
    let own = try Fixture.json("spark-transcript-ticket-params.valid")
    #expect(SparkTranscriptReader.ticketParams(spark: "sp-9q2wloft1", device: nil) == own)
  }

  @Test("the window's one message: the ticket, and the runs it reads, each after the line it holds")
  func open() throws {
    let golden = try Fixture.json("spark-transcript-open.valid")
    let open = SparkTranscriptOpen(
      ticket: "Qm9pZ2hUcmFuc2NyaXB0VGlja2V0X0V4YW1wbGUwMDE",
      runs: [.init(run: "run-01JC2Z9X0A", after: nil), .init(run: "run-01JC4MA2K3", after: 4)])
    #expect(open.json == golden)
    let text = try open.text()
    let parsed = try JSONValue.parse(Data(text.utf8))
    #expect(parsed == golden)
  }

  @Test("the worker answers ready, lines, caught-up with what it dropped, a new run, or a refusal")
  func frames() throws {
    var types: [String] = []
    for name in ["ready", "line", "caught-up", "run", "refused"] {
      let golden = try Fixture.json("spark-transcript-frame.\(name)")
      let frame = try? SparkTranscriptFrame(json: golden)
      types.append(frame.map(Self.typeName) ?? "unread")
    }
    #expect(types == ["ready", "line", "caught-up", "run", "refused"])
    let caught = try? SparkTranscriptFrame(json: try Fixture.json("spark-transcript-frame.caught-up"))
    #expect(caught == .caughtUp(dropped: 1))
    let ready = try? SparkTranscriptFrame(json: try Fixture.json("spark-transcript-frame.ready"))
    #expect(ready == .ready(generation: 2))
    let refused = try? SparkTranscriptFrame(json: try Fixture.json("spark-transcript-frame.refused"))
    #expect(refused == .refused(reason: "ticket-used"))
    let run = try? SparkTranscriptFrame(json: try Fixture.json("spark-transcript-frame.run"))
    #expect(run == .run(SparkTranscriptRun(runtimeRunId: "run-01JC4P7M2N", startedAt: "2026-11-04T23:40:00.000Z", fresh: false)))
    // a frame of a type this build does not know does not read: the reader passes it over
    let pause = JSONValue.object(["type": .string("pause")])
    #expect(throws: WireDecodeError.self) { try SparkTranscriptFrame(json: pause) }
  }

  static func typeName(_ frame: SparkTranscriptFrame) -> String {
    switch frame {
    case .ready: "ready"
    case .line: "line"
    case .caughtUp: "caught-up"
    case .run: "run"
    case .refused: "refused"
    }
  }
}
