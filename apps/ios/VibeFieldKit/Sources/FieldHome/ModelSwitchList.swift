import FieldAgents
import FieldDesign
import FieldProduct
import SwiftUI

/// PF-3 (2026-11-21; DESIGN.md §8 "The phone's live card is its terminal", "The capsule is the switch") — the live
/// card's road to a running run's model switch: two asks of the desktop that owns the run. The card knows no agent's
/// command and no vendor's list: the list is the agent's own, as that desktop reads it, and the change is made by the
/// run's adapter there.
struct ModelSwitchDoor {
  /// What the run's row offers (`AgentFacet.modelSwitch`): a door exists only for a run that offers a switch.
  let offer: AgentModelSwitch
  /// The agent's own picker on the run's desktop (`agent.models`).
  let models: () async throws -> AgentModelsResult
  /// One change asked of the run (`agent.switchModel`).
  let ask: (AgentSwitchModelChange) async throws -> AgentSwitchModelResult
  /// The desktop's name, for the line that says it could not be reached.
  let desktop: String
  /// DEBUG's `-vf-demo-model-switch`: the list opens by itself two seconds in, since a screenshot cannot touch the
  /// capsule. false on every real door.
  var opensByItself = false
  /// DEBUG's `-vf-demo-model-switch=refused`: the owner's word the list stands on as its first refusal. nil on every
  /// real door.
  var standingRefusal: String? = nil
}

#if DEBUG
  /// `-vf-demo-model-switch[=refused]` (PF-3) — a FIXTURE door for the open card's capsule, for looking at the switch
  /// list's own pixels with no desktop: an offer no row made, three invented models and their effort values, and an
  /// ask that answers `sent` after a beat. With `=refused` the list stands on the owner's `working`. It reaches no
  /// daemon and changes no agent, and it cannot run in a build that reads no launch arguments. Its answer names the
  /// provider of the card it stands on, as the real door's does: the fixture names no agent of its own (wall R23b;
  /// mended 2026-11-22, where it had written one agent's id twice).
  enum ModelSwitchDemo {
    static let argument = "-vf-demo-model-switch"

    static func door(_ arguments: [String], provider: String) -> ModelSwitchDoor? {
      guard let named = arguments.first(where: { $0 == argument || $0.hasPrefix(argument + "=") }) else { return nil }
      let answer = catalog(provider)
      return ModelSwitchDoor(
        offer: AgentModelSwitch(model: true, controls: ["effort"], persistence: "default"),
        models: {
          try await Task.sleep(for: .milliseconds(300))
          return try AgentModelsResult(json: answer)
        },
        ask: { _ in
          try await Task.sleep(for: .milliseconds(400))
          return try AgentSwitchModelResult(json: .object(["status": .string("sent")]))
        },
        desktop: "Studio", opensByItself: true,
        standingRefusal: named.hasSuffix("=refused") ? "working" : nil)
    }

    private static func effort(_ values: [String]) -> JSONValue {
      .object([
        "id": .string("effort"), "label": .string("Effort"), "role": .string("effort"),
        "values": .array(values.map { .object(["id": .string($0), "label": .string($0.capitalized)]) }),
      ])
    }

    private static func model(_ id: String, _ label: String, _ efforts: [String]) -> JSONValue {
      .object([
        "id": .string(id), "label": .string(label),
        "controls": .array(efforts.isEmpty ? [] : [effort(efforts)]),
      ])
    }

    private static func catalog(_ provider: String) -> JSONValue {
      .object([
        "provider": .string(provider), "refreshing": .bool(false),
        "catalog": .object([
          "provider": .string(provider), "cwd": .string(""), "observedAt": .string("2026-11-21T00:00:00.000Z"),
          "source": .object(["kind": .string("fixture"), "freshness": .string("fresh")]),
          "completeness": .string("complete"), "customModels": .bool(false),
          "models": .array([
            model("opus", "Opus 5.5", ["low", "medium", "high", "max"]),
            model("sonnet", "Sonnet 5.5", ["low", "medium", "high"]),
            model("haiku", "Haiku 5.5", []),
          ]),
        ]),
      ])
    }
  }
