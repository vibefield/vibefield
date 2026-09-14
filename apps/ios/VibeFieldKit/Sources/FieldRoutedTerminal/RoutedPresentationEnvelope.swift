import FieldProduct
import Foundation

/// The binary framing of one presentation unit on the frames WebSocket (spec §8,
/// `encode/decodePresentationEnvelope` in contracts, pinned by
/// `tp-envelope.vector.json`):
///
/// ```text
///   0  'T' (0x54)
///   1  'P' (0x50)
///   2  version (1)
///   3  reserved (0)
///   4  u32 BE header length (bytes)
///   8  header JSON (PresentationEnvelopeHeader), then the payload to the end
/// ```
///
/// The unit's credit CHARGE is the whole message length as received — prefix,
/// header and payload — and never a field the sender supplied. Both ends observe
/// the same number because compression is refused at the door, which is the only
/// reason a byte ledger can be kept at all.
public enum RoutedPresentationEnvelope {
  public static let magic: [UInt8] = [0x54, 0x50]
  public static let version: UInt8 = 1
  public static let prefixBytes = 8
  /// A header is a few hundred bytes. Anything larger is PROTOCOL — the cap is
  /// what keeps a malformed length from being an allocation.
  public static let maxHeaderBytes = 4096

  public enum DecodeFailure: Error, Equatable, CustomStringConvertible {
    case short
    case badMagic
    case badVersion
    case headerTooLarge(Int)
    case headerTruncated
    case headerNotUtf8
    case headerNotJson
    case headerInvalid(String)

    public var description: String {
      switch self {
      case .short: "message shorter than the 8-byte prefix"
      case .badMagic: "not a 'TP' envelope"
      case .badVersion: "unknown envelope version"
      case .headerTooLarge(let size): "header of \(size) bytes exceeds the 4096-byte cap"
      case .headerTruncated: "header runs past the end of the message"
      case .headerNotUtf8: "header is not UTF-8"
      case .headerNotJson: "header is not JSON"
      case .headerInvalid(let reason): "header is not a presentation envelope: \(reason)"
      }
    }
  }

  /// Decode one binary message.
  ///
  /// `payload` is a SLICE of `bytes` — no copy, as the contract requires — which
  /// means its indices do not start at zero. A caller that retains it past the
  /// message must copy it (`Data(envelope.payload)`); one that hands it straight
  /// on may pass the slice.
  public static func decode(_ bytes: Data) throws -> RoutedEnvelope {
    guard bytes.count >= prefixBytes else { throw DecodeFailure.short }
    let base = bytes.startIndex
    guard bytes[base] == magic[0], bytes[base + 1] == magic[1] else { throw DecodeFailure.badMagic }
    guard bytes[base + 2] == version else { throw DecodeFailure.badVersion }
    let headerLength =
      (Int(bytes[base + 4]) << 24) | (Int(bytes[base + 5]) << 16) | (Int(bytes[base + 6]) << 8)
      | Int(bytes[base + 7])
    guard headerLength <= maxHeaderBytes else { throw DecodeFailure.headerTooLarge(headerLength) }
    let headerEnd = base + prefixBytes + headerLength
    guard headerEnd <= bytes.endIndex else { throw DecodeFailure.headerTruncated }
    let headerBytes = bytes[(base + prefixBytes)..<headerEnd]
    guard String(data: headerBytes, encoding: .utf8) != nil else {
      throw DecodeFailure.headerNotUtf8
    }
    guard let raw = try? JSONValue.parse(Data(headerBytes)) else {
      throw DecodeFailure.headerNotJson
    }
    let header: RoutedEnvelopeHeader
    do {
      header = try RoutedEnvelopeHeader(json: raw)
    } catch {
      throw DecodeFailure.headerInvalid(String(describing: error))
    }
    return RoutedEnvelope(
      header: header, payload: bytes[headerEnd...], chargedBytes: bytes.count)
  }

