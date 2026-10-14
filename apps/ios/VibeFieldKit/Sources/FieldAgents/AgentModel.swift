import Foundation

/// An agent, by the id the runtime and VibeField's catalog both call it: the
/// catalog id, which is puppeteer's provider id verbatim (AC-D2).
///
/// OPEN, and that is the contract's own shape: `AgentProviderId` in
/// `packages/contracts/src/agent-index.ts` is a validated STRING, not an enum,
/// and it stays one on every wire (the catalog's R4). A closed enum here made an
/// unfamiliar provider unrepresentable, which cost the field a whole agent: the
/// row could not be folded, so nobody could see it.
///
/// **It names no agent (AC-5, 2026-09-22).** The four statics that stood here,
/// the `known` roster, the `displayName` switch and the three-vendor
/// `hasDrawnMark` were a fourth list of agents beside puppeteer's, rosetta's
/// and the catalog — and the statics let a branch on a vendor live in another
/// file where no literal lint could see it (`ReplyChips.swift` did). What an
/// agent is CALLED is the desktop's catalog's, over the wire (`AgentCatalog`,
/// AC-D9); what it WEARS is the build-time asset tables' (`MarksAtlas`, the
/// card's glyph catalog), keyed by catalog id; and an id neither knows is
/// carried and drawn as its raw id and its letter (R4).
public struct AgentProvider: RawRepresentable, Sendable, Hashable, Codable {
  public let rawValue: String

  /// Non-failable on purpose: every string is a provider this build must be
  /// able to carry, whether or not it can draw a mark for it.
  public init(rawValue: String) { self.rawValue = rawValue }

  /// The LETTER a mark key wears when no drawn mark exists — the reference's
  /// rule (`AgentIcon.tsx`'s `agentMark`): the id's first character
  /// uppercased, else `?` for an id with no characters at all.
  ///
  /// The reference also lists `acp → A` as an explicit override. That is the
  /// letter the rule gives anyway, so the override was a vendor literal buying
  /// nothing, and it went with the statics (AC-5, R23b).
  ///
  /// It lives here rather than in the renderer because BOTH surfaces draw it:
  /// the swarm's Metal watermark and the card's SwiftUI glyph, which must not
  /// disagree about what an agent is called.
  public var markLetter: String {
    rawValue.first.map { String($0).uppercased() } ?? "?"
  }
}

/// Session lifecycle vocabulary (the runtime's `state.lifecycle` subset the
/// field consumes: anything not `ready` renders as working; `exited` and
/// `failed` leave the field).
public enum AgentLifecycle: String, Sendable, Codable {
  case starting
  case ready
  case exited
  case failed
}

/// A pending permission request — the blocker of kind `permission`, kept as
/// its own list because the card's reply chips are derived from it (K-D4).
public struct AgentPermission: Sendable, Equatable, Codable {
  public var tool: String?
  public init(tool: String? = nil) { self.tool = tool }
}

/// Why an agent is blocked, in the monitor's three words. A permission is
/// carried by `AgentRuntimeState.permissions`; the other two kinds ride
/// `blockers`, in the order the monitor listed them.
public enum AgentBlockerKind: String, Sendable, Codable {
  case permission
  case question
  case failure
}

public struct AgentBlocker: Sendable, Equatable, Codable {
  public var kind: AgentBlockerKind
  /// An adapter's human-readable line for the blocker: what the body says first.
  public var detail: String?
  /// A question blocker's question as asked (the first question's header, else
  /// its prompt). fieldd's row does not carry it yet; the mock and a later door do.
  public var question: String?
  /// The tool a permission names — the one piece of evidence `field.agents.v1`
  /// flattens onto the row today.
  public var tool: String?
  /// A failure's code.
  public var code: String?

  public init(
    kind: AgentBlockerKind, detail: String? = nil, question: String? = nil, tool: String? = nil,
    code: String? = nil
  ) {
    self.kind = kind
    self.detail = detail
    self.question = question
    self.tool = tool
    self.code = code
  }
}

