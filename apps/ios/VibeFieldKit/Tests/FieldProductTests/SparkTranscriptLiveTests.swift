import Foundation
import Testing

@testable import FieldProduct

/// SP-7a W1 (SP-7a's plan, §W1) — the phone's reader against the REAL transcript worker, over the real socket. Opt-in:
/// off unless `SP7A_W1_DIR` names the folder fieldd's harness row (`packages/fieldd/test/sp7a-w1-harness.test.ts`)
/// serves from (xcodebuild passes it as `TEST_RUNNER_SP7A_W1_DIR`). The harness starts fieldd's own worker on this
/// host's loopback, which the simulator shares, keeps a door's answer in `ticket.json` (refreshed: a ticket is
/// single-use), and appends a reply each second. This row reads it as Chat will:
/// - `URLSessionProductTransport`'s default session, whose request names no Origin (the worker's rule: this machine's
///   client);
/// - the kept lines, caught up, then a tail line heard after;
/// - what it saw written to `kit-saw.json`, and `kit-done`, so the harness stops.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

private let w1Dir = ProcessInfo.processInfo.environment["SP7A_W1_DIR"]

/// The home's door, as the harness keeps it: each ask reads the newest `ticket.json`.
@MainActor
private final class HarnessTicketDoor: SparkTranscriptDoor {
  let file: URL
  private(set) var asks = 0

  init(_ file: URL) { self.file = file }

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asks += 1
    guard method == SparkTranscriptLimits.openTicketMethod else {
      throw FieldProductError(kind: "NOT_FOUND", message: "the harness answers no \(method)")
    }
    return try JSONValue.parse(try Data(contentsOf: file))
  }
}

@MainActor
private func w1Wait(_ what: String, timeout: Duration = .seconds(60), _ condition: @MainActor () -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if condition() { return }
    try? await Task.sleep(for: .milliseconds(50))
  }
  Issue.record("timed out waiting for \(what)")
}

private func held(_ reading: SparkTranscriptReading, _ run: String) -> [SparkTranscriptKnownLine] {
  guard case .ready(_, let lines, _, _) = reading else { return [] }
  return lines[run] ?? []
}

@Suite("SP-7a W1 — the phone's reader against fieldd's own transcript worker")
@MainActor
struct SparkTranscriptLiveTests {
  @Test(
    "reads the kept lines and the tail from the real worker, over a socket with no Origin",
    .enabled(if: w1Dir != nil), .timeLimit(.minutes(3)))
  func readsTheRealWorker() async throws {
    let dir = URL(fileURLWithPath: try #require(w1Dir))
    let ticketFile = dir.appendingPathComponent("ticket.json")
    defer { try? Data().write(to: dir.appendingPathComponent("kit-done")) }
    await w1Wait("the harness's ticket.json", timeout: .seconds(120)) {
      FileManager.default.fileExists(atPath: ticketFile.path)
    }
    let first = try SparkTranscriptTicket(json: try JSONValue.parse(try Data(contentsOf: ticketFile)))
    let latest = first.runs.last
    let run = try #require(latest).runtimeRunId
    let door = HarnessTicketDoor(ticketFile)
    let reader = SparkTranscriptReader(spark: first.spark, door: door, transport: URLSessionProductTransport())
    reader.start()
    await w1Wait("the caught-up reading") { held(reader.reading, run).count >= 3 }
    let caught = held(reader.reading, run)
    let base = caught.last?.seq ?? 0
    await w1Wait("a tail line after seq \(base)") { (held(reader.reading, run).last?.seq ?? 0) > base }
    let after = held(reader.reading, run)
    let reading = reader.reading
    let skipped = reader.skipped
    let asks = door.asks
    reader.cancel()

    let kinds = after.map { $0.kind }
    let seqs = after.map { $0.seq }
    var dropped = -1
    if case .ready(_, _, let count, _) = reading { dropped = count }
    let saw = JSONValue.object([
      "spark": .string(first.spark),
      "run": .string(run),
      "caughtUp": .int(Int64(caught.count)),
      "seqs": .array(seqs.map { .int($0) }),
      "kinds": .array(kinds.map { .string($0) }),
      "dropped": .int(Int64(dropped)),
      "skipped": .int(Int64(skipped)),
      "asks": .int(Int64(asks)),
    ])
    try saw.encoded().write(to: dir.appendingPathComponent("kit-saw.json"), options: .atomic)

    let kept = Array(kinds.prefix(3))
    #expect(kept == ["run", "you", "reply"], "the kept lines, in order")
    let contiguous = seqs.isEmpty ? [] : Array(1...(seqs.last ?? 0))
    #expect(seqs == contiguous, "every line once, with no gap")
    let tailSeq = seqs.last ?? 0
    #expect(tailSeq > base, "a tail line after the catch-up")
    #expect(dropped == 0 && skipped == 0)
  }
}
