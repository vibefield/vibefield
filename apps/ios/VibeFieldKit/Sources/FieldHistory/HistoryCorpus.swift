import Foundation

/// What the History tab reads (IOS-9b, H-D4): the ledger, a project, a
/// session's document, the search hits — as VALUES, the shapes the record's
/// six screens read and nothing about where they came from.
///
/// Two sources fill them: `HistoryCorpus.mock` (the History records' own
/// invented corpus, the one every design page drew — `-vf-mock`,
/// `-vf-demo-history`) and, since SP-6, the reads over a desktop's door
/// (`index.projects` · `index.sessions` · `index.project` · `index.session` ·
/// `index.timeline` + the tail · `index.search`, `HistoryDesktopReader`), one
/// corpus per desktop. Nothing in the views knows the difference, which is the
/// point. `Codable` because a corpus read from a desktop is CACHED and replayed
/// while that desktop cannot answer (airplane mode, H-D7's words).
public struct HistoryCorpus: Equatable, Sendable, Codable {
  /// The desktop whose index this is — its NAME, the word the honest states
  /// carry (`studio is asleep · read 11:42`).
  public var desktop: String
  /// The desktop's durable device id (the mesh's), the key everything about
  /// a desktop is filed under; the routes name it.
  public var deviceId: String
  public var sessionCount: Int
  public var agentCount: Int
  /// When this phone last read the index — the word the asleep states carry.
  public var readAt: String
  public var projects: [HistoryProject]
  public var live: [HistoryLive]
  public var sessions: [String: [HistorySession]]
  public var hits: [HistoryHitGroup]
  /// SP-6 — the query `hits` answer, when a DESKTOP answered them (the local
  /// term filter then stands aside: the index widened word fragments, and a
  /// hit it found is a hit). nil: `hits` is the whole corpus's, filtered here.
  public var searchedQuery: String?
  public var recentSearches: [String]
  public var documents: [String: HistoryDocument]

  public init(
    desktop: String, deviceId: String = "dev-1", sessionCount: Int, agentCount: Int, readAt: String,
    projects: [HistoryProject], live: [HistoryLive], sessions: [String: [HistorySession]],
    hits: [HistoryHitGroup], searchedQuery: String? = nil, recentSearches: [String],
    documents: [String: HistoryDocument]
  ) {
    self.desktop = desktop
    self.deviceId = deviceId
    self.sessionCount = sessionCount
    self.agentCount = agentCount
    self.readAt = readAt
    self.projects = projects
    self.live = live
    self.sessions = sessions
    self.hits = hits
    self.searchedQuery = searchedQuery
    self.recentSearches = recentSearches
    self.documents = documents
  }

  /// A desktop nothing has been read from yet: the shape every reader starts
  /// at, and what a cache that holds nothing answers.
  public static func empty(desktop: String, deviceId: String) -> HistoryCorpus {
    HistoryCorpus(
      desktop: desktop, deviceId: deviceId, sessionCount: 0, agentCount: 0, readAt: "", projects: [],
      live: [], sessions: [:], hits: [], recentSearches: [], documents: [:])
  }

  public func project(_ id: String) -> HistoryProject? { projects.first { $0.id == id } }
  public func sessions(of projectId: String) -> [HistorySession] { sessions[projectId] ?? [] }
  public func document(_ sessionId: String) -> HistoryDocument? { documents[sessionId] }
}

/// The ledger row: identity, location, quantity — and the marks of who worked here.
public struct HistoryProject: Identifiable, Equatable, Sendable, Codable {
  public let id: String
  public let name: String
  /// The dealt colour's sequence (record §02): the row's accent and wash.
  public let seq: Int
  public let path: String
  /// The folder is gone: the path is said in italics, the row stays.
  public let missing: Bool
  /// Tokens over 30 days, as the figure and its unit: `1.24` `B`.
  public let figure: String
  public let unit: String
  /// The same quantity as a number (in millions), for the wash.
  public let spend: Double
  /// The last activity's word: `now` · `2h` · `yesterday` · `12d`.
  public let last: String
  /// The same, as minutes, for the recent ranking.
  public let recencyMinutes: Int
  public let agents: [HistoryAgentShare]
  public let moreAgents: Int
  public let spark: [Int]
  public let stats: HistoryProjectStats?
  /// SP-6 — the project's 53 weeks of 7 as the index counted them (0…4 per
  /// day, from `index.project`'s heatmap); nil draws the record's seeded
  /// pattern, which is the mock's and the honest "not read yet".
  public let ribbon: [[Int]]?

