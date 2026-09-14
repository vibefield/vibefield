import FieldRoutedTerminal
import Foundation
import GhostteaFrame

/// The phone's real frame sink: the cell's own TRF1, straight into the Metal
/// renderer's frame path.
///
/// Under T there is no replica and no on-device encode. The cell renders the
/// session once (TP-L-B′) and every viewer decodes; what used to be logical grid
/// rows re-encoded here is now the same binary damage frame the deck applies.
/// `TerminalAttachment` publishes what this sink hands it and `TerminalSurface`
/// calls `apply(frame:)` with it.
///
/// This type owns TWO things the client above it deliberately does not:
///
/// 1. **The scene it holds.** A delta applies iff its base is what the sink
///    already shows, and only the sink can answer that — so the last applied
///    stamp lives here and `applyDeltaFrame` returns the answer rather than
///    guessing at it.
/// 2. **The inner half of the `trfIdentity` rule** (owed by TM-4, done here).
///    The client binds the declared `(sessionHandle, viewHandle)` pair to the
///    activation and refuses a re-declaration or a collision; the OTHER half is
///    comparing the handles stamped INSIDE each decoded frame, and it belongs
///    wherever the TRF1 decoder is. That is here.
@MainActor
public final class RoutedTerminalFrameSink: RoutedFrameSink {
  /// What a frame did when it reached the renderer's path, for the tests and
  /// for the attachment's own counters. Never a blank: a dropped frame says
  /// which rule dropped it.
  public enum Outcome: Sendable, Equatable {
    case applied
    case rejectedLineage
    /// The frame's own handles are not the pair the cell declared for this
    /// activation. Two identities must never route to two replicas.
    case rejectedIdentity(String)
    /// The bytes would not parse as TRF1 at all.
    case undecodable(String)
  }

  /// The activation this sink is showing, and the pair the cell declared for it.
  private struct Bound {
    let session: String
    let activation: String
    let identity: RoutedTrfIdentity
  }

  /// Where a frame goes once it has passed every rule. The attachment installs
  /// this; nothing else may.
  private let publish: @MainActor (Data) -> Void
  /// Told when an activation's own identity rule failed, so the attachment can
  /// end the activation rather than sit on a scene it must not trust.
  private let identityFailed: @MainActor (String, String) -> Void
  /// Told when an activation ended, with the cell's (or the client's) reason.
  private let ended: @MainActor (String, String) -> Void

  private var bound: Bound?
  private var content: RoutedSceneStamp?

  public private(set) var lastOutcome: Outcome?
  public private(set) var appliedFullFrames = 0
  public private(set) var appliedDeltaFrames = 0
  public private(set) var rejectedFrames = 0

  public init(
    publish: @escaping @MainActor (Data) -> Void,
    identityFailed: @escaping @MainActor (_ session: String, _ reason: String) -> Void = { _, _ in },
    activationEnded: @escaping @MainActor (_ session: String, _ reason: String) -> Void = { _, _ in }
  ) {
    self.publish = publish
    self.identityFailed = identityFailed
    self.ended = activationEnded
  }

  // MARK: RoutedFrameSink

  public func bindActivation(
    session: String, activation: String, identity: RoutedTrfIdentity
  ) {
    // A new activation is a new scene: whatever this sink holds is not a base
    // for what is coming, and the client has already said so on its side by
    // clearing its own applied stamp on a seed.
    if bound?.activation != activation { content = nil }
    bound = Bound(session: session, activation: activation, identity: identity)
  }

  public func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp
  ) {
    guard admits(payload, session: session, activation: activation) else { return }
    self.content = content
    appliedFullFrames += 1
    lastOutcome = .applied
    publish(Data(payload))
  }

  public func applyDeltaFrame(
    _ payload: Data, session: String, activation: String, base: RoutedSceneStamp?,
    result: RoutedSceneStamp
  ) -> Bool {
    guard admits(payload, session: session, activation: activation) else { return false }
    // The delta rule, at the only place that can answer it: a delta applies iff
    // its base is the scene this sink holds. A self-contained full frame (no
    // base) always applies; a base against nothing held is a lineage break
    // unless it names the empty scene.
    if let base, let held = content, RoutedSceneStamp.compare(base, held) != 0 {
      rejectedFrames += 1
      lastOutcome = .rejectedLineage
      return false
    }
    if let base, content == nil, base.sceneRevision != 0 {
      rejectedFrames += 1
      lastOutcome = .rejectedLineage
      return false
    }
    self.content = result
    appliedDeltaFrames += 1
    lastOutcome = .applied
    publish(Data(payload))
    return true
  }

  public func activationEnded(session: String, activation: String, reason: String) {
    guard bound?.activation == activation else { return }
    bound = nil
    content = nil
    ended(session, reason)
  }

  // MARK: The identity rule's inner half

  /// Decode the frame's own header and compare its handles with the pair the
  /// cell declared at attach. A mismatch DROPS the frame and fails the
  /// activation — a frame carrying another session's handle is precisely the
  /// "two identities routing to two replicas" the rule exists to prevent, and
  /// applying it would paint one terminal with another's contents.
  ///
  /// `decodeTRF1Frame` is the RENDERER's own reader (`GhostteaFrame`, which the
  /// Metal view decodes every frame with), not a second byte-offset parser
  /// written here: the header layout is ghosttea's and must have exactly one
  /// reading on this device. It parses the 64-byte header and the section TABLE
  /// only — every section body stays an unread slice — so this costs a bounds
  /// walk per frame, not a second decode.
  ///
  /// **One dependency, stated:** `GhostteaFrame` is a TARGET of the ghosttea
  /// package and not one of its PRODUCTS, so this import rests on the package's
  /// module search path rather than on a declared product dependency. It builds
  /// today and would fail loudly, never silently, if that changed; promoting it
  /// to a product is an upstream ask filed with G27.
  private func admits(_ payload: Data, session: String, activation: String) -> Bool {
    guard let bound, bound.activation == activation, bound.session == session else {
      // Not this sink's activation. The client already discards superseded
      // content; this is the second wall, and it is silent because a
      // replacement is the normal cost of a reconnect, not a fault.
      return false
    }
    let frame: TRF1Frame
    do {
      frame = try decodeTRF1Frame(payload)
    } catch {
      rejectedFrames += 1
      lastOutcome = .undecodable(String(describing: error))
      return false
    }
    // The handles ride the wire as DECIMAL STRINGS (JSON cannot carry a u64),
    // so the comparison is made in the wire's own spelling rather than by
    // parsing the declaration into a number that might not round-trip.
    let declared = bound.identity
    guard String(frame.sessionHandle) == declared.sessionHandle,
      String(frame.viewHandle) == declared.viewHandle
    else {
      rejectedFrames += 1
      let reason =
        "a frame carried TRF1 handles \(frame.sessionHandle)/\(frame.viewHandle) "
        + "where the cell declared \(declared.sessionHandle)/\(declared.viewHandle)"
      lastOutcome = .rejectedIdentity(reason)
      self.bound = nil
      content = nil
      identityFailed(session, reason)
      return false
    }
    return true
  }
}
