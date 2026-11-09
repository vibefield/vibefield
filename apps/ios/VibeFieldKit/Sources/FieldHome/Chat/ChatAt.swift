import FieldProduct
import Foundation

// IOS-12f's M-f2 (PC-L1, one Chat; plan-12f's Q8 A; DESIGN.md §8 "The phone's Chat", the composer) — @'S ROWS IN CHAT,
// the Mac's (`field-app/src/chat/at-rows.ts`) ported: the spark, its profiles and the board's facts in; the two groups
// out, read bottom-up, nearest first. Held to the goldens the Mac's own model writes
// (`Tests/FieldHomeTests/Fixtures/at-rows/`).

/// What a board row says, on either side's wire: the one rule reads these (at-rows-goldens.test.ts, `Facts`).
struct ChatAtRun: Equatable, Sendable {
  let run: String
  let agent: String
  let label: String
  let project: String?
  /// `working`, `idle`, `blocked`, or `unknown` for a run not heard yet.
  let status: String
  let blockers: Int
  let alive: Bool
  let spark: String?
  let originBy: String?
  let originSpark: String?
  let profile: RunProfileFacts
  /// Times in ms; a time that can't be read is 0, as the Mac's `timeOf` has it.
  let createdAt: Double
  let stateChangedAt: Double
  let lastActivityAt: Double?
}

extension ChatAtRun {
  /// The phone's cut of a row (Q3; DESIGN.md §8 "The phone's Chat"): the owner's monitor row says the resolved profile
  /// and no persona, so a retired sign-in reads as its set here, where the Mac's rule offers it nowhere.
  init(remote row: AgentRemoteRow) {
    let monitor = row.monitorRow
    self.init(
      run: row.runtimeRunId, agent: monitor.provider?.id ?? "", label: monitor.provider?.label ?? "",
      project: monitor.project.name.isEmpty ? nil : monitor.project.name,
      status: monitor.observed ? monitor.status.rawValue : "unknown",
      blockers: monitor.wait.map { Int($0.count ?? 1) } ?? 0, alive: monitor.alive, spark: row.spark,
      originBy: row.origin?.by, originSpark: row.origin?.spark, profile: RunProfileFacts(profileSet: monitor.profileSet),
      createdAt: Double(monitor.createdAt), stateChangedAt: Double(monitor.statusSince),
      lastActivityAt: monitor.activity?.since.map { Double($0) })
  }
}

/// What @ reads of a spark.
struct ChatAtSpark: Equatable, Sendable {
  let id: String
  let name: String
  let profiles: [String]
  /// its own session's run
  let run: String?
}

/// Read, being read, or refused (the Mac's `null`, value, `"failed"`).
enum ChatAtReading<Value: Sendable>: Sendable {
  case reading
  case read(Value)
  case failed
}

struct ChatAtProfile: Equatable, Sendable {
  let id: String
  let name: String
}

/// An agent the spark can start, under one of its profiles.
struct ChatAtAgentRow: Equatable, Sendable, Identifiable {
  let id: String
  let agent: String
  let label: String
  let profile: ChatAtProfile
  /// the profile's name, as the row's pill, when the spark has more than one
  let pill: String?
}

/// A session's one word for what it is doing.
enum ChatAtSessionWord: String, Equatable, Sendable {
  case working = "Working"
  case idle = "Idle"
  case needsYou = "Needs you"
}

/// A session running in the spark's profiles that its `agent_send` takes.
struct ChatAtSessionRow: Equatable, Sendable, Identifiable {
  let id: String
  let session: String
  let agent: String
  let label: String
  let handle: String
  let project: String?
  let word: ChatAtSessionWord?
}

/// @'s list, as drawn top to bottom: the agents, then the sessions, the nearest last, against the composer.
struct ChatAtList: Equatable, Sendable {
  var agents: [ChatAtAgentRow] = []
  var sessions: [ChatAtSessionRow] = []
  var reading = false
  var sessionsFailed = false
  var quiet: String? = nil
}

/// @'s words (DESIGN.md §9 "Chat's words"). When its profiles can't be read, it says New spark's own sentence.
enum ChatAtWords {
  static let agents = "Start an agent"
  static let sessions = "Running in its profiles"
  static let reading = "Reading its agents…"
  static let sessionsFailed = "VibeField can't read what's running right now"
  static func none(_ query: String) -> String { "Nothing called \"\(query)\"" }
  static func empty(_ name: String) -> String { "Nothing to add from \(name)'s profiles" }
}

enum ChatAt {
  /// A session's one word: Working, Idle, or Needs you (its run blocked on the person); none for a run not heard yet.
  static func word(_ run: ChatAtRun) -> ChatAtSessionWord? {
    if run.status == "blocked" || run.blockers > 0 { return .needsYou }
    if run.status == "working" { return .working }
    if run.status == "idle" { return .idle }
    return nil
  }