  /// The inverse. Shipping code never sends a presentation unit — the client is
  /// the RECEIVER of these — so this exists for the fake cell door and for the
  /// golden's round trip, which is what proves the decoder above reads what the
  /// contracts encoder writes.
  public static func encode(header: JSONValue, payload: Data) throws -> Data {
    let headerBytes = try header.encoded()
    guard headerBytes.count <= maxHeaderBytes else {
      throw DecodeFailure.headerTooLarge(headerBytes.count)
    }
    var out = Data(capacity: prefixBytes + headerBytes.count + payload.count)
    out.append(contentsOf: magic)
    out.append(version)
    out.append(0)
    let length = UInt32(headerBytes.count)
    out.append(UInt8((length >> 24) & 0xff))
    out.append(UInt8((length >> 16) & 0xff))
    out.append(UInt8((length >> 8) & 0xff))
    out.append(UInt8(length & 0xff))
    out.append(headerBytes)
    out.append(payload)
    return out
  }
}

public struct RoutedEnvelope: Sendable {
  public let header: RoutedEnvelopeHeader
  /// A view into the received message; valid for as long as the message is.
  public let payload: Data
  /// The whole message length — the credit charge, exactly once, whatever
  /// becomes of the content.
  public let chargedBytes: Int
}

public struct RoutedEnvelopeHeader: Sendable, Equatable {
  public enum Kind: String, Sendable, Equatable {
    case trf1Frame = "trf1-frame"
    case transferBegin = "transfer-begin"
    case transferChunk = "transfer-chunk"
    case transferEnd = "transfer-end"
    case calibration
  }

  public enum TransferKind: String, Sendable, Equatable {
    case seed
    case catchup
  }

  public let creditEpoch: Int64
  public let activationSequence: Int64
  public let sessionId: String
  public let activationId: String
  public let leaseEpoch: Int64
  public let kind: Kind
  /// A SEED carries `baseContent = null` (the receiver may hold no compatible
  /// base); a catch-up carries the base it requires; a delta applies iff its
  /// base equals what the receiver holds. `nil` here means "null or absent" —
  /// the two read alike everywhere in this client.
  public let baseContent: RoutedSceneStamp?
  public let resultContent: RoutedSceneStamp?
  public let transfer: Transfer?
  public let calibration: Calibration?
  public let unknownFields: [String]

  public struct Transfer: Sendable, Equatable {
    public let transferId: String
    public let kind: TransferKind?
    public let totalBytes: Int?
    public let chunkCount: Int?
    public let checksum: UInt32?
    public let cols: Int?
    public let rows: Int?
    public let scrollbackRows: Int?
    public let chunkIndex: Int?
    public let byteOffset: Int?
  }