  public init(
    id: String, name: String, seq: Int, path: String, missing: Bool = false, figure: String, unit: String,
    spend: Double, last: String, recencyMinutes: Int, agents: [HistoryAgentShare], moreAgents: Int = 0,
    spark: [Int], stats: HistoryProjectStats? = nil, ribbon: [[Int]]? = nil
  ) {
    self.id = id
    self.name = name
    self.seq = seq
    self.path = path
    self.missing = missing
    self.figure = figure
    self.unit = unit
    self.spend = spend
    self.last = last
    self.recencyMinutes = recencyMinutes
    self.agents = agents
    self.moreAgents = moreAgents
    self.spark = spark
    self.stats = stats
    self.ribbon = ribbon
  }

  public var isLive: Bool { last == "now" }
}

public struct HistoryAgentShare: Equatable, Sendable, Codable {
  public let agent: String
  public let share: Int

  public init(_ agent: String, _ share: Int) {
    self.agent = agent
    self.share = share
  }
}

/// A project's four figures.
public struct HistoryProjectStats: Equatable, Sendable, Codable {
  public let sessions: String
  public let messages: String
  public let tokens: String
  public let tokensUnit: String
  public let activeDays: String
  public let facts: String

  public init(sessions: String, messages: String, tokens: String, tokensUnit: String, activeDays: String, facts: String) {
    self.sessions = sessions
    self.messages = messages
    self.tokens = tokens
    self.tokensUnit = tokensUnit
    self.activeDays = activeDays
    self.facts = facts
  }
}

/// A session running right now, and where a tap on it goes.
public struct HistoryLive: Identifiable, Equatable, Sendable, Codable {
  public enum Destination: Equatable, Sendable, Codable {
    case session(String)
    case project
  }

  public let id: String
  public let projectId: String
  public let title: String
  public let agent: String
  public let running: String
  public let destination: Destination

  public init(id: String, projectId: String, title: String, agent: String, running: String, destination: Destination) {
    self.id = id
    self.projectId = projectId
    self.title = title
    self.agent = agent
    self.running = running
    self.destination = destination
  }
}

public struct HistorySession: Identifiable, Equatable, Sendable, Codable {
  public enum Tone: Equatable, Sendable, Codable {
    case orange
  }

  public let id: String
  public let projectId: String
  /// The day header this row opens, when it is the first of its day.
  public let day: String?
  public let title: String
  public let agent: String
  public let meta: String
  public let branch: String
  public let last: String
  public let tone: Tone?

  public init(
    id: String, projectId: String, day: String? = nil, title: String, agent: String, meta: String, branch: String,
    last: String, tone: Tone? = nil
  ) {
    self.id = id
    self.projectId = projectId
    self.day = day
    self.title = title
    self.agent = agent
    self.meta = meta
    self.branch = branch
    self.last = last
    self.tone = tone
  }

  public var isLive: Bool { last == "now" }
}

/// Search hits, grouped under the session they were found in.
public struct HistoryHitGroup: Identifiable, Equatable, Sendable, Codable {
  public let id: String
  public let projectId: String
  /// The session the hits belong to — a document when the corpus holds one.
  public let sessionId: String
  public let sessionTitle: String
  public let agent: String
  public let day: String
  public let rows: [HistoryHit]

  public init(id: String, projectId: String, sessionId: String, sessionTitle: String, agent: String, day: String, rows: [HistoryHit]) {
    self.id = id
    self.projectId = projectId
    self.sessionId = sessionId
    self.sessionTitle = sessionTitle
    self.agent = agent
    self.day = day
    self.rows = rows
  }
}

public struct HistoryHit: Identifiable, Equatable, Sendable, Codable {
  public enum Who: Equatable, Sendable, Codable {
    case you
    case agent
  }

  public let id: String
  /// The anchor the hit lands on: a segment id in the session's document, or
  /// a session row's id in a project. Two hits may share one.
  public let anchor: String
  public let who: Who
  public let text: String
  public let at: String

  public init(id: String, anchor: String, who: Who, text: String, at: String) {
    self.id = id
    self.anchor = anchor
    self.who = who
    self.text = text
    self.at = at
  }
}

// MARK: - The document

