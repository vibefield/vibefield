import FieldDesign
import SwiftUI

/// Settings › one of your desktops (IOS-10a): a read-only glance — what it
/// runs on, whether it serves its terminals to your devices, and what this
/// phone can do with it. Nothing here manages the desktop; its own Settings
/// does. A desktop that is not reachable now keeps its facts, dimmed, and says
/// why in words — asleep is grey, never "offline" (§9); what the phone can do
/// with it is drawn only while it is connected.
///
/// Later slices read more, each a glance like these: its agent catalog and
/// profile sets over its door, its History's index, its VibeField version
/// (the roster's `appVersion`). Its running agents are the Field's, read
/// through the home (PG-L4.6), never here.
struct DesktopPage: View {
  let desktop: SettingsDesktop
  let standing: SettingsAccount.Standing

  var body: some View {
    let line = SettingsModel.desktopLine(desktop)
    List {
      head(line)
      Section {
        if DeviceMark.OS(platform: desktop.platform) != .unknown {
          ChromeRow("Runs on", value: DeviceMark.OS(platform: desktop.platform).label)
        }
        if let terminals = SettingsModel.terminalsValue(desktop) {
          ChromeRow("Terminals", value: terminals)
        }
        if case .wantsYou(_, let reason?) = desktop.reach {
          ChromeRow("It said", detail: reason, detailIsMono: true)
        }
      } header: {
        ChromeListHead("This desktop", tags: [FactTag("Read-only")])
      } footer: {
        if desktop.isAsleep {
          ChromeListFoot(SettingsModel.asleepFoot(desktop, standing: standing))
        }
      }
      .chromeRows()
      .opacity(desktop.isAsleep ? 0.62 : 1)
      // Its abilities while it answers: one dialing, refused or incompatible
      // says so in its head and is not asked for anything (DS-L9).
      if desktop.reach == .connected {
        Section {
          ForEach(SettingsModel.abilities(desktop), id: \.title) { ability in
            HStack(spacing: 12) {
              ChromeRow(ability.title, detail: ability.detail)
              if ability.can {
                FieldGlyph(.check, size: 18)
                  .foregroundStyle(ChromePalette.ink)
                  .accessibilityLabel("Yes")
              } else if ability.detail == nil {
                FactTag("Not yet", line: .dotted)
              }
            }
            .accessibilityElement(children: .combine)
          }
        } header: {
          ChromeListHead("From this phone you can")
        } footer: {
          ChromeListFoot(
            "Your desktops give your phone the same things, because it is you. Another account’s "
              + "desktop gives it nothing, and isn’t shown.")
        }
        .chromeRows()
      }
    }
    .chromeList()
    .navigationTitle(desktop.name)
    .navigationBarTitleDisplayMode(.inline)
  }

  /// The desktop as itself: its OS mark on a tile, its name, and its line.
  private func head(_ line: SettingsModel.Line) -> some View {
    HStack(spacing: 14) {
      DeviceMark(platform: desktop.platform, size: 30)
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: 56, height: 56)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ChromePalette.fill))
      VStack(alignment: .leading, spacing: 2) {
        Text(desktop.name)
          .font(ChromeListType.pageName)
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        HStack(spacing: 6) {
          if line.wantsTheUser {
            Circle().fill(ChromePalette.attention).frame(width: 6, height: 6)
          } else if desktop.reach == .connected {
            Circle().fill(ChromePalette.green).frame(width: 6, height: 6)
          }
          Text(line.text)
            .font(ChromeListType.detail)
            .foregroundStyle(line.wantsTheUser ? ChromePalette.attention : ChromePalette.inkTertiary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      Spacer(minLength: 0)
    }
    .listRowBackground(Color.clear)
    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 0, trailing: 4))
    .accessibilityElement(children: .combine)
  }
}
