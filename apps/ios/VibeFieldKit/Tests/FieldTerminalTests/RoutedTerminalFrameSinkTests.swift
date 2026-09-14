import FieldProduct
import FieldRoutedTerminal
import Foundation
import GhostteaFrame
import Testing

@testable import FieldTerminal

/// TM-4 left the INNER half of the `trfIdentity` rule owed, and named exactly
/// where it belonged: "the sink is where the decoder lives". This is that half.
///
/// The frames are REAL — two verbatim TRF1 frames from the repo's own
/// terminal-perf corpus, the same lane fixture TM-4's witness carries — so the
/// handles being compared are handles a cell actually stamped, not numbers this
/// test wrote into a header of its own.
@Suite struct RoutedTerminalFrameSinkTests {
  /// A frame's own handles, read with the renderer's reader.
  private func handles(_ frame: Data) throws -> RoutedTrfIdentity {
    let decoded = try decodeTRF1Frame(frame)
    return RoutedTrfIdentity(
      sessionHandle: String(decoded.sessionHandle), viewHandle: String(decoded.viewHandle))
  }

  private func stamp(_ revision: Int64) -> RoutedSceneStamp {
    RoutedSceneStamp(cellBootId: "cb-1", modelGeneration: 1, sceneRevision: revision)
  }

  @MainActor
  @Test func theCellsOwnFrameReachesTheRendererByteForByte() throws {
    // The whole point of T: no replica, no re-encode. What the cell sent is
    // what `TerminalSurface` applies.
    let frames = try LaneFrames.load()
    var published: [Data] = []
    let sink = RoutedTerminalFrameSink(publish: { published.append($0) })
    sink.bindActivation(
      session: "s-1", activation: "act-1", identity: try handles(frames.seed))
    let applied = sink.applyFullFrame(
      frames.seed, session: "s-1", activation: "act-1", content: stamp(1))

    #expect(applied)
    #expect(published == [frames.seed])
    #expect(sink.appliedFullFrames == 1)
    #expect(sink.lastOutcome == .applied)
  }

  @MainActor
  @Test func aFrameStampedWithAnotherSessionsHandleIsDroppedAndFailsTheActivation() throws {
    // The rule's reason, stated in the contract: two identities must never
    // route to two replicas. A frame carrying handles the cell did not declare
    // could paint THIS terminal with ANOTHER session's contents, so it never
    // reaches the renderer and the activation goes with it.
    let frames = try LaneFrames.load()
    let real = try handles(frames.seed)
    var published: [Data] = []
    var failures: [String] = []
    let sink = RoutedTerminalFrameSink(
      publish: { published.append($0) },
      identityFailed: { _, reason in failures.append(reason) })
    sink.bindActivation(
      session: "s-1", activation: "act-1",
      identity: RoutedTrfIdentity(
        sessionHandle: String(UInt64(real.sessionHandle)! &+ 1), viewHandle: real.viewHandle))

    // The ANSWER is the half K-H1 was about: a full frame this sink refuses
    // must say so, or the client acknowledges a scene the glass never held.
    let applied = sink.applyFullFrame(
      frames.seed, session: "s-1", activation: "act-1", content: stamp(1))

    #expect(applied == false)
    #expect(published.isEmpty)
    #expect(failures.count == 1)
    #expect(failures.first?.contains(real.sessionHandle) == true)
    #expect(sink.rejectedFrames == 1)
    if case .rejectedIdentity = sink.lastOutcome {} else {
      Issue.record("expected an identity rejection, got \(String(describing: sink.lastOutcome))")
    }
  }

  @MainActor
  @Test func theVIEWHandleIsCheckedToo() throws {
    // Both halves of the pair, not just the session: one session takes MULTIPLE
    // views keyed `(view_id, client_id)`, and a frame for another view of the
    // same session is still a frame this activation did not ask for.
    let frames = try LaneFrames.load()
    let real = try handles(frames.seed)
    var published: [Data] = []
    let sink = RoutedTerminalFrameSink(publish: { published.append($0) })
    sink.bindActivation(
      session: "s-1", activation: "act-1",
      identity: RoutedTrfIdentity(
        sessionHandle: real.sessionHandle,
        viewHandle: String(UInt64(real.viewHandle)! &+ 1)))

    let applied = sink.applyFullFrame(
      frames.seed, session: "s-1", activation: "act-1", content: stamp(1))
    #expect(applied == false)
    #expect(published.isEmpty)
    #expect(sink.rejectedFrames == 1)
  }

  @MainActor
  @Test func aDeltaWithAWrongIdentityIsRefusedRatherThanReseeded() throws {
    // The answer matters: `false` means "the sink holds a different scene",
    // which the client repairs with a reseed. A frame that fails the IDENTITY
    // rule must not be reported as a lineage break — the repair for it is not
    // another frame from the same wrong source.
    let frames = try LaneFrames.load()
    var failures: [String] = []
    let sink = RoutedTerminalFrameSink(
      publish: { _ in }, identityFailed: { _, reason in failures.append(reason) })
    sink.bindActivation(
      session: "s-1", activation: "act-1",
      identity: RoutedTrfIdentity(sessionHandle: "999999", viewHandle: "999999"))

    let applied = sink.applyDeltaFrame(
      frames.delta, session: "s-1", activation: "act-1", base: nil, result: stamp(2))
    #expect(applied == false)
    #expect(failures.count == 1)
  }