  /// The sessions the spark's `agent_send` takes, by its whole rule: live; in one of its profiles; not its own session;
  /// and the person's own (no spark's own session, started by you) or one this spark started.
  private static func reached(
    _ spark: ChatAtSpark, _ runs: [ChatAtRun], personaSets: [String: String]
  ) -> [ChatAtRun] {
    runs.filter { run in
      guard run.alive, run.run != spark.run else { return false }
      guard let profile = ProfilePlacement.setOf(run.profile, personaSets: personaSets), spark.profiles.contains(profile)
      else { return false }
      let his = run.spark == nil && (run.originBy ?? "you") == "you"
      let started = run.originBy == "spark" && run.originSpark == spark.id
      return his || started
    }
  }

  /// Each session's handle: its name, with the next ordinal for each after the first by its start that shares it,
  /// numbered across every session offered, so a row keeps its handle while the query filters.
  private static func numbered(_ runs: [ChatAtRun]) -> [String: String] {
    let byStart = runs.sorted { a, b in
      if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
      return a.run.compare(b.run, locale: Locale(identifier: "en")) == .orderedAscending
    }
    var handles: [String: String] = [:]
    var seen: [String: Int] = [:]
    for run in byStart {
      let name = run.project ?? run.label
      let count = (seen[name] ?? 0) + 1
      seen[name] = count
      handles[run.run] = count == 1 ? name : "\(name)·\(count)"
    }
    return handles
  }

  /// The sessions `spark`'s agent_send takes and the handles @ gives them: the one place the set is chosen and numbered.
  /// Empty while the profiles or the board are not read, or can't be.
  private static func offered(
    _ spark: ChatAtSpark, board: ChatAtReading<[ChatAtRun]>, sets: ChatAtReading<[AgentProfileSet]>
  ) -> (reached: [ChatAtRun], handles: [String: String]) {
    guard case .read(let runs) = board, case .read(let sets) = sets else { return ([], [:]) }
    let found = reached(spark, runs, personaSets: ProfilePlacement.personaSets(sets))
    return (found, numbered(found))
  }

  /// @'s handles, by run id: the one rule, for every reader that names a session as @ does.
  static func handles(
    spark: ChatAtSpark, board: ChatAtReading<[ChatAtRun]>, sets: ChatAtReading<[AgentProfileSet]>
  ) -> [String: String] {
    offered(spark, board: board, sets: sets).handles
  }

  private static func matches(_ query: String, _ words: String?...) -> Bool {
    if query.isEmpty { return true }
    let needle = query.lowercased()
    return words.contains { $0?.lowercased().contains(needle) == true }
  }

  /// @'s list for the spark's thread. `labels`: each agent's label as the catalog says it, by its id.
  static func list(
    spark: ChatAtSpark, query: String, sets: ChatAtReading<[AgentProfileSet]>, board: ChatAtReading<[ChatAtRun]>,
    labels: [String: String]
  ) -> ChatAtList {
    if case .failed = sets { return ChatAtList(quiet: NewSparkWords.cannotListAgents) }
    var sessionsFailed = false
    if case .failed = board { sessionsFailed = true }
    guard case .read(let readSets) = sets else { return ChatAtList(reading: true, sessionsFailed: sessionsFailed) }
    if case .reading = board { return ChatAtList(reading: true, sessionsFailed: sessionsFailed) }
    let many = spark.profiles.count > 1
    let offeredAgents = readSets.filter { spark.profiles.contains($0.id) }.flatMap { set -> [ChatAtAgentRow] in
      var seen = Set<String>()
      let providers = set.personas.filter { $0.identity?.loggedIn == true }.map { $0.provider }
        .filter { seen.insert($0).inserted }
      return providers.map { provider in
        ChatAtAgentRow(
          id: "agent:\(provider):\(set.id)", agent: provider, label: labels[provider] ?? provider,
          profile: ChatAtProfile(id: set.id, name: set.label), pill: many ? set.label : nil)
      }
    }
    let (reached, handles) = offered(spark, board: board, sets: sets)
    // by the newest activity, ties in the board's order: the nearest last
    let offeredSessions = reached.enumerated().sorted { a, b in
      let left = a.element.lastActivityAt ?? a.element.stateChangedAt
      let right = b.element.lastActivityAt ?? b.element.stateChangedAt
      return left != right ? left < right : a.offset < b.offset
    }.map { _, run in
      ChatAtSessionRow(
        id: "session:\(run.run)", session: run.run, agent: run.agent, label: run.label,
        handle: handles[run.run] ?? run.label, project: run.project, word: word(run))
    }
    let agents = offeredAgents.filter { matches(query, $0.label, $0.pill) }
    let sessions = offeredSessions.filter { matches(query, $0.handle, $0.project, $0.label) }
    let offeredCount = offeredAgents.count + offeredSessions.count
    // without the board what is running is not known, so "nothing to add" is never said then; what follows the @
    // matching none of what is offered is said as ever
    let quiet: String?
    if offeredCount == 0, !sessionsFailed {
      quiet = ChatAtWords.empty(spark.name)
    } else if !query.isEmpty, agents.isEmpty, sessions.isEmpty {
      quiet = ChatAtWords.none(query)
    } else {
      quiet = nil
    }
    return ChatAtList(agents: agents, sessions: sessions, reading: false, sessionsFailed: sessionsFailed, quiet: quiet)
  }
}
