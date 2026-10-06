import FieldProduct
import Foundation
import Observation

/// SP-6 — History GROUPED BY DESKTOP (the slice table's "grouped by desktop";
/// SP-D2 (a): the phone is a multi-door client for History — one corpus per
/// self desktop whose door answers, the HOME desktop first, DS-8's home).
/// A desktop whose door does not answer is still a group: its reader replays
/// what this phone last read of it from the cache, under H-D7's words with the
/// desktop's name (`mini is asleep · read 11:42`), figures dimmed and green
/// withheld. The home screen attaches and detaches readers as the link's
/// roster moves; the views read the readers.
@MainActor
@Observable
public final class HistoryDesktops {
  public private(set) var readers: [HistoryDesktopReader] = []
  public private(set) var home: String?

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

  /// A fixed reader (the mock's corpus) as the one group.
  public func mount(_ reader: HistoryDesktopReader) {
    for existing in readers { existing.close() }
    readers = [reader]
    home = reader.deviceId
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
  }

  public func setHome(_ deviceId: String?) {
    home = deviceId
    order()
  }

  public func pause() {
    for reader in readers { reader.pause() }
  }

  public func resume() {
    for reader in readers { reader.resume() }
  }

  public func need(_ need: HistoryNeed) {
    let device: String =
      switch need {
      case .project(let device, _), .session(let device, _), .older(let device, _), .seen(let device, _):
        device
      }
    reader(for: device)?.need(need)
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
