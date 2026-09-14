import CryptoKit
import FieldProduct
import Foundation

/// One of the two authorities on a cell door (spec §5.1, TP-D21), CARRIED.
///
/// The phone does not MINT grants — fieldd does, with a per-cell-boot key the
/// phone never holds — and that single fact decides this type's shape. The MAC
/// covers the protected header and the claims AS THE CELL RECEIVES THEM, unknown
/// fields included, precisely so that a typed re-serialization can never
/// silently break it. A Swift struct with eight `Codable` properties would do
/// exactly that the first time fieldd adds a ninth: the field would be read,
/// dropped, re-encoded without, and the cell would answer a silent `1008` that
/// no one on this device could explain.
///
/// So the grant is held as the JSON that arrived, verbatim, and put on the wire
/// the same way. The typed claims below are READ-ONLY projections used for the
/// decisions this client makes locally — is it for this cell, does it allow this
/// channel, has it expired, does it carry `input` — and they are never the thing
/// that is sent.
public struct RoutedGrant: Sendable, Equatable {
  public enum Kind: String, Sendable, Equatable {
    case transport = "CellTransportGrant"
    case attach = "SessionAttachGrant"
  }

  /// Exactly the bytes fieldd minted, as a JSON value. This is what is sent.
  public let raw: JSONValue
  public let kind: Kind
  public let keyId: KeyId
  public let claims: JSONValue
  public let mac: String
  /// Keys the wire carried that this build does not read — logged, never fatal.
  public let unknownFields: [String]

  public struct KeyId: Sendable, Equatable {
    public let cellBootId: String
    public let keyGeneration: Int64
  }

  // MARK: Claims both grant types carry

  public let audienceCellBootId: String
  public let clientId: String
  public let issuedAt: Int64
  public let expiresAt: Int64

  // MARK: Transport claims (nil on an attach grant)

  public let connectionSetId: String?
  public let allowedChannels: [RoutedChannel]?
  public let transportGrantGeneration: Int64?
  public let nonce: String?

  // MARK: Attach claims (nil on a transport grant)

  public let sessionId: String?
  /// Custody's per-session lease epoch. OPTIONAL in the contract until the floor
  /// exposes it: ABSENT is "not exposed", never 0 — so it stays optional here
  /// and every message that must carry one says where it got it.
  public let leaseEpoch: Int64?
  public let routeRevision: Int64?
  public let grantGeneration: Int64?
  public let rights: [RoutedRight]?

  public init(json: JSONValue) throws {
    var envelope = try WireObject(shape: "AuthenticatedGrant", value: json)
    var header = envelope.object("protected")
    let typ = try header.requiredString("typ")
    guard let kind = Kind(rawValue: typ) else {
      throw WireDecodeError(shape: "AuthenticatedGrant", reason: "unknown grant type `\(typ)`")
    }
    var keyIdFields = header.object("kid")
    self.kind = kind
    self.keyId = KeyId(
      cellBootId: try keyIdFields.requiredString("cellBootId"),
      keyGeneration: try keyIdFields.requiredInt("keyGeneration"))
    self.mac = try envelope.requiredString("mac")
    guard let claims = envelope.value("claims"), claims.objectValue != nil else {
      throw WireDecodeError(shape: "AuthenticatedGrant", reason: "missing `claims`")
    }
    self.claims = claims
    self.raw = json
    self.unknownFields = envelope.unknownFields

    var body = try WireObject(shape: typ, value: claims)
    self.audienceCellBootId = try body.requiredString("audienceCellBootId")
    self.clientId = try body.requiredString("clientId")
    self.issuedAt = try body.requiredInt("issuedAt")
    self.expiresAt = try body.requiredInt("expiresAt")
    switch kind {
    case .transport:
      self.connectionSetId = try body.requiredString("connectionSetId")
      self.allowedChannels = try body.requiredArray("allowedChannels")
        .compactMap { $0.stringValue.flatMap(RoutedChannel.init(rawValue:)) }
      self.transportGrantGeneration = try body.requiredInt("transportGrantGeneration")
      self.nonce = try body.requiredString("nonce")
      self.sessionId = nil
      self.leaseEpoch = nil
      self.routeRevision = nil
      self.grantGeneration = nil
      self.rights = nil
    case .attach:
      self.connectionSetId = nil
      self.allowedChannels = nil
      self.transportGrantGeneration = nil
      self.nonce = nil
      self.sessionId = try body.requiredString("sessionId")
      self.leaseEpoch = body.int("leaseEpoch")
      self.routeRevision = try body.requiredInt("routeRevision")
      self.grantGeneration = try body.requiredInt("grantGeneration")
      // An unknown right is TOLERATED and dropped: rights are a set of strings
      // the issuer may grow, and a phone that refused the whole grant over a
      // word it had not learned would lock itself out of a session it is
      // entitled to read.
      self.rights = try body.requiredArray("rights")
        .compactMap { $0.stringValue.flatMap(RoutedRight.init(rawValue:)) }
    }
  }

