import Foundation

/// One transfer in flight — a seed or a catch-up — staged whole before it is
/// applied (spec §8, "Transfers: one generalized, self-fenced, convergent wire").
///
/// A transfer is the only place this client allocates on somebody else's say-so,
/// so every bound it advertised is enforced HERE rather than trusted: the
/// receiver rejects a `totalBytes` above budget, an out-of-bounds offset, an
/// overlapping range, a duplicate completion, and a layout that would overflow a
/// computed allocation. Each chunk's transport credit is returned at
/// copy-into-staging — not at apply — because the bytes have left the wire
/// buffer by then and the ledger's job is the wire, not the screen.
public struct RoutedTransfer: Sendable {
  public enum Failure: Error, Equatable, CustomStringConvertible {
    case tooLarge(totalBytes: Int, budget: Int)
    case badLayout
    case badChunkCount
    case outOfBounds(offset: Int, count: Int, totalBytes: Int)
    case overlap(offset: Int, count: Int)
    case incomplete(received: Int, totalBytes: Int)
    case checksumMismatch(expected: UInt32, actual: UInt32)
    case unknownTransfer(String)

    public var description: String {
      switch self {
      case .tooLarge(let total, let budget):
        "transfer of \(total) bytes exceeds this client's \(budget)-byte staging budget"
      case .badLayout: "transfer layout would overflow a computed allocation"
      case .badChunkCount: "transfer declares a chunk count its bytes cannot fill"
      case .outOfBounds(let offset, let count, let total):
        "chunk [\(offset), \(offset + count)) falls outside a \(total)-byte transfer"
      case .overlap(let offset, let count): "chunk [\(offset), \(offset + count)) overlaps one already staged"
      case .incomplete(let received, let total): "transfer ended with \(received) of \(total) bytes"
      case .checksumMismatch(let expected, let actual):
        "transfer checksum \(actual) does not match the declared \(expected)"
      case .unknownTransfer(let id): "no transfer `\(id)` is in flight"
      }
    }
  }

  public let transferId: String
  public let kind: RoutedEnvelopeHeader.TransferKind
  public let totalBytes: Int
  public let chunkCount: Int
  public let checksum: UInt32
  public let baseContent: RoutedSceneStamp?
  public let resultContent: RoutedSceneStamp
  private var staging: Data
  /// Half-open byte ranges already staged, kept sorted — the overlap and
  /// completeness checks are both answered from this and nothing else.
  private var staged: [(offset: Int, end: Int)] = []
  private var stagedBytes = 0

  public init(header: RoutedEnvelopeHeader, budgetBytes: Int) throws {
    guard let transfer = header.transfer, let kind = transfer.kind,
      let totalBytes = transfer.totalBytes, let chunkCount = transfer.chunkCount,
      let checksum = transfer.checksum, let resultContent = header.resultContent
    else {
      throw Failure.badChunkCount
    }
    guard totalBytes >= 0, totalBytes <= budgetBytes else {
      throw Failure.tooLarge(totalBytes: totalBytes, budget: budgetBytes)
    }
    // A zero-chunk transfer is legal (begin + end, an empty frame); anything
    // else must declare at least one chunk for the bytes it promises.
    guard chunkCount >= 0, totalBytes == 0 || chunkCount > 0 else { throw Failure.badChunkCount }
    // The layout is the cell's statement about the frame's shape. It is not used
    // to size anything here — the staging buffer is `totalBytes` — but a layout
    // whose product cannot be represented is a corrupt header, and a receiver
    // that computed with it would be the one to find out.
    if let cols = transfer.cols, let rows = transfer.rows {
      let scrollback = transfer.scrollbackRows ?? 0
      let lines = rows.addingReportingOverflow(scrollback)
      guard cols > 0, rows > 0, scrollback >= 0, !lines.overflow,
        !cols.multipliedReportingOverflow(by: lines.partialValue).overflow
      else { throw Failure.badLayout }
    }
    self.transferId = transfer.transferId
    self.kind = kind
    self.totalBytes = totalBytes
    self.chunkCount = chunkCount
    self.checksum = checksum
    self.baseContent = header.baseContent
    self.resultContent = resultContent
    self.staging = Data(repeating: 0, count: totalBytes)
  }

  /// Copy one chunk into staging. The caller returns its transport credit
  /// immediately afterwards, whatever this answers.
  public mutating func stage(_ header: RoutedEnvelopeHeader, payload: Data) throws {
    guard let offset = header.transfer?.byteOffset else { throw Failure.badChunkCount }
    let count = payload.count
    guard offset >= 0, count >= 0, offset + count <= totalBytes else {
      throw Failure.outOfBounds(offset: offset, count: count, totalBytes: totalBytes)
    }
    guard count > 0 else { return }
    let end = offset + count
    for range in staged where offset < range.end && range.offset < end {
      throw Failure.overlap(offset: offset, count: count)
    }
    staging.replaceSubrange(offset..<end, with: payload)
    staged.append((offset: offset, end: end))
    staged.sort { $0.offset < $1.offset }
    stagedBytes += count
  }

  /// Complete the transfer: every byte present, and the checksum over the
  /// concatenated chunk bytes agreeing. Integrity only — the channel is already
  /// authenticated, so this catches a truncated or misordered reassembly, never
  /// an adversary.
  public func finish() throws -> Data {
    guard stagedBytes == totalBytes else {
      throw Failure.incomplete(received: stagedBytes, totalBytes: totalBytes)
    }
    // Contiguity: the sorted ranges must tile [0, totalBytes) exactly. Byte
    // count alone would accept a gap paid for by a duplicate, and the overlap
    // check alone would accept a hole.
    var cursor = 0
    for range in staged {
      guard range.offset == cursor else {
        throw Failure.incomplete(received: stagedBytes, totalBytes: totalBytes)
      }
      cursor = range.end
    }
    guard cursor == totalBytes else {
      throw Failure.incomplete(received: stagedBytes, totalBytes: totalBytes)
    }
    let actual = RoutedCrc32c.checksum(staging)
    guard actual == checksum else {
      throw Failure.checksumMismatch(expected: checksum, actual: actual)
    }
    return staging
  }

  public var isSeed: Bool { kind == .seed }
}
