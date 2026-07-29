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
/// permission walls, idle out, and exit, at a pace tuned for watching.
@MainActor
@Observable
public final class MockAgentField {
  public private(set) var agents: [AgentSnapshot] = []

  /// Set for a reproducible fleet (previews/tests); nil = organic each launch.
  private var rng: SplitMix64
  private var ticker: Task<Void, Never>?
  private var spawnCounter = 0

  private static let projects = [
    "vibe-field", "truffle", "chopsticks", "ghosttea", "ice", "mille", "spaghetti", "widgetlab",
  ]
  private static let branches = [
    "main", "c6-meshdata", "ios-bootstrap", "d29-settings", "el8-lockstep", nil, nil,
  ]
  private static let models: [AgentProvider: String] = [
    .claude: "Fable 5", .codex: "o5", .grok: "Grok 4", .acp: "ACP",
  ]
  private static let toolTitles = [
    "Bash", "Edit", "Read", "WebFetch", "pnpm verify", "cargo test", "Grep",
  ]
  private static let permissionTools = ["Bash", "Edit", "Write", "WebFetch", "git push"]

  public init(seed: UInt64? = nil) {
    rng = SplitMix64(seed: seed ?? UInt64.random(in: .min ... .max))
    seedInitialFleet()
  }

  public func start() {
    guard ticker == nil else { return }
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(700))
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

  // MARK: - Script

  private func seedInitialFleet() {
    let working = AgentRuntimeState(
      activeTurn: true,
      toolRuns: [AgentToolRun(title: "Bash")],
      contextUsedPercent: 34,
      modelName: "Fable 5",
      branch: "c6-meshdata")
    let thinking = AgentRuntimeState(
      activeReasoning: true, contextUsedPercent: 58, modelName: "Fable 5", branch: "main")
    let waiting = AgentRuntimeState(
      permissions: [AgentPermission(tool: "Bash")],
      contextUsedPercent: 41,
      modelName: "o5",
      branch: "ios-bootstrap")
    let idle = AgentRuntimeState(contextUsedPercent: 12, modelName: "Fable 5")

    agents = [
      makeAgent(project: "vibe-field", state: working),
      makeAgent(project: "truffle", state: thinking),
      makeAgent(project: "chopsticks", state: waiting, provider: .codex),
      makeAgent(project: "ghosttea", state: idle),
      makeAgent(project: "mille", state: AgentRuntimeState(contextUsedPercent: 7), provider: .grok),
      makeAgent(project: "ice", state: nil),
    ]
  }

  private func makeAgent(
    project: String, state: AgentRuntimeState?, provider: AgentProvider? = nil
  ) -> AgentSnapshot {
    spawnCounter += 1
    let chosenProvider =
      provider
      ?? (random(10) < 6 ? .claude : AgentProvider.allCases[random(AgentProvider.allCases.count)])
    return AgentSnapshot(
      id: "mock-session-\(spawnCounter)",
      runtimeSessionID: "mock-runtime-\(spawnCounter)-\(UInt32(truncatingIfNeeded: rng.next()))",
      provider: chosenProvider,
      project: project,
      state: state)
  }

  private func tick() {
    var next: [AgentSnapshot] = []
    for var agent in agents {
      guard var state = agent.state else {
        // Starting sessions report ready shortly after spawn.
        if chance(0.35) {
          agent.state = AgentRuntimeState(
            activeTurn: true,
            contextUsedPercent: 2,
            modelName: Self.models[agent.provider],
            branch: Self.branches[random(Self.branches.count)])
        }
        next.append(agent)
        continue
      }

      switch classifyAgentStatus(state) {
      case .working:
        state.contextUsedPercent = min(
          97, (state.contextUsedPercent ?? 0) + Double.random(in: 0.2...1.4, using: &rng))
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
          state.permissions = [
            AgentPermission(tool: Self.permissionTools[random(Self.permissionTools.count)])
          ]
        } else if chance(0.07) {
          state.activeTurn = false
          state.activeReasoning = false
          state.toolRuns = []
          state.taskCount = 0
        }
      case .waiting:
        // Approvals resolve elsewhere (desktop, for now); model that patience.
        if chance(0.06) {
          state.permissions = []
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

      agent.state = state
      if classifyAgentStatus(state) != nil { next.append(agent) }
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
