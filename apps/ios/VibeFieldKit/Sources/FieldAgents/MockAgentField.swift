import Foundation
import Observation
import SwarmPhysics

/// A scripted stand-in for the daemon-side agent feed.
///
/// The real feed arrives when fieldd's agent tracks land and the phone binds
/// `agent.subscribe` over the tailnet; until then this drives the exact same
/// `AgentSnapshot` shape through the exact same classifier, so the home
/// screen is real UI over honest-shaped data — never a special demo path.
/// It is deliberately theatrical: agents spawn, run tools, think, hit
/// permission walls, idle out, and exit, at a pace tuned for watching. Since
/// IOS-6a it also burns tokens along the reference lab's four shapes, wears a
/// model and an effort, replies, and asks questions, so every drawn state of
/// RFC 005 has something honest-shaped to show.
@MainActor
@Observable
public final class MockAgentField {
  public private(set) var agents: [AgentSnapshot] = []

  /// Set for a reproducible fleet (previews/tests); nil = organic each launch.
  private var rng: SplitMix64
  private var ticker: Task<Void, Never>?
  private var spawnCounter = 0
  /// Each agent's burn, by session id: the reference lab's shape and the
  /// cumulative sides.
  private var burns: [String: Burn] = [:]
  private let clock: () -> Date

  /// The tick: the mock's beat, and the interval the burn integrates over.
  private static let tickSeconds = 0.7

  private static let projects = [
    "vibe-field", "truffle", "chopsticks", "ghosttea", "ice", "mille", "spaghetti", "widgetlab",
  ]
  private static let branches = [
    "main", "c6-meshdata", "ios-bootstrap", "d29-settings", "el8-lockstep", nil, nil,
  ]
  private static let models: [AgentProvider: String] = [
    .claude: "Fable 5", .codex: "o5", .grok: "Grok 4", .acp: "ACP",
  ]
  private static let efforts: [AgentProvider: String] = [
    .claude: "high", .codex: "medium", .grok: "low",
  ]
  private static let toolTitles = [
    "Bash", "Edit", "Read", "WebFetch", "pnpm verify", "cargo test", "Grep",
  ]
  private static let permissionTools = ["Bash", "Edit", "Write", "WebFetch", "git push"]
  private static let replies = [
    "Done: the editor now saves on blur and the three failing tests pass.",
    "The lockfile churn was one package; reset and attributed with a control install.",
    "Landed the fix behind the gate; verify is green.",
    "Two findings, both at seams between modules — fixed and pinned.",
    "The probe answered: the door grants the preset from WhoIs, no token needed.",
  ]
  private static let questions = [
    "Which key should the export use, the artist or the album?",
    "Keep the old ledger format for one release, or cut over now?",
  ]

  /// The reference lab's burn shapes (`BURN_SHAPES`): tokens per minute as a
  /// function of the step, with the wobble that keeps them from reading as
  /// sawtooths.
  enum BurnShape: CaseIterable, Sendable {
    case ember, steady, ease, blaze

    func rate(step: Double) -> Double {
      let wobble = { (amount: Double) in 1 + amount * sin(step * 1.7) * cos(step * 0.6) }
      switch self {
      case .ember: return 600 * wobble(0.2)
      case .steady: return 8_000 * wobble(0.12)
      case .ease: return (12_000 - 10_000 * min(1, step / 30)) * wobble(0.1)
      case .blaze: return (step < 28 ? 3_000 : 3_000 + ((step - 28) / 11) * 27_000) * wobble(0.08)
      }
    }
  }

  private struct Burn {
    var shape: BurnShape
    var step: Double = 0
    var total: Double = 0
    var input: Double = 0
    var output: Double = 0
  }

  public init(seed: UInt64? = nil, clock: @escaping () -> Date = { .now }) {
    rng = SplitMix64(seed: seed ?? UInt64.random(in: .min ... .max))
    self.clock = clock
    seedInitialFleet()
  }

