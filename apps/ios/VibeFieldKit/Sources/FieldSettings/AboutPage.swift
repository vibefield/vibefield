import FieldDesign
import FieldTerminal
import SwiftUI
import UIKit

/// Settings › About (IOS-10a): this phone's VibeField, your desktops, what the
/// phone is built with, and Tailscale's trademark line — which stood at the
/// foot of the terminal sheet only because the phone had no About (TS-7).
/// IOS-13a: the privacy policy and support, and the non-affiliation line under
/// Tailscale's.
///
/// The version is the bundle's own. Each desktop's VibeField, in the words its
/// own Settings › Updates uses, comes once the phone reads the roster's
/// `appVersion` (AU-3a); until then a desktop row says how it is reached.
struct AboutPage: View {
  let desktops: [SettingsDesktop]

  private var info: [String: Any]? { Bundle.main.infoDictionary }

  var body: some View {
    List {
      hero
      Section {
        ChromeRow("Version", value: SettingsModel.version(info: info))
      } header: {
        ChromeListHead(DeviceWord.current.This, tags: [FactTag("Read-only")])
      }
      .chromeRows()
      if !desktops.isEmpty {
        Section {
          ForEach(desktops) { desktop in
            let line = SettingsModel.desktopLine(desktop)
            ChromeRow(
              desktop.name, lead: .device(platform: desktop.platform), detail: line.text,
              detailWantsTheUser: line.wantsTheUser)
          }
        } header: {
          ChromeListHead("Your desktops")
        }
        .chromeRows()
      }
      Section {
        NavigationLink(value: SettingsRoute.acknowledgements) {
          ChromeRow("Acknowledgements", lead: .glyph(.document))
        }
      }
      .chromeRows()
      // IOS-13a — the privacy policy and support, outside VibeField (Safari), each trailed by §13's `outward`
      Section {
        ForEach(SettingsModel.aboutLinks) { link in
          Link(destination: link.url) {
            HStack {
              ChromeRow(link.title)
              FieldGlyph(.outward, size: 16)
                .foregroundStyle(ChromePalette.placeholder)
                .accessibilityHidden(true)
            }
          }
        }
      }
      .chromeRows()
      // One foot: Tailscale's trademark line, then the non-affiliation line (§8, amended 2026-11-05)
      VStack(spacing: 6) {
        ForEach(SettingsModel.aboutFoot, id: \.self) { line in
          Text(line)
        }
      }
      .font(ChromeListType.detail)
      .foregroundStyle(ChromePalette.inkFaint)
      .frame(maxWidth: .infinity)
      .multilineTextAlignment(.center)
      .listRowBackground(Color.clear)
    }
    .chromeList()
    .navigationTitle("About")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var hero: some View {
    VStack(spacing: 4) {
      if let icon = appIcon {
        Image(uiImage: icon)
          .resizable()
          .frame(width: 64, height: 64)
          .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
              .strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5)
          }
          .shadow(color: ChromeShadow.card.color, radius: ChromeShadow.card.radius, y: ChromeShadow.card.y)
          .padding(.bottom, 8)
          .accessibilityHidden(true)
      }
      Text("VibeField")
        .font(ChromeListType.pageName)
        .foregroundStyle(ChromePalette.ink)
      Text(heroLine)
        .font(ChromeListType.detail)
        .foregroundStyle(ChromePalette.inkTertiary)
    }
    .frame(maxWidth: .infinity)
    .listRowBackground(Color.clear)
    .accessibilityElement(children: .combine)
  }

  /// The app's own icon — its light rendition, in either look
  /// (`SettingsModel.iconName`).
  private var appIcon: UIImage? {
    SettingsModel.iconName(info: info).flatMap { UIImage(named: $0) }
  }

  private var heroLine: String {
    let version = SettingsModel.version(info: info)
    #if DEBUG
      return "\(version) · Development build"
    #else
      return version
    #endif
  }
}

/// Settings › About › Acknowledgements: what the phone draws and runs that
/// others made, each with what it is for and its licence.
struct AcknowledgementsPage: View {
  /// IOS-13a — L5's acknowledgements when the build carries them; else §9's line, then the short list (Q5).
  var state: AcknowledgementsState = Acknowledgements.main

  var body: some View {
    List {
      switch state {
      case .bundled(let doc):
        ForEach(Acknowledgements.groups(doc)) { group in
          Section {
            ForEach(group.parts) { part in
              NavigationLink(value: SettingsRoute.acknowledgement(part.id)) {
                let row = Acknowledgements.row(part)
                ChromeRow(row.title, detail: row.detail, detailIsMono: true, value: row.value)
              }
            }
          } header: {
            if !group.title.isEmpty {
              ChromeListHead(group.title)
            }
          }
          .chromeRows()
        }
      case .absent:
        notBundled(SettingsWords.acknowledgementsAbsent)
      case .unreadable(let reason):
        notBundled(SettingsWords.acknowledgementsUnreadable(reason))
      }
      Section {
        ForEach(TerminalCredits.effects) { effect in
          ChromeRow(effect.name, detail: effect.licence)
        }
      } header: {
        ChromeListHead("The terminal’s effects")
      } footer: {
        ChromeListFoot("Ghostty’s community shaders, as ghosttea ports them. Each keeps its own licence.")
      }
      .chromeRows()
    }
    .chromeList()
    .navigationTitle("Acknowledgements")
    .navigationBarTitleDisplayMode(.inline)
  }

  /// No acknowledgements to draw: the line that says so, then the short list the page has always shown, so the page
  /// still credits and is never blank.
  @ViewBuilder
  private func notBundled(_ line: String) -> some View {
    Text(line)
      .font(ChromeListType.detail)
      .foregroundStyle(ChromePalette.inkTertiary)
      .listRowBackground(Color.clear)
    Section {
      ForEach(SettingsModel.credits) { credit in
        ChromeRow(credit.name, detail: credit.role, value: credit.licence)
      }
    } header: {
      ChromeListHead("Built with")
    } footer: {
      ChromeListFoot(SettingsWords.builtWith(DeviceWord.current))
    }
    .chromeRows()
  }
}

/// IOS-13a — one part's full licence texts: each under its kind, its file names in mono above the body, and the body in
/// mono 12, selectable. A text the file does not carry is named (§9), never dropped.
struct AcknowledgementTextsPage: View {
  let part: AcknowledgementsDoc.Part
  let doc: AcknowledgementsDoc

  var body: some View {
    List {
      ForEach(Array(Acknowledgements.texts(of: part, in: doc).enumerated()), id: \.offset) { _, resolved in
        switch resolved {
        case .text(let text):
          Section {
            VStack(alignment: .leading, spacing: 8) {
              if !text.files.isEmpty {
                Text(text.files.joined(separator: " · "))
                  .font(ChromeListType.detailMono)
                  .foregroundStyle(ChromePalette.inkTertiary)
              }
              Text(text.body)
                .font(ChromeType.mono(12))
                .foregroundStyle(ChromePalette.ink)
                .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
          } header: {
            ChromeListHead(text.kind)
          }
          .chromeRows()
        case .missing(let id):
          Section {
            Text(SettingsWords.textMissing(id))
              .font(ChromeListType.detail)
              .foregroundStyle(ChromePalette.inkTertiary)
          }
          .chromeRows()
        }
      }
    }
    .chromeList()
    .navigationTitle(part.name)
    .navigationBarTitleDisplayMode(.inline)
  }
}
