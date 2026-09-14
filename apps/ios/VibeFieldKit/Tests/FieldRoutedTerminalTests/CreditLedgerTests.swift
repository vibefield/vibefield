import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// The seven credit laws (spec §8), each as its own row.
///
/// They are all arithmetic and lifetimes, so none of them wants a socket — which
/// is the point: a ledger that could only be tested through a door would be
/// tested at the one moment it is hardest to reason about.
@Suite struct CreditLedgerTests {
  /// Law (1): every received unit returns its charge EXACTLY ONCE, to the
  /// connection total AND to the account its envelope named.
  @Test func everyUnitIsChargedOnceToBothTotals() {
    var ledger = RoutedCreditLedger(creditEpoch: 3)
    ledger.charge(bytes: 100, activationId: "a-1", nowMs: 0)
    ledger.charge(bytes: 250, activationId: "a-1", nowMs: 1)
    ledger.charge(bytes: 40, activationId: "a-2", nowMs: 2)
    #expect(ledger.connectionBytesReturned == 390)
    #expect(ledger.bytesReturned(for: "a-1") == 350)
    #expect(ledger.bytesReturned(for: "a-2") == 40)
  }

  /// Law (1) again, and the part that is easy to get wrong: a unit for an
  /// activation this client no longer presents is STILL charged. A receiver that
  /// returned credit only for units it liked would starve the connection one
  /// mistake at a time.
  @Test func aStaleActivationsUnitIsStillReturned() {
    var ledger = RoutedCreditLedger(creditEpoch: 1)
    ledger.charge(bytes: 512, activationId: "an-activation-nobody-holds", nowMs: 0)
    let body = ledger.makeReturn(nowMs: 0)
    #expect(body["connectionBytesReturned"]?.intValue == 512)
    #expect(body["accounts"]?.arrayValue?.count == 1)
  }

  /// Law (6): every total is CUMULATIVE and monotonic within the epoch, so a
  /// duplicate or reordered return is harmless — the cell applies `max()`.
  @Test func totalsAreCumulativeAndTheSequenceOnlyDeduplicates() {
    var ledger = RoutedCreditLedger(creditEpoch: 1)
    ledger.charge(bytes: 100, activationId: "a-1", nowMs: 0)
    let first = ledger.makeReturn(nowMs: 0)
    ledger.charge(bytes: 100, activationId: "a-1", nowMs: 1)
    let second = ledger.makeReturn(nowMs: 1)
    #expect(first["connectionBytesReturned"]?.intValue == 100)
    #expect(second["connectionBytesReturned"]?.intValue == 200)
    #expect(first["creditSequence"]?.intValue == 1)
    #expect(second["creditSequence"]?.intValue == 2)
    #expect(second["creditEpoch"]?.intValue == 1)
  }

  /// Laws (2) and (3): invalidation stops admission and NEVER pretends
  /// already-admitted bytes vanished — the account drains, is still reported,
  /// and is forgotten only after the drain TTL has passed with no unit.
  @Test func aCancelledAccountDrainsAndIsOnlyForgottenAfterItsTtl() {
    var ledger = RoutedCreditLedger(creditEpoch: 1)
    ledger.charge(bytes: 1000, activationId: "a-old", nowMs: 0)
    ledger.charge(bytes: 10, activationId: "a-new", nowMs: 0)
    ledger.drain(activationId: "a-old", nowMs: 0)
    #expect(ledger.isDraining("a-old"))

    // A straggler that was already in flight at invalidation still lands, still
    // charges, and pushes the drain clock out.
    ledger.charge(bytes: 24, activationId: "a-old", nowMs: 1000)
    ledger.prune(nowMs: 4000, drainTtlMs: 5000)
    #expect(ledger.accountIds == ["a-new", "a-old"])
    #expect(ledger.bytesReturned(for: "a-old") == 1024)

    ledger.prune(nowMs: 6001, drainTtlMs: 5000)
    #expect(ledger.accountIds == ["a-new"])
    // Forgetting the NAME never loses the BYTES: the connection total is
    // cumulative and monotonic within the epoch.
    #expect(ledger.connectionBytesReturned == 1034)
  }

