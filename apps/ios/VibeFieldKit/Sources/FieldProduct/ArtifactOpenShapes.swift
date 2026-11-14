import Foundation

// SP-4 / MA-5 — `artifact.open`, as the phone asks it and reads it (`ArtifactOpenParams`, `ArtifactOpenResult`,
// packages/contracts/src/artifacts.ts). Hand-written tolerant readers, as every reader in this target is: the goldens
// under `Tests/FieldProductTests/Fixtures` are the contracts' own bytes (`pnpm check:ios-fixtures`). A field this
// build cannot read costs that field, never the answer: the contract's own `.catch`es, mirrored.

/// `MADE_APP_OPEN_STATES`: `serving` (its listener up) or `starting` (on its way up). A word this build cannot read
/// is `starting`, which promises nothing is up.
public enum ArtifactOpenState: String, Sendable, Equatable {
  case serving
  case starting

  public init(wire: String?) {
    self = wire.flatMap(Self.init(rawValue:)) ?? .starting
  }
}

/// `MadeAppReach`: a made app's declared hosts. `MADE_APP_LIMITS.REACH_HOSTS` at most, each a bare public DNS host
/// (`isReachHost`): canonical, its last label not all digits, never `ts.net` or under it.
public enum MadeAppReach {
  /// `MADE_APP_LIMITS.REACH_HOSTS`
  public static let maxHosts = 16

  public static func isHost(_ host: String) -> Bool {
    guard !host.isEmpty, host.utf8.count <= 253 else { return false }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2, labels.allSatisfy(isLabel), let last = labels.last,
      !last.allSatisfy({ $0.isASCII && $0.isNumber })
    else { return false }
    return host != "ts.net" && !host.hasSuffix(".ts.net")
  }

  /// `DNS_LABEL`: 1…63 of lowercase letters, digits and hyphens, a letter or digit at each end.
  private static func isLabel(_ label: Substring) -> Bool {
    let bytes = Array(label.utf8)
    guard let first = bytes.first, let last = bytes.last, bytes.count <= 63 else { return false }
    let alphanumeric: (UInt8) -> Bool = { (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) }
    return alphanumeric(first) && alphanumeric(last) && bytes.allSatisfy { alphanumeric($0) || $0 == 0x2D }
  }
}

/// What `artifact.open` answers.
public struct ArtifactOpenResult: Sendable, Equatable {
  public let state: ArtifactOpenState
  /// The root URL the app's own listener reported. Nil when absent, or when it is not a root claim
  /// (`ArtifactRootUrl`'s catch: validate or strip, never rewrite).
  public let url: String?
  /// The page's declared hosts, what a host's web view admits besides the origin (MA-L7). Nil when absent, or when
  /// the list is not one (`MadeAppReach`'s catch: one bad host, or more than `maxHosts`, voids it whole).
  public let reach: [String]?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ArtifactOpenResult", value: json)
    state = ArtifactOpenState(wire: object.string("state"))
    url = object.string("url").flatMap { ArtifactRootURL.isClaim($0) ? $0 : nil }
    if let items = object.array("reach") {
      let hosts = items.compactMap(\.stringValue)
      let whole = hosts.count == items.count && hosts.count <= MadeAppReach.maxHosts
      reach = whole && hosts.allSatisfy(MadeAppReach.isHost) ? hosts : nil
    } else {
      reach = nil
    }
    _ = object.value("//")
    unknownFields = object.unknownFields
  }
}

/// What the phone asks `artifact.open`: an app by its id on the desktop that serves it. The phone never sets `reveal`
/// (the window's ask alone).
public struct ArtifactOpenParams: Sendable, Equatable {
  public let appId: String
  /// The serving desktop, when it is not the home the phone asks: the home forwards the call whole (`federate`).
  public let device: String?
  /// One of the app's versions (Versions); absent, the newest.
  public let presentationId: String?

  public init(appId: String, device: String?, presentationId: String? = nil) {
    self.appId = appId
    self.device = device
    self.presentationId = presentationId
  }

  public var json: JSONValue {
    var fields: [String: JSONValue] = ["appId": .string(appId)]
    if let device { fields["device"] = .string(device) }
    if let presentationId { fields["presentationId"] = .string(presentationId) }
    return .object(fields)
  }
}
