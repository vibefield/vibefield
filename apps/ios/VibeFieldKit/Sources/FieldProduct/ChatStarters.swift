import Foundation

// MARK: - The starters, filled from the home (track ES, ES-5a)
//
// The port of field-app's `starters.ts` (DESIGN.md §8 "Chat's list", the jobs, "Filled from this Mac"; ES-D4 A; ES-Q1),
// held to the Mac's own golden (`ChatStartersGoldenTests`). Pure: the home's agents and live runs in, the hello's three
// starters, their slots filled, out.
// - The crew is an agent the home has that can be started: the ruled one where it has it, else the catalog's first.
// - The project is the busiest folder among the live runs, by its name; a tie goes to the one worked in last.
// - The handle is the live run, no spark's own, worked in last, named by its agent and its place among that agent's live
//   runs. The reviewer is an agent the home has, the ruled one first, another than the run's own where there is one.
// - An agent slot with nothing to fill keeps its ruled word. A project or a run with nothing to fill drops out and the
//   starter reads bare (ES-Q1, James 2026-11-09). A read that cannot be had counts as nothing to fill.
// - Which agent a ruled word names is the catalog's to say (`starterAgent`), so no agent id is a literal here (R23b).
// - The home's agents fill them (E2, VF-PM 2026-11-09), by the rule that puts the phone's profiles on the home alone.

public enum ChatStarters {
  /// One agent as the rule reads it.
  public struct Agent: Sendable, Equatable {
    public let id: String
    public let label: String
    public let available: Bool
    public let canSpawn: Bool

    public init(id: String, label: String, available: Bool, canSpawn: Bool) {
      self.id = id
      self.label = label
      self.available = available
      self.canSpawn = canSpawn
    }
  }

  /// One board run as the rule reads it.
  public struct Run: Sendable, Equatable {
    public let runtimeRunId: String
    public let kind: String
    public let alive: Bool
    /// The spark this is the own run of.
    public let spark: String?
    /// Its folder's name.
    public let project: String?
    public let createdMs: Int64
    /// When the run was worked in last, as near as this side can say (`run(_:)`).
    public let workedMs: Int64

    public init(
      runtimeRunId: String, kind: String, alive: Bool, spark: String?, project: String?, createdMs: Int64,
      workedMs: Int64
    ) {
      self.runtimeRunId = runtimeRunId
      self.kind = kind
      self.alive = alive
      self.spark = spark
      self.project = project
      self.createdMs = createdMs
      self.workedMs = workedMs
    }
  }

  /// A read in: still out, failed, or its rows.
  public enum Read<Row: Sendable & Equatable>: Sendable, Equatable {
    case out
    case failed
    case rows([Row])
  }

  /// The starters: held in their places, wordless, while a read is out; then read.
  public enum Reading: Sendable, Equatable {
    case reading([ChatStarter])
    case read([ChatStarter])

    public var isHeld: Bool {
      if case .reading = self { return true }
      return false
    }

    public var starters: [ChatStarter] {
      switch self {
      case .reading(let starters), .read(let starters): starters
      }
    }
  }

  /// The starters, filled from what the home has, or held while it is read.
  public static func of(agents: Read<Agent>, runs: Read<Run>, catalog: AgentCatalogResult) -> Reading {
    // the agents the home has that can be started, in the catalog's order; nil where they could not be read
    let here: [Agent]?
    switch agents {
    case .out: return .reading(ChatFlowWords.starters)
    case .failed: here = nil
    case .rows(let rows): here = startable(rows, catalog: catalog)
    }
    // the person's live runs: never a spark's own, never one that has ended
    let live: [Run]
    switch runs {
    case .out: return .reading(ChatFlowWords.starters)
    case .failed: live = []
    case .rows(let rows): live = rows.filter { $0.alive && $0.spark == nil }
    }

    let ruledCrew = catalog.starterAgent(.crew)
    let ruledReviewer = catalog.starterAgent(.reviewer)

    var crew = ruledCrew?.label
    if let here, let first = here.first {
      crew = (here.first { $0.id == ruledCrew?.id } ?? first).label
    }

    // worked in last; a tie goes to the greater id
    let last = live.max { ($0.workedMs, $0.runtimeRunId) < ($1.workedMs, $1.runtimeRunId) }
    let runAgent = last?.kind ?? catalog.starterAgent(.handle)?.puppeteerProvider
    let handle = last.map { handleOf($0, live: live) }

    var reviewer = ruledReviewer?.label
    if let here, let first = here.first {
      let ruled = here.first { $0.id == ruledReviewer?.id }
      let other = here.first { $0.id != runAgent }
      if let ruled, ruled.id != runAgent {
        reviewer = ruled.label
      } else {
        reviewer = (other ?? ruled ?? first).label
      }
    }

    // a role no catalog row holds keeps the hello's whole ruled sentence
    let ruled = ChatFlowWords.starters
    return .read([
      ChatStarter(glyph: .agents, words: crew.map(crewWords) ?? ruled[0].words),
      ChatStarter(glyph: .panes, words: folderWords(busiestFolder(live))),
      ChatStarter(glyph: .duplicate, words: reviewer.map { reviewWords($0, run: handle) } ?? ruled[2].words),
    ])
  }

