import FieldProduct
import Foundation

/// The receiver's half of the byte-credit protocol (spec §8, TP-D11).
///
/// **Credit is bytes, never sequence.** A receiver consumes units out of
/// connection order by design, so a connection-level "consumed through N" cannot
/// be stated without either falsely acknowledging a stalled activation's units
/// or starving every other activation. This ledger therefore counts BYTES
/// RETURNED, cumulatively, per connection and per activation — an acknowledgement
/// carries no ordering claim at all. Ordering and progress are `SceneApplied`
/// (stamps), which is a different message for a different question.
///
/// **The charge of a unit is the RECEIVED MESSAGE LENGTH** — prefix, header and
/// payload — never a sender-supplied field. Both ends see the same number only
/// because compression is refused at the door; that is the fact the whole ledger
/// rests on.
///
/// A pure value type with an injected clock: every law below is a decision about
/// arithmetic and lifetimes, and none of them wants a socket to be tested.
public struct RoutedCreditLedger: Sendable, Equatable {
  /// The epoch these totals belong to. The cell's rule is that the credit epoch
  /// IS the frames leg generation, so a replaced leg is always a new epoch —
  /// law (4): bytes on the dead socket cannot arrive on the replacement.
  public private(set) var creditEpoch: Int64
  public private(set) var creditSequence: Int64 = 0
  /// Law (6): cumulative and monotonic, so a duplicate or reordered return is
  /// harmless — the cell applies `max()` per field.
  public private(set) var connectionBytesReturned: Int = 0

  private struct Account: Sendable, Equatable {
    var bytesReturned: Int = 0
    var draining: Bool = false
    var lastUnitAtMs: Int64 = 0
  }

  private var accounts: [String: Account] = [:]
  /// Unflushed bytes, for the batching decision only — the flush always sends
  /// the current TOTALS, never a delta.
  public private(set) var unreturnedBytes: Int = 0
  private var lastFlushAtMs: Int64 = 0

  public init(creditEpoch: Int64, nowMs: Int64 = 0) {
    self.creditEpoch = creditEpoch
    self.lastFlushAtMs = nowMs
  }

  /// Law (1): every received unit returns its charge EXACTLY ONCE — to the
  /// connection total and to the account its envelope named — **even when the
  /// activation is stale or unknown and the content is discarded.** A receiver
  /// that returned credit only for units it liked would starve the connection
  /// one mistake at a time, so this function takes no opinion about the content;
  /// the caller charges first and decides afterwards.
  public mutating func charge(bytes: Int, activationId: String, nowMs: Int64) {
    connectionBytesReturned += bytes
    unreturnedBytes += bytes
    var account = accounts[activationId] ?? Account()
    account.bytesReturned += bytes
    account.lastUnitAtMs = nowMs
    accounts[activationId] = account
  }

  /// Law (2) and (3): invalidating an activation stops new admission and never
  /// pretends already-admitted bytes vanished — the account goes DRAINING and
  /// keeps being reported. The leg is ordered and the cell stopped admitting at
  /// invalidation, so every straggler was already in flight at that instant.
  public mutating func drain(activationId: String, nowMs: Int64) {
    guard var account = accounts[activationId] else { return }
    account.draining = true
    if account.lastUnitAtMs == 0 { account.lastUnitAtMs = nowMs }
    accounts[activationId] = account
  }

  /// A draining account is forgotten once `creditAccountDrainTtlMs` has passed
  /// with no unit for it. Its bytes stay in the CONNECTION total, which is
  /// cumulative and monotonic within the epoch — dropping the row is the client
  /// forgetting a name, never the ledger losing bytes.
  public mutating func prune(nowMs: Int64, drainTtlMs: Int) {
    accounts = accounts.filter { _, account in
      !(account.draining && nowMs - account.lastUnitAtMs >= Int64(drainTtlMs))
    }
  }

  /// Law (4): a replaced frames leg starts a new epoch and resets every total.
  /// Nothing is carried across — not the accounts, not the sequence, not the
  /// unflushed bytes, because none of them describes the new socket.
  public mutating func reset(creditEpoch: Int64, nowMs: Int64) {
    self.creditEpoch = creditEpoch
    creditSequence = 0
    connectionBytesReturned = 0
    accounts = [:]
    unreturnedBytes = 0
    lastFlushAtMs = nowMs
  }

  /// Whether a return is owed: bytes are outstanding and either the batching
  /// delay has passed or enough has accumulated to be worth a message now.
  ///
  /// The delay is the CELL's `maxCreditReturnDelayMs` — the bound it is entitled
  /// to assume. The byte threshold is this client's: a quarter of the advertised
  /// per-activation window, so a burst returns credit before the window closes
  /// rather than after the delay, which is what keeps a fast session from
  /// stalling on its own acknowledgement.
  public func owesReturn(nowMs: Int64, maxDelayMs: Int, thresholdBytes: Int) -> Bool {
    guard unreturnedBytes > 0 else { return false }
    return unreturnedBytes >= thresholdBytes || nowMs - lastFlushAtMs >= Int64(maxDelayMs)
  }

  /// The next `TransportCredit` body. Every total is CUMULATIVE within the
  /// epoch; `creditSequence` only lets the cell ignore one it has already seen.
  public mutating func makeReturn(nowMs: Int64) -> JSONValue {
    creditSequence += 1
    unreturnedBytes = 0
    lastFlushAtMs = nowMs
    let rows = accounts.keys.sorted().map { activationId in
      JSONValue.object([
        "activationId": .string(activationId),
        "bytesReturned": .int(Int64(accounts[activationId]?.bytesReturned ?? 0)),
      ])
    }
    return .object([
      "creditEpoch": .int(creditEpoch),
      "creditSequence": .int(creditSequence),
      "connectionBytesReturned": .int(Int64(connectionBytesReturned)),
      "accounts": .array(rows),
    ])
  }

  // MARK: Readers, for tests and for an honest face

  public func bytesReturned(for activationId: String) -> Int {
    accounts[activationId]?.bytesReturned ?? 0
  }

  public func isDraining(_ activationId: String) -> Bool {
    accounts[activationId]?.draining ?? false
  }

  public var accountIds: [String] { accounts.keys.sorted() }
}
