import FieldProduct
import Foundation

/// Which socket of the pair. A cell serves both on one port, at `/control` and
/// `/frames`, and a hello whose `channel` does not match its path is
/// `HELLO_MALFORMED` — so this value and the URL are never chosen separately.
public enum RoutedChannel: String, Sendable, Equatable, CaseIterable {
  case control
  case frames
}

/// A right an attach grant may carry. `geometryAdmin` is never minted in v1; it
/// is listed because the wire may spell it and a reader that refused it would be
/// refusing a grant it was given.
public enum RoutedRight: String, Sendable, Equatable {
  case geometry
  case geometryAdmin
  case input
  case read
}

/// Every JSON text message on either leg is `{ type: <TpMessageType>, …body }`
/// (TP-S3a). The tag is the contracts schema's NAME; the body is the untagged
/// shape and never carries a second `type`.
///
/// The four tags this client never sends or reads are here anyway, because the
/// two LEG SETS below are the actual contract and a set is only a contract while
/// it is complete: a tag outside a leg's inbound set is a protocol error, and
/// deciding that needs the whole vocabulary, not the part we happen to use.
public enum RoutedMessageType: String, Sendable, Equatable, CaseIterable {
  case connectionHello = "ConnectionHello"
  case connectionAccepted = "ConnectionAccepted"
  case connectionRefused = "ConnectionRefused"
  case legHeartbeat = "LegHeartbeat"
  case legHeartbeatAck = "LegHeartbeatAck"
  case attachControlLeg = "AttachControlLeg"
  case controlLegAttached = "ControlLegAttached"
  case attachRefused = "AttachRefused"
  case declareDemand = "DeclareDemand"
  case demandAccepted = "DemandAccepted"
  case cellActivationStatus = "CellActivationStatus"
  case claimGeometry = "ClaimGeometry"
  case releaseGeometry = "ReleaseGeometry"
  case transferGeometry = "TransferGeometry"
  case sendInput = "SendInput"
  case sessionEvent = "SessionEvent"
  case geometryCommitted = "GeometryCommitted"
  case geometryRefused = "GeometryRefused"
  case geometryState = "GeometryState"
  case attachFramesLeg = "AttachFramesLeg"
  case framesLegAttached = "FramesLegAttached"
  case transportCredit = "TransportCredit"
  case sceneApplied = "SceneApplied"
  case calibrationPing = "CalibrationPing"
}

/// `TP_LEG_INBOUND` / `TP_LEG_OUTBOUND`, from the client's seat: OUTBOUND here
/// is what this client may SEND on a leg (the contract's "inbound", client →
/// cell) and INBOUND is what it may READ (the contract's "outbound").
///
/// Reading a tag outside the inbound set is a PROTOCOL error this client
/// surfaces and closes on — which is exactly why `session-events` has to be
/// negotiated before the cell may speak `SessionEvent`, and `geometry-events`
/// before it speaks `GeometryState` (item 42).
public enum RoutedLegVocabulary {
  public static func inbound(_ channel: RoutedChannel) -> Set<RoutedMessageType> {
    switch channel {
    case .control:
      [
        .connectionAccepted, .connectionRefused, .legHeartbeatAck, .controlLegAttached,
        .attachRefused, .demandAccepted, .cellActivationStatus, .geometryCommitted,
        .geometryRefused, .sessionEvent, .geometryState,
      ]
    case .frames:
      [.connectionAccepted, .connectionRefused, .legHeartbeatAck, .framesLegAttached, .attachRefused]
    }
  }

  public static func outbound(_ channel: RoutedChannel) -> Set<RoutedMessageType> {
    switch channel {
    case .control:
      [
        .connectionHello, .legHeartbeat, .attachControlLeg, .declareDemand, .claimGeometry,
        .releaseGeometry, .transferGeometry, .sendInput,
      ]
    case .frames:
      [.connectionHello, .legHeartbeat, .attachFramesLeg, .transportCredit, .sceneApplied, .calibrationPing]
    }
  }
}

