import FieldDesign
import FieldTerminal
import SwiftUI

/// The phone's Settings (IOS-10a; the design page "Settings in a Pocket",
/// revised 2026-10-31): a sheet on paper, headed by you, as the desktop's
/// Settings is (§8 "The Me menu": "Settings stays the centred dialog, headed
/// by you"). It holds your desktops as glances and this phone's own
/// preferences; anything that belongs to a Mac stays on the Mac.
///
/// iOS's own parts — a `NavigationStack`, inset-grouped lists, large and
/// inline titles, the system's back and close — in the chrome family's voice:
/// History's paper and fill, its group heads (`chromeGroupHead`), §13's glyphs
/// bare in the secondary ink, a desktop as its OS mark, the ink switch. Every
/// size is a text style, so the pages move with the reader's text size.
///
/// The design page's open marks stand at their leans here (heads: History's
/// eyebrow; glyphs: bare; switch: ink); each is one modifier to change.
public struct SettingsView: View {
  private let account: SettingsAccount
  @Binding private var terminal: TerminalAppearance
  private let actions: SettingsActions
  /// Settings' own routes, then the Terminal page's: two kinds of value, so a
  /// `NavigationPath` rather than an array of one.
  @State private var path: NavigationPath
  @AppStorage(PhoneAppearance.storageKey) private var look: PhoneAppearance = .auto
  @Environment(\.dismiss) private var dismiss

  /// - Parameter opening: where the sheet opens — the card's `···` opens it on
  ///   Terminal (`.terminal`), with Settings one step back.
  public init(
    account: SettingsAccount, terminal: Binding<TerminalAppearance>, opening: SettingsOpening = .root,
    actions: SettingsActions
  ) {
    self.account = account
    _terminal = terminal
    self.actions = actions
    var path = NavigationPath()
    for route in opening.routes { path.append(route) }
    if let page = opening.terminalPage { path.append(page) }
    _path = State(initialValue: path)
  }

  public var body: some View {
    NavigationStack(path: $path) {
      root
        .navigationDestination(for: SettingsRoute.self) { route in
          page(route)
            .toolbar { closeItem }
        }
        .navigationDestination(for: TerminalSettingsRoute.self) { route in
          route.destination(appearance: $terminal)
            .toolbar { closeItem }
        }
    }
    .tint(ChromePalette.ink)
    .toggleStyle(ChromeSwitchStyle())
  }

  // MARK: - The root

  private var root: some View {
    List {
      Section {
        head
      }
      .chromeRows()
      if account.isSignedIn {
        desktops
      }
      Section {
        NavigationLink(value: SettingsRoute.appearance) {
          ChromeRow("Appearance", lead: .glyph(.sun), value: look.word)
        }
        NavigationLink(value: SettingsRoute.terminal) {
          ChromeRow("Terminal", lead: .glyph(.terminal), value: terminal.shownThemeName)
        }
      } header: {
        ChromeListHead("This phone")
      }
      .chromeRows()
      Section {
        NavigationLink(value: SettingsRoute.about) {
          ChromeRow("About", lead: .glyph(.package), value: SettingsModel.version(info: Bundle.main.infoDictionary))
        }
      }
      .chromeRows()
    }
    .chromeList()
    .navigationTitle("Settings")
    .navigationBarTitleDisplayMode(.large)
    .toolbar { closeItem }
  }

