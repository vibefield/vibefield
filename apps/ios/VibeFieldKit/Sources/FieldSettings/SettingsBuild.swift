/// RB-1 — which build this is, for the rows James ruled by build (DESIGN.md §8 "The phone's Settings", amended
/// 2026-11-12: Notifications is drawn in TestFlight and development builds only, and the build submitted for App
/// Review draws neither it nor Developer).
///
/// This file is the ONE place `VF_TESTFLIGHT` is read. Only the TestFlight archive passes it (`testflight.sh archive
/// N testflight`, as `-DVF_TESTFLIGHT` in `OTHER_SWIFT_FLAGS`), so a Release build without it is the review build,
/// and a slip can only draw too little.
public enum SettingsBuild: Sendable, Equatable {
  case review
  case testFlight
  case development

  /// The build this binary is. RB-1's red: a stub, so the tests fail at their own assertions; the green reads
  /// `DEBUG`, then `VF_TESTFLIGHT`.
  public static let current: SettingsBuild = .review

  /// Whether This phone draws Notifications, dotted Not yet: every build but the review build. RB-1's red: a stub.
  public var drawsNotifications: Bool { false }
}