public struct HistoryDocument: Identifiable, Equatable, Sendable, Codable {
  public let id: String
  public let projectId: String
  public let title: String
  public let agentName: String
  public let agent: String
  /// The branch, when the index named one; empty draws no branch (a listing
  /// row carries none — the mock's branches are the record's).
  public let branch: String
  public let startedAt: String
  public let startDay: String
  public let turns: [HistoryTurn]
  /// The live line's words, when the last run is still going.
  public let liveSince: String?
  /// SP-6 — the page door's continuation to OLDER rows than this document
  /// holds (nil: the whole session is here, or the mock's).
  public let nextCursor: String?
  /// SP-6 — rosetta's projection generation these rows belong to; the
  /// cache's stamp beside the session's own.
  public let watermark: String?

  public init(
    id: String, projectId: String, title: String, agentName: String, agent: String, branch: String, startedAt: String,
    startDay: String, turns: [HistoryTurn], liveSince: String? = nil, nextCursor: String? = nil,
    watermark: String? = nil
  ) {
    self.id = id
    self.projectId = projectId
    self.title = title
    self.agentName = agentName
    self.agent = agent
    self.branch = branch
    self.startedAt = startedAt
    self.startDay = startDay
    self.turns = turns
    self.liveSince = liveSince
    self.nextCursor = nextCursor
    self.watermark = watermark
  }

  /// Every anchor a hit can land on, in reading order.
  public var anchors: [String] {
    turns.flatMap { turn -> [String] in
      [turn.promptAnchor].compactMap { $0 } + turn.segments.compactMap(\.anchor)
    }
  }
}

public struct HistoryTurn: Identifiable, Equatable, Sendable, Codable {
  public let id: String
  public let at: String
  /// A day pill before the prompt, when the gap earned one: `11:31 · after 1h 19m`.
  public let dayPill: HistoryDayPill?
  public let prompt: String
  /// The hit id that lands on this prompt, if search found it here.
  public let promptAnchor: String?
  public let model: String
  public let facts: String
  public let isLive: Bool
  public let segments: [HistorySegment]
  /// SP-6 — what was attached to the PROMPT, as placeholders' words (`image
  /// shot.png on studio`): drawn under the panel, never relayed (H-D9).
  public let promptAttachments: [String]
  /// SP-6 — the words under a prompt the door cut at its bound (`clipped ·
  /// 14 KB on studio`); nil for a prompt carried whole.
  public let promptClipped: String?

  public init(
    id: String, at: String, dayPill: HistoryDayPill? = nil, prompt: String, promptAnchor: String? = nil,
    model: String, facts: String, isLive: Bool = false, segments: [HistorySegment],
    promptAttachments: [String] = [], promptClipped: String? = nil
  ) {
    self.id = id
    self.at = at
    self.dayPill = dayPill
    self.prompt = prompt
    self.promptAnchor = promptAnchor
    self.model = model
    self.facts = facts
    self.isLive = isLive
    self.segments = segments
    self.promptAttachments = promptAttachments
    self.promptClipped = promptClipped
  }
}

/// The gap between turns, said once: the clock and how long it had been.
public struct HistoryDayPill: Equatable, Sendable, Codable {
  public let time: String
  public let after: String

  public init(time: String, after: String) {
    self.time = time
    self.after = after
  }
}

public enum HistorySegment: Identifiable, Equatable, Sendable, Codable {
  /// A paragraph of the reply. `anchor` is the hit id search lands on.
  case prose(id: String, at: String, text: String, anchor: String?)
  /// A folded run: the sentence of nouns, the duration, the failed count, the ladder.
  case ledger(id: String, summary: String, duration: String, failed: Int, isLive: Bool, lines: [HistoryLedgerLine])
  /// SP-6 — something attached to a message that this phone does NOT carry
  /// (H-D9, EL2: images and files are not relayed): an honest placeholder in
  /// the row — `image on studio` — never a broken image. `kind` is rosetta's
  /// attachment kind (image · document · audio · video · file, open),
  /// `label` the name when the index had one.
  case attachment(id: String, kind: String, label: String?)
  /// SP-6 — the words under a reply whose text the door CUT at its bound
  /// (`INDEX_TIMELINE.TEXT_CHARS`): `clipped · 14 KB on studio`, in the
  /// record's honest-state voice, so a body never reads as complete when it
  /// is not; the whole is read in the room, which has the ticket.
  case clipped(id: String, words: String)

  public var id: String {
    switch self {
    case .prose(let id, _, _, _), .ledger(let id, _, _, _, _, _), .attachment(let id, _, _), .clipped(let id, _):
      id
    }
  }

