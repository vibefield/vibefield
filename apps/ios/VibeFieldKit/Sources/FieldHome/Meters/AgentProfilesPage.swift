import FieldProduct
import Foundation

// UM-4 (UM-D25 and UM-D26 A; DESIGN.md §8 "The phone's corner", §9 "The meters' words") — THE ME MENU'S ROW AND THE
// AGENT PROFILES PAGE, AS WORDS AND CHOICES (pure): what the row says, and every line of the page, from the home's
// meters (`MetersReading`), the lens (`ProfileLens`), the home's name and the clock. The views draw what this says.
//
// RED STUB (UM-4d): the words' shape, saying nothing.

struct AgentProfilesWords: Equatable {
  /// One row of the page's Profiles group: All profiles (`id` nil) or a profile.
  struct ProfileRow: Equatable, Identifiable {
    /// the profile's id; nil for All profiles
    let profileId: String?
    let name: String
    let line: String
    let word: String?
    let hot: Bool
    let checked: Bool
    let profile: MeterProfile?
    var id: String { profileId ?? "" }
  }

  /// One row of the page's Plans group.
  struct PlanRow: Equatable, Identifiable {
    enum Body: Equatable {
      case reading(windows: [MeterWindow], kept: String?, forecast: String?, stale: Bool)
      case firstRead
      case needs(String)
      case none(String)
    }

    let key: String
    let provider: String
    let title: String
    let glyph: MeterProfile?
    let body: Body
    var id: String { key }
  }

  let menuWord: String?
  let menuHot: Bool
  let read: String
  let profiles: [ProfileRow]
  let plansHead: String
  let plans: [PlanRow]

  init(reading: MetersReading, lens: ProfileLens, home: String, now: Date) {
    menuWord = nil
    menuHot = false
    read = ""
    profiles = []
    plansHead = ""
    plans = []
  }
}
