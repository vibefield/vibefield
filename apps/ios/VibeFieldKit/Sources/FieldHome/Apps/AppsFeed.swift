import FieldProduct
import Foundation
import Observation

// MA-6c — the phone's reading of the apps doors through its home: `index.apps.list {scope: "mesh"}`, every page, the
// pings of `index.apps.subscribe`, and the project names of `project.list`. RED: attach and ask do nothing.

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
  /// The pages one reading walks at most: the phone's own bound, a thousand apps over a radio. A walk it stops is said.
  static let maxPages = 10

  private(set) var reading = Reading()

  /// The home's door, handed over when it changes or the app comes forward (nil: no home answers).
  func attach(_ door: (any ChatDoor)?, home: String?) {}

  /// Typed words, asked of the door's titles; none clears the answer without asking.
  func ask(_ words: String) async {}
}
