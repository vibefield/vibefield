import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-6 — THE WITNESS RUN, STEP BY STEP, AND THE TIMELINE GOLDEN'S READERS. `steps()` is a PRIVATE STAND-IN for PG-4t's
// shared `HomeFixture.witnessSteps` (fd's Q10 ruling, 2026-11-04), of its shape: the open, frames 0…7, PG-1c's resync
// after frame 7, then the old chain's delta at 8, which is the gap; each step's drawn rows as `RemoteMeshCopy` draws
// them, driven exactly as `PhoneBodyParityTests` drives it (FieldMeshTests). It goes when the shared one lands, with no
// output change. `rows(_:ledger:)` joins a step's drawn rows as HomeScreen's `godviewInput` does.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum TimelineWitness {
  /// One step of the run: its `at` as the golden spells it ("open", "resync", or the frame's index), and its rows.
  struct Step {
    let at: String
    let gap: Bool
    let rows: [RemoteFieldRow]
  }

  /// PG-1c: the whole-mesh resync is delivered after this frame (`PHONE_RESYNC_AFTER`).
  static let resyncAfter = 7

  static func steps() throws -> [Step] {
    let open = try AgentRemoteMeshOpen(json: try HomeFixture.json("agent-remote-mesh-open.witness"))
    let frames = try (try HomeFixture.json("agent-remote-mesh-frames.witness").arrayValue ?? [])
      .map(AgentRemoteMeshFrame.init(json:))
    let resync = try AgentRemoteMeshOpen(json: try HomeFixture.json("agent-remote-mesh-open.resync"))
    var copy = RemoteMeshCopy()
    guard copy.open(open, now: HomeFixture.now) == .applied else { throw Unread(what: "the witness open") }
    _ = copy.publish()
    var steps = [Step(at: "open", gap: false, rows: copy.drawn())]
    for (index, frame) in frames.enumerated() {
      let deliveries: [Delivery] = index == resyncAfter ? [.frame(index, frame), .resync] : [.frame(index, frame)]
      for delivery in deliveries {
        let outcome: RemoteMeshCopy.Outcome
        let at: String
        switch delivery {
        case .frame(let index, let frame):
          at = "\(index)"
          outcome = copy.frame(frame, now: HomeFixture.now)
        case .resync:
          at = "resync"
          outcome = copy.open(resync, now: HomeFixture.now)
        }
        if case .gap = outcome {
          steps.append(Step(at: at, gap: true, rows: []))
          return steps
        }
        guard outcome == .applied else { throw Unread(what: "step \(at): \(outcome)") }
        _ = copy.publish()
        steps.append(Step(at: at, gap: false, rows: copy.drawn()))
      }
    }
    return steps
  }

  private enum Delivery {
    case frame(Int, AgentRemoteMeshFrame)
    case resync
  }

  /// The timeline's rows for one step, joined as HomeScreen's `godviewInput` joins them: the swarm's own unread (its
  /// bubbles', `GodviewStageInput.unreadIds`) and the ledger's colour (`GodviewStageInput.colour`), the ledger dealt
  /// over the step's drawn agents in order as `FieldBubble.swift:331` deals; no open card, so nothing active.
  static func rows(_ drawn: [RemoteFieldRow], ledger: inout ProjectLedger) -> [TimelineRow] {
    let bubbles = drawn.map { fieldBubble(from: $0, fieldIsLive: true, catalog: .empty, suppressUnread: false) }
    let unread = GodviewStageInput.unreadIds(bubbles: bubbles)
    ledger = ledger.dealing(
      drawn.filter { $0.row.monitor.kind == .agent }.map { MonitorWords.projectName($0.row.monitor) })
    let projects = ledger
    return drawn.map {
      TimelineRow(
        $0, unread: unread.contains($0.id),
        colour: GodviewStageInput.colour(of: $0, projects: projects, tint: .light), active: false)
    }
  }

  /// Every step's lanes at the golden's clock, beside the golden's step.
  static func walk(_ visit: (_ golden: JSONValue, _ set: TimelineLaneSet, _ step: Step) throws -> Void) throws {
    let golden = try TimelineGolden.load()
    let goldenSteps = golden["steps"]?.arrayValue ?? []
    let mine = try steps()
    let goldenCount = goldenSteps.count
    let mineCount = mine.count
    #expect(goldenCount == mineCount, "the run's steps")
    var ledger = ProjectLedger.empty
    for (step, goldenStep) in zip(mine, goldenSteps) {
      let at = TimelineGolden.at(goldenStep["at"])
      #expect(at == step.at, "the golden's step \(step.at)")
      let isGap = goldenStep["gap"]?.boolValue ?? false
      #expect(isGap == step.gap, "step \(step.at): the gap")
      if step.gap { continue }
      let set = TimelineLanes.lanes(rows(step.rows, ledger: &ledger), nowMs: TimelineGolden.nowMs)
      try visit(goldenStep, set, step)
    }
  }

  struct Unread: Error, CustomStringConvertible {
    let what: String
    var description: String { "the witness did not read: \(what)" }
  }
}

/// `phone-timeline.golden.json`, mirrored into this bundle byte for byte (pnpm check:ios-fixtures).
enum TimelineGolden {
  /// `PHONE_BODY_NOW_MS`: the golden's clock.
  static let nowMs = 1_790_803_300_000.0

  static func load() throws -> JSONValue { try HomeFixture.json("phone-timeline.golden") }

  /// The open step, which carries the fixed vectors.
  static func open() throws -> JSONValue {
    let first = try load()["steps"]?.arrayValue?.first
    return try #require(first, "the timeline golden has no open step")
  }

  /// The entries of one of the open step's vectors.
  static func entries(_ name: String) throws -> [JSONValue] {
    let entries = try open()[name]?.arrayValue ?? []
    return try #require(entries.isEmpty ? nil : entries, "the timeline golden records no \(name)")
  }

  /// A step's `at`, as a string.
  static func at(_ value: JSONValue?) -> String {
    if let text = value?.stringValue { return text }
    return value?.intValue.map { "\($0)" } ?? "?"
  }

  /// A number the golden carries: JSON's own, or a tag for what JSON cannot hold; nil is `null`.
  static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .string("NaN")?: .nan
    case .string("Infinity")?: .infinity
    case .string("-Infinity")?: -.infinity
    case .null?, nil: nil
    case let other?: other.doubleValue
    }
  }

  /// A recorded string, `null` as nil.
  static func text(_ value: JSONValue?) -> String? {
    guard let value, !value.isNull else { return nil }
    return value.stringValue
  }
}