  public func has(_ right: RoutedRight) -> Bool { rights?.contains(right) ?? false }

  public func allows(_ channel: RoutedChannel) -> Bool {
    allowedChannels?.contains(channel) ?? false
  }

  // MARK: Validity

  public enum Validity: Sendable, Equatable {
    case valid
    case notYetValid
    case expired
    /// `expiresAt − issuedAt` exceeds the bound — a MALFORMED grant whatever the
    /// clock says, which is why it is checked first. The bound is what keeps the
    /// cell's high-water tombstones finite.
    case lifetimeExceeded
  }

  /// The two limits the cell applies, applied here too — locally, before a dial,
  /// so a dead grant costs no socket and the caller gets a NAME instead of a
  /// silent `1008` it would have to guess about.
  /// Every term below is arithmetic over timestamps a REMOTE minted, so each is
  /// taken with a reporting operator rather than `+`/`-`. `expiresAt -
  /// issuedAt` is reached from `open()` on every ticket and trapped on a grant
  /// whose stamps were far enough apart — a defective fieldd crashing the app
  /// rather than being told its grant is malformed (TM-r3, K-M3).
  public func validity(
    at nowMs: Int64,
    maxClockSkewMs: Int64 = Int64(RoutedTerminalContract.maxClockSkewMs),
    maxGrantLifetimeMs: Int64 = Int64(RoutedTerminalContract.maxGrantLifetimeMs)
  ) -> Validity {
    // A lifetime that cannot be represented, or one that runs BACKWARDS
    // (`expiresAt` before `issuedAt`), is malformed for the same reason an
    // over-long one is: it is not a window, whatever the clock says. The
    // backwards case used to fall through to `.valid` — a grant that expired
    // before it was issued, with every later comparison saying yes.
    let lifetime = expiresAt.subtractingReportingOverflow(issuedAt)
    if lifetime.overflow || lifetime.partialValue < 0
      || lifetime.partialValue > maxGrantLifetimeMs
    {
      return .lifetimeExceeded
    }
    // An `issuedAt` so small that the skew cannot be taken off it names a
    // moment before any clock, and nothing is earlier than that — so nothing is
    // NOT YET valid against it. The same argument, mirrored, for `expiresAt`.
    let earliest = issuedAt.subtractingReportingOverflow(maxClockSkewMs)
    if !earliest.overflow, nowMs < earliest.partialValue { return .notYetValid }
    let latest = expiresAt.addingReportingOverflow(maxClockSkewMs)
    if !latest.overflow, nowMs >= latest.partialValue { return .expired }
    return .valid
  }

  // MARK: The MAC

  /// The exact bytes under the MAC: the RFC 8785 canonical form of
  /// `{ protected, claims }`, over the RECEIVED values.
  public func signingInput() throws -> Data {
    guard case .object(let envelope) = raw, let header = envelope["protected"] else {
      throw WireDecodeError(shape: "AuthenticatedGrant", reason: "missing `protected`")
    }
    return try RoutedCanonicalJson.bytes(.object(["protected": header, "claims": claims]))
  }

  /// Verify the MAC against a per-cell-boot key.
  ///
  /// The phone never holds one — the cell is the verifier and fieldd the issuer
  /// — so this exists for the GOLDEN: it is how `tp-grant-mac.vector.json`
  /// proves this client's canonicalization and base64url agree with the two
  /// implementations that do the real work. If a future slice ever gives a
  /// holder a key (the floor's own mint, TM-D8's recorded upgrade), this is the
  /// function it calls; until then no shipping path reaches it.
  public func verifyMac(key: Data) throws -> Bool {
    guard let presented = RoutedBase64URL.decode(mac) else { return false }
    return HMAC<SHA256>.isValidAuthenticationCode(
      presented, authenticating: try signingInput(), using: SymmetricKey(data: key))
  }
}

/// base64url (RFC 4648 §5), unpadded — the MAC's encoding.
public enum RoutedBase64URL {
  public static func decode(_ text: String) -> Data? {
    var padded = text.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = padded.count % 4
    if remainder == 2 { padded += "==" } else if remainder == 3 { padded += "=" } else if remainder != 0 {
      return nil
    }
    return Data(base64Encoded: padded)
  }

  public static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
