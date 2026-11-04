import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-4t — THE WITNESS, STEP BY STEP (host + kit): `HomeFixture.witnessSteps()` is PG's replay — its labels, its frame
// kinds, its one gap — and its first step is the rows every view suite already starts from.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4t — the witness, step by step")
struct WitnessStepsTests {
  /// W1 — PG's labels: the open, frames 0…7, the resync, frame 8; eleven steps, the body golden's count.
  @Test func theStepsArePGsLabels() throws {
    let steps = try HomeFixture.witnessSteps()
    let labels = steps.map { $0.at }
    #expect(labels == ["open", "0", "1", "2", "3", "4", "5", "6", "7", "resync", "8"])
    #expect(HomeFixture.resyncAfter == 7)
  }

  /// W2 — the frame is nil at the open alone; each frame step's kind is its decoded frame's case, the resync's is
  /// "resync", and step 8 (the gap) is a delta.
  @Test func eachStepNamesItsDeliverysKind() throws {
    let steps = try HomeFixture.witnessSteps()
    let list = try HomeFixture.json("agent-remote-mesh-frames.witness").arrayValue
    let frames = try (list ?? []).map(AgentRemoteMeshFrame.init(json:))
    #expect(frames.count > 8, "the witness has the gap's frame")
    let kinds = steps.map { $0.frame }
    #expect(kinds.first == .some(nil), "the open delivers no frame")
    #expect(kinds.dropFirst().allSatisfy { $0 != nil }, "every delivery names its kind")
    for step in steps {
      guard let index = Int(step.at), index < frames.count else { continue }
      let expected: String
      switch frames[index] {
      case .delta: expected = "delta"
      case .snapshot: expected = "snapshot"
      case .state: expected = "state"
      }
      #expect(step.frame == expected, "step \(step.at)")
    }
    let resync = steps.first { $0.at == "resync" }
    #expect(resync?.frame == "resync")
    let last = steps.last
    #expect(last?.at == "8")
    #expect(last?.frame == "delta")
  }

  /// W3 — the gap is the run's last step alone, and it draws no rows; every step before it draws the window.
  @Test func theGapIsTheLastStepAndDrawsNothing() throws {
    let steps = try HomeFixture.witnessSteps()
    let gaps = steps.map { $0.gap }
    #expect(gaps.last == true)
    #expect(gaps.dropLast().allSatisfy { !$0 }, "one gap, at the end")
    let last = steps.last
    #expect(last?.rows == [])
    for step in steps.dropLast() {
      #expect(!step.rows.isEmpty, "step \(step.at) draws the window")
    }
  }

  /// W4 — the open's rows are `witnessRows()`, where every view suite starts.
  @Test func theOpenIsWhereEveryViewStarts() throws {
    let steps = try HomeFixture.witnessSteps()
    let open = try #require(steps.first)
    let rows = try HomeFixture.witnessRows()
    #expect(open.at == "open")
    #expect(open.rows == rows)
  }

  /// W5 — the replay's clock and a still's `-vf-godview-now` are one number.
  @Test func theClockIsTheStillsClock() throws {
    let frozen = GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"])
    let ms = try #require(frozen).timeIntervalSince1970 * 1000
    #expect(Int64(ms) == HomeFixture.nowMs)
  }
}
