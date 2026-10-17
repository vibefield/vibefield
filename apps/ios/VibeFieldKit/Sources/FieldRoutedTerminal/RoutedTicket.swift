import FieldProduct
import Foundation

/// The two doors of one cell, as a TAILNET principal is given them (TM-2's
/// `RemoteCellEndpointSet`: `wss://<tailnet dns>:<port>/cell/<cellBootId>/control|frames`).
///
/// The loopback `CellEndpointSet` a window receives is loopback-ONLY by contract
/// (D36 — the regex admits `127.0.0.1 | [::1] | localhost`, and the floor drops
/// a door URL that fails it). This is the OTHER shape, a product-plane fact
/// minted only by fieldd for a WhoIs-verified self peer, and the phone is its
/// only reader — so the reader is deliberately tolerant about the AUTHORITY
/// (a tailnet name, or loopback when a simulator is talking to a door on the
/// same machine) and strict about the one rule that is not topology:
///
/// **no query, no fragment.** Tokens never ride URLs — authority is the grant in
/// the first frame — and a URL carrying either is refused here rather than
/// dialed, because the failure mode it guards against is a secret in a log.
///
/// F1 adds the FREEWAY's shape (`FreewayCellEndpointSet`): `freeway://cell/<cellBootId>/control|frames`,
/// the cell's two legs as streams on the phone's link to the desktop, never a socket address.
/// Strict the way the contract is: each URL names its own channel, and both name ONE cell (a pair
/// split across cells, or across shapes, is two half-lanes, refused). Which transport dials which
/// shape is the caller's: this reader only says what was named.
public struct RoutedCellEndpoints: Sendable, Equatable {
  public let controlUrl: URL
  public let framesUrl: URL
  public let unknownFields: [String]

  public init(controlUrl: URL, framesUrl: URL) throws {
    self.controlUrl = try Self.checked(controlUrl, "controlUrl", .control)
    self.framesUrl = try Self.checked(framesUrl, "framesUrl", .frames)
    try Self.oneCell(self.controlUrl, self.framesUrl)
    self.unknownFields = []
  }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "RemoteCellEndpointSet", value: json)
    let control = try fields.requiredString("controlUrl")
    let frames = try fields.requiredString("framesUrl")
    guard let controlUrl = URL(string: control) else {
      throw WireDecodeError(shape: "RemoteCellEndpointSet", reason: "controlUrl is not a URL")
    }
    guard let framesUrl = URL(string: frames) else {
      throw WireDecodeError(shape: "RemoteCellEndpointSet", reason: "framesUrl is not a URL")
    }
    self.controlUrl = try Self.checked(controlUrl, "controlUrl", .control)
    self.framesUrl = try Self.checked(framesUrl, "framesUrl", .frames)
    try Self.oneCell(self.controlUrl, self.framesUrl)
    self.unknownFields = fields.unknownFields
  }

  public func url(for channel: RoutedChannel) -> URL {
    switch channel {
    case .control: controlUrl
    case .frames: framesUrl
    }
  }

  /// The freeway's scheme: a leg the link's transport opens as a `terminal-leg` stream.
  public static let freewayScheme = "freeway"

  /// The cell and channel a `freeway://cell/<cellBootId>/<channel>` URL names; nil for any other
  /// URL. The contract's own pattern: the boot id is `[A-Za-z0-9._-]+`, and nothing else rides.
  public static func freewayLeg(_ url: URL) -> (cellBootId: String, channel: RoutedChannel)? {
    guard url.scheme?.lowercased() == freewayScheme,
      let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parts.host == "cell", parts.port == nil, parts.user == nil, parts.password == nil,
      parts.query == nil, parts.fragment == nil
    else { return nil }
    let segments = parts.path.split(separator: "/", omittingEmptySubsequences: false)
    guard segments.count == 3, segments[0].isEmpty, let channel = RoutedChannel(rawValue: String(segments[2]))
    else { return nil }
    let boot = segments[1]
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    guard !boot.isEmpty, boot.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
    return (String(boot), channel)
  }

  private static func checked(_ url: URL, _ field: String, _ channel: RoutedChannel) throws -> URL {
    if url.scheme?.lowercased() == freewayScheme {
      guard let leg = freewayLeg(url), leg.channel == channel else {
        throw WireDecodeError(
          shape: "FreewayCellEndpointSet",
          reason: "\(field) is not a freeway://cell/<cellBootId>/\(channel.rawValue) URL")
      }
      return url
    }
    guard let scheme = url.scheme?.lowercased(), scheme == "ws" || scheme == "wss" else {
      throw WireDecodeError(
        shape: "RemoteCellEndpointSet", reason: "\(field) is not a ws://, wss:// or freeway:// URL")
    }
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      throw WireDecodeError(shape: "RemoteCellEndpointSet", reason: "\(field) is not a URL")
    }
    guard parts.query == nil, parts.fragment == nil else {
      throw WireDecodeError(
        shape: "RemoteCellEndpointSet",
        reason: "\(field) carries a query or fragment — tokens never ride URLs")
    }
    guard let host = parts.host, !host.isEmpty else {
      throw WireDecodeError(shape: "RemoteCellEndpointSet", reason: "\(field) has no host")
    }
    return url
  }

  /// A freeway pair names one cell, and a pair is one shape: a lane split across cells or shapes
  /// is two half-lanes.
  private static func oneCell(_ control: URL, _ frames: URL) throws {
    let legs = (freewayLeg(control), freewayLeg(frames))
    switch legs {
    case (nil, nil):
      return
    case (let control?, let frames?) where control.cellBootId == frames.cellBootId:
      return
    default:
      throw WireDecodeError(shape: "FreewayCellEndpointSet", reason: "both legs name one cell")
    }
  }
}

