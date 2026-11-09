import FieldProduct
import Foundation
import Observation

// MA-6c — the phone's reading of the apps doors through its home: `index.apps.list {scope: "mesh"}`, every page, the
// pings of `index.apps.subscribe`, and the project names of `project.list`. The door has folded already, so a row seen
// on two pages counts once and nothing else is done to it. The phone calls no `artifact.open` before MA-5.

@MainActor
@Observable
final class AppsFeed {
  /// Where the reading stands. Nothing is a blank (MA-L10): a library still reading and a home that does not answer
  /// each say so.
  enum Phase: Equatable {
    case waiting
    case live
    /// The answering desktop's library has not been read yet (`library-reading`), never an empty shelf.
    case reading(device: String?)
    /// No home answers.
    case off
    /// The home answered something this build cannot read, or could not answer.
    case unavailable
  }

  struct Reading: Equatable {
    var phase: Phase = .waiting
    var home: String?
    var apps: [IndexAppRow] = []
    var sources: [IndexAppsSource] = []
    var clipped = false
    /// Project names by key.
    var projects: [String: String] = [:]
    /// The door's answer to typed words, and the words it answers.
    var matches: [IndexAppRow] = []
    var matchWords = ""
  }

  /// One page: `INDEX_TAILNET_LIMITS.MAX_ROWS`, so the door has no reason to say `clipped`.
  static let pageLimit = 100
  /// The pages one reading walks at most: the phone's own bound, a thousand apps over a radio, against the desk's 41 per
  /// desktop. A walk it stops is said (`clipped`).
  static let maxPages = 10
  /// `IndexAppsParams`' `q`: longer words are never asked.
  static let maxQuery = 512
  /// `project.list`'s one page, the desk's (`PROJECT_DOORS.PAGE_MAX_LIMIT`).
  static let projectsLimit = 500

  private(set) var reading = Reading()

  @ObservationIgnored private var door: (any ChatDoor)?
  @ObservationIgnored private var watch: (any ChatWatch)?
  @ObservationIgnored private var attached = false
  /// The newest door: a watch opened for an older one is let go.
  @ObservationIgnored private var epoch = 0
  /// The newest reading: an older one's walk stops, and lands nothing.
  @ObservationIgnored private var readings = 0
  /// The newest ask of typed words: an older one lands nothing.
  @ObservationIgnored private var asks = 0

  /// The home's door, handed over when it changes or the app comes forward (nil: no home answers). The apps a home
  /// already showed stand until another home's replace them.
  func attach(_ door: (any ChatDoor)?, home: String?) {
    if attached, door === self.door, home == reading.home { return }
    attached = true
    watch?.cancel()
    watch = nil
    self.door = door
    epoch += 1
    readings += 1
    asks += 1
    var next = reading
    if next.home != home {
      next = Reading()
      next.home = home
    }
    next.phase = door == nil ? .off : next.apps.isEmpty ? .waiting : next.phase
    publish(next)
    guard let door else { return }
    // the pings are asked before the first page, so a change after that page was read pings
    watchPings(door, epoch: epoch)
    read()
  }

  /// Typed words, asked of the door's titles; none clears the answer without asking.
  func ask(_ words: String) async {
    asks += 1
    let asked = asks
    guard !words.isEmpty, words.utf16.count <= Self.maxQuery, let door else {
      answer([], words: words)
      return
    }
    let params: JSONValue = .object([
      "scope": .string("mesh"), "limit": .int(Int64(Self.pageLimit)), "q": .string(words),
    ])
    let page = try? IndexAppsResult(json: try await door.call("index.apps.list", params: params))
    guard asked == asks else { return }
    answer(page?.rows ?? [], words: words)
  }

  private func answer(_ rows: [IndexAppRow], words: String) {
    var next = reading
    next.matches = rows
    next.matchWords = words
    publish(next)
  }

  private func publish(_ next: Reading) {
    if next != reading { reading = next }
  }

  /// Each ping reads the shelf again (the door's rows are always empty). The stream's opening frame counts as one: a
  /// reading it overtakes stops at its next page.
  private func watchPings(_ door: any ChatDoor, epoch: Int) {
    Task { @MainActor [weak self] in
      let frame: @MainActor (JSONValue) -> Void = { [weak self] _ in
        guard let self, epoch == self.epoch else { return }
        self.read()
      }
      let params: JSONValue = .object(["scope": .string("mesh")])
      guard let watch = try? await door.watch("index.apps.subscribe", params: params, onFrame: frame) else { return }
      guard let self, epoch == self.epoch else {
        watch.cancel()
        return
      }
      self.watch = watch
    }
  }

  private func read() {
    guard let door else { return }
    readings += 1
    let asked = readings
    Task { @MainActor [weak self] in
      guard let self else { return }
      let outcome = await self.walk(door, asked: asked)
      guard asked == self.readings else { return }
      let names = await Self.projectNames(door)
      guard asked == self.readings else { return }
      self.land(outcome, names: names)
    }
  }

  private enum Outcome {
    case read(apps: [IndexAppRow], sources: [IndexAppsSource], clipped: Bool)
    case libraryReading(device: String?)
    case unavailable
  }

  /// Every page by its cursor, at most `maxPages`, stopping as soon as a newer reading overtakes this one.
  private func walk(_ door: any ChatDoor, asked: Int) async -> Outcome {
    var apps: [IndexAppRow] = []
    var seen = Set<String>()
    var sources: [IndexAppsSource] = []
    var cursor: String?
    do {
      for _ in 0..<Self.maxPages {
        guard asked == readings else { break }
        var params: [String: JSONValue] = ["scope": .string("mesh"), "limit": .int(Int64(Self.pageLimit))]
        if let cursor { params["cursor"] = .string(cursor) }
        let page = try IndexAppsResult(json: try await door.call("index.apps.list", params: .object(params)))
        apps.append(contentsOf: page.rows.filter { seen.insert($0.appKey).inserted })
        sources = page.sources
        cursor = page.cursor
        if cursor == nil { break }
      }
    } catch let refusal as FieldProductError {
      if let reading = MadeAppRefusal(details: refusal.details), reading.state == .reading {
        return .libraryReading(device: reading.device)
      }
      return .unavailable
    } catch {
      return .unavailable
    }
    return .read(apps: apps, sources: sources, clipped: cursor != nil)
  }

  private static func projectNames(_ door: any ChatDoor) async -> [String: String] {
    let params = ProjectListParams(limit: projectsLimit).json
    guard let page = try? ProjectListResult(json: try await door.call("project.list", params: params)) else {
      return [:]
    }
    return Dictionary(page.rows.map { ($0.key, $0.name) }, uniquingKeysWith: { first, _ in first })
  }

  private func land(_ outcome: Outcome, names: [String: String]) {
    var next = reading
    switch outcome {
    case .read(let apps, let sources, let clipped):
      next.phase = .live
      next.apps = apps
      next.sources = sources
      next.clipped = clipped
      next.projects = names
    case .libraryReading(let device):
      next.phase = .reading(device: device)
    case .unavailable:
      next.phase = .unavailable
    }
    publish(next)
  }
}