  /// Headed by you: your face, your name and your login, which open Account;
  /// signed out, the way in.
  @ViewBuilder
  private var head: some View {
    let lines = SettingsModel.headLines(account)
    if account.standing == .signedOut {
      Button(action: actions.signIn) {
        HStack(spacing: 14) {
          AccountMark(account: account, size: 60)
          VStack(alignment: .leading, spacing: 3) {
            Text("Continue with Tailscale")
              .font(ChromeListType.accountName)
              .foregroundStyle(ChromePalette.ink)
            if let note = lines.note {
              Text(note)
                .font(ChromeListType.detail)
                .foregroundStyle(ChromePalette.inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
          Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
    } else {
      NavigationLink(value: SettingsRoute.account) {
        HStack(spacing: 14) {
          AccountMark(account: account, size: 60, dot: lines.status?.wantsTheUser == true)
          VStack(alignment: .leading, spacing: 3) {
            Text(account.name)
              .font(ChromeListType.accountName)
              .foregroundStyle(ChromePalette.ink)
              .lineLimit(1)
              .minimumScaleFactor(0.7)
            if let status = lines.status {
              Text(status.text)
                .font(ChromeListType.row)
                .foregroundStyle(status.wantsTheUser ? ChromePalette.attention : ChromePalette.inkTertiary)
            } else if let login = account.loginLine {
              Text(login)
                .font(ChromeListType.detailMono)
                .foregroundStyle(ChromePalette.inkTertiary)
                .lineLimit(1)
                .truncationMode(.middle)
            }
            if let note = lines.note {
              Text(note)
                .font(ChromeListType.detail)
                .foregroundStyle(ChromePalette.inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .padding(.vertical, 8)
      }
      .accessibilityLabel("\(account.name), \(lines.status?.text ?? account.login ?? ""), account")
    }
  }

  private var desktops: some View {
    Section {
      if account.desktops.isEmpty {
        Text("None yet")
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.placeholder)
      } else {
        ForEach(account.desktops) { desktop in
          let line = SettingsModel.desktopLine(desktop)
          NavigationLink(value: SettingsRoute.desktop(desktop.id)) {
            ChromeRow(
              desktop.name, lead: .device(platform: desktop.platform), detail: line.text,
              detailWantsTheUser: line.wantsTheUser)
          }
        }
      }
    } header: {
      ChromeListHead("Your desktops")
    } footer: {
      if account.desktops.isEmpty {
        ChromeListFoot(SettingsModel.noDesktopsFoot(account.standing))
      }
    }
    .chromeRows()
  }

  // MARK: - The pages

  @ViewBuilder
  private func page(_ route: SettingsRoute) -> some View {
    switch route {
    case .account:
      AccountPage(account: account, actions: actions)
    case .desktop(let id):
      if let desktop = account.desktops.first(where: { $0.id == id }) {
        DesktopPage(desktop: desktop, standing: account.standing)
      } else {
        // The desktop left the roster while its page stood (signed out, or
        // forgotten): say so rather than draw a blank.
        List {
          Section {
            ChromeRow("Not on this phone now", detail: "It returns to Your desktops the next time it answers.")
          }
          .chromeRows()
        }
        .chromeList()
      }
    case .appearance:
      AppearancePage(look: $look)
    case .terminal:
      TerminalSettingsPage(appearance: $terminal)
    case .about:
      AboutPage(desktops: account.desktops)
    case .acknowledgements:
      AcknowledgementsPage()
    }
  }

  @ToolbarContentBuilder
  private var closeItem: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      if #available(iOS 26.0, *) {
        Button(role: .close) { dismiss() }
      } else {
        Button("Done") { dismiss() }
          .fontWeight(.semibold)
      }
    }
  }
}

/// Your face at the head of Settings and of Account — the corner's own face
/// (`UserFaceView`, §2.8), tilted because it is over 40 pt — or, before any
/// desktop has said who you are, the plain circle the corner wears. The dot is
/// §2.5's orange beside the face, never on it (I-5).
struct AccountMark: View {
  let account: SettingsAccount
  let size: CGFloat
  var dot: Bool = false

  var body: some View {
    ZStack {
      if let face = account.face, account.isSignedIn {
        UserFaceView(face: face, size: size, seed: account.seed, held: false)
      } else {
        Circle()
          .fill(ChromePalette.paper)
          .overlay { Circle().strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
          .overlay {
            Image(systemName: "person")
              .font(.system(size: size * 0.42, weight: .regular))
              .foregroundStyle(ChromePalette.inkSecondary)
          }
          .frame(width: size, height: size)
      }
    }
    .overlay(alignment: .topTrailing) {
      if dot {
        Circle()
          .fill(ChromePalette.attention)
          .frame(width: 12, height: 12)
          .overlay { Circle().strokeBorder(ChromePalette.paper, lineWidth: 2) }
          .offset(x: 1, y: -1)
      }
    }
    .accessibilityHidden(true)
  }
}