  public var anchor: String? {
    if case .prose(_, _, _, let anchor) = self { return anchor }
    return nil
  }
}

public struct HistoryLedgerLine: Identifiable, Equatable, Sendable, Codable {
  public enum State: Equatable, Sendable, Codable {
    case ok
    case failed
    case running
  }

  public let id: String
  public let verb: String
  public let object: String
  public let dir: String?
  public let result: String
  public let state: State

  public init(id: String, verb: String, object: String, dir: String? = nil, result: String, state: State = .ok) {
    self.id = id
    self.verb = verb
    self.object = object
    self.dir = dir
    self.result = result
    self.state = state
  }
}

// MARK: - The mock

extension HistoryCorpus {
  /// The History records' own invented corpus — the same names, figures and
  /// sentences every design page drew (`draft/ios-pocket/*/hp.js`), so a
  /// screenshot of the phone can be read against the page it was ruled on.
  /// Real-shaped, invented, and plainly a mock: it answers only `-vf-mock`.
  public static let mock = HistoryCorpus(
    desktop: "studio",
    sessionCount: 1405,
    agentCount: 9,
    readAt: "11:42",
    projects: [
      HistoryProject(
        id: "vf", name: "vibe-field", seq: 0, path: "~/project100/vibe-field", figure: "1.24", unit: "B", spend: 1240,
        last: "now", recencyMinutes: 0,
        agents: [.init("claude", 62), .init("codex", 21), .init("cursor", 9)], moreAgents: 2,
        spark: [2, 3, 2, 4, 3, 5, 4, 6, 5, 7, 8, 6, 9, 10, 12],
        stats: .init(
          sessions: "128", messages: "8,412", tokens: "3.73", tokensUnit: "B", activeDays: "102",
          facts: "31d streak · 31d best · peak 3 PM · mostly Opus 5")),
      HistoryProject(
        id: "ice", name: "infinite-canvas-engine", seq: 1, path: "~/ice", figure: "386", unit: "M", spend: 386, last: "2h",
        recencyMinutes: 120, agents: [.init("claude", 70), .init("cursor", 30)],
        spark: [9, 8, 6, 7, 5, 4, 4, 3, 3, 2, 2, 1, 0, 1, 1]),
      HistoryProject(
        id: "mille", name: "mille", seq: 2, path: "~/project100/mille", figure: "214", unit: "M", spend: 214, last: "now",
        recencyMinutes: 1, agents: [.init("codex", 58), .init("claude", 42)],
        spark: [0, 0, 1, 0, 2, 3, 5, 6, 4, 3, 2, 0, 1, 2, 3],
        stats: .init(
          sessions: "41", messages: "2,904", tokens: "611", tokensUnit: "M", activeDays: "58",
          facts: "6d streak · 14d best · peak 11 PM · mostly o5")),
      HistoryProject(
        id: "chop", name: "chopsticks", seq: 3, path: "~/p008/chopsticks", figure: "92.4", unit: "M", spend: 92.4,
        last: "40m", recencyMinutes: 40, agents: [.init("cursor", 55), .init("claude", 45)],
        spark: [3, 4, 5, 4, 6, 5, 6, 7, 5, 6, 7, 6, 5, 6, 7]),
      HistoryProject(
        id: "rosetta", name: "rosetta", seq: 6, path: "~/project100/rosetta", figure: "71.8", unit: "M", spend: 71.8,
        last: "yesterday", recencyMinutes: 1440,
        agents: [.init("claude", 60), .init("codex", 30), .init("opencode", 10)],
        spark: [0, 1, 2, 4, 3, 5, 6, 4, 5, 3, 4, 6, 5, 3, 2]),
      HistoryProject(
        id: "truffle", name: "truffle", seq: 4, path: "~/p008/truffle · folder not found", missing: true, figure: "31.0",
        unit: "M", spend: 31, last: "12d", recencyMinutes: 17280, agents: [.init("claude", 100)],
        spark: [4, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      HistoryProject(
        id: "jabali", name: "jabali", seq: 5, path: "~/jabali", figure: "4.20", unit: "M", spend: 4.2, last: "26d",
        recencyMinutes: 37440, agents: [.init("gemini", 70), .init("claude", 30)],
        spark: [1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ],
    live: [
      HistoryLive(
        id: "live-vf", projectId: "vf", title: "MT-2 — the tree's eleven glyphs", agent: "claude",
        running: "pnpm specimen --rows worktree", destination: .session("mt-2")),
      HistoryLive(
        id: "live-mille", projectId: "mille", title: "FileTree virtual scroll", agent: "codex",
        running: "apply_patch FileTree.tsx", destination: .project),
    ],
    sessions: [
      "vf": [
        HistorySession(
          id: "mt-2", projectId: "vf", day: "Today", title: "MT-2 — the tree's eleven glyphs", agent: "claude",
          meta: "41 msgs · 1h 45m · 148M", branch: "mt-2", last: "now"),
        HistorySession(
          id: "ah-4", projectId: "vf", title: "AH-4 preview capture runtime", agent: "claude",
          meta: "88 msgs · 3h 04m · 312M", branch: "ah-4/preview", last: "6h"),
        HistorySession(
          id: "gt-5d", projectId: "vf", day: "Yesterday", title: "GT-5d — the floor's honest states", agent: "claude",
          meta: "64 msgs · 2h 21m · 224M", branch: "gt-5d", last: "yesterday"),
        HistorySession(
          id: "verify-tokens", projectId: "vf", title: "verify — the tokens transcription check", agent: "codex",
          meta: "29 msgs · 26m · 41.0M", branch: "codex/settings", last: "yesterday", tone: .orange),
        HistorySession(
          id: "ios-5e", projectId: "vf", day: "Thu 10 Sep", title: "IOS-5e — the card at every size", agent: "cursor",
          meta: "52 msgs · 1h 12m · 96.3M", branch: "ios/5e-polish", last: "2d"),
      ],
      "mille": [
        HistorySession(
          id: "m1", projectId: "mille", day: "Today", title: "FileTree virtual scroll", agent: "codex",
          meta: "36 msgs · 58m · 71.2M", branch: "tree/virtual", last: "now"),
        HistorySession(
          id: "m2", projectId: "mille", title: "FileTree decorations follow §2.5", agent: "codex",
          meta: "22 msgs · 40m · 38.9M", branch: "tree/decor", last: "3h"),
        HistorySession(
          id: "m3", projectId: "mille", day: "Tue 8 Sep", title: "vibefield theme bridge", agent: "claude",
          meta: "47 msgs · 1h 31m · 120M", branch: "theme/vibefield", last: "4d"),
      ],
    ],
    hits: [
      HistoryHitGroup(
        id: "g-vf", projectId: "vf", sessionId: "mt-2", sessionTitle: "MT-2 — the tree's eleven glyphs", agent: "claude",
        day: "Today",
        rows: [
          HistoryHit(
            id: "h1", anchor: "h1", who: .you,
            text: "…At a 12px row that's mush — a badge tucked inside a page outline reads as “generic page, only blurrier”…",
            at: "10:02"),
          HistoryHit(
            id: "h2", anchor: "h2", who: .agent,
            text: "…thirty-two of them pointing at a language badge inside the page silhouette. At 1em of a 12px row…",
            at: "10:02"),
          HistoryHit(
            id: "h3", anchor: "h3", who: .agent,
            text: "…an ordering bug in the check, not in the glyphs. No badge survives at 12px, so none is drawn.",
            at: "10:12"),
        ]),
      HistoryHitGroup(
        id: "g-mille", projectId: "mille", sessionId: "m2", sessionTitle: "FileTree decorations follow §2.5",
        agent: "codex", day: "Thu",
        rows: [
          HistoryHit(
            id: "mh1", anchor: "m2", who: .you,
            text: "…the git badge should carry §2.5's meanings, not git's colours — modified is cyan, conflict is orange…",
            at: "14:20"),
          HistoryHit(
            id: "mh2", anchor: "m2", who: .agent,
            text: "…moved the status badge out of the name column so a long path never clips it at 12px…",
            at: "14:26"),
        ]),
    ],
    recentSearches: ["badge", "debounce", "claimControl", "specimen rows", "write key"],
    documents: [
      "mt-2": HistoryDocument(
        id: "mt-2", projectId: "vf", title: "MT-2 — the tree's eleven glyphs", agentName: "Claude Code", agent: "claude",
        branch: "mt-2", startedAt: "10:02", startDay: "Sat 12 Sep",
        turns: [
          HistoryTurn(
            id: "t1", at: "10:02:14",
            prompt:
              "The icon set still has a per-language map. At a 12px row that's mush — a badge tucked inside a page outline reads as “generic page, only blurrier”. Cut it to categories and tell me what the categories should be.",
            promptAnchor: "h1", model: "claude-opus-5 · high", facts: "48s · 21.4K",
            segments: [
              .prose(id: "t1-p1", at: "10:02:21", text: "Reading what the map covers today before I cut anything.", anchor: nil),
              // SP-6 — the honest-state words: a reply the door cut at its bound,
              // and an attachment whose bytes the index did not record
              .clipped(id: "t1-c1", words: "clipped · 14 KB on studio"),
              .attachment(id: "t1-a1", kind: "image", label: "image icon-map.png · omitted from the record on studio"),
              .ledger(
                id: "t1-l1", summary: "2 reads · 1 search", duration: "11s", failed: 0, isLive: false,
                lines: [
                  .init(id: "t1-l1-1", verb: "Read", object: "vibefield.ts", dir: "design-kit/src/icons/", result: "212 lines"),
                  .init(id: "t1-l1-2", verb: "Read", object: "icon-theme.ts", dir: "mille-ui/src/", result: "88 lines"),
                  .init(id: "t1-l1-3", verb: "Searched", object: "languageBadge", result: "32 in 6 files"),
                ]),
              .prose(
                id: "t1-p2", at: "10:02:58",
                text:
                  "Forty-one extensions, thirty-two of them pointing at a language badge inside the page silhouette. At 1em of a 12px row that is twelve device pixels for both marks, and the badge loses.",
                anchor: "h2"),
              .prose(
                id: "t1-p3", at: "10:03:02",
                text:
                  "The distinctions worth keeping are the ones that change how you treat a row: code, style, prose, config, media, a lockfile you must not hand-edit, a secrets file, and git's own plumbing. Eight, plus the folder pair and the unknown page. Eleven.",
                anchor: nil),
            ]),
          HistoryTurn(
            id: "t2", at: "10:09:40",
            prompt:
              "Eleven is right. Draw them and put them on the specimen at the real size — I want to see them at 12px, not at 48.",
            model: "claude-opus-5 · high", facts: "2m 41s · 64.8K",
            segments: [
              .ledger(
                id: "t2-l1", summary: "3 edits · vibefield.ts, glyphs.svg, specimen.html · 3 commands", duration: "2m 41s",
                failed: 1, isLive: false,
                lines: [
                  .init(id: "t2-l1-1", verb: "Edited", object: "vibefield.ts", dir: "icons/", result: "+118 −64"),
                  .init(id: "t2-l1-2", verb: "Edited", object: "glyphs.svg", dir: "assets/", result: "+44"),
                  .init(id: "t2-l1-3", verb: "Ran", object: "pnpm build:icons", result: "exit 1", state: .failed),
                  .init(id: "t2-l1-4", verb: "Edited", object: "build-icons.mjs", dir: "scripts/", result: "+3 −1"),
                  .init(id: "t2-l1-5", verb: "Ran", object: "pnpm build:icons · pnpm specimen", result: "2 ok"),
                ]),
              .prose(
                id: "t2-p1", at: "10:12:19",
                text:
                  "Eleven glyphs, all resolving. The build script asserted inline.svg began with <svg before the assets barrel had re-exported it — an ordering bug in the check, not in the glyphs. No badge survives at 12px, so none is drawn.",
                anchor: "h3"),
            ]),
          HistoryTurn(
            id: "t3", at: "11:31:08", dayPill: .init(time: "11:31", after: "after 1h 19m"),
            prompt: "Run the specimen against the real worktree rows and tell me which ones still go to mush.",
            model: "claude-opus-5 · high", facts: "16m → …", isLive: true,
            segments: [
              .prose(
                id: "t3-p1", at: "11:31:15",
                text: "Rendering every row the tree draws at 12px, light and dark, and diffing each glyph against its neighbours.",
                anchor: nil),
              .ledger(
                id: "t3-l1", summary: "2 reads · 2 commands · pnpm specimen --rows worktree", duration: "1m 12s → …",
                failed: 0, isLive: true,
                lines: [
                  .init(id: "t3-l1-1", verb: "Read", object: "rows.json", dir: "specimen/", result: "1,204 rows"),
                  .init(id: "t3-l1-2", verb: "Read", object: "render.ts", dir: "specimen/", result: "140 lines"),
                  .init(id: "t3-l1-3", verb: "Ran", object: "pnpm specimen --themes both", result: "4.1s"),
                  .init(id: "t3-l1-4", verb: "Running", object: "pnpm specimen --rows worktree", result: "1m 12s", state: .running),
                ]),
            ]),
        ],
        liveSince: "11:45")
    ])
}
