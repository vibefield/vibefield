import FieldDesign
import SwiftUI
import UIKit

/// TS-7 — the account's door, drawn on the Field page (DESIGN.md §9 "The
/// phone's door"). `FieldHomeModel.doorPage` decides WHICH page stands; this
/// draws it, in the chrome family's voice: sentence case, one act, and the
/// words the page ruled (TS-D11, the phone frames A:719-722; James, Q1 all A).
///
/// It stands over a field that keeps drifting and takes no acts (the hold
/// and the bloom are off while it does, `HomeScreen.stage`).
struct DoorPageView: View {
  let page: FieldHomeModel.DoorPage
  /// Continue with Tailscale, and Sign in again: the one act, `mesh.signIn()`.
  let onSignIn: () -> Void
  /// Room for the bar under the page.
  let bottomClearance: CGFloat

  @Environment(\.openURL) private var openURL
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      switch page {
      case .welcome(let failure): welcome(failure: failure)
      case .approval(let machine, let console): approval(machine: machine, console: console)
      case .signInAgain(let note): signInAgain(note: note)
      case .noDesktops(let login, let found): noDesktops(login: login, found: found)
      }
    }
    .frame(maxWidth: 420, alignment: .leading)
    .padding(.horizontal, 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.bottom, bottomClearance)
  }

  // MARK: The pages

  @ViewBuilder
  private func welcome(failure: String?) -> some View {
    title("Your field, in your pocket.")
    line("Approve agents, watch sessions and type into them, from anywhere your Mac is.")
    HStack(alignment: .center, spacing: 14) {
      TailscaleMark()
      Text("Private network by Tailscale. Use the same account as VibeField on your Mac.")
        .font(ChromeType.sans(ChromeType.sheetBodySize))
        .foregroundStyle(ChromePalette.inkSecondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
    .padding(.top, 28)
    act("Continue with Tailscale")
    footnote("Next, iOS asks to use tailscale.com to sign in.")
    if let failure { footnote(failure) }
  }

  @ViewBuilder
  private func approval(machine: String?, console: URL?) -> some View {
    title("Waiting for approval.")
    line("You’re signed in. An admin of your Tailscale network approves new devices.")
    HStack(spacing: 10) {
      Image(systemName: "key")
        .font(.system(size: 17, weight: .regular))
        .foregroundStyle(ChromePalette.inkSecondary)
      Text("This phone")
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(ChromePalette.ink)
      Spacer(minLength: 8)
      if let machine {
        Text(machine)
          .font(ChromeType.mono(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .textSelection(.enabled)
        Button(copied ? "Copied" : "Copy") {
          UIPasteboard.general.string = machine
          copied = true
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        }
        .font(ChromeType.sans(13, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .accessibilityLabel(copied ? "Copied" : "Copy this phone’s name")
      }
    }
    .padding(.horizontal, 14)
    .frame(minHeight: 48)
    .background { ChromeMaterial.well() }
    .padding(.top, 24)
    if let console {
      Button("Open the admin console") { openURL(console) }
        .buttonStyle(ChromePillStyle(.secondary))
        .padding(.top, 24)
    }
  }

  @ViewBuilder
  private func signInAgain(note: String?) -> some View {
    title("Sign in to Tailscale again.")
    line("This phone can’t reach your desktops until you do. Nothing here is lost.")
    act("Sign in again")
    if let note { footnote(note) }
  }

  @ViewBuilder
  private func noDesktops(login: String, found: FieldHomeModel.FoundDesktop?) -> some View {
    title("No desktops yet.")
    Text(Self.noDesktopsLine(login: login))
      .font(ChromeType.sans(15))
      .foregroundStyle(ChromePalette.inkSecondary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 10)
    // The row keeps its promise (Q1-f): the first desktop to list fills it
    // for the found beat, then the page yields to the field.
    HStack(spacing: 10) {
      DeviceMark(platform: found?.platform ?? "darwin", size: 17)
        .foregroundStyle(found == nil ? ChromePalette.inkTertiary : ChromePalette.ink)
      Text(found?.name ?? "Your Mac appears here")
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(found == nil ? ChromePalette.inkTertiary : ChromePalette.ink)
        .lineLimit(1)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 14)
    .frame(minHeight: 48)
    .background { ChromeMaterial.well() }
    .accessibilityElement(children: .combine)
    .padding(.top, 24)
    .animation(FieldMotion.ease(0.24), value: found)
  }

  /// "Connect your devices…" in the desktop menu's own weight, so the eye
  /// finds the words it will look for on the Mac.
  static func noDesktopsLine(login: String) -> AttributedString {
    var line = AttributedString("Signed in as \(login). On your Mac, open VibeField, click your face, then ")
    var act = AttributedString("Connect your devices…")
    act.font = ChromeType.sans(15, .semibold)
    act.foregroundColor = ChromePalette.ink
    line += act
    line += AttributedString(" with this same account.")
    return line
  }

  // MARK: The parts

  private func title(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.sans(28, .bold))
      .foregroundStyle(ChromePalette.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }

  private func line(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.sans(15))
      .foregroundStyle(ChromePalette.inkSecondary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 10)
  }

  private func act(_ words: String) -> some View {
    Button(words, action: onSignIn)
      .buttonStyle(ChromePillStyle(.primary))
      .padding(.top, 28)
  }

  private func footnote(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.sans(ChromeType.hintSize))
      .foregroundStyle(ChromePalette.inkTertiary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 12)
  }
}
