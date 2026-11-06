import CoreGraphics
import FieldHistory
import FieldProduct

/// SE-2 (UM-D27 A, ruled 2026-11-06 on the page *The Bands Meter*; DESIGN.md §8 "The phone's profile token") — the
/// token above search and its menu, their measure and what they say. SE-2d (red): every number is zero, every word
/// empty, and nothing shows.
enum LensToken {
  static let height: CGFloat = 0
  static let radius: CGFloat = 0
  static let maxWidth: CGFloat = 0
  static let leading: CGFloat = 0
  static let trailing: CGFloat = 0
  static let parts: CGFloat = 0
  static let nameHeight: CGFloat = 0
  static let nameRadius: CGFloat = 0
  static let nameLeading: CGFloat = 0
  static let nameTrailing: CGFloat = 0
  static let nameGlyph: CGFloat = 0
  static let nameGap: CGFloat = 0
  static let nameText: CGFloat = 0
  static let close: CGFloat = 0
  static let closeGlyph: CGFloat = 0
  static let right: CGFloat = 0
  static let aboveCircle: CGFloat = 0
  static let growFrom: CGFloat = 0
  static let growOrigin = CGSize.zero
  static let menuWidth: CGFloat = 0
  static let menuRadius: CGFloat = 0
  static let menuGap: CGFloat = 0
  static let menuFoot: CGFloat = 0
  static let menuPopFrom: CGFloat = 0
  static let menuPop: Double = 0
  static let menuOrigin = CGSize.zero
  static let checkColumn: CGFloat = 0
  static let checkGlyph: CGFloat = 0
  static let everyGlyph: CGFloat = 0
  static let profileGlyph: CGFloat = 0
  static let viewLead: CGFloat = 0
  static let reducedFade: Double = 0

  static let clearWords = ""
  static let eyebrow = ""
  static let everyWord = ""
  static let pageWord = ""

  static func bottom(homeInset: CGFloat) -> CGFloat { 0 }
  static func menuBottom(homeInset: CGFloat) -> CGFloat { 0 }

  /// One row of the menu that picks a profile.
  struct Item: Equatable, Identifiable {
    /// The profile it shows; nil shows every profile.
    let pick: String?
    /// Its glyph: the profile's, or nil for every profile's.
    let lead: PhoneSearch.Lead?
    let label: String
    /// Its sessions ("3 sessions").
    let word: String
    /// It is the one shown.
    let checked: Bool

    var id: String { pick ?? "" }
  }

  static func items(_ lens: ProfileLens, live: PhoneSearch.Live) -> [Item] { [] }

  static func shows(
    _ lens: ProfileLens, onField: Bool, searchOpen: Bool, faceHeld: Bool, menuOpen: Bool, pageOpen: Bool
  ) -> Bool { false }

  static func spoken(_ profile: AgentProfileSet) -> String { "" }
}