/// What fieldd mints for one client, one session, at one placement: where to
/// dial, authority to ESTABLISH the legs, and authority over the SESSION.
///
/// Everything a receiver needs is in the grants — the ticket repeats none of it,
/// so there is no field to mismatch. The phone's reading is the same as the
/// renderer's; only `endpoints` differs (a tailnet authority instead of
/// loopback), which is why this reader takes both.
public struct RoutedTerminalTicket: Sendable, Equatable {
  public let route: RoutedRouteBinding
  public let endpoints: RoutedCellEndpoints
  public let transportGrant: RoutedGrant
  public let attachGrant: RoutedGrant
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "TerminalOpenTicket", value: json)
    guard let route = fields.value("route") else {
      throw WireDecodeError(shape: "TerminalOpenTicket", reason: "missing `route`")
    }
    guard let endpoints = fields.value("endpoints") else {
      throw WireDecodeError(shape: "TerminalOpenTicket", reason: "missing `endpoints`")
    }
    guard let transport = fields.value("transportGrant") else {
      throw WireDecodeError(shape: "TerminalOpenTicket", reason: "missing `transportGrant`")
    }
    guard let attach = fields.value("attachGrant") else {
      throw WireDecodeError(shape: "TerminalOpenTicket", reason: "missing `attachGrant`")
    }
    self.route = try RoutedRouteBinding(json: route)
    self.endpoints = try RoutedCellEndpoints(json: endpoints)
    self.transportGrant = try RoutedGrant(json: transport)
    self.attachGrant = try RoutedGrant(json: attach)
    self.unknownFields = fields.unknownFields

    // Three agreements worth refusing a ticket over, all of them local: a ticket
    // whose halves disagree is a fieldd bug, and dialing it would spend a socket
    // to be told so by a silent 1008 nobody could read.
    guard self.transportGrant.kind == .transport else {
      throw WireDecodeError(
        shape: "TerminalOpenTicket", reason: "transportGrant is a \(self.transportGrant.kind)")
    }
    guard self.attachGrant.kind == .attach else {
      throw WireDecodeError(
        shape: "TerminalOpenTicket", reason: "attachGrant is a \(self.attachGrant.kind)")
    }
    guard self.transportGrant.audienceCellBootId == self.route.cellBootId,
      self.attachGrant.audienceCellBootId == self.route.cellBootId
    else {
      throw WireDecodeError(
        shape: "TerminalOpenTicket", reason: "a grant names a different cell than the route")
    }
  }

  public var sessionId: String? { attachGrant.sessionId }
  public var connectionSetId: String? { transportGrant.connectionSetId }
  public var clientId: String { transportGrant.clientId }
  public var rights: [RoutedRight] { attachGrant.rights ?? [] }
  /// The activation triple's lease epoch, from the grant that carries it, with
  /// the route binding as the fallback. Absent on both = the floor does not
  /// expose it yet, and the wire's required field is then 0 — the one place this
  /// client writes a number the grant did not give it, named here on purpose.
  public var leaseEpoch: Int64 { attachGrant.leaseEpoch ?? route.leaseEpoch ?? 0 }
}