/// Whether an effort value is provider evidence or only launch intent — the
/// body sets launch intent in italics so a reading never mistakes it for
/// evidence. An older producer that omits the intent is read as observed.
public enum AgentEffortIntent: String, Sendable, Codable {
  case configured
  case observed
}

public struct AgentEffort: Sendable, Equatable, Codable {
  public var value: String
  public var intent: AgentEffortIntent
  public init(value: String, intent: AgentEffortIntent = .observed) {
    self.value = value
    self.intent = intent
  }
}

/// One cumulative usage sample (the monitor's `MonitorUsageSample`).
public struct AgentUsageSample: Sendable, Equatable, Codable {
  public var at: Date
  public var cumulativeTokens: Double
  /// Cumulative prompt-side tokens (input, cache reads, cache creation) when the source splits usage.
  public var inputTokens: Double?
  /// Cumulative completion-side tokens (output, reasoning) when the source splits usage.
  public var outputTokens: Double?

  public init(at: Date, cumulativeTokens: Double, inputTokens: Double? = nil, outputTokens: Double? = nil) {
    self.at = at
    self.cumulativeTokens = cumulativeTokens
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
  }
}

/// How much of a run's work Core could price (RFC 008). `unavailable` is a
/// MISSING pricing lane, never a zero-dollar claim; the ladder is drawn unread.
public enum AgentCostCoverage: String, Sendable, Codable {
  case complete
  case partial
  case unavailable
}

/// Corrected spend in one of Core's fixed thirty-second buckets
/// (`MonitorCostBucket`), including the current bucket.
public struct AgentCostBucket: Sendable, Equatable, Codable {
  public var at: Date
  public var costUsd: Double
  public init(at: Date, costUsd: Double) {
    self.at = at
    self.costUsd = costUsd
  }
}

/// Core's usage for a run, in the mirror's own field names (`MonitorUsageState`):
/// a corrected estimate that every source moves. The field never reads the
/// tokens directly — `UsageLedger` folds the USD into the number the screen
/// stands behind, and the body reads the live rate for the burn ladder.
///
/// The cost fields are decoded tolerantly (D-i18): `field.agents.v1` does not
/// carry them yet and VibeField's puppeteer pin predates RFC 008, so on today's
/// wire they are absent and the body reads `unavailable` — one hollow flame.
public struct AgentUsage: Sendable, Equatable, Codable {
  public var cumulativeTokens: Double?
  public var inputTokens: Double?
  public var outputTokens: Double?
  public var cacheReadTokens: Double?
  public var cacheCreationTokens: Double?
  public var reasoningTokens: Double?
  public var samples: [AgentUsageSample]
  /// Estimated API-equivalent USD for the observed work of this run.
  public var costUsd: Double?
  public var costCoverage: AgentCostCoverage?
  /// Core's own live projection over its rate-eligible window — never a
  /// difference of UI snapshots.
  public var costRatePerMin: Double?
  /// Corrected costs in fixed 30-second buckets, including the current one.
  public var costHistory: [AgentCostBucket]

  public init(
    cumulativeTokens: Double? = nil,
    inputTokens: Double? = nil,
    outputTokens: Double? = nil,
    cacheReadTokens: Double? = nil,
    cacheCreationTokens: Double? = nil,
    reasoningTokens: Double? = nil,
    samples: [AgentUsageSample] = [],
    costUsd: Double? = nil,
    costCoverage: AgentCostCoverage? = nil,
    costRatePerMin: Double? = nil,
    costHistory: [AgentCostBucket] = []
  ) {
    self.cumulativeTokens = cumulativeTokens
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
    self.cacheReadTokens = cacheReadTokens
    self.cacheCreationTokens = cacheCreationTokens
    self.reasoningTokens = reasoningTokens
    self.samples = samples
    self.costUsd = costUsd
    self.costCoverage = costCoverage
    self.costRatePerMin = costRatePerMin
    self.costHistory = costHistory
  }
}