/// One decoded text message: the tag, and the body with the tag stripped.
public struct RoutedTaggedMessage: Sendable {
  public let type: RoutedMessageType
  public let body: JSONValue
}

public enum RoutedWire {
  public enum DecodeFailure: Error, Equatable, CustomStringConvertible {
    case notJson
    case notAnObject
    case missingType
    /// A tag no build of this client knows. TOLERATED at the reader — the caller
    /// decides, because before an accept an unknown tag is `HELLO_MALFORMED` and
    /// after it the leg's own set decides.
    case unknownType(String)
    case notAllowedHere(RoutedMessageType)

    public var description: String {
      switch self {
      case .notJson: "not JSON"
      case .notAnObject: "not a JSON object"
      case .missingType: "no `type` tag"
      case .unknownType(let tag): "unknown tag `\(tag)`"
      case .notAllowedHere(let tag): "`\(tag.rawValue)` is not read on this leg"
      }
    }
  }

  /// `{ type, ...body }` as the wire spells it.
  public static func tag(_ type: RoutedMessageType, _ body: [String: JSONValue]) -> JSONValue {
    var fields = body
    fields["type"] = .string(type.rawValue)
    return .object(fields)
  }

  public static func encode(_ type: RoutedMessageType, _ body: [String: JSONValue]) throws -> String {
    let data = try tag(type, body).encoded()
    guard let text = String(data: data, encoding: .utf8) else {
      throw DecodeFailure.notJson
    }
    return text
  }

  /// Decode one inbound text frame against the tags this leg may READ.
  public static func decode(_ text: String, allowed: Set<RoutedMessageType>) throws
    -> RoutedTaggedMessage
  {
    guard let value = try? JSONValue.parse(Data(text.utf8)) else { throw DecodeFailure.notJson }
    guard case .object(var fields) = value else { throw DecodeFailure.notAnObject }
    guard let tag = fields["type"]?.stringValue else { throw DecodeFailure.missingType }
    guard let type = RoutedMessageType(rawValue: tag) else { throw DecodeFailure.unknownType(tag) }
    guard allowed.contains(type) else { throw DecodeFailure.notAllowedHere(type) }
    // The tag is stripped before the body is read, so a tolerant body can never
    // smuggle a second one.
    fields.removeValue(forKey: "type")
    return RoutedTaggedMessage(type: type, body: .object(fields))
  }
}

// MARK: - The shapes this client READS

/// Authoritative placement of one session. A changed binding is a NEW
/// activation, never a resume.
public struct RoutedRouteBinding: Sendable, Equatable {
  public let cellBootId: String
  public let routeRevision: Int64
  /// Absent = the floor does not expose custody's lease epoch yet — never 0.
  public let leaseEpoch: Int64?

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "RouteBinding", value: json)
    cellBootId = try fields.requiredString("cellBootId")
    routeRevision = try fields.requiredInt("routeRevision")
    leaseEpoch = fields.int("leaseEpoch")
  }
}

/// Source-content LINEAGE plus revision — the ONLY content stamp on the wire.
/// Two stamps are comparable iff their `sceneEpoch` is equal.
public struct RoutedSceneStamp: Sendable, Equatable {
  public let cellBootId: String
  public let modelGeneration: Int64
  public let sceneRevision: Int64

  public init(cellBootId: String, modelGeneration: Int64, sceneRevision: Int64) {
    self.cellBootId = cellBootId
    self.modelGeneration = modelGeneration
    self.sceneRevision = sceneRevision
  }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "SceneContentStamp", value: json)
    var epoch = fields.object("sceneEpoch")
    cellBootId = try epoch.requiredString("cellBootId")
    modelGeneration = try epoch.requiredInt("modelGeneration")
    sceneRevision = try fields.requiredInt("sceneRevision")
  }

  public var json: JSONValue {
    .object([
      "sceneEpoch": .object([
        "cellBootId": .string(cellBootId), "modelGeneration": .int(modelGeneration),
      ]),
      "sceneRevision": .int(sceneRevision),
    ])
  }

  public var sameLineage: (String, Int64) { (cellBootId, modelGeneration) }

  /// The spec's ordering rule: `nil` = not comparable (a different lineage,
  /// which always seeds).
  public static func compare(_ a: RoutedSceneStamp, _ b: RoutedSceneStamp) -> Int? {
    guard a.sameLineage == b.sameLineage else { return nil }
    if a.sceneRevision == b.sceneRevision { return 0 }
    return a.sceneRevision < b.sceneRevision ? -1 : 1
  }
}

