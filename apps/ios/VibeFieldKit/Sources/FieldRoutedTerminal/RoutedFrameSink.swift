import Foundation

/// Where a cell's frames go.
///
/// This is the ONE seam between the routed client and a renderer, and it is
/// deliberately the narrowest thing that can carry a frame: TRF1 bytes and the
/// stamps that say what they are. The phone already has a TRF1 decoder — the
/// Metal renderer behind `TerminalAttachment` consumes `frame: Data` today, from
/// an encode the phone does for itself out of logical rows — so under T the
/// cell's own TRF1 goes straight into that path and the row replica and the
/// on-device encode disappear. Nothing in this protocol names Ghosttea, and
/// nothing in it names VibeField.
///
/// The payload is a VIEW into the received message and is valid only for the
/// duration of the call. An implementation that hands it to another thread, or
/// keeps it, must copy it (`Data(payload)`).
public protocol RoutedFrameSink: AnyObject, Sendable {
  /// The TRF1 handles the cell declared for this activation, at the moment it
  /// declared them (`FramesLegAttached.trfIdentity`).
  ///
  /// The rule the contract states has two halves, and they belong in two places.
  /// The client enforces the half that needs no TRF1 decoder — the pair is bound
  /// to the activation, a re-attach may not change it, and two live activations
  /// of one connection set may not claim the same `sessionHandle` — which is the
  /// half the rule exists for: two identities must never route to two replicas.
  /// The other half, comparing the handles stamped INSIDE each decoded frame, is
  /// the sink's, because the sink owns the only TRF1 decoder on the device and
  /// this target deliberately names no Ghosttea type. A sink that decodes is
  /// expected to make that comparison and refuse a frame that fails it.
  func bindActivation(session: String, activation: String, identity: RoutedTrfIdentity) async

  /// A full frame: the seed, or a catch-up, reassembled and checksum-verified.
  /// The receiver's scene is REPLACED — there is no base to apply against.
  func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp) async

  /// An incremental frame. It applies iff `base` equals what the sink currently
  /// holds; a sink that has moved on must say so by returning `false`, which the
  /// client reports as a lineage break and repairs with a reseed rather than
  /// applying a delta onto the wrong scene.
  func applyDeltaFrame(
    _ payload: Data, session: String, activation: String, base: RoutedSceneStamp?,
    result: RoutedSceneStamp
  ) async -> Bool

  /// The activation's scene is gone: the lease was revoked, the leg died, or the
  /// route moved. The sink keeps showing what it has — an honest stale face
  /// beats a blank one — but must not expect more frames under this activation.
  func activationEnded(session: String, activation: String, reason: String) async
}

/// A sink that holds the last frame and the stamp it carries. The phone's real
/// sink is the Metal renderer (TM-5); this one is what the witness applies
/// frames into, and what a caller with no renderer yet can mount.
public actor RoutedFrameRecorder: RoutedFrameSink {
  public private(set) var lastFrame: Data?
  public private(set) var content: RoutedSceneStamp?
  public private(set) var fullFrames = 0
  public private(set) var deltaFrames = 0
  public private(set) var endings: [String] = []
  public private(set) var identities: [String: RoutedTrfIdentity] = [:]

  public init() {}

  public func bindActivation(session: String, activation: String, identity: RoutedTrfIdentity) {
    identities[activation] = identity
  }

  public func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp
  ) {
    lastFrame = Data(payload)
    self.content = content
    fullFrames += 1
  }

  public func applyDeltaFrame(
    _ payload: Data, session: String, activation: String, base: RoutedSceneStamp?,
    result: RoutedSceneStamp
  ) -> Bool {
    // The delta rule, at the only place that can answer it: a delta applies iff
    // its base is what this sink holds. A self-contained full frame (base nil)
    // always applies.
    if let base, let held = content, RoutedSceneStamp.compare(base, held) != 0 { return false }
    if let base, content == nil, base.sceneRevision != 0 { return false }
    lastFrame = Data(payload)
    content = result
    deltaFrames += 1
    return true
  }

  public func activationEnded(session: String, activation: String, reason: String) {
    endings.append("\(activation):\(reason)")
  }
}
