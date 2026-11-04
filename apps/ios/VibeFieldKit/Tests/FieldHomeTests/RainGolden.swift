import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-8 — THE RAIN'S GOLDEN, READ: `phone-rain.golden.json` (field-app's `perf/lib/phone-goldens-rain.ts`, puppeteer-
// views 0.3.3's rain over the window's rows of the witness run), mirrored into this bundle byte for byte
// (`pnpm check:ios-fixtures`); and the witness driven through `RemoteMeshCopy` as FieldLink drives it — the open,
// frames 0…7, PG-1c's resync delivered after frame 7 as an open, then the old chain's delta, the gap — so every step's
// drawn rows are the phone's own (`PhoneBodyParityTests`' path). No value in a parity row is hand-copied.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum RainGolden {
  /// PG-1c — the whole-mesh resync is delivered after this frame (`PHONE_RESYNC_AFTER`).
  static let resyncAfter = 7

  static func load() throws -> JSONValue { try HomeFixture.json("phone-rain.golden") }

  /// The golden's steps, every one.
  static func steps() throws -> [JSONValue] {
    let golden = try load()
    let steps = golden["steps"]?.arrayValue ?? []
    return try #require(steps.isEmpty ? nil : steps, "the rain golden records no steps")
  }

  /// The open's step: where the tokens, the palette, the parameters, the random and the still frame stand.
  static func open() throws -> JSONValue {
    let first = try steps().first ?? .null
    let at = first["at"]?.stringValue
    #expect(at == "open")
    return first
  }

  /// A step's `at` as the golden writes it: `open`, `resync`, or a frame's index.
  static func at(_ step: JSONValue) -> String {
    step["at"].map { $0.stringValue ?? "\($0.intValue ?? -1)" } ?? "?"
  }

  /// One step of the witness run on the phone: its label, and the window's drawn rows (nil at the gap).
  struct WindowStep {
    let at: String
    let rows: [RemoteFieldRow]?
  }

  /// The witness through the phone's copy, step by step, as the golden's steps are cut.
  static func windowSteps() throws -> [WindowStep] {
    let open = try AgentRemoteMeshOpen(json: try HomeFixture.json("agent-remote-mesh-open.witness"))
    let frames = try (HomeFixture.json("agent-remote-mesh-frames.witness").arrayValue ?? [])
      .map(AgentRemoteMeshFrame.init(json:))
    let resync = try AgentRemoteMeshOpen(json: try HomeFixture.json("agent-remote-mesh-open.resync"))
    var copy = RemoteMeshCopy()
    var out: [WindowStep] = []
    _ = copy.open(open, now: HomeFixture.now)
    _ = copy.publish()
    out.append(WindowStep(at: "open", rows: copy.drawn()))
    enum Delivery {
      case frame(Int, AgentRemoteMeshFrame)
      case resync(AgentRemoteMeshOpen)
    }
    var deliveries: [Delivery] = []
    for (index, frame) in frames.enumerated() {
      deliveries.append(.frame(index, frame))
      if index == resyncAfter { deliveries.append(.resync(resync)) }
    }
    for delivery in deliveries {
      let outcome: RemoteMeshCopy.Outcome
      let label: String
      switch delivery {
      case .frame(let index, let frame):
        label = "\(index)"
        outcome = copy.frame(frame, now: HomeFixture.now)
      case .resync(let open):
        label = "resync"
        outcome = copy.open(open, now: HomeFixture.now)
      }
      if case .gap = outcome {
        out.append(WindowStep(at: label, rows: nil))
        break
      }
      _ = copy.publish()
      out.append(WindowStep(at: label, rows: copy.drawn()))
    }
    return out
  }

  /// The golden's steps beside the phone's, paired by `at`; the two runs must agree step for step.
  static func paired() throws -> [(golden: JSONValue, phone: WindowStep)] {
    let golden = try steps()
    let phone = try windowSteps()
    let goldenAts = golden.map(at)
    let phoneAts = phone.map(\.at)
    #expect(goldenAts == phoneAts, "the golden's steps are the witness run's")
    return Array(zip(golden, phone))
  }

  /// The witness open's drawn rows with one row's `monitorRow` edited first: a hand row for a fact the witness lacks,
  /// through the phone's own reading (`AgentRemoteMeshOpen`, `RemoteMeshCopy`), never a hand-built row.
  static func witness(editing id: String, _ edit: (inout [String: JSONValue]) -> Void) throws -> [RemoteFieldRow] {
    let json = edited(try HomeFixture.json("agent-remote-mesh-open.witness"), id: id, edit)
    var copy = RemoteMeshCopy()
    _ = copy.open(try AgentRemoteMeshOpen(json: json), now: HomeFixture.now)
    _ = copy.publish()
    return copy.drawn()
  }

  private static func edited(
    _ value: JSONValue, id: String, _ edit: (inout [String: JSONValue]) -> Void
  ) -> JSONValue {
    switch value {
    case .object(var fields):
      if case .object(var row)? = fields["monitorRow"], row["id"]?.stringValue == id {
        edit(&row)
        fields["monitorRow"] = .object(row)
        return .object(fields)
      }
      for (key, field) in fields { fields[key] = edited(field, id: id, edit) }
      return .object(fields)
    case .array(let items):
      return .array(items.map { edited($0, id: id, edit) })
    default:
      return value
    }
  }

  /// A number the golden carries: JSON's own, or a tag for what JSON cannot hold.
  static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .string("NaN")?: .nan
    case .string("Infinity")?: .infinity
    case .string("-Infinity")?: -.infinity
    case let other?: other.doubleValue
    case nil: nil
    }
  }
}