extension RoutedSceneStamp: CustomStringConvertible {
  /// A stamp in a log line's words: the revision, and the lineage's generation.
  public var description: String { "r\(sceneRevision) of generation \(modelGeneration)" }
}

public struct RoutedConnectionAccepted: Sendable {
  public let protocolMajor: Int64
  public let protocolMinor: Int64
  public let connectionSetId: String
  public let channel: RoutedChannel
  public let legGeneration: Int64
  public let heartbeatTtlMs: Int64
  /// Frames leg only. The cell's own rule: the credit epoch IS the frames leg
  /// generation, so a replaced leg is always a new epoch.
  public let creditEpoch: Int64?
  public let initialWindows: RoutedReceiverCapacities?
  public let limits: RoutedProtocolLimits
  public let capabilities: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "ConnectionAccepted", value: json)
    var version = fields.object("selectedProtocolVersion")
    protocolMajor = try version.requiredInt("major")
    protocolMinor = try version.requiredInt("minor")
    connectionSetId = try fields.requiredString("connectionSetId")
    let channelText = try fields.requiredString("channel")
    guard let channel = RoutedChannel(rawValue: channelText) else {
      throw WireDecodeError(shape: "ConnectionAccepted", reason: "unknown channel `\(channelText)`")
    }
    self.channel = channel
    legGeneration = try fields.requiredInt("legGeneration")
    heartbeatTtlMs = try fields.requiredInt("heartbeatTtlMs")
    creditEpoch = fields.int("creditEpoch")
    initialWindows = try fields.decodeObject("initialWindows") { value in
      var window = try WireObject(shape: "ReceiverCapacities", value: value)
      return RoutedReceiverCapacities(
        connectionCreditBytes: Int(try window.requiredInt("connectionCreditBytes")),
        perActivationCreditBytes: Int(try window.requiredInt("perActivationCreditBytes")),
        stagingBytesPerSession: Int(window.int("stagingBytesPerSession") ?? 0),
        stagingBytesTotal: Int(window.int("stagingBytesTotal") ?? 0),
        maxConcurrentActivations: Int(window.int("maxConcurrentActivations") ?? 0),
        maxConcurrentSeeds: Int(window.int("maxConcurrentSeeds") ?? 0))
    }
    // Tolerant: a limit the cell omits keeps this client's conservative floor.
    var announced = fields.object("protocolLimits")
    let floor = RoutedProtocolLimits.floor
    limits = RoutedProtocolLimits(
      maxControlMessageBytes: Int(announced.int("maxControlMessageBytes") ?? Int64(floor.maxControlMessageBytes)),
      maxPresentationChunkBytes: Int(announced.int("maxPresentationChunkBytes") ?? Int64(floor.maxPresentationChunkBytes)),
      maxCreditReturnDelayMs: Int(announced.int("maxCreditReturnDelayMs") ?? Int64(floor.maxCreditReturnDelayMs)),
      sceneAppliedRefreshMs: Int(announced.int("sceneAppliedRefreshMs") ?? Int64(floor.sceneAppliedRefreshMs)),
      activationAttachDeadlineMs: Int(announced.int("activationAttachDeadlineMs") ?? Int64(floor.activationAttachDeadlineMs)),
      maxCatchupBytes: Int(announced.int("maxCatchupBytes") ?? Int64(floor.maxCatchupBytes)),
      creditAccountDrainTtlMs: Int(announced.int("creditAccountDrainTtlMs") ?? Int64(floor.creditAccountDrainTtlMs)))
    capabilities = (fields.array("capabilities") ?? []).compactMap(\.stringValue)
    unknownFields = fields.unknownFields
  }

  public func negotiated(_ capability: String) -> Bool { capabilities.contains(capability) }
}