/// One running tool invocation, reduced to what the bubble caption needs.
public struct AgentToolRun: Sendable, Equatable, Codable {
  public var title: String?
  public init(title: String? = nil) { self.title = title }
}

/// The live state slice the field renders — a SUBSET of puppeteer's monitor
/// projection (`AgentMonitorState`), field names kept, so the day fieldd's
/// `agent.subscribe` reaches the phone (IOS-4) the binding is a mapping and
/// not a redesign. The first nine fields are the July feed; the rest are what
/// RFC 005's bodies read (the burn, the effort, the reply, the blocker's kind,
/// the clocks).
public struct AgentRuntimeState: Sendable, Equatable, Codable {
  public var lifecycle: AgentLifecycle
  public var activeTurn: Bool
  public var activeReasoning: Bool
  public var permissions: [AgentPermission]
  public var toolRuns: [AgentToolRun]
  public var taskCount: Int
  /// Context window usage, 0...100, when the vendor reports one.
  public var contextUsedPercent: Double?
  public var modelName: String?
  public var branch: String?
  /// Blockers other than a permission (a question, a failure), monitor order.
  public var blockers: [AgentBlocker]
  public var effort: AgentEffort?
  /// The root agent's latest reply, bounded by the producer; the body shows
  /// its first line.
  public var lastAssistantMessage: String?
  public var usage: AgentUsage?
  /// When the current status began (the unread rule reads it, never the
  /// transition, so a turn that began and ended between two projections still
  /// counts).
  public var statusSince: Date?
  /// The monitor's `freshness.lastEvidenceAt`: stale evidence dims the body.
  public var lastEvidenceAt: Date?

  public init(
    lifecycle: AgentLifecycle = .ready,
    activeTurn: Bool = false,
    activeReasoning: Bool = false,
    permissions: [AgentPermission] = [],
    toolRuns: [AgentToolRun] = [],
    taskCount: Int = 0,
    contextUsedPercent: Double? = nil,
    modelName: String? = nil,
    branch: String? = nil,
    blockers: [AgentBlocker] = [],
    effort: AgentEffort? = nil,
    lastAssistantMessage: String? = nil,
    usage: AgentUsage? = nil,
    statusSince: Date? = nil,
    lastEvidenceAt: Date? = nil
  ) {
    self.lifecycle = lifecycle
    self.activeTurn = activeTurn
    self.activeReasoning = activeReasoning
    self.permissions = permissions
    self.toolRuns = toolRuns
    self.taskCount = taskCount
    self.contextUsedPercent = contextUsedPercent
    self.modelName = modelName
    self.branch = branch
    self.blockers = blockers
    self.effort = effort
    self.lastAssistantMessage = lastAssistantMessage
    self.usage = usage
    self.statusSince = statusSince
    self.lastEvidenceAt = lastEvidenceAt
  }
}

