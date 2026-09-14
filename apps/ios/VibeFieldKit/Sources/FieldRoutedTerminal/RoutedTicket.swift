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
public struct RoutedCellEndpoints: Sendable, Equatable {
  public let controlUrl: URL
  public let framesUrl: URL
  public let unknownFields: [String]

  public init(controlUrl: URL, framesUrl: URL) throws {
    self.controlUrl = try Self.checked(controlUrl, "controlUrl")
    self.framesUrl = try Self.checked(framesUrl, "framesUrl")
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
    self.controlUrl = try Self.checked(controlUrl, "controlUrl")
    self.framesUrl = try Self.checked(framesUrl, "framesUrl")
    self.unknownFields = fields.unknownFields
  }

  public func url(for channel: RoutedChannel) -> URL {
    switch channel {
    case .control: controlUrl
    case .frames: framesUrl
    }
  }

  private static func checked(_ url: URL, _ field: String) throws -> URL {
    guard let scheme = url.scheme?.lowercased(), scheme == "ws" || scheme == "wss" else {
      throw WireDecodeError(
        shape: "RemoteCellEndpointSet", reason: "\(field) is not a ws:// or wss:// URL")
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