/// POST-verification refusal. Every PRE-authentication failure is a silent
/// `1008` instead — which is why this type can never explain one.
public struct RoutedConnectionRefused: Sendable, Equatable {
  public let code: String
  public let retryable: Bool

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "ConnectionRefused", value: json)
    code = try fields.requiredString("code")
    retryable = fields.bool("retryable") ?? false
  }
}

public struct RoutedControlLegAttached: Sendable, Equatable {
  public let sessionId: String
  public let activationId: String
  public let grantGenerationAccepted: Int64
  public let rights: [RoutedRight]

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "ControlLegAttached", value: json)
    sessionId = try fields.requiredString("sessionId")
    activationId = try fields.requiredString("activationId")
    grantGenerationAccepted = try fields.requiredInt("grantGenerationAccepted")
    rights = try fields.requiredArray("rights").compactMap {
      $0.stringValue.flatMap(RoutedRight.init(rawValue:))
    }
  }
}

public struct RoutedAttachRefused: Sendable, Equatable {
  public let activationId: String?
  public let code: String
  public let retryable: Bool

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "AttachRefused", value: json)
    activationId = fields.string("activationId")
    code = try fields.requiredString("code")
    retryable = fields.bool("retryable") ?? false
  }
}

public struct RoutedTrfIdentity: Sendable, Equatable {
  /// u64 handles ride as DECIMAL STRINGS — JSON numbers cannot carry a u64.
  public let sessionHandle: String
  public let viewHandle: String

  public init(sessionHandle: String, viewHandle: String) {
    self.sessionHandle = sessionHandle
    self.viewHandle = viewHandle
  }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "TrfIdentity", value: json)
    sessionHandle = try fields.requiredString("sessionHandle")
    viewHandle = try fields.requiredString("viewHandle")
  }
}

public struct RoutedFramesLegAttached: Sendable, Equatable {
  public enum Outcome: Sendable, Equatable {
    case resumeAccepted(from: RoutedSceneStamp, newestAvailable: RoutedSceneStamp)
    case seedRequired(reason: String)
  }

  public let sessionId: String
  public let activationId: String
  public let resumeToken: String
  public let trfIdentity: RoutedTrfIdentity
  public let outcome: Outcome

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "FramesLegAttached", value: json)
    sessionId = try fields.requiredString("sessionId")
    activationId = try fields.requiredString("activationId")
    resumeToken = try fields.requiredString("resumeToken")
    trfIdentity = try RoutedTrfIdentity(json: fields.value("trfIdentity") ?? .null)
    var result = fields.object("outcome")
    let kind = try result.requiredString("kind")
    switch kind {
    case "resume-accepted":
      guard let from = result.value("from"), let newest = result.value("newestAvailable") else {
        throw WireDecodeError(
          shape: "FramesAttachOutcome", reason: "resume-accepted carries from + newestAvailable")
      }
      outcome = .resumeAccepted(
        from: try RoutedSceneStamp(json: from), newestAvailable: try RoutedSceneStamp(json: newest))
    case "seed-required":
      outcome = .seedRequired(reason: result.string("reason") ?? "unspecified")
    default:
      throw WireDecodeError(shape: "FramesAttachOutcome", reason: "unknown kind `\(kind)`")
    }
  }
}

/// The revocable lease, in TWO independent dimensions. `presentation` answers
/// "is this viewer's scene being advanced"; `input` answers "may this viewer
/// write". The cell never says `input = allowed` while presentation is not
/// presenting, and this reader does not enforce that — it REPORTS what arrived,
/// because a client that silently repaired an impossible pair would hide the
/// cell bug that produced it.
public struct RoutedActivationStatus: Sendable, Equatable {
  public enum Presentation: Sendable, Equatable {
    case presenting
    case stopped(reason: String)
    case revoked(reason: String)
  }

  public enum Input: Sendable, Equatable {
    case allowed
    case suspended(reason: String)
    case revoked(reason: String)
  }