  /// Law (4): replacing the physical frames leg starts a new epoch and resets
  /// every total — bytes on the dead socket cannot arrive on the replacement,
  /// and carrying a total across would credit the new leg for them.
  @Test func aNewEpochResetsEverything() {
    var ledger = RoutedCreditLedger(creditEpoch: 1)
    ledger.charge(bytes: 5000, activationId: "a-1", nowMs: 0)
    _ = ledger.makeReturn(nowMs: 0)
    ledger.reset(creditEpoch: 2, nowMs: 10)
    #expect(ledger.creditEpoch == 2)
    #expect(ledger.creditSequence == 0)
    #expect(ledger.connectionBytesReturned == 0)
    #expect(ledger.accountIds.isEmpty)
    #expect(ledger.unreturnedBytes == 0)
    let body = ledger.makeReturn(nowMs: 11)
    #expect(body["creditEpoch"]?.intValue == 2)
    #expect(body["creditSequence"]?.intValue == 1)
  }

  /// Batching: a return is owed when enough has accumulated OR the cell's own
  /// `maxCreditReturnDelayMs` has passed — whichever comes first, so a burst
  /// does not wait for a timer and a trickle does not cost a message per frame.
  @Test func returnsAreOwedByThresholdOrByDelay() {
    var ledger = RoutedCreditLedger(creditEpoch: 1, nowMs: 0)
    #expect(!ledger.owesReturn(nowMs: 100, maxDelayMs: 16, thresholdBytes: 1000))
    ledger.charge(bytes: 10, activationId: "a-1", nowMs: 0)
    #expect(!ledger.owesReturn(nowMs: 5, maxDelayMs: 16, thresholdBytes: 1000))
    #expect(ledger.owesReturn(nowMs: 20, maxDelayMs: 16, thresholdBytes: 1000))
    ledger.charge(bytes: 2000, activationId: "a-1", nowMs: 5)
    #expect(ledger.owesReturn(nowMs: 6, maxDelayMs: 16, thresholdBytes: 1000))
    _ = ledger.makeReturn(nowMs: 6)
    #expect(!ledger.owesReturn(nowMs: 7, maxDelayMs: 16, thresholdBytes: 1000))
  }

  /// Law (7), from the receiver's side: the accounts are SEPARATE, so one
  /// activation's traffic never appears in another's total. The per-activation
  /// window is what makes one viewer's stall another viewer's non-event, and it
  /// only works if the ledger keeps them apart.
  @Test func oneActivationsBytesNeverLandInAnothersAccount() {
    var ledger = RoutedCreditLedger(creditEpoch: 1)
    ledger.charge(bytes: 900, activationId: "a-stalled", nowMs: 0)
    ledger.charge(bytes: 10, activationId: "a-busy", nowMs: 0)
    #expect(ledger.bytesReturned(for: "a-stalled") == 900)
    #expect(ledger.bytesReturned(for: "a-busy") == 10)
    let accounts = ledger.makeReturn(nowMs: 0)["accounts"]?.arrayValue ?? []
    #expect(accounts.count == 2)
    #expect(accounts.compactMap { $0["activationId"]?.stringValue } == ["a-busy", "a-stalled"])
  }
}

@Suite struct TransferTests {
  private func beginHeader(
    id: String = "t-1", kind: String = "seed", totalBytes: Int, chunkCount: Int, checksum: UInt32,
    cols: Int = 80, rows: Int = 24
  ) throws -> RoutedEnvelopeHeader {
    try RoutedEnvelopeHeader(
      json: .object([
        "creditEpoch": .int(1), "activationSequence": .int(1), "sessionId": .string("s-1"),
        "activationId": .string("a-1"), "leaseEpoch": .int(0),
        "kind": .string("transfer-begin"),
        "baseContent": .null,
        "resultContent": stamp(4).json,
        "transfer": .object([
          "transferId": .string(id), "kind": .string(kind), "totalBytes": .int(Int64(totalBytes)),
          "chunkCount": .int(Int64(chunkCount)),
          "checksum": .object(["alg": .string("crc32c"), "value": .int(Int64(checksum))]),
          "targetLayout": .object([
            "cols": .int(Int64(cols)), "rows": .int(Int64(rows)), "scrollbackRows": .int(1000),
          ]),
        ]),
      ]))
  }