  @MainActor
  @Test func bytesThatAreNotTRF1NeverReachTheRenderer() throws {
    var published: [Data] = []
    let sink = RoutedTerminalFrameSink(publish: { published.append($0) })
    sink.bindActivation(
      session: "s-1", activation: "act-1",
      identity: RoutedTrfIdentity(sessionHandle: "1", viewHandle: "1"))
    let applied = sink.applyFullFrame(
      Data(repeating: 0x41, count: 128), session: "s-1", activation: "act-1", content: stamp(1))

    // `.undecodable` is the case K-H1 rode in on: the bytes will not parse, the
    // renderer gets nothing, and until TM-r3 the client was told it applied.
    #expect(applied == false)
    #expect(published.isEmpty)
    if case .undecodable = sink.lastOutcome {} else {
      Issue.record("expected an undecodable outcome, got \(String(describing: sink.lastOutcome))")
    }
  }

  @MainActor
  @Test func aDeltaAppliesOnlyOntoTheSceneTheSinkHolds() throws {
    // The rule the client cannot answer: only the sink knows what is on screen.
    let frames = try LaneFrames.load()
    let identity = try handles(frames.seed)
    let sink = RoutedTerminalFrameSink(publish: { _ in })
    sink.bindActivation(session: "s-1", activation: "act-1", identity: identity)
    sink.applyFullFrame(frames.seed, session: "s-1", activation: "act-1", content: stamp(4))

    // A delta whose base is the held scene applies…
    #expect(
      sink.applyDeltaFrame(
        frames.delta, session: "s-1", activation: "act-1", base: stamp(4), result: stamp(5)))
    // …and one whose base is a scene this sink never held does not.
    #expect(
      sink.applyDeltaFrame(
        frames.delta, session: "s-1", activation: "act-1", base: stamp(9), result: stamp(10))
        == false)
    #expect(sink.lastOutcome == .rejectedLineage)
  }

  @MainActor
  @Test func aFrameForASupersededActivationIsSilentlyDiscarded() throws {
    // A replacement is the normal cost of a reconnect, not a fault: the content
    // is dropped (the client already charged its bytes) and nothing is reported.
    let frames = try LaneFrames.load()
    var published: [Data] = []
    var failures: [String] = []
    let sink = RoutedTerminalFrameSink(
      publish: { published.append($0) }, identityFailed: { _, reason in failures.append(reason) })
    sink.bindActivation(
      session: "s-1", activation: "act-2", identity: try handles(frames.seed))
    let applied = sink.applyFullFrame(
      frames.seed, session: "s-1", activation: "act-1", content: stamp(1))

    // `false` here too — but a superseded frame is the ONE refusal the client
    // must not count against its repair bound, which is why the client checks
    // the activation before it counts anything.
    #expect(applied == false)
    #expect(published.isEmpty)
    #expect(failures.isEmpty)
    #expect(sink.rejectedFrames == 0)
  }

  @MainActor
  @Test func aNewActivationDropsTheSceneTheOldOneHeld() throws {
    // A new activation is a new lineage; carrying the old applied stamp across
    // it would let the first delta land on a scene from another attach.
    let frames = try LaneFrames.load()
    let identity = try handles(frames.seed)
    let sink = RoutedTerminalFrameSink(publish: { _ in })
    sink.bindActivation(session: "s-1", activation: "act-1", identity: identity)
    sink.applyFullFrame(frames.seed, session: "s-1", activation: "act-1", content: stamp(7))
    sink.bindActivation(session: "s-1", activation: "act-2", identity: identity)

    // Base 7 was the OLD activation's scene; this sink no longer holds one.
    #expect(
      sink.applyDeltaFrame(
        frames.delta, session: "s-1", activation: "act-2", base: stamp(7), result: stamp(8))
        == false)
  }

  @MainActor
  @Test func anEndedActivationTellsTheHostOnce() throws {
    let frames = try LaneFrames.load()
    var endings: [String] = []
    let sink = RoutedTerminalFrameSink(
      publish: { _ in }, activationEnded: { _, reason in endings.append(reason) })
    sink.bindActivation(
      session: "s-1", activation: "act-1", identity: try handles(frames.seed))
    sink.activationEnded(session: "s-1", activation: "act-1", reason: "leg-dead")
    // A second ending for an activation this sink has already let go says
    // nothing: the card has been told, and repeating it would re-cool a
    // terminal a newer attach may already be painting.
    sink.activationEnded(session: "s-1", activation: "act-1", reason: "leg-dead")

    #expect(endings == ["leg-dead"])
  }
}

/// Two REAL TRF1 frames, verbatim from the repo's own `terminal-perf` corpus —
/// the same lane fixture TM-4's socket witness carries, copied here because a
/// test bundle cannot reach into another one. It is NOT a contracts golden
/// (nothing in `packages/contracts/fixtures` carries a frame), so
/// `check:ios-fixtures` correctly ignores it.
enum LaneFrames {
  static func load() throws -> (seed: Data, delta: Data, provenance: String) {
    guard
      let url = Bundle.module.url(
        forResource: "trf1-frames.lane", withExtension: "json", subdirectory: "Fixtures")
    else { throw Missing() }
    let vector = try JSONValue.parse(try Data(contentsOf: url))
    let seed = try #require(vector["seedFrameBase64"]?.stringValue)
    let delta = try #require(vector["deltaFrameBase64"]?.stringValue)
    let trace = vector["source"]?["trace"]?.stringValue ?? "?"
    let version = vector["source"]?["ghostteaVersion"]?.stringValue ?? "?"
    return (
      try #require(Data(base64Encoded: seed)), try #require(Data(base64Encoded: delta)),
      "\(trace) @ ghosttea \(version)"
    )
  }

  struct Missing: Error, CustomStringConvertible {
    var description: String { "trf1-frames.lane.json is not in the test bundle" }
  }
}