  public let sessionId: String
  public let activationId: String
  public let cellStatusSequence: Int64
  public let leaseTtlMs: Int64
  public let acceptedContent: RoutedSceneStamp?
  public let presentation: Presentation
  public let input: Input

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "CellActivationStatus", value: json)
    sessionId = try fields.requiredString("sessionId")
    activationId = try fields.requiredString("activationId")
    cellStatusSequence = try fields.requiredInt("cellStatusSequence")
    leaseTtlMs = try fields.requiredInt("leaseTtlMs")
    acceptedContent = try fields.decodeObject("acceptedContent") { try RoutedSceneStamp(json: $0) }
    var presentationFields = fields.object("presentation")
    let presentationState = try presentationFields.requiredString("state")
    let presentationReason = presentationFields.string("reason") ?? "unspecified"
    switch presentationState {
    case "presenting": presentation = .presenting
    case "stopped": presentation = .stopped(reason: presentationReason)
    case "revoked": presentation = .revoked(reason: presentationReason)
    default:
      throw WireDecodeError(
        shape: "PresentationDimension", reason: "unknown state `\(presentationState)`")
    }
    var inputFields = fields.object("input")
    let inputState = try inputFields.requiredString("state")
    let inputReason = inputFields.string("reason") ?? "unspecified"
    switch inputState {
    case "allowed": input = .allowed
    case "suspended": input = .suspended(reason: inputReason)
    case "revoked": input = .revoked(reason: inputReason)
    default:
      throw WireDecodeError(shape: "InputDimension", reason: "unknown state `\(inputState)`")
    }
  }
}

/// cell → client on the control leg, behind the negotiated `session-events`
/// capability. An unknown `kind` is drop-and-log at the receiver (a tolerant
/// reader), never a leg close — future variants are additive behind the same
/// capability.
public enum RoutedSessionEvent: Sendable, Equatable {
  case exited(
    sessionId: String, exitCode: Int64?, exitSignal: String?, requestedTermination: String?,
    exitOutcome: String)
  case removed(sessionId: String)
  /// The cell's own deltas dropped. Honest, and the client's cue to reconcile
  /// against the authoritative inventory rather than trust what it holds.
  case resync
  case unknown(kind: String)

  public init(json: JSONValue) throws {
    var envelope = try WireObject(shape: "SessionEvent", value: json)
    var event = envelope.object("event")
    let kind = try event.requiredString("kind")
    switch kind {
    case "exited":
      self = .exited(
        sessionId: try event.requiredString("sessionId"),
        exitCode: event.int("exitCode"),
        exitSignal: event.string("exitSignal"),
        requestedTermination: event.string("requestedTermination"),
        exitOutcome: event.string("exitOutcome") ?? "unknown")
    case "removed":
      self = .removed(sessionId: try event.requiredString("sessionId"))
    case "resync":
      self = .resync
    default:
      self = .unknown(kind: kind)
    }
  }
}

/// Typed text or a paste the client refused because one control message
/// cannot carry it (`RoutedTerminalClient.send(text:to:)`). Both sizes are the
/// TEXT's own UTF-8, the measure a person can check: `bytes` its whole size,
/// `fits` how much of THIS text one message carries, its escapes counted —
/// always below `bytes`.
public struct RoutedInputRefusal: Sendable, Equatable {
  public enum Kind: Sendable, Equatable {
    case typed
    case pasted
  }

  public let kind: Kind
  public let bytes: Int
  public let fits: Int

  public init(kind: Kind, bytes: Int, fits: Int) {
    self.kind = kind
    self.bytes = bytes
    self.fits = fits
  }
}

/// The facts of an `exited` event, kept on the session it names
/// (`RoutedSessionState.exit`): the code or the signal, whether the end was
/// asked for, and the engine's own outcome word. Nothing here is inferred.
public struct RoutedSessionExit: Sendable, Equatable {
  public let code: Int64?
  public let signal: String?
  public let requestedTermination: String?
  public let outcome: String

