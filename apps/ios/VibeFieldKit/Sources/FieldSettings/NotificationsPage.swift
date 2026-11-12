// RB-1 — This phone › Notifications, dotted Not yet (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; §9
// "Notifications, before push"). The whole file is compiled only into TestFlight and development builds, so the
// build submitted for App Review carries neither the page nor its words (`SettingsBuild`).
#if DEBUG || VF_TESTFLIGHT
  import FieldDesign
  import SwiftUI
  import UIKit

  /// What a notification will look like, the place it will be set, and why nothing is set yet: no push exists, so the
  /// three switches are drawn and disabled, and the foot says how the phone tells you until then.
  struct NotificationsPage: View {
    var body: some View {
      List {
        Section {
          preview
        } footer: {
          ChromeListFoot(SettingsWords.notificationsCaption)
        }
        .chromeRows()
        Section {
          wish(SettingsWords.notifyNeedsYou, detail: SettingsWords.notifyNeedsYouDetail, on: true)
          wish(SettingsWords.notifyFinishes, on: false)
          wish(SettingsWords.notifyAsleep, on: false)
        } header: {
          ChromeListHead(SettingsWords.tellMeWhen, tags: [FactTag("Not yet", line: .dotted)])
        } footer: {
          Text(foot)
            .font(ChromeListType.detail)
            .foregroundStyle(ChromePalette.inkTertiary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .chromeRows()
      }
      .chromeList()
      .navigationTitle(SettingsWords.notificationsRow)
      .navigationBarTitleDisplayMode(.inline)
    }

    /// The plain icon over VIBEFIELD · now, and a desktop's title line: a picture of a notification, never one.
    private var preview: some View {
      HStack(alignment: .top, spacing: 12) {
        if let icon = appIcon {
          Image(uiImage: icon)
            .resizable()
            .frame(width: 38, height: 38)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
              RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5)
            }
            .accessibilityHidden(true)
        }
        VStack(alignment: .leading, spacing: 2) {
          HStack {
            Text(SettingsWords.previewApp)
              .font(ChromeListType.detail.weight(.semibold))
              .foregroundStyle(ChromePalette.inkSecondary)
            Spacer(minLength: 8)
            Text(SettingsWords.previewWhen)
              .font(ChromeListType.detail)
              .foregroundStyle(ChromePalette.inkTertiary)
          }
          Text("\(Text(SettingsWords.previewDesktop).fontWeight(.semibold)) · \(SettingsWords.previewLine)")
            .font(ChromeListType.row)
            .foregroundStyle(ChromePalette.ink)
        }
      }
      .padding(.vertical, 6)
      .accessibilityElement(children: .combine)
    }

    /// One wish, drawn and disabled: the place is reserved and nothing is promised.
    private func wish(_ title: String, detail: String? = nil, on: Bool) -> some View {
      Toggle(isOn: .constant(on)) {
        ChromeRow(title, detail: detail)
      }
      .disabled(true)
    }

    /// §9's foot, its first sentence set apart.
    private var foot: AttributedString {
      var words = AttributedString(SettingsWords.notificationsFoot(DeviceWord.current))
      if let lead = words.range(of: SettingsWords.notificationsFootLead) {
        words[lead].font = ChromeListType.detail.weight(.semibold)
      }
      return words
    }

    /// The app's own icon, as About draws it (`SettingsModel.iconName`).
    private var appIcon: UIImage? {
      SettingsModel.iconName(info: Bundle.main.infoDictionary).flatMap { UIImage(named: $0) }
    }
  }

  extension SettingsWords {
    /// RB-1 (DESIGN.md §9 "Notifications, before push"): the row, the preview, its caption, the group and its three
    /// switches, and the foot, whose first sentence is set apart.
    static let notificationsRow = "Notifications"
    static let previewApp = "VIBEFIELD"
    static let previewWhen = "now"
    static let previewDesktop = "studio"
    static let previewLine = "An agent is waiting on you"
    static let notificationsCaption = "A title and nothing more: what your agents said stays on your desktop."
    static let tellMeWhen = "Tell me when"
    static let notifyNeedsYou = "An agent needs you"
    static let notifyNeedsYouDetail = "An approval or a question"
    static let notifyFinishes = "A session finishes"
    static let notifyAsleep = "A desktop goes to sleep"
    static let notificationsFootLead = "Not built yet."
    static func notificationsFoot(_ device: DeviceWord) -> String {
      "\(notificationsFootLead) When it is, a desktop tells \(device.this) only that something happened, never what "
        + "your agents said. Until then, the orange count on the Field tab is how \(device.this) tells you."
    }
  }
#endif
