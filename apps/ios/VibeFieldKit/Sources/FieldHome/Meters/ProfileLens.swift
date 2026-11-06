import FieldProduct

// UM-4 (track UM; UM-D24, UM-D26 and UM-D27 A, SE-D2 A on the page *The Bands Meter*, 2026-11-06; DESIGN.md §8 "The
// phone's corner" and "The phone's profile token") — THE PHONE'S ONE LENS: which of the home's profiles the field
// shows, and which desktop search keeps to. The held face's let-go, the Agent Profiles page's Profiles rows, the token
// above search and its menu, and search's sheet all read and set this one value, so the phone never holds two
// answers to "whose sessions am I looking at" (the desktop's echo is SE-D2's one filter).
//
// It keys on the HOME's profiles (the lead's ruling 17): a profile id is a desktop's own, so the lens names the home's
// sets, and the other desktops' sessions recede under it (§8 "The phone's profile token", the lens on Field). With one
// profile nothing names a profile (UM-D12): no lens can be chosen.

/// The phone's lens: the home's profiles that stand on a circle, the one chosen (none: every profile), and the
/// desktop search keeps to (none: every desktop).
struct ProfileLens: Equatable, Sendable {
  /// The home's profiles, in the home's order — the ones that stand on a circle (the caller hands them in through the
  /// meter model's `hasCircle`: a draft no agent signed in to has none, the lead's ruling 7).
  private(set) var profiles: [AgentProfileSet] = []
  /// The chosen profile's id, one of `profiles`; nil shows every profile.
  private(set) var profile: String?
  /// The desktop search keeps to (a device id); nil keeps to none.
  private(set) var desk: String?

  /// Where a hold on the face was let go (§8 "The phone's corner": the reach).
  enum Release: Equatable, Sendable {
    /// on the face, or within the hub's reach: every profile
    case hub
    /// on a profile's bud: that profile
    case bud(String)
    /// on open ground: the field as it was
    case open
  }

  /// The chosen profile, while one is.
  var chosen: AgentProfileSet? { nil }

  /// UM-D12 — a profile can be chosen only while there are several.
  var offersProfiles: Bool { false }

  /// The home's profiles, read again (on attach, on open, after a sign-in changed them): a chosen profile the home no
  /// longer holds, or the last one but one, lets the lens go.
  mutating func adopt(_ sets: [AgentProfileSet]) {}

  /// Shows one profile (`id`), or every profile (nil): the token's menu, its ×, the page's Profiles rows and the
  /// face's actions under VoiceOver. A profile the home does not hold, or a pick with one profile, changes nothing.
  mutating func show(_ id: String?) {}

  /// The hold's let-go (§8 "The phone's corner"): on the hub every profile, on a bud that profile, on open ground
  /// nothing. With one profile letting go only closes.
  mutating func letGo(_ release: Release) {}

  /// Keeps search to one desktop (`id`), or to none (nil).
  mutating func keep(desk id: String?) {}

  /// Search closed: only the profile outlives it (the lead's ruling 21) — the desktop's token clears.
  mutating func searchClosed() {}
}