  public func start() {
    guard ticker == nil else { return }
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(Int(Self.tickSeconds * 1000)))
        guard let self else { return }
        self.tick()
      }
    }
  }

  public func stop() {
    ticker?.cancel()
    ticker = nil
  }

  /// Long-press-to-create: a fresh session that reports in after a beat.
  @discardableResult
  public func spawn(project: String? = nil) -> String {
    let snapshot = makeAgent(
      project: project ?? Self.projects[random(Self.projects.count)],
      state: nil)
    agents.append(snapshot)
    return snapshot.id
  }

  /// One beat of the script, exposed so a test can drive the fleet without a
  /// timer.
  public func advance() { tick() }

  // MARK: - Script

  private func seedInitialFleet() {
    let now = clock()
    let working = AgentRuntimeState(
      activeTurn: true,
      toolRuns: [AgentToolRun(title: "Bash")],
      contextUsedPercent: 34,
      modelName: "Fable 5",
      branch: "c6-meshdata",
      effort: AgentEffort(value: "high"),
      statusSince: now,
      lastEvidenceAt: now)
    let thinking = AgentRuntimeState(
      activeReasoning: true, contextUsedPercent: 58, modelName: "Fable 5", branch: "main",
      effort: AgentEffort(value: "high"), statusSince: now, lastEvidenceAt: now)
    let blocked = AgentRuntimeState(
      permissions: [AgentPermission(tool: "Bash")],
      contextUsedPercent: 41,
      modelName: "o5",
      branch: "ios-bootstrap",
      effort: AgentEffort(value: "medium"),
      lastAssistantMessage: "May I run pnpm test to check the fix?",
      statusSince: now,
      lastEvidenceAt: now)
    let idle = AgentRuntimeState(
      contextUsedPercent: 12, modelName: "Fable 5", effort: AgentEffort(value: "high"),
      lastAssistantMessage: Self.replies[0], statusSince: now, lastEvidenceAt: now)

    agents = [
      makeAgent(project: "vibe-field", state: working, burn: .steady),
      makeAgent(project: "truffle", state: thinking, burn: .blaze),
      makeAgent(project: "chopsticks", state: blocked, provider: .codex),
      makeAgent(project: "ghosttea", state: idle),
      makeAgent(
        project: "mille",
        state: AgentRuntimeState(
          contextUsedPercent: 7, effort: AgentEffort(value: "low", intent: .configured),
          statusSince: now, lastEvidenceAt: now),
        provider: .grok),
      makeAgent(project: "ice", state: nil),
    ]
  }

  private func makeAgent(
    project: String, state: AgentRuntimeState?, provider: AgentProvider? = nil,
    burn: BurnShape? = nil
  ) -> AgentSnapshot {
    spawnCounter += 1
    let chosenProvider =
      provider
      ?? (random(10) < 6 ? .claude : AgentProvider.allCases[random(AgentProvider.allCases.count)])
    let id = "mock-session-\(spawnCounter)"
    let shape = burn ?? BurnShape.allCases[random(BurnShape.allCases.count)]
    burns[id] = Burn(shape: shape, total: state == nil ? 0 : Double(random(400_000)))
    return AgentSnapshot(
      id: id,
      runtimeSessionID: "mock-runtime-\(spawnCounter)-\(UInt32(truncatingIfNeeded: rng.next()))",
      provider: chosenProvider,
      project: project,
      state: state.map { withUsage($0, id: id) })
  }

  /// The burn's cumulative sides written into the state, as a monitor would
  /// report them: the total, the split, and the last samples.
  private func withUsage(_ state: AgentRuntimeState, id: String) -> AgentRuntimeState {
    guard let burn = burns[id] else { return state }
    var next = state
    var usage = state.usage ?? AgentUsage()
    usage.cumulativeTokens = burn.total
    usage.inputTokens = burn.input
    usage.outputTokens = burn.output
    let sample = AgentUsageSample(
      at: clock(), cumulativeTokens: burn.total, inputTokens: burn.input, outputTokens: burn.output)
    usage.samples = Array((usage.samples + [sample]).suffix(40))
    next.usage = usage
    return next
  }

  private func tick() {
    let now = clock()
    var next: [AgentSnapshot] = []
    for var agent in agents {
      guard var state = agent.state else {
        // Starting sessions report ready shortly after spawn.
        if chance(0.35) {
          agent.state = withUsage(
            AgentRuntimeState(
              activeTurn: true,
              contextUsedPercent: 2,
              modelName: Self.models[agent.provider],
              branch: Self.branches[random(Self.branches.count)],
              effort: Self.efforts[agent.provider].map { AgentEffort(value: $0, intent: .configured) },
              statusSince: now,
              lastEvidenceAt: now),
            id: agent.id)
        }
        next.append(agent)
        continue
      }

      let before = classifyAgentStatus(state)
      switch before {
      case .working:
        state.contextUsedPercent = min(
          97, (state.contextUsedPercent ?? 0) + Double.random(in: 0.2...1.4, using: &rng))
        // Launch intent becomes evidence once the provider has spoken.
        if let effort = state.effort, effort.intent == .configured {
          state.effort = AgentEffort(value: effort.value, intent: .observed)
        }
        if chance(0.18) {
          // Shuffle what the work looks like.
          if chance(0.4) {
            state.toolRuns = [AgentToolRun(title: Self.toolTitles[random(Self.toolTitles.count)])]
            state.activeReasoning = false
          } else if chance(0.5) {
            state.toolRuns = []
            state.activeReasoning = true
            state.activeTurn = true
          } else {
            state.toolRuns = []
            state.activeReasoning = false
            state.activeTurn = true
          }
        }
        if chance(0.045) {
          if chance(0.7) {
            let tool = Self.permissionTools[random(Self.permissionTools.count)]
            state.permissions = [AgentPermission(tool: tool)]
            state.lastAssistantMessage = chance(0.6) ? "May I run \(tool) to check the fix?" : nil
          } else if chance(0.6) {
            state.blockers = [AgentBlocker(kind: .question)]
            state.lastAssistantMessage = Self.questions[random(Self.questions.count)]
          } else {
            state.blockers = [AgentBlocker(kind: .failure, detail: "E_TOOL")]
            state.lastAssistantMessage = nil
          }
        } else if chance(0.07) {
          state.activeTurn = false
          state.activeReasoning = false
          state.toolRuns = []
          state.taskCount = 0
          state.lastAssistantMessage = Self.replies[random(Self.replies.count)]
        }
        // The burn: only a working agent spends.
        if var burn = burns[agent.id] {
          let spent = burn.shape.rate(step: burn.step) * Self.tickSeconds / 60
          let outputShare = 0.18 + 0.12 * sin(burn.step / 2)
          burn.total += spent
          burn.output += spent * outputShare
          burn.input += spent * (1 - outputShare)
          burn.step += Self.tickSeconds / 30
          burns[agent.id] = burn
        }
      case .blocked:
        // Approvals resolve elsewhere (desktop, for now); model that patience.
        if chance(0.06) {
          state.permissions = []
          state.blockers = []
          state.activeTurn = true
        }
      case .idle:
        if chance(0.08) {
          state.activeTurn = true
          state.toolRuns = chance(0.5) ? [AgentToolRun(title: "Read")] : []
        } else if chance(0.015), agents.count > 3 {
          state.lifecycle = .exited
        }
      case nil:
        continue
      }

      state.lastEvidenceAt = now
      if classifyAgentStatus(state) != before { state.statusSince = now }
      agent.state = withUsage(state, id: agent.id)
      if classifyAgentStatus(state) != nil {
        next.append(agent)
      } else {
        burns[agent.id] = nil
      }
    }

    if next.count < 8, chance(0.03) {
      next.append(makeAgent(project: Self.projects[random(Self.projects.count)], state: nil))
    }

    agents = next
  }

  private func chance(_ probability: Double) -> Bool {
    Double.random(in: 0..<1, using: &rng) < probability
  }

  private func random(_ upper: Int) -> Int {
    Int.random(in: 0..<max(1, upper), using: &rng)
  }
}
