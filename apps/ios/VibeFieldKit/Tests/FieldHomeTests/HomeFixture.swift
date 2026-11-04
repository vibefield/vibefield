import FieldProduct
import Foundation

// PG-4s — the Godview views' bytes, in THIS bundle (FieldHomeTests' `Fixtures/`): PG-3a's witness, which every view
// suite replays, and the goldens the views are held to. The twin of FieldMeshTests' `MeshFixture`, because a test
// target cannot read another target's bundle (`Tests/FieldMeshTests/RemoteRows.swift:6-7`). It reads FieldProduct
// alone, so a view suite that needs only the bytes runs on the host inner loop too.

enum HomeFixture {
  /// The instant the witness is applied at: the body suite's (`RemoteRows.now`).
  static let now = "2026-11-01T00:00:00.000Z"

  /// `Fixtures/<name>.json`, parsed.
  static func json(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw MissingFixture(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  /// The witness open applied through `RemoteMeshCopy` as FieldLink drives it (open, then publish), and the window's
  /// rows it draws: where every view lane's harness starts (`PhoneBodyParityTests`' path).
  static func witnessRows(now: String = HomeFixture.now) throws -> [RemoteFieldRow] {
    let open = try AgentRemoteMeshOpen(json: try json("agent-remote-mesh-open.witness"))
    var copy = RemoteMeshCopy()
    _ = copy.open(open, now: now)
    _ = copy.publish()
    return copy.drawn()
  }

  struct MissingFixture: Error, CustomStringConvertible {
    let name: String
    var description: String { "fixture `\(name).json` is not in the FieldHomeTests bundle" }
  }
}

// PG-4t — THE WITNESS, STEP BY STEP: what every view lane's harness replays. One `RemoteMeshCopy` driven in PG's
// order (`readWitnessInputs`, phone-goldens.ts): the open, frames 0…7, the whole-mesh resync after frame 7, and frame
// 8, the old chain's delta that is the run's gap — eleven steps, the body golden's count. The rows are the copy's own
// (`publish()`, then `drawn()`), exactly as FieldLink and `PhoneBodyParityTests` drive it. FieldProduct alone, so it
// runs on the host loop.
extension HomeFixture {
  /// The body model's clock: PG's `PHONE_BODY_NOW_MS`, and a still's `-vf-godview-now`.
  static let nowMs: Int64 = 1_790_803_300_000
  /// The whole-mesh resync is delivered after this frame: PG's `PHONE_RESYNC_AFTER`.
  static let resyncAfter = 7

  /// One step of the replay.
  struct WitnessStep: Equatable {
    /// `"open"`, `"0"`…`"7"`, `"resync"`, `"8"`: PG's step labels.
    let at: String
    /// nil at the open; else the delivery's kind, PG's `frameKind`: `"delta"`, `"snapshot"`, `"state"` or `"resync"`.
    let frame: String?
    /// The copy could not follow this delivery: true on the run's last step alone.
    let gap: Bool
    /// The window's drawn rows after this step (`publish()`, then `drawn()`); `[]` at the gap.
    let rows: [RemoteFieldRow]
  }

  /// The witness replayed: every step through the gap. A fault THROWS with its step's label (a trap would end every
  /// suite in the process); a run is never returned short.
  static func witnessSteps(now: String = HomeFixture.now) throws -> [WitnessStep] {
    []
  }

  /// The replay could not go on: at which step, and what the copy answered.
  struct WitnessReplayFault: Error, CustomStringConvertible {
    let step: String
    let what: String
    var description: String { "the witness replay stopped at step \(step): \(what)" }
  }
}
