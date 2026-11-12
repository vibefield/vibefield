// RB-1 — This phone › Notifications, dotted Not yet (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; §9
// "Notifications, before push"). The whole file is compiled only into TestFlight and development builds, so the
// build submitted for App Review carries neither the page nor its words (`SettingsBuild`).
#if DEBUG || VF_TESTFLIGHT
  import FieldDesign
  import SwiftUI

  /// RB-1's red: a stub. The green draws the preview, its caption, Tell me when with its three switches drawn and
  /// disabled, and the foot.
  struct NotificationsPage: View {
    var body: some View { EmptyView() }
  }

  extension SettingsWords {
    /// RB-1 (DESIGN.md §9 "Notifications, before push"): the row, the preview, its caption, the group and its three
    /// switches, and the foot. RB-1's red: stubs, so the words test fails at its own assertions.
    static let notificationsRow = ""
    static let previewApp = ""
    static let previewWhen = ""
    static let previewDesktop = ""
    static let previewLine = ""
    static let notificationsCaption = ""
    static let tellMeWhen = ""
    static let notifyNeedsYou = ""
    static let notifyNeedsYouDetail = ""
    static let notifyFinishes = ""
    static let notifyAsleep = ""
    static func notificationsFoot(_ device: DeviceWord) -> String { "" }
  }
#endif