#endif

/// PF-3 — what the switch list reads and says, kept pure so its rows are tested without a view.
enum ModelSwitch {
  /// How long the capsule draws an asked word before the row's own word stands again.
  static let askedFor: Duration = .seconds(30)

  static let reading = "Reading its models…"
  static let unread = "Couldn't read its models."

  /// A refusal in the phone's words. `working` and `blocked` are the owner's words for a run that is not idle; any
  /// other reason is said as the owner said it.
  static func refusal(_ reason: String) -> String {
    switch reason {
    case "working": return "It's mid-turn. Ask again when it's idle."
    case "blocked": return "It's waiting on an answer. Ask again after."
    default:
      let word = reason.hasSuffix(".") ? String(reason.dropLast()) : reason
      return "It couldn't take that: \(word)."
    }
  }

  static func unreachable(_ desktop: String) -> String { "Couldn't reach \(desktop)." }

  static func keeps(_ agent: String) -> String { "\(agent) keeps this for its new sessions too." }

  /// PF-12 (2026-11-22) — what a readout capsule says when it is pressed: the row offers no switch. The phone cannot
  /// tell why (the agent's adapter names none, its turns are not read, or its desktop is older than the switch), so
  /// the line says only that. `agent` is the catalog's name for it, empty where it names none.
  static func noSwitch(_ agent: String) -> String {
    agent.isEmpty ? "This agent's model can't be changed from here." : "\(agent)'s model can't be changed from here."
  }

  /// The listed model that serves the run: the one whose id or label is the readout's model word. nil where the
  /// serving model is not in the list, and then no row is checked.
  static func serving(_ models: [AgentModelChoice], model word: String) -> AgentModelChoice? {
    let word = word.lowercased()
    return models.first { $0.id.lowercased() == word || $0.label.lowercased() == word }
  }

  /// The effort control the list draws: the serving model's own; with no serving model, the one every listed model
  /// offers with the same values, else none.
  static func effortControl(_ models: [AgentModelChoice], serving: AgentModelChoice?) -> AgentModelControl? {
    if let serving { return serving.effort }
    guard let first = models.first?.effort else { return nil }
    let values = first.values.map(\.id)
    let shared = models.allSatisfy { $0.effort?.id == first.id && $0.effort?.values.map(\.id) == values }
    return shared ? first : nil
  }

  /// A change that was sent and that the row has not confirmed: the word the capsule draws in its place, and the
  /// readout's own words when it was asked, so the first change of either clears it.
  struct Asked: Equatable {
    enum Part: Equatable { case model, effort }
    let part: Part
    let word: String
    let model: String
    let effort: String?

    /// The row has said something new since the ask: the row's word is the confirmation.
    func settled(by readout: FieldHomeModel.LiveCardReadout) -> Bool {
      readout.model != model || readout.effort != effort
    }
  }
}

/// PF-12 (2026-11-22; DESIGN.md §8, "The capsule is the switch") — a readout capsule's one line, in the list's own
/// line type and on its glass: why a press changes nothing.
struct ModelSwitchWhy: View {
  let words: String

  var body: some View {
    Text(words)
      .font(.system(size: 15))
      .foregroundStyle(FieldPalette.textMain.opacity(0.66))
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, 12)
      .frame(minHeight: 44, alignment: .leading)
      .padding(4)
      .frame(maxWidth: 280, alignment: .leading)
  }
}

/// The switch list (DESIGN.md §8, "The capsule is the switch"): the agent's own models, the serving model's effort
/// values, a refusal as its foot line, and whether the agent keeps a change as its default.
struct ModelSwitchList: View {
  let door: ModelSwitchDoor
  let readout: FieldHomeModel.LiveCardReadout
  let agentName: String
  let onSent: (ModelSwitch.Asked) -> Void

  private enum Load: Equatable {
    case reading
    case read([AgentModelChoice])
    case failed(String)
  }

  @State private var load: Load = .reading
  @State private var refusal: String?
  @State private var asking = false