  private func chunkHeader(id: String = "t-1", index: Int, offset: Int) throws
    -> RoutedEnvelopeHeader
  {
    try RoutedEnvelopeHeader(
      json: .object([
        "creditEpoch": .int(1), "activationSequence": .int(2), "sessionId": .string("s-1"),
        "activationId": .string("a-1"), "leaseEpoch": .int(0),
        "kind": .string("transfer-chunk"),
        "transfer": .object([
          "transferId": .string(id), "chunkIndex": .int(Int64(index)),
          "byteOffset": .int(Int64(offset)),
        ]),
      ]))
  }

  private func stamp(_ revision: Int64) -> RoutedSceneStamp {
    RoutedSceneStamp(cellBootId: "cb-1", modelGeneration: 0, sceneRevision: revision)
  }

  /// The happy path: a seed arrives in chunks, reassembles, and its crc32c
  /// agrees. The checksum is INTEGRITY only — the channel is authenticated — so
  /// what it catches is a truncated or misordered reassembly.
  @Test func aChunkedSeedReassemblesAndVerifies() throws {
    let bytes = Data((0..<300).map { UInt8($0 % 251) })
    let checksum = RoutedCrc32c.checksum(bytes)
    var transfer = try RoutedTransfer(
      header: try beginHeader(totalBytes: bytes.count, chunkCount: 3, checksum: checksum),
      budgetBytes: 4096)
    try transfer.stage(try chunkHeader(index: 0, offset: 0), payload: bytes[0..<100])
    try transfer.stage(try chunkHeader(index: 2, offset: 200), payload: bytes[200..<300])
    try transfer.stage(try chunkHeader(index: 1, offset: 100), payload: bytes[100..<200])
    #expect(try transfer.finish() == bytes)
    #expect(transfer.isSeed)
  }

  /// A zero-chunk transfer is legal — `begin` then `end`, an empty frame — and
  /// the cell's own pump can send one, so a receiver that required a chunk would
  /// hang on a real message.
  @Test func aZeroChunkTransferIsLegal() throws {
    let checksum = RoutedCrc32c.checksum(Data())
    let transfer = try RoutedTransfer(
      header: try beginHeader(totalBytes: 0, chunkCount: 0, checksum: checksum), budgetBytes: 4096)
    #expect(try transfer.finish().isEmpty)
  }

