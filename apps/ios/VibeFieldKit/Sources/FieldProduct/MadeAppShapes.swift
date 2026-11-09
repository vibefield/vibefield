import Foundation

// MA-6a (absorbing MA-1b, which never landed; VF-PM 2026-11-09 04:46Z) — the apps doors, as the phone READS them:
// `index.apps.list`'s page (`IndexAppsResult`, `packages/contracts/src/agent-index.ts`) and an apps refusal
// (`MadeAppOpenRefusal`, artifacts.ts). Hand-written tolerant readers of the contracts' shapes, as every reader in this
// target is: the goldens under `Tests/FieldProductTests/Fixtures` are the contracts' own bytes
// (`pnpm check:ios-fixtures`), and a word this build has not heard costs that fact, never the row.
//
// The door has already folded (MA-D4: "one app as the fold answers it"), so nothing here folds. The row is narrowed to
// what the shelf draws; a known field the phone has no use for is read past so it is not named as unknown.

/// rosetta's six availability words, and `unknown` (`MADE_APP_AVAILABILITIES`, open: a word this build has not heard
/// reads as `unknown`).
public enum MadeAppAvailability: String, Sendable, Equatable, CaseIterable {
  case captured
  case notCaptured = "not_captured"
  case missing
  case tooLarge = "too_large"
  case unsupported
  case changedDuringRead = "changed_during_read"
  case unknown

  public init(wire: String?) {
    self = wire.flatMap(Self.init(rawValue:)) ?? .unknown
  }
}

/// An app's face (MA-D10 (b); `MadeAppPreview`), which carries no URL: the address is derived from its desktop's
/// `previewsBase` and never stored. A preview this build cannot read costs the preview, never the row.
public struct MadeAppPreview: Sendable, Equatable {
  public let id: String
  public let digest: String

  public init?(json: JSONValue?) {
    guard let id = json?["id"]?.stringValue, let digest = json?["digest"]?.stringValue else { return nil }
    self.id = id
    self.digest = digest
  }
}

/// AH §6's rule for a root URL (`artifactRootUrlClaim`, artifacts.ts): printable ASCII with no `%` or `\`, `https://`,
/// a canonical DNS name, a port spelled canonically inside AH's range, and nothing else.
public enum ArtifactRootURL {
  /// `ARTIFACT_LIMITS.URL_CHARS`
  public static let maxChars = 2048
  /// `ARTIFACT_LIMITS.LISTEN_PORT_MIN`
  public static let portMin = 10_000
  /// `ARTIFACT_LIMITS.LISTEN_PORT_MAX`
  public static let portMax = 19_999

  public static func isClaim(_ raw: String) -> Bool {
    guard raw.utf16.count <= maxChars,
      raw.unicodeScalars.allSatisfy({ (0x21...0x7E).contains($0.value) }),
      !raw.contains("%"), !raw.contains("\\"), raw.hasPrefix("https://")
    else { return false }
    var rest = raw.dropFirst("https://".count)
    if rest.hasSuffix("/") { rest = rest.dropLast() }
    guard let colon = rest.firstIndex(of: ":") else { return false }
    let hostname = rest[..<colon]
    let portText = rest[rest.index(after: colon)...]
    guard !hostname.contains(where: { "/?#@".contains($0) }), isCanonicalDnsName(hostname) else { return false }
    guard (1...5).contains(portText.count), portText.allSatisfy({ $0.isASCII && $0.isNumber }),
      let port = Int(portText), String(port) == portText, (portMin...portMax).contains(port)
    else { return false }
    return true
  }

  /// `isCanonicalDnsName`: at most 253 characters, at least two labels, each `DNS_LABEL` of 1…63.
  private static func isCanonicalDnsName(_ host: Substring) -> Bool {
    guard !host.isEmpty, host.utf8.count <= 253, host.contains(".") else { return false }
    return host.split(separator: ".", omittingEmptySubsequences: false).allSatisfy(isDnsLabel)
  }

  private static func isDnsLabel(_ label: Substring) -> Bool {
    let bytes = Array(label.utf8)
    guard let first = bytes.first, let last = bytes.last, bytes.count <= 63 else { return false }
    let alphanumeric: (UInt8) -> Bool = { (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) }
    return alphanumeric(first) && alphanumeric(last) && bytes.allSatisfy { alphanumeric($0) || $0 == 0x2D }
  }
}

/// `IndexApp` — one app as the fold answers it: the SERVING row, with what the door joins.
public struct IndexAppRow: Sendable, Equatable, Identifiable {
  /// `${device}:${appId}` of the serving row. Opaque: compared, never parsed.
  public let appKey: String
  /// The app's fold key, stable across desktops: what the phone's ledger of opens names.
  public let foldKey: String
  public let device: String
  public let appId: String
  public let devices: [String]
  public let presentationId: String
  public let title: String
  public let filename: String
  /// rosetta's agent kind. An open grammar, never compared to a literal (R23b).
  public let kind: String?
  /// The catalog id it maps to. An open grammar, never compared to a literal (R23b).
  public let provider: String?
  public let sessionId: String
  public let timelineId: String
  public let versions: Int64
  public let publishedAt: Int64?
  public let capturedAt: Int64?
  public let availability: MadeAppAvailability
  public let hostedUrl: String?
  /// rosetta 0.1.4's: `> 0` is a page served without its files ("page only"). Absent is unknown.
  public let droppedFiles: Int64?
  public let preview: MadeAppPreview?
  public let projectKey: String?
  /// The project's deal index, the fallback icon's colour (MA-D10 (b)).
  public let ink: Int64?
  public let kept: Bool
  public let hidden: Bool
  public let openable: Bool
  public let unknownFields: [String]