/// Where a run's terminal is, and whose desktop it is on (G3's join).
///
/// It rides the snapshot rather than being looked up at the card because it is
/// a FACT THE FEED GAVE US: the fold's own `terminal` field plus the device
/// whose board carried the row. A card that re-derived it would be guessing at
/// something the wire already said.
public struct AgentJoin: Sendable, Equatable, Codable {
  /// The MESH device id of the desktop this row came from — the devices
  /// store's key, which is also the key a product client is filed under.
  public var deviceID: String
  /// `local` · `remote` · `none`, the wire's own word. `none` is an exited run
  /// (or one whose PTY is gone), and it is the only value that means there is
  /// nothing to attach to.
  public var hosted: String
  /// The floor's session id — the handle `terminal.v1.hosts` advertises and
  /// the one an attach takes. Absent for a run with no terminal.
  public var runtimeSessionID: String?
  /// AR-4: the run is live and unobserved, resuming at its next idle. Its PTY
  /// EXISTS, so it can still be attached to; what it cannot be is resumed
  /// twice.
  public var pending: Bool
  /// MF-1f: the run's process has ENDED, and its row is still here because the
  /// floor still lists its PTY. `terminal.hosted` stays `local` with the same
  /// session id, so the pane can still be read — and RESUME is the verb.
  public var exited: Bool
  /// DS-8 (DS-L8) — whether the desktop this run lives on is LIVE on the
  /// phone's home right now: its chain is flowing on the home's mesh board, and
  /// the home is answering. `false` is a desktop asleep, stale or on another
  /// version — or a home that stopped answering — and the row STAYS, drawn
  /// greyed (`FieldAssembly` dresses it stale), because asleep is a state and
  /// not an absence. `true` for a feed with no mesh behind it.
  public var deviceLive: Bool
  /// PJ-7 (Q3) — the agent's own id for the conversation this run continues
  /// (the field row's `nativeSessionId`): what History's Jump to joins a
  /// session row to its card by. The id only, never the folder (EL7 B1); nil
  /// until the agent says it.
  public var nativeSessionID: String?

  public init(
    deviceID: String, hosted: String, runtimeSessionID: String? = nil, pending: Bool = false,
    exited: Bool = false, deviceLive: Bool = true, nativeSessionID: String? = nil
  ) {
    self.deviceID = deviceID
    self.hosted = hosted
    self.runtimeSessionID = runtimeSessionID
    self.pending = pending
    self.exited = exited
    self.deviceLive = deviceLive
    self.nativeSessionID = nativeSessionID
  }

  /// Whether the run has a terminal at all, by the wire's word.
  public var hasTerminal: Bool { hosted != "none" && runtimeSessionID != nil }
}

/// One agent session as the field sees it.
public struct AgentSnapshot: Identifiable, Sendable, Equatable {
  /// The session id — the identity spine (EL7); stable across state churn.
  public let id: String
  /// The runtime alias; the card header still derives a hue from it (D-i16).
  public let runtimeSessionID: String
  public var provider: AgentProvider
  /// The producer's own word for the agent on this row — the field row's
  /// `label` (fieldd stamps the catalog's since AC-3; a desktop from before
  /// it stamps the adapter's own). The name's fallback when no catalog row
  /// reaches this phone for the id (`AgentFacet.providerName`). nil for the
  /// scripted fleet, which has no producer.
  public var label: String?
  /// Folder-name project label, the bubble's headline — and, until IOS-4
  /// hands the workspace root over, the key the project's colour is dealt by.
  public var project: String
  /// nil = spawned but not yet reporting — renders as working, "starting".
  public var state: AgentRuntimeState?
  public let createdAt: Date
  /// G3's join, when the feed gave one. nil for the scripted fleet, which has
  /// no desktop and no PTY — and that absence is exactly why its cards offer
  /// no attach.
  public var join: AgentJoin?
  /// What the catalog says about this agent (AC-D9): the row the fold found
  /// for `provider` in the catalog of the desktop that published this run. It
  /// rides the snapshot for the reason `join` does — it is a fact the feed
  /// gave us, and a card that looked it up again would be guessing at it.
  ///
  /// nil is an honest state, never a missing feature: a desktop from before
  /// the door, the scripted fleet (no desktop at all), or an id no catalog
  /// decided on. The run still draws, as its raw id and its letter (R4).
  public var catalogEntry: AgentCatalogEntry?

  public init(
    id: String,
    runtimeSessionID: String,
    provider: AgentProvider,
    label: String? = nil,
    project: String,
    state: AgentRuntimeState? = nil,
    createdAt: Date = .now,
    join: AgentJoin? = nil,
    catalogEntry: AgentCatalogEntry? = nil
  ) {
    self.id = id
    self.runtimeSessionID = runtimeSessionID
    self.provider = provider
    self.label = label
    self.project = project
    self.state = state
    self.createdAt = createdAt
    self.join = join
    self.catalogEntry = catalogEntry
  }
}