  /// Every bound this client advertised is ENFORCED here rather than trusted: a
  /// transfer is the one place it allocates on somebody else's say-so.
  @Test func theBoundsAreEnforcedRatherThanTrusted() throws {
    // Above the advertised staging budget.
    #expect(throws: RoutedTransfer.Failure.tooLarge(totalBytes: 8192, budget: 4096)) {
      try RoutedTransfer(
        header: try beginHeader(totalBytes: 8192, chunkCount: 1, checksum: 0), budgetBytes: 4096)
    }
    // A layout whose cell count cannot be represented.
    #expect(throws: RoutedTransfer.Failure.badLayout) {
      try RoutedTransfer(
        header: try beginHeader(
          totalBytes: 4, chunkCount: 1, checksum: 0, cols: Int.max, rows: Int.max),
        budgetBytes: 4096)
    }

    var transfer = try RoutedTransfer(
      header: try beginHeader(totalBytes: 100, chunkCount: 2, checksum: 0), budgetBytes: 4096)
    // Out of bounds.
    #expect(throws: RoutedTransfer.Failure.outOfBounds(offset: 90, count: 20, totalBytes: 100)) {
      try transfer.stage(try chunkHeader(index: 0, offset: 90), payload: Data(count: 20))
    }
    // Overlapping.
    try transfer.stage(try chunkHeader(index: 0, offset: 0), payload: Data(count: 50))
    #expect(throws: RoutedTransfer.Failure.overlap(offset: 40, count: 20)) {
      try transfer.stage(try chunkHeader(index: 1, offset: 40), payload: Data(count: 20))
    }
  }

  /// A `byteOffset` at the top of the range is a REFUSAL, not a crash (TM-r3,
  /// K-M3).
  ///
  /// The bounds check above read `offset + count <= totalBytes`, and with
  /// `byteOffset: 9223372036854775807` and any non-empty chunk that sum
  /// overflowed and trapped — one line before the check that would have refused
  /// it. The number is the CELL's, arrives unvalidated, and a client that dies
  /// on a defective one cannot report anything at all.
  ///
  /// The failure's own `description` is exercised too, because it computed the
  /// same sum and would have trapped while explaining the refusal.
  @Test func aByteOffsetAtTheTopOfTheRangeIsRefusedRatherThanTrapped() throws {
    let bytes = Data(count: 100)
    var transfer = try RoutedTransfer(
      header: try beginHeader(
        totalBytes: bytes.count, chunkCount: 1, checksum: RoutedCrc32c.checksum(bytes)),
      budgetBytes: 4096)
    #expect(
      throws: RoutedTransfer.Failure.outOfBounds(
        offset: Int(Int64.max), count: 8, totalBytes: 100)
    ) {
      try transfer.stage(
        try chunkHeader(index: 0, offset: Int(Int64.max)), payload: Data(count: 8))
    }
    let named = RoutedTransfer.Failure.outOfBounds(
      offset: Int(Int64.max), count: 8, totalBytes: 100
    ).description
    #expect(named.contains("9223372036854775807"))
    #expect(named.contains("8-byte chunk"))
    // The other end of the range, and the other failure, for the same reason.
    #expect(
      throws: RoutedTransfer.Failure.outOfBounds(offset: Int(Int64.min), count: 8, totalBytes: 100)
    ) {
      try transfer.stage(
        try chunkHeader(index: 0, offset: Int(Int64.min)), payload: Data(count: 8))
    }
    #expect(
      RoutedTransfer.Failure.overlap(offset: Int(Int64.max), count: 8).description
        .contains("9223372036854775807"))
    // …and the transfer is still usable afterwards: a refused chunk stages
    // nothing, so the real one still fits and still verifies.
    try transfer.stage(try chunkHeader(index: 0, offset: 0), payload: bytes)
    #expect(try transfer.finish() == bytes)
  }

  /// A byte count alone would accept a gap paid for by a duplicate, and the
  /// overlap check alone would accept a hole — so completion is decided by the
  /// ranges TILING the transfer exactly.
  @Test func aHoleIsCaughtEvenWhenTheByteCountLooksRight() throws {
    var transfer = try RoutedTransfer(
      header: try beginHeader(totalBytes: 100, chunkCount: 2, checksum: 0), budgetBytes: 4096)
    try transfer.stage(try chunkHeader(index: 0, offset: 0), payload: Data(count: 40))
    try transfer.stage(try chunkHeader(index: 1, offset: 50), payload: Data(count: 50))
    #expect(throws: RoutedTransfer.Failure.incomplete(received: 90, totalBytes: 100)) {
      try transfer.finish()
    }
  }

  @Test func aWrongChecksumIsRefusedRatherThanApplied() throws {
    let bytes = Data((0..<64).map { UInt8($0) })
    var transfer = try RoutedTransfer(
      header: try beginHeader(totalBytes: bytes.count, chunkCount: 1, checksum: 0xDEAD_BEEF),
      budgetBytes: 4096)
    try transfer.stage(try chunkHeader(index: 0, offset: 0), payload: bytes)
    #expect(throws: (any Error).self) { try transfer.finish() }
  }

  /// CRC-32C (Castagnoli), against the algorithm's published check value: the
  /// crc of "123456789" is 0xE3069283.
  @Test func theChecksumIsCastagnoliNotTheOtherCrc32() {
    #expect(RoutedCrc32c.checksum(Array("123456789".utf8)) == 0xE306_9283)
    #expect(RoutedCrc32c.checksum([]) == 0)
  }
}