  public var id: String { appKey }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexApp", value: json)
    appKey = try object.requiredString("appKey")
    foldKey = try object.requiredString("foldKey")
    device = try object.requiredString("device")
    appId = try object.requiredString("appId")
    devices = (object.array("devices") ?? []).compactMap(\.stringValue)
    presentationId = try object.requiredString("presentationId")
    title = try object.requiredString("title")
    filename = try object.requiredString("filename")
    kind = object.string("kind")
    provider = object.string("provider")
    sessionId = try object.requiredString("sessionId")
    timelineId = try object.requiredString("timelineId")
    versions = object.int("versions") ?? 0
    publishedAt = object.int("publishedAt")
    capturedAt = object.int("capturedAt")
    availability = MadeAppAvailability(wire: object.string("availability"))
    hostedUrl = object.string("hostedUrl")
    droppedFiles = object.int("droppedFiles")
    preview = MadeAppPreview(json: object.value("preview"))
    projectKey = object.string("projectKey")
    ink = object.int("ink")
    kept = object.bool("kept") == true
    hidden = object.bool("hidden") == true
    openable = object.bool("openable") == true
    for known in ["rootSessionId", "byteLen", "digest", "nativeId", "description", "place"] {
      _ = object.value(known)
    }
    unknownFields = object.unknownFields
  }
}

/// `IndexAppsSource` — a desktop's standing in an apps answer: `IndexCatalogSource` and two facts of its own.
public struct IndexAppsSource: Sendable, Equatable, Identifiable {
  public let device: String
  public let name: String?
  public let isSelf: Bool
  /// DS-L8: asleep is a state, never a blank. A word this build has not heard is kept and drawn as not live.
  public let state: AgentMeshDeviceState
  /// How many of this desktop's rows the answering table holds, before the fold.
  public let rows: Int64
  /// rosetta's `canonical_ready`. Absent: unknown (an older desktop, or one not heard yet).
  public let libraryReady: Bool?
  /// The root https URL of its previews serve. One this build cannot read is no base (AH §6).
  public let previewsBase: String?

  public var id: String { device }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexAppsSource", value: json)
    device = try object.requiredString("device")
    name = object.string("name")
    isSelf = object.bool("self") ?? false
    state = AgentMeshDeviceState(wire: object.string("state") ?? "live")
    rows = object.int("rows") ?? 0
    libraryReady = object.bool("libraryReady")
    previewsBase = object.string("previewsBase").flatMap { ArtifactRootURL.isClaim($0) ? $0 : nil }
  }
}

/// `IndexAppsResult` — a page of the fold, newest first; `cursor` continues it, and `clipped` says a tailnet caller's
/// page was cut.
public struct IndexAppsResult: Sendable, Equatable {
  public let rows: [IndexAppRow]
  public let cursor: String?
  public let sources: [IndexAppsSource]
  public let clipped: Bool
  /// Rows this build could not read, by reason: one bad row is not a bad page.
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "IndexAppsResult", value: json)
    var dropped: [String] = []
    rows = try object.rows("rows", IndexAppRow.init(json:), dropped: &dropped)
    cursor = object.string("cursor")
    sources = object.optionalRows("sources", IndexAppsSource.init(json:), dropped: &dropped)
    clipped = object.bool("clipped") == true
    droppedRows = dropped
    unknownFields = object.unknownFields
  }
}

/// An apps refusal (`MadeAppOpenRefusal`): the UNAVAILABLE details of `{service: "apps", state}`. The list door answers
/// `library-reading`; the others are `artifact.open`'s, which the phone does not call before MA-5.
public struct MadeAppRefusal: Sendable, Equatable {
  /// `MADE_APP_OPEN_REFUSAL_STATES`, each spelled as registries.ts spells it.
  public enum State: String, Sendable, Equatable, CaseIterable {
    case exportUnbuilt = "export-unbuilt"
    case notKept = "not-kept"
    case tooLarge = "too-large"
    case unsupported = "unsupported"
    case reading = "library-reading"
    case exportFailed = "export-failed"
    case notLinked = "not-linked"
  }

  /// `MADE_APP_OPEN.SERVICE`
  public static let service = "apps"

  public let state: State
  /// The desktop the refusal is about, when it was carried there.
  public let device: String?

  public init?(details: JSONValue?) {
    guard details?["service"]?.stringValue == Self.service,
      let word = details?["state"]?.stringValue,
      let state = State(rawValue: word)
    else { return nil }
    self.state = state
    device = details?["device"]?.stringValue
  }
}
