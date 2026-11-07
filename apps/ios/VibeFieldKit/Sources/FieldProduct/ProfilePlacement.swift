import Foundation

// IOS-12f (TU-1, Q3; the contracts' `profileSetOfRun` and `personaSetsOf`, agent-index.ts) — the ONE rule that places
// a run in an Agent Profile, which the talk room, the needs-you Allow, Chat's @ and the New spark sheet share: the
// profile it was filed under; else the native set's for a run that names no persona; else the profile listing its
// persona; else none (a retired sign-in, or the profiles not read yet). The New spark sheet's reach counts by it, and
// @'s list (IOS-12f's M-f2) places its sessions by it.
// SKELETON (f2): the rule's answers are f4's; the rows in NewSparkTests are red until then.

/// What a run says of its profile: the one it was filed under, and the persona it runs as.
public struct RunProfileFacts: Sendable, Equatable {
  public let profileSet: String?
  public let profileId: String?

  public init(profileSet: String? = nil, profileId: String? = nil) {
    self.profileSet = profileSet
    self.profileId = profileId
  }
}

public enum ProfilePlacement {
  /// The agents' own folders' set (`NATIVE_PROFILE_SET_ID`).
  public static let nativeSet = "native"

  /// Each persona to the profile listing it, over one frame of sets (a persona two sets list is the later set's).
  public static func personaSets(_ sets: [AgentProfileSet]) -> [String: String] {
    [:]
  }

  /// The profile a run is placed in, or nil. `personaSets` nil: the profiles not read yet.
  public static func setOf(_ run: RunProfileFacts, personaSets: [String: String]?) -> String? {
    nil
  }
}
