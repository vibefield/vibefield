import FieldProduct
import Foundation
import Observation

/// SP-6 — one reader per self desktop whose door answers (SP-D2 (a): the
/// phone is a multi-door client for History), the HOME desktop first, DS-8's
/// home. PJ-7 — the LEDGER is no longer grouped by desktop (TP §6.3; SP-D10's
/// grouping superseded): `projects` reads every desktop's projects over ONE
/// door — the home's, or another answering desktop's while the home sleeps —
/// and a desktop's reader keeps what only it can answer: its standing, a
/// session's document and tail, its search. A desktop that does not answer
/// replays what this phone last read of it, under H-D7's words with its name.
/// The home screen attaches and detaches as the link's roster moves; the views
/// read the ledger and the readers.
@MainActor
@Observable
public final class HistoryDesktops {
  public private(set) var readers: [HistoryDesktopReader] = []
  public private(set) var home: String?
  /// PJ-7 — the ledger of projects, over one door (or the cache's, asleep).
  public private(set) var projects: HistoryProjects

  @ObservationIgnored private let cache: HistoryCache?
  @ObservationIgnored private let agentLabel: @MainActor (String) -> String
  @ObservationIgnored private let now: @MainActor () -> Date

  public init(
    cache: HistoryCache? = HistoryCache(),
    agentLabel: @escaping @MainActor (String) -> String = { $0 },
    now: @escaping @MainActor () -> Date = { Date() }
  ) {
    self.cache = cache
    self.agentLabel = agentLabel
    self.now = now
    projects = HistoryProjects(source: nil, door: nil, cache: cache, now: now)
    projects.start()
  }

  /// PJ-7 — the door the ledger reads: a reader over it stands while the
  /// source does; another source, or one replaying the cache, is replaced.
  public func attachProjects(
    source: String, door: any HistoryDoor, ownsDoor: Bool, roster: [FieldHistoryModel.RosterDesktop]
  ) {
    if projects.source == source, !projects.isReplaying {
      projects.update(roster: roster)
      return
    }
    projects.close()
    projects = HistoryProjects(source: source, door: door, ownsDoor: ownsDoor, cache: cache, roster: roster, now: now)
    projects.start()
  }

  /// PJ-7 — which door the ledger reads (the lead's call, build-pj7.md): the
  /// HOME's while it answers, else the first other desktop that answers (the
  /// readers' order: the home first, then by name). It asks through that
  /// desktop's reader's own door, so History holds one door per desktop. No
  /// desktop answering: the cache's ledger, asleep.
  public func chooseLedger(roster: [FieldHistoryModel.RosterDesktop]) {
    let answering = readers.filter { !$0.isReplaying && $0.openDoor != nil }
    guard let reader = answering.first(where: { $0.deviceId == home }) ?? answering.first,
      let door = reader.openDoor
    else {
      projectsOffline()
      projects.update(roster: roster)
      return
    }
    attachProjects(source: reader.deviceId, door: door, ownsDoor: false, roster: roster)
  }

  /// No desktop's door answers: the ledger replays what this phone kept.
  public func projectsOffline() {
    guard !projects.isReplaying || projects.source != nil else { return }
    projects.close()
    projects = HistoryProjects(source: nil, door: nil, cache: cache, now: now)
    projects.start()
  }

  public func reader(for deviceId: String) -> HistoryDesktopReader? {
    readers.first { $0.deviceId == deviceId }
  }

  /// A desktop whose door answers: a reader over it, started (the cache
  /// replays first, then the ledger reads). A reader already over a door for
  /// this desktop stands; one replaying the cache is replaced.
  public func attach(
    deviceId: String, name: String, isHome: Bool, door: any HistoryDoor, ownsDoor: Bool
  ) {
    if let existing = reader(for: deviceId), !existing.isReplaying, existing.isHome == isHome {
      return
    }
    reader(for: deviceId)?.close()
    let reader = HistoryDesktopReader(
      deviceId: deviceId, name: name, isHome: isHome, door: door, ownsDoor: ownsDoor, cache: cache,
      agentLabel: agentLabel, now: now)
    replace(reader)
    reader.start()
  }

  /// A desktop this account has but cannot be asked right now: the cache's
  /// reader, asleep. A reader over a door stands until the door is gone.
  public func markOffline(deviceId: String, name: String, isHome: Bool = false) {
    if let existing = reader(for: deviceId) {
      if existing.isReplaying { return }
      existing.close()
    }
    let reader = HistoryDesktopReader(
      deviceId: deviceId, name: name, isHome: isHome, door: nil, cache: cache, agentLabel: agentLabel,
      now: now)
    replace(reader)
    reader.start()
  }

  /// A fixed reader (the mock's corpus) as the one desktop, and its corpus
  /// as the ledger.
  public func mount(_ reader: HistoryDesktopReader) {
    for existing in readers { existing.close() }
    readers = [reader]
    home = reader.deviceId
    projects.close()
    projects = .fixed(corpus: reader.corpus, standing: reader.standing)
  }

  public func forget(deviceId: String) {
    reader(for: deviceId)?.close()
    readers.removeAll { $0.deviceId == deviceId }
  }

  /// Every door is gone (the mesh left): each reader becomes the cache's.
  public func allOffline() {
    for reader in readers where !reader.isReplaying {
      markOffline(deviceId: reader.deviceId, name: reader.name, isHome: reader.isHome)
    }
    projectsOffline()
  }

  public func setHome(_ deviceId: String?) {
    home = deviceId
    order()
  }

  public func pause() {
    for reader in readers { reader.pause() }
    projects.pause()
  }

  public func resume() {
    for reader in readers { reader.resume() }
    projects.resume()
  }

  public func need(_ need: HistoryNeed) {
    switch need {
    case .project(let key):
      projects.open(key)
    case .session(let device, _), .older(let device, _), .seen(let device, _):
      reader(for: device)?.need(need)
    }
  }

  /// One question to every desktop that answers — in turn (a phone has one
  /// to three desktops; a question per radio round trip is the cost either
  /// way, and the readers are the main actor's).
  public func search(_ query: String, kind: FieldHistoryModel.SearchKind) async {
    for reader in readers where !reader.isReplaying {
      await reader.search(query, kind: kind)
    }
  }

  private func replace(_ reader: HistoryDesktopReader) {
    readers.removeAll { $0.deviceId == reader.deviceId }
    readers.append(reader)
    if reader.isHome { home = reader.deviceId }
    order()
  }

  /// The home first, then the rest by name.
  private func order() {
    readers.sort { a, b in
      if a.deviceId == home { return true }
      if b.deviceId == home { return false }
      return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }
  }
}