  private var models: [AgentModelChoice] {
    if case .read(let models) = load { return models }
    return []
  }
  private var serving: AgentModelChoice? { ModelSwitch.serving(models, model: readout.model) }
  private var offer: AgentModelSwitch { door.offer }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      switch load {
      case .reading: line(ModelSwitch.reading)
      case .failed(let words): line(words)
      case .read(let models):
        if offer.model {
          caption("Model")
          ForEach(models) { model in modelRow(model) }
        }
        if offer.effort, let control = ModelSwitch.effortControl(models, serving: serving) {
          caption("Effort")
          effortRow(control)
        }
      }
      if let refusal {
        Text(refusal)
          .font(.system(size: 13))
          .foregroundStyle(ChromePalette.attention)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
      }
      if offer.savesDefault {
        Text(ModelSwitch.keeps(agentName))
          .font(.system(size: 12))
          .foregroundStyle(FieldPalette.textMain.opacity(0.5))
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
      }
    }
    .padding(4)
    .frame(width: 280, alignment: .leading)
    .disabled(asking)
    .task {
      if let standing = door.standingRefusal { refusal = ModelSwitch.refusal(standing) }
      do {
        let result = try await door.models()
        if let catalog = result.catalog, !catalog.models.isEmpty {
          load = .read(catalog.models)
        } else {
          let said = result.failure?.message ?? ""
          load = .failed(said.isEmpty ? ModelSwitch.unread : said)
        }
      } catch {
        load = .failed(ModelSwitch.unreachable(door.desktop))
      }
    }
  }

  private func caption(_ words: String) -> some View {
    Text(words)
      .font(.system(size: 12, weight: .medium))
      .foregroundStyle(FieldPalette.textMain.opacity(0.5))
      .padding(.horizontal, 12)
      .padding(.top, 10)
      .padding(.bottom, 4)
      .accessibilityAddTraits(.isHeader)
  }

  private func line(_ words: String) -> some View {
    Text(words)
      .font(.system(size: 15))
      .foregroundStyle(FieldPalette.textMain.opacity(0.66))
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, 12)
      .frame(minHeight: 44, alignment: .leading)
  }

  private func modelRow(_ model: AgentModelChoice) -> some View {
    let isServing = model.id == serving?.id
    return Button {
      ask(.model(id: model.id), part: .model, word: model.label.lowercased())
    } label: {
      HStack(spacing: 8) {
        Text(model.label)
          .font(.system(size: 15))
          .lineLimit(1)
        Spacer(minLength: 0)
        if isServing {
          Image(systemName: "checkmark")
            .font(.system(size: 13, weight: .semibold))
        }
      }
      .foregroundStyle(FieldPalette.textMain)
      .padding(.horizontal, 12)
      .frame(height: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(isServing ? .isSelected : [])
  }

  private func effortRow(_ control: AgentModelControl) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(control.values) { value in
          let isServing = value.id.lowercased() == readout.effort
          Button {
            ask(.control(id: control.id, value: value.id), part: .effort, word: value.id.lowercased())
          } label: {
            Text(value.label)
              .font(.system(size: 14, weight: .medium))
              .lineLimit(1)
              .foregroundStyle(isServing ? FieldPalette.panelBackground : FieldPalette.textMain)
              .padding(.horizontal, 12)
              .frame(height: 32)
              .background(
                Capsule().fill(isServing ? FieldPalette.textMain : FieldPalette.textMain.opacity(0.1)))
          }
          .buttonStyle(.plain)
          // a touch target of 44 around a 32 capsule
          .frame(height: 44)
          .accessibilityAddTraits(isServing ? .isSelected : [])
        }
      }
      .padding(.horizontal, 12)
    }
  }

  private func ask(_ change: AgentSwitchModelChange, part: ModelSwitch.Asked.Part, word: String) {
    guard !asking else { return }
    asking = true
    refusal = nil
    Task {
      defer { asking = false }
      do {
        let answer = try await door.ask(change)
        if answer.sent {
          onSent(ModelSwitch.Asked(part: part, word: word, model: readout.model, effort: readout.effort))
        } else {
          refusal = ModelSwitch.refusal(answer.reason ?? "")
        }
      } catch {
        refusal = ModelSwitch.unreachable(door.desktop)
      }
    }
  }
}