  public struct Calibration: Sendable, Equatable {
    public let sequence: Int64
    public let t0: Double
    public let t1: Double
    public let t2: Double
  }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "PresentationEnvelopeHeader", value: json)
    creditEpoch = try fields.requiredInt("creditEpoch")
    activationSequence = try fields.requiredInt("activationSequence")
    sessionId = try fields.requiredString("sessionId")
    activationId = try fields.requiredString("activationId")
    leaseEpoch = try fields.requiredInt("leaseEpoch")
    let kindText = try fields.requiredString("kind")
    guard let kind = Kind(rawValue: kindText) else {
      throw WireDecodeError(
        shape: "PresentationEnvelopeHeader", reason: "unknown kind `\(kindText)`")
    }
    self.kind = kind
    baseContent = try fields.decodeObject("baseContent") { try RoutedSceneStamp(json: $0) }
    resultContent = try fields.decodeObject("resultContent") { try RoutedSceneStamp(json: $0) }
    transfer = try fields.decodeObject("transfer") { value in
      var transferFields = try WireObject(shape: "TransferHeader", value: value)
      var layout = transferFields.object("targetLayout")
      var checksumFields = transferFields.object("checksum")
      let algorithm = checksumFields.string("alg")
      let checksumValue = checksumFields.int("value")
      if let algorithm, algorithm != "crc32c" {
        throw WireDecodeError(
          shape: "TransferHeader", reason: "unknown checksum algorithm `\(algorithm)`")
      }
      return Transfer(
        transferId: try transferFields.requiredString("transferId"),
        kind: transferFields.string("kind").flatMap(TransferKind.init(rawValue:)),
        totalBytes: transferFields.int("totalBytes").map(Int.init),
        chunkCount: transferFields.int("chunkCount").map(Int.init),
        checksum: checksumValue.map { UInt32(truncatingIfNeeded: $0) },
        cols: layout.int("cols").map(Int.init),
        rows: layout.int("rows").map(Int.init),
        scrollbackRows: layout.int("scrollbackRows").map(Int.init),
        chunkIndex: transferFields.int("chunkIndex").map(Int.init),
        byteOffset: transferFields.int("byteOffset").map(Int.init))
    }
    calibration = try fields.decodeObject("calibration") { value in
      var echo = try WireObject(shape: "CalibrationEcho", value: value)
      return Calibration(
        sequence: try echo.requiredInt("sequence"),
        t0: echo.double("t0") ?? 0,
        t1: echo.double("t1") ?? 0,
        t2: echo.double("t2") ?? 0)
    }
    // `profiling` is read and discarded: this client does not advertise the
    // capability, so the cell never sends one — reading it costs nothing and
    // keeps it out of `unknownFields`.
    _ = fields.value("profiling")
    unknownFields = fields.unknownFields

    // The per-kind requirements the contract's own refinement enforces. A unit
    // that fails one is a PROTOCOL error, not a tolerated shape: these are the
    // fields the receiver must have to apply anything at all.
    switch kind {
    case .trf1Frame:
      guard resultContent != nil else {
        throw WireDecodeError(
          shape: "PresentationEnvelopeHeader", reason: "trf1-frame carries resultContent")
      }
    case .transferBegin:
      guard let transfer, transfer.kind != nil, transfer.totalBytes != nil,
        transfer.chunkCount != nil, transfer.checksum != nil, resultContent != nil
      else {
        throw WireDecodeError(
          shape: "PresentationEnvelopeHeader",
          reason: "transfer-begin carries kind + totalBytes + chunkCount + checksum + resultContent")
      }
      if transfer.kind == .catchup && baseContent == nil {
        throw WireDecodeError(
          shape: "PresentationEnvelopeHeader", reason: "a catch-up carries the base it requires")
      }
    case .transferChunk:
      guard let transfer, transfer.chunkIndex != nil, transfer.byteOffset != nil else {
        throw WireDecodeError(
          shape: "PresentationEnvelopeHeader",
          reason: "transfer-chunk carries chunkIndex + byteOffset")
      }
    case .transferEnd:
      guard transfer != nil else {
        throw WireDecodeError(
          shape: "PresentationEnvelopeHeader", reason: "transfer-end carries transfer.transferId")
      }
    case .calibration:
      guard calibration != nil else {
        throw WireDecodeError(
          shape: "PresentationEnvelopeHeader", reason: "calibration carries the echo")
      }
    }
    // Epoch equality across the stamps of one unit (spec §8).
    if let base = baseContent, let result = resultContent, base.sameLineage != result.sameLineage {
      throw WireDecodeError(
        shape: "PresentationEnvelopeHeader", reason: "base and result stamps share one sceneEpoch")
    }
  }
}

/// CRC-32C (Castagnoli), the transfer checksum's algorithm. Integrity only — the
/// channel is already authenticated, so this catches a truncated or misordered
/// reassembly, never an adversary.
public enum RoutedCrc32c {
  private static let table: [UInt32] = {
    var table = [UInt32](repeating: 0, count: 256)
    for index in 0..<256 {
      var crc = UInt32(index)
      for _ in 0..<8 {
        crc = (crc & 1) == 1 ? (crc >> 1) ^ 0x82F6_3B78 : crc >> 1
      }
      table[index] = crc
    }
    return table
  }()

  public static func checksum<Bytes: Sequence>(_ bytes: Bytes) -> UInt32 where Bytes.Element == UInt8 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in bytes {
      crc = (crc >> 8) ^ table[Int((crc ^ UInt32(byte)) & 0xFF)]
    }
    return crc ^ 0xFFFF_FFFF
  }
}
