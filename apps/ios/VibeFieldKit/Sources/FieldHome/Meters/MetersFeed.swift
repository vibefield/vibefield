import FieldProduct
import Foundation
import Observation

// UM-4 (UM-D8 A; the lead's rulings 17 and 18) — THE METERS' FEED on the phone: the HOME's cached usage batch and the
// home's profiles, read through the home's one door (DS-8), as Chat's feed reads its lists (`ChatFeed`). The phone
// runs no poll of its own and never asks for a fresh reading (`AgentsUsageParams.cached`, no `refresh`): it asks
// `agents.usage` once when a door is handed over, then watches `agents.usage.subscribe` (whole batches at the stream
// floor; the home's own windows run the poll, a phone's subscription is a passive watcher) for as long as the door is
// held — HomeScreen hands it over while the app is in the foreground and takes it back in the background. The home's
// profiles (`agents.profileSets.list`, with personas and plans) and catalog (`agent.catalog`, every surface's rows:
// the meters' order and names are the desktop's) are read on attach and again whenever a meter view opens.
//
// A home that refuses `agent.usage` (an older desktop: `FORBIDDEN_SCOPE`) is said, never drawn blank: the page and
// the hold say "‹home› doesn't share usage yet" (§9). A door that cannot answer leaves "usage unavailable", the
// dashed circles (ruling 10), and is still watched — the stream's open snapshot repairs it when the home answers — and
// asked again (cached, free) whenever a meter view opens. Without a door the last word stands; with no word yet it is
// "usage unavailable" too, never a first read with no read in flight (the U3 review).

/// What the meters know of the home.
struct MetersReading: Equatable {
  enum Usage: Equatable {
    /// no answer yet: every metered sign-in is a first read
    case waiting
    /// the home's batch, whole
    case batch(AgentAccountUsageBatch)
    /// the home refuses `agent.usage` (an older desktop): said, never blank
    case notShared
    /// the home's usage door could not answer
    case unavailable
  }

  /// A door is handed over: the home answers for the meters now.
  var connected = false
  /// The home's device id, while one answers.
  var home: String?
  /// The home's profiles, as `agents.profileSets.list` answered (a draft included; `profiles` leaves it out).
  var sets: [AgentProfileSet] = []
  /// The home's catalog, every surface's rows.
  var catalog: [AgentCatalogRow] = []
  var usage: Usage = .waiting

  /// No reading has come yet: no answer, or the home's honest empty — its answer before its first refresh is
  /// `entries: []`, stamped now (agent-usage.ts) — so the words say "Reading usage…", never a reading's age.
  var firstRead: Bool {
    switch usage {
    case .waiting: return true
    case .batch(let batch): return batch.entries.isEmpty
    case .notShared, .unavailable: return false
    }
  }

  /// The profiles that stand on a circle (ruling 7), in the home's order: the lens's (`ProfileLens.adopt`).
  var profiles: [AgentProfileSet] { sets.filter(MeterModel.hasCircle) }

  /// The batch's readings; none before the first answer.
  var rows: [AgentAccountUsageEntry] {
    guard case .batch(let batch) = usage else { return [] }
    return batch.entries
  }

  /// How the meters are asked: the home's catalog, Settings' titles, and whether the home's usage could be read.
  var options: MetersOptions {
    MetersOptions(catalog: MeterCatalog(rows: catalog), usageReadable: usage != .unavailable && usage != .notShared)
  }

  /// One profile's meters (`profile`), or every profile's (nil, UM-D12).
  func meters(of profile: String?, now: Date) -> ProfileMeters {
    if let profile, let set = profiles.first(where: { $0.id == profile }) {
      return MeterModel.planMeters(set, rows: rows, now: now, options: options)
    }
    return MeterModel.everyPlan(profiles, rows: rows, now: now, options: options)
  }
}

@MainActor
@Observable
final class MetersFeed {
  private(set) var reading = MetersReading()
  /// The clock the meters are read at: the device's, or a fixture's stamp under `-vf-mock`.
  @ObservationIgnored var clock: @MainActor () -> Date = { Date() }

  @ObservationIgnored private var door: (any ChatDoor)?
  @ObservationIgnored private var watch: (any ChatWatch)?
  @ObservationIgnored private var ask = 0

  /// The home's door, handed over when it changes or the app comes forward (nil: none — the watch ends and the last
  /// word stands).
  func attach(_ door: (any ChatDoor)?, home: String?) {
    if door === self.door, home == reading.home { return }
    watch?.cancel()
    watch = nil
    self.door = door
    ask += 1
    var next = reading
    next.connected = door != nil
    if next.home != home {
      // another home's profiles and meters are not this one's
      next = MetersReading()
      next.connected = door != nil
      next.home = home
    }
    // no door and no answer yet: nothing is being read, so it is unavailable — never a first read that never ends
    // (ruling 10); the next door's read replaces it
    if door == nil, next.usage == .waiting { next.usage = .unavailable }
    if next != reading { reading = next }
    guard door != nil else { return }
    readProfiles()
    readUsage()
  }

  /// A meter view opened (the Me menu, the page, the hold): the home's profiles again, since a sign-in on the desktop
  /// may have changed its plans; and the cached usage again after a door that could not answer. Never after a refusal
  /// (the home's answer), never while the first read is out (`waiting` with a door held is the attach's own ask), and
  /// never fresh.
  func open() {
    readProfiles()
    if reading.usage == .unavailable { readUsage() }
  }

  private func readProfiles() {
    guard let door else { return }
    let asked = ask
    Task { @MainActor [weak self] in
      let sets = try? AgentProfileSetsResult(json: try await door.call("agents.profileSets.list", params: nil))
      let catalog = try? AgentCatalogResult(
        json: try await door.call("agent.catalog", params: AgentCatalogParams().json))
      guard let self, asked == self.ask else { return }
      var next = self.reading
      if let sets { next.sets = sets.sets }
      if let catalog { next.catalog = catalog.catalog }
      if next != self.reading { self.reading = next }
    }
  }

  private func readUsage() {
    guard let door else { return }
    let asked = ask
    Task { @MainActor [weak self] in
      let usage: MetersReading.Usage
      do {
        usage = .batch(
          try AgentAccountUsageBatch(json: try await door.call("agents.usage", params: AgentsUsageParams.cached.json)))
      } catch let refusal as FieldProductError where refusal.kind == "FORBIDDEN_SCOPE" {
        usage = .notShared
      } catch {
        usage = .unavailable
      }
      guard let self, asked == self.ask else { return }
      if self.reading.usage != usage { self.reading.usage = usage }
      // a batch is watched, and so is a door that could not answer: the stream opens on a snapshot, which repairs the
      // batch when the home answers again. A refusal is the home's answer: nothing to watch.
      if usage != .notShared, self.watch == nil { self.watchUsage(door, asked: asked) }
    }
  }

  /// Whole batches as the home's poll reads them; a frame this build cannot read leaves the last batch standing.
  private func watchUsage(_ door: any ChatDoor, asked: Int) {
    Task { @MainActor [weak self] in
      let frame: @MainActor (JSONValue) -> Void = { [weak self] value in
        guard let self, asked == self.ask, let batch = try? AgentAccountUsageBatch(json: value) else { return }
        if self.reading.usage != .batch(batch) { self.reading.usage = .batch(batch) }
      }
      guard let watch = try? await door.watch("agents.usage.subscribe", params: .object([:]), onFrame: frame) else {
        return
      }
      guard let self, asked == self.ask, self.watch == nil else {
        watch.cancel()
        return
      }
      self.watch = watch
    }
  }
}
