import FieldRoutedTerminal
import Foundation
import GhostteaFrame

/// The phone's real frame sink: the cell's own TRF1, straight into the Metal
/// renderer's frame path.
///
/// Under T there is no replica and no on-device encode. The cell renders the
/// session once (TP-L-B′) and every viewer decodes; what used to be logical grid
/// rows re-encoded here is now the same binary damage frame the deck applies.
/// A frame that passes the rules below goes to `render` — the attachment's
/// `TerminalScene`, which applies it to the retained scene at once — and the
/// renderer's own verdict is this sink's answer (the second audit's B2,
/// 2026-10-16: "applied" used to mean "published to a slot SwiftUI would read
/// later", so the cell heard applied for frames the glass had not taken).
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
    /// Every rule here passed and the renderer still would not take the frame:
    /// it would not decode it whole, or its own sequence check refused it.
    case rejectedByRenderer
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

  /// Where a frame goes once it has passed every rule, answering whether the
  /// retained scene took it. The attachment installs this; nothing else may.
  private let render: @MainActor (Data) -> Bool
  /// Told when an activation's own identity rule failed, so the attachment can
  /// end the activation rather than sit on a scene it must not trust.
  private let identityFailed: @MainActor (String, String) -> Void
  /// Told when an activation ended, with the cell's (or the client's) reason.
  private let ended: @MainActor (String, String) -> Void
  /// Told, in a sentence, which rule refused a frame: the first refusal of a
  /// run, then each power of two, then the frame that ends the run. A console
  /// names the rule without a line per frame (2026-10-17: after a reopen every
  /// delta was refused, and nothing said whether the stamps or the renderer did).
  private let noted: @MainActor (String) -> Void
  private var refusedInARow = 0

  private var bound: Bound?
  private var content: RoutedSceneStamp?

  public private(set) var lastOutcome: Outcome?
  public private(set) var appliedFullFrames = 0
  public private(set) var appliedDeltaFrames = 0
  public private(set) var rejectedFrames = 0

  public init(
    render: @escaping @MainActor (Data) -> Bool,
    identityFailed: @escaping @MainActor (_ session: String, _ reason: String) -> Void = { _, _ in },
    activationEnded: @escaping @MainActor (_ session: String, _ reason: String) -> Void = { _, _ in },
    noted: @escaping @MainActor (_ sentence: String) -> Void = { _ in }
  ) {
    self.render = render
    self.identityFailed = identityFailed
    self.ended = activationEnded
    self.noted = noted
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

  /// A full frame REPLACES the scene, so there is no base to check — but the
  /// two rules `admits` answers still apply, and until TM-r3 this method
  /// swallowed both of them. It returns the answer now: `false` is this sink
  /// saying the glass does not hold this frame, and the client must not report
  /// it applied to a cell that would then stop seeding.
  @discardableResult
  public func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp
  ) -> Bool {
    guard admits(payload, session: session, activation: activation) else { return false }
    guard rendered(payload, "a whole scene at \(content)") else { return false }
    self.content = content
    appliedFullFrames += 1
    lastOutcome = .applied
    endRefusalRun()
    return true
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
      noteRefusal("a delta on \(base) where the scene holds \(held)")
      return false
    }
    if let base, content == nil, base.sceneRevision != 0 {
      rejectedFrames += 1
      lastOutcome = .rejectedLineage
      noteRefusal("a delta on \(base) where the scene holds nothing")
      return false
    }
    guard rendered(payload, "a delta to \(result)") else { return false }
    self.content = result
    appliedDeltaFrames += 1
    lastOutcome = .applied
    endRefusalRun()
    return true
  }

  /// Hand the frame to the renderer and keep its verdict. A refusal leaves the
  /// held stamp where it was: the scene still shows the frame before this one.
  private func rendered(_ payload: Data, _ what: @autoclosure () -> String) -> Bool {
    guard render(Data(payload)) else {
      rejectedFrames += 1
      lastOutcome = .rejectedByRenderer
      noteRefusal("the renderer would not take \(what())")
      return false
    }
    return true
  }

  private func noteRefusal(_ why: String) {
    refusedInARow += 1
    if refusedInARow & (refusedInARow - 1) == 0 {
      noted("refused \(refusedInARow) in a row — \(why)")
    }
  }

  private func endRefusalRun() {
    guard refusedInARow > 0 else { return }
    noted("a frame applied after \(refusedInARow) refused")
    refusedInARow = 0
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
      // content; this is the second wall, and it counts nothing because a
      // replacement is the normal cost of a reconnect, not a fault.
      noteRefusal(
        bound.map { "a frame for \(activation) reached the sink of \($0.activation)" }
          ?? "a frame reached a sink bound to no activation")
      return false
    }
    let frame: TRF1Frame
    do {
      frame = try decodeTRF1Frame(payload)
    } catch {
      rejectedFrames += 1
      lastOutcome = .undecodable(String(describing: error))
      noteRefusal("a frame would not decode: \(error)")
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
      noteRefusal(reason)
      self.bound = nil
      content = nil
      identityFailed(session, reason)
      return false
    }
    return true
  }
}