  public init(code: Int64?, signal: String?, requestedTermination: String?, outcome: String) {
    self.code = code
    self.signal = signal
    self.requestedTermination = requestedTermination
    self.outcome = outcome
  }
}

/// DS-4b — who holds a session's geometry seat, as the CELL names it: the
/// claimant (`clientId` + a non-reused `viewId`) and the `holderGeneration`
/// the cell minted at the claim or transfer that seated it (TPv3 §6). A view
/// can only ever NAME itself; the generation is the cell's.
public struct RoutedGeometryHolder: Sendable, Equatable {
  public let clientId: String
  public let viewId: String
  public let holderGeneration: Int64

  public init(clientId: String, viewId: String, holderGeneration: Int64) {
    self.clientId = clientId
    self.viewId = viewId
    self.holderGeneration = holderGeneration
  }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "GeometryHolder", value: json)
    clientId = try fields.requiredString("clientId")
    viewId = try fields.requiredString("viewId")
    holderGeneration = try fields.requiredInt("holderGeneration")
  }

  /// Whether this holder is the claimant `clientId`/`viewId`: a seat is a
  /// view's only when BOTH match — one client's two views are two claimants.
  public func isClaimant(clientId: String, viewId: String) -> Bool {
    self.clientId == clientId && self.viewId == viewId
  }

  public var json: JSONValue {
    .object([
      "clientId": .string(clientId), "viewId": .string(viewId),
      "holderGeneration": .int(holderGeneration),
    ])
  }
}

public struct RoutedGeometryCommitted: Sendable, Equatable {
  public let holder: RoutedGeometryHolder
  public let geometryRevision: Int64
  public let cols: Int
  public let rows: Int

  public var clientId: String { holder.clientId }
  public var viewId: String { holder.viewId }
  public var holderGeneration: Int64 { holder.holderGeneration }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "GeometryCommitted", value: json)
    guard let holder = fields.value("holder") else {
      throw WireDecodeError(shape: "GeometryCommitted", reason: "missing `holder`")
    }
    self.holder = try RoutedGeometryHolder(json: holder)
    geometryRevision = try fields.requiredInt("geometryRevision")
    cols = Int(try fields.requiredInt("cols"))
    rows = Int(try fields.requiredInt("rows"))
  }
}

/// A refusal — and, since DS-D5, the ANNOUNCEMENT: the cell tells a displaced
/// holder nothing when another view takes the seat, so a view learns who holds
/// it from the refusal of its next verb (`currentHolder` + `geometryRevision`
/// on `STALE_REVISION`, `NOT_HOLDER`, `SEAT_HELD`). A refusal that names a
/// revision and no holder says the seat is EMPTY; one that names neither says
/// nothing about the seat at all (`RIGHT_MISSING`, a malformed caller).
///
/// Corrected 2026-10-19 (item 42): the cell now tells a displaced holder too.
/// Every change of the seat reaches each leg that negotiated `geometry-events`
/// (`RoutedGeometryState`), which this client advertises, and a face reads that
/// announcement (`RoutedSessionState.seat`). The refusal stays the announcement
/// the TAKE learns from: the belief its verbs are built on is fed by their own
/// answers alone.
public struct RoutedGeometryRefused: Sendable, Equatable {
  public let code: String
  public let geometryRevision: Int64?
  public let currentHolder: RoutedGeometryHolder?

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "GeometryRefused", value: json)
    code = try fields.requiredString("code")
    geometryRevision = fields.int("geometryRevision")
    // Tolerant: a holder this build cannot read is no announcement, never a
    // refusal this client cannot read at all.
    currentHolder = fields.value("currentHolder").flatMap { try? RoutedGeometryHolder(json: $0) }
  }
}