@Suite struct EnvelopeShapeTests {
  /// The per-kind requirements the contract's own refinement enforces. A unit
  /// missing one cannot be applied at all, so it is a protocol error rather than
  /// a tolerated shape — which is the line between "tolerant reader" and
  /// "pretends it can read".
  @Test func eachKindRequiresWhatApplyingItNeeds() throws {
    func header(_ fields: [String: JSONValue]) -> JSONValue {
      var base: [String: JSONValue] = [
        "creditEpoch": .int(1), "activationSequence": .int(1), "sessionId": .string("s"),
        "activationId": .string("a"), "leaseEpoch": .int(0),
      ]
      for (key, value) in fields { base[key] = value }
      return .object(base)
    }
    // A frame with no result stamp: nothing could say what applying it produced.
    #expect(throws: (any Error).self) {
      try RoutedEnvelopeHeader(json: header(["kind": .string("trf1-frame")]))
    }
    // A catch-up with no base: it is a catch-up precisely because it has one.
    #expect(throws: (any Error).self) {
      try RoutedEnvelopeHeader(
        json: header([
          "kind": .string("transfer-begin"),
          "resultContent": RoutedSceneStamp(
            cellBootId: "cb", modelGeneration: 0, sceneRevision: 1
          ).json,
          "transfer": .object([
            "transferId": .string("t"), "kind": .string("catchup"), "totalBytes": .int(4),
            "chunkCount": .int(1),
            "checksum": .object(["alg": .string("crc32c"), "value": .int(0)]),
            "targetLayout": .object([
              "cols": .int(80), "rows": .int(24), "scrollbackRows": .int(0),
            ]),
          ]),
        ]))
    }
    // Base and result must share one lineage.
    #expect(throws: (any Error).self) {
      try RoutedEnvelopeHeader(
        json: header([
          "kind": .string("trf1-frame"),
          "baseContent": RoutedSceneStamp(
            cellBootId: "cb-1", modelGeneration: 0, sceneRevision: 1
          ).json,
          "resultContent": RoutedSceneStamp(
            cellBootId: "cb-2", modelGeneration: 0, sceneRevision: 2
          ).json,
        ]))
    }
  }

  /// The framing's failure modes, each named. The header CAP is what keeps a
  /// malformed length from being an allocation.
  @Test func theFramingRefusesEveryMalformedShapeByName() throws {
    #expect(throws: RoutedPresentationEnvelope.DecodeFailure.short) {
      try RoutedPresentationEnvelope.decode(Data([0x54, 0x50]))
    }
    #expect(throws: RoutedPresentationEnvelope.DecodeFailure.badMagic) {
      try RoutedPresentationEnvelope.decode(Data([0x58, 0x50, 1, 0, 0, 0, 0, 0]))
    }
    #expect(throws: RoutedPresentationEnvelope.DecodeFailure.badVersion) {
      try RoutedPresentationEnvelope.decode(Data([0x54, 0x50, 9, 0, 0, 0, 0, 0]))
    }
    #expect(throws: RoutedPresentationEnvelope.DecodeFailure.headerTooLarge(0x0001_0000)) {
      try RoutedPresentationEnvelope.decode(Data([0x54, 0x50, 1, 0, 0, 0x01, 0, 0]))
    }
    #expect(throws: RoutedPresentationEnvelope.DecodeFailure.headerTruncated) {
      try RoutedPresentationEnvelope.decode(Data([0x54, 0x50, 1, 0, 0, 0, 0, 10]))
    }
    #expect(throws: RoutedPresentationEnvelope.DecodeFailure.headerNotJson) {
      try RoutedPresentationEnvelope.decode(Data([0x54, 0x50, 1, 0, 0, 0, 0, 2]) + Data("{{".utf8))
    }
  }
}