  // MARK: - The phone's rows, as the rule's fields

  /// One of the home's rows as a run, nil for a bare terminal, which is no agent's run. `workedMs` is
  /// `activity?.since ?? statusSince`; it is the remote row's nearest to last evidence, not equal to it; a
  /// `lastActivityAt` on the monitor row is a contracts widening, not this slice's (VF-PM 2026-11-09 08:27:37Z).
  public static func run(_ row: AgentRemoteRow) -> Run? {
    let monitor = row.monitorRow
    guard let kind = monitor.provider?.id else { return nil }
    return Run(
      runtimeRunId: row.runtimeRunId, kind: kind, alive: monitor.alive, spark: row.spark, project: monitor.project.name,
      createdMs: monitor.createdAt, workedMs: monitor.activity?.since ?? monitor.statusSince)
  }

  /// The home's rows, as runs. None until the home is known.
  public static func runs(_ rows: [AgentRemoteRow], home: String?) -> [Run] {
    guard let home else { return [] }
    return rows.filter { $0.device == home }.compactMap(run)
  }

  /// `agent.providers` joined to the catalog: the phone's summary has no `offers.spawn`, the catalog's `canSpawn` does.
  public static func agents(_ providers: [AgentProviderSummary], catalog: AgentCatalogResult) -> [Agent] {
    let spawns = Dictionary(catalog.catalog.map { ($0.id, $0.canSpawn) }, uniquingKeysWith: { first, _ in first })
    return providers.map {
      Agent(id: $0.id, label: $0.label, available: $0.available, canSpawn: spawns[$0.id] == true)
    }
  }

  // MARK: - The rule

  private static func crewWords(_ agent: String) -> String { "Spawn 4 \(agent) agents to research a topic each" }

  private static func folderWords(_ folder: String?) -> String {
    guard let folder else { return "Keep track of my agents" }
    return "Keep track of my agents in \(folder)"
  }

  private static func reviewWords(_ reviewer: String, run: String?) -> String {
    let whose = run.map { "\($0)'s" } ?? "my agents'"
    return "Have \(reviewer) review \(whose) work until it's clean"
  }

  private static func startable(_ agents: [Agent], catalog: AgentCatalogResult) -> [Agent] {
    let rows = catalog.catalog
    func place(_ agent: Agent) -> Int { rows.firstIndex { $0.id == agent.id } ?? rows.count }
    // the place, then the order they came in: `sorted` does not promise to be stable
    let ordered = agents.filter { $0.available && $0.canSpawn }.enumerated().sorted { a, b in
      let (left, right) = (place(a.element), place(b.element))
      return left == right ? a.offset < b.offset : left < right
    }
    return ordered.map { $0.element }
  }

  /// The folder most live runs stand in, by its name; a tie goes to the one worked in last, then the one seen first.
  /// None, where no live run names its folder.
  private static func busiestFolder(_ live: [Run]) -> String? {
    var folders: [(name: String, runs: Int, last: Int64)] = []
    for run in live {
      guard let name = run.project, !name.isEmpty else { continue }
      if let at = folders.firstIndex(where: { $0.name == name }) {
        folders[at].runs += 1
        folders[at].last = max(folders[at].last, run.workedMs)
      } else {
        folders.append((name, 1, run.workedMs))
      }
    }
    var best: (name: String, runs: Int, last: Int64)?
    for folder in folders {
      guard let current = best else {
        best = folder
        continue
      }
      if folder.runs > current.runs || (folder.runs == current.runs && folder.last > current.last) { best = folder }
    }
    return best?.name
  }

  /// A run's handle: its agent, and its place among that agent's live runs by their start (`claude`, `claude·2`).
  private static func handleOf(_ run: Run, live: [Run]) -> String {
    let mates = live.filter { $0.kind == run.kind }
      .sorted { ($0.createdMs, $0.runtimeRunId) < ($1.createdMs, $1.runtimeRunId) }
    let place = (mates.firstIndex { $0.runtimeRunId == run.runtimeRunId } ?? 0) + 1
    return place <= 1 ? run.kind : "\(run.kind)·\(place)"
  }
}