/// item 42 (2026-10-19) — who a seat's holder IS, as a person reads it: the
/// device kind, its name, its OS. fieldd mints it into the attach grant's
/// claims from the principal it verified; the cell never composes one, it
/// ECHOES the face in the claims of the activation whose view holds the seat.
/// Presentation only: no right, fence or CAS reads it.
///
/// `kind` and `os` are OPEN strings, kept as the wire spells them. The contract
/// names `phone | window | peer-window` and `ios | macos | windows | linux`
/// today, and a newer fieldd's word reaches this phone as text, never as a
/// refusal; which mark an OS wears is a view's decision, not this reader's.
/// `name` is never empty — a face that says who drives must have a name to say
/// — so a nameless one is refused, as the contract refuses it.
public struct RoutedGeometryHolderFace: Sendable, Equatable {
  public let kind: String
  public let name: String
  public let os: String?

  public init(kind: String, name: String, os: String? = nil) {
    self.kind = kind
    self.name = name
    self.os = os
  }

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "GeometryHolderFace", value: json)
    kind = try fields.requiredString("kind")
    name = try fields.requiredString("name")
    os = fields.string("os")
  }
}

/// item 42 — the holder as `GeometryState` announces it: the cell-minted
/// `GeometryHolder` and the face from its attach claims. A SIBLING of
/// `RoutedGeometryHolder`, never a widening of it, exactly as the contract
/// keeps `GeometryHolder` bare: the take's beliefs compare bare holders, and a
/// commit or a refusal answers a caller about its own verb, with no face.
public struct RoutedGeometryStateHolder: Sendable, Equatable {
  public let holder: RoutedGeometryHolder
  /// Absent when the grant carried none: a mint from before item 42, or a
  /// principal fieldd could not name.
  public let face: RoutedGeometryHolderFace?

  public var clientId: String { holder.clientId }
  public var viewId: String { holder.viewId }
  public var holderGeneration: Int64 { holder.holderGeneration }

  public init(holder: RoutedGeometryHolder, face: RoutedGeometryHolderFace? = nil) {
    self.holder = holder
    self.face = face
  }

  public init(json: JSONValue) throws {
    holder = try RoutedGeometryHolder(json: json)
    // Tolerant: a face this build cannot read is no face. The holder, the
    // revision and the size stand without it, as a faceless grant's do — a
    // presentation detail never costs the seat.
    face = json["face"].flatMap { try? RoutedGeometryHolderFace(json: $0) }
  }
}

/// item 42 (2026-10-19) — cell → client on the CONTROL leg, behind the
/// negotiated `geometry-events` capability: a session's geometry seat as it
/// now is. The cell sends it after every change of the seat's holder or of its
/// committed size — to the control leg of every activation of the session, the
/// caller's included and after the verb's own answer, so replies still match
/// asks in send order — and once right after the `ControlLegAttached` of an
/// attach, when a size was ever committed. A STATE, not a delta, under the
/// receiver's rule the contract states: a strictly OLDER `geometryRevision` is
/// ignored, an equal or newer one replaces. The session's END is not announced
/// here: that is `SessionEvent`'s.
public struct RoutedGeometryState: Sendable, Equatable {
  public let sessionId: String
  /// Nil while the seat is EMPTY: nobody drives.
  public let holder: RoutedGeometryStateHolder?
  public let geometryRevision: Int64
  /// The PTY's COMMITTED size. A release does not resize the PTY back, so an
  /// empty seat carries the last size committed — the size the pane is drawing.
  public let cols: Int
  public let rows: Int

  public init(json: JSONValue) throws {
    var fields = try WireObject(shape: "GeometryState", value: json)
    sessionId = try fields.requiredString("sessionId")
    // `holder` is NULLABLE, never optional — the contract's own spelling: `null`
    // is an EMPTY seat, and a message without the key says nothing about the
    // seat at all. `WireObject` reads null and absent alike, so the key is
    // asked for first: a state that never named its holder is not taken to say
    // that nobody drives.
    guard json["holder"] != nil else {
      throw WireDecodeError(
        shape: "GeometryState", reason: "missing `holder` (an empty seat is null)")
    }
    holder = try fields.decodeObject("holder") { try RoutedGeometryStateHolder(json: $0) }
    geometryRevision = try fields.requiredInt("geometryRevision")
    cols = Int(try fields.requiredInt("cols"))
    rows = Int(try fields.requiredInt("rows"))
  }
}
