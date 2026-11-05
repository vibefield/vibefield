import FieldDesign
import SwiftUI

/// Settings › Account (IOS-10a): your face and where it comes from, this
/// phone's own sign-in to Tailscale, its network details, and the way out.
///
/// There is no connect and no disconnect: signed in is connected, and the
/// phone reaches the network again by itself (2026-10-18). The words are the
/// phone's door's (DESIGN.md §9): "Connected", "Sign in to Tailscale again",
/// "Waiting for approval"; "tailnet" and the machine name stay in Network
/// details (TS-L2). Tailscale's mark is kept exact and never under its 48 pt
/// floor (`TailscaleMark`, TS-D4), which is why About carries its trademark
/// line.
struct AccountPage: View {
  let account: SettingsAccount
  let actions: SettingsActions
  @State private var confirmingSignOut = false

  var body: some View {
    List {
      hero
      faceSection
      tailscaleSection
      if account.machineName != nil || account.tailnet != nil {
        networkSection
      }
      Section {
        Button(role: .destructive) {
          confirmingSignOut = true
        } label: {
          Text("Sign out")
            .font(ChromeListType.row)
            .foregroundStyle(ChromePalette.red)
            .frame(maxWidth: .infinity)
        }
      } footer: {
        ChromeListFoot(SettingsWords.signOutMessage(DeviceWord.current))
      }
      .chromeRows()
    }
    .chromeList()
    .navigationTitle("Account")
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog(
      SettingsWords.signOutTitle(login: account.login), isPresented: $confirmingSignOut,
      titleVisibility: .visible
    ) {
      Button("Sign out", role: .destructive) { actions.signOut() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(SettingsWords.signOutMessage(DeviceWord.current))
    }
  }

  // MARK: - You

  private var hero: some View {
    VStack(spacing: 4) {
      AccountMark(account: account, size: 76)
        .padding(.bottom, 8)
      Text(account.name)
        .font(ChromeListType.pageName)
        .foregroundStyle(ChromePalette.ink)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .multilineTextAlignment(.center)
      if let login = account.loginLine {
        Text(login)
          .font(ChromeListType.detailMono)
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
          .truncationMode(.middle)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 4)
    .listRowBackground(Color.clear)
    .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 0, trailing: 20))
    .accessibilityElement(children: .combine)
  }

  private var faceSection: some View {
    let words = SettingsModel.faceWords(account.faceSource, face: account.face, device: DeviceWord.current)
    return Section {
      HStack(spacing: 12) {
        Group {
          if let face = account.face {
            UserFaceView(face: face, size: 30, seed: account.seed, held: false)
          } else {
            Image(systemName: "person")
              .font(.system(size: 17, weight: .regular))
              .foregroundStyle(ChromePalette.inkSecondary)
          }
        }
        .frame(width: ChromeRow.leadWidth + 4)
        .accessibilityHidden(true)
        ChromeRow("Face", value: words.value)
      }
    } header: {
      ChromeListHead("Your face", tags: faceTags)
    } footer: {
      ChromeListFoot(words.foot)
    }
    .chromeRows()
  }

  private var faceTags: [FactTag] {
    switch account.faceSource {
    case .none: [FactTag("No desktop yet", line: .dashed)]
    case .dealt: [FactTag(DeviceWord.current.This)]
    case .home(let desktop): [FactTag("From \(desktop)")]
    }
  }

  // MARK: - Tailscale

  private var tailscaleSection: some View {
    let state = SettingsModel.tailscaleState(account.standing)
    let foot = SettingsModel.tailscaleFoot(account.standing, device: DeviceWord.current)
    return Section {
      HStack(spacing: 14) {
        TailscaleMark(size: 56)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            if state.wantsTheUser {
              Circle().fill(ChromePalette.attention).frame(width: 7, height: 7)
            }
            Text(state.text)
              .font(ChromeListType.row.weight(.semibold))
              .foregroundStyle(state.wantsTheUser ? ChromePalette.attention : ChromePalette.ink)
              .fixedSize(horizontal: false, vertical: true)
          }
          Text("Your devices, privately, by Tailscale.")
            .font(ChromeListType.detail)
            .foregroundStyle(ChromePalette.inkTertiary)
          if let login = account.login {
            Text(login)
              .font(ChromeListType.detailMono)
              .foregroundStyle(ChromePalette.inkTertiary)
              .lineLimit(1)
              .truncationMode(.middle)
          }
        }
        .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
      }
      .padding(.vertical, 8)
      .accessibilityElement(children: .combine)
      if account.standing == .signInAgain {
        Button(action: actions.signIn) {
          ChromeRow("Sign in again")
        }
        .buttonStyle(.plain)
      }
      if account.standing == .waitingForApproval, let console = account.adminConsole {
        Link(destination: console) {
          HStack {
            ChromeRow("Open the admin console")
            FieldGlyph(.outward, size: 16)
              .foregroundStyle(ChromePalette.placeholder)
              .accessibilityHidden(true)
          }
        }
      }
    } header: {
      ChromeListHead("Tailscale", tags: [FactTag(DeviceWord.current.This)])
    } footer: {
      ChromeListFoot(foot.text, attention: foot.wantsTheUser)
    }
    .chromeRows()
  }

  // MARK: - Network details

  private var networkSection: some View {
    Section {
      if let machine = account.machineName {
        HStack(spacing: 12) {
          ChromeRow(DeviceWord.current.This, value: machine, valueIsMono: true)
          CopyButton(text: machine, label: SettingsWords.copyName(DeviceWord.current))
        }
      }
      if let tailnet = account.tailnet {
        ChromeRow("Tailnet", value: tailnet, valueIsMono: true)
      }
    } header: {
      ChromeListHead("Network details")
    } footer: {
      ChromeListFoot(SettingsWords.networkFoot(DeviceWord.current))
    }
    .chromeRows()
  }
}

/// Copy, then "Copied" for a moment — the approval page's own act (TS-7).
struct CopyButton: View {
  let text: String
  let label: String
  @State private var copied = false

  var body: some View {
    Button(copied ? "Copied" : "Copy") {
      UIPasteboard.general.string = text
      copied = true
      Task {
        try? await Task.sleep(for: .seconds(1.5))
        copied = false
      }
    }
    .buttonStyle(.borderless)
    .font(ChromeListType.detail.weight(.semibold))
    .foregroundStyle(ChromePalette.ink)
    .accessibilityLabel(copied ? "Copied" : label)
  }
}
