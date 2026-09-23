import FieldDesign
import FieldSwarm
import SwiftUI

/// The account corner (IOS-8b, AP-D1/D5): the owner's face in a 50 pt glass
/// circle at the bottom-left, and the menu that grows from it — the desktop's
/// Me corner (UA-D19, DESIGN.md §8) at touch pitch.
///
/// ONE element changes role: the circle around the face IS the menu, grown on
/// the island's curve into a 276 pt panel of solid chrome, corners concentric
/// with the circle. The face never moves, so the second tap lands on the same
/// face and folds it away. It reads bottom-up, nearest first: you · your
/// desktops · Settings… · the connection's act · Sign out farthest from the
/// thumb. Not signed in, the corner is the act — `Sign in` in the same glass,
/// words only, because the tab bar's capsule will begin 85 pt from the edge.
///
/// Every word is `FieldHomeModel.accountFace`'s; this draws what it is handed.
/// The whole thing is a swarm obstacle, open or closed.
struct AccountCornerView: View {
  let face: FieldHomeModel.AccountFace
  let isOpen: Bool
  /// The tilt's seed — the login, so the face sits at one angle on every
  /// launch of this account.
  let seed: String
  let onToggle: () -> Void
  let onSettings: () -> Void
  let onSignOut: () -> Void
  let onConnection: (FieldHomeModel.AccountFace.ConnectionAct) -> Void

  /// The circle's diameter, and the menu's corner radius twice over.
  static let circle: CGFloat = 50
  static let faceSize: CGFloat = 34
  static let menuWidth: CGFloat = 276
  /// The island's curve (`--vf-ease-island`, 600 ms) — the menu's grow.
  static let grow: Animation = .timingCurve(0.25, 1, 0.3, 1, duration: 0.6)

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    if face.control == .signIn {
      signInPill
    } else {
      menu
    }
  }

  // MARK: - Not signed in: the corner is the act

  private var signInPill: some View {
    Button {
      onConnection(.connect)
    } label: {
      Text("Sign in")
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(ChromePalette.ink)
        .padding(.horizontal, 16)
        .frame(height: Self.circle)
    }
    .buttonStyle(.plain)
    .background { ChromeMaterial.glass(radius: Self.circle / 2, shadow: ChromeShadow.card) }
    .accessibilityLabel("Sign in with Tailscale")
    .swarmObstacle()
  }

  // MARK: - The face, and the menu it grows into

  private var menu: some View {
    VStack(alignment: .leading, spacing: 0) {
      if isOpen {
        rows
          .frame(width: Self.menuWidth, alignment: .leading)
          .transition(.opacity)
      }
      HStack(alignment: .center, spacing: 0) {
        faceButton
        if isOpen {
          youRow
            .transition(.opacity.combined(with: .offset(x: -6)))
        }
      }
    }
    .frame(width: isOpen ? Self.menuWidth : Self.circle, alignment: .bottomLeading)
    .background { panel }
    .clipShape(RoundedRectangle(cornerRadius: Self.circle / 2, style: .continuous))
    .background {
      // The menu's shadow rides OUTSIDE the clip; the closed circle's glass
      // carries its own.
      RoundedRectangle(cornerRadius: Self.circle / 2, style: .continuous)
        .fill(Color.clear)
        .shadow(
          color: isOpen ? ChromeShadow.menu.color : .clear, radius: ChromeShadow.menu.radius, x: 0,
          y: ChromeShadow.menu.y)
    }
    .overlay(alignment: .topTrailing) {
      // The dot (AP-D7): §2.5 orange, ringed in the chrome, beside the face
      // and never on it — and gone the moment the words take over.
      if face.wantsAttention && !isOpen {
        Circle()
          .fill(ChromePalette.attention)
          .frame(width: 9, height: 9)
          .overlay { Circle().strokeBorder(ChromePalette.menuSurface, lineWidth: 2) }
          .padding(3)
          .transition(.opacity)
          .accessibilityHidden(true)
      }
    }
    .animation(reduceMotion ? .easeInOut(duration: 0.12) : Self.grow, value: isOpen)
    .swarmObstacle()
  }

  /// Solid chrome when open (§8, James: "do not make it transparent"); the
  /// card's glass when it is only the circle.
  @ViewBuilder
  private var panel: some View {
    ZStack {
      ChromeMaterial.glass(radius: Self.circle / 2, shadow: nil)
        .opacity(isOpen ? 0 : 1)
      RoundedRectangle(cornerRadius: Self.circle / 2, style: .continuous)
        .fill(ChromePalette.menuSurface)
        .overlay {
          RoundedRectangle(cornerRadius: Self.circle / 2, style: .continuous)
            .strokeBorder(ChromePalette.menuHairline, lineWidth: 0.5)
        }
        .opacity(isOpen ? 1 : 0)
    }
  }

  private var faceButton: some View {
    Button(action: onToggle) {
      ZStack {
        switch face.control {
        case .face(let userFace):
          UserFaceView(face: userFace, size: Self.faceSize, seed: seed, held: isOpen)
        case .blank, .signIn:
          // Signed in, and no desktop has said who you are yet: a plain
          // circle, never a face it would have to take back.
          Image(systemName: "person")
            .font(.system(size: 20, weight: .regular))
            .foregroundStyle(ChromePalette.inkSecondary)
        }
      }
      .frame(width: Self.circle, height: Self.circle)
      .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(face.name.isEmpty ? "Account" : "\(face.name): account")
    .accessibilityAddTraits(.isButton)
    .accessibilityValue(isOpen ? "menu open" : "")
  }

  /// You, beside the face: the name, and the login line or the connection's
  /// word under it. Tapping it opens Settings — the account's own page, when
  /// the phone has one; today the settings sheet.
  private var youRow: some View {
    Button(action: onSettings) {
      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 1) {
          Text(face.name.isEmpty ? "You" : face.name)
            .font(ChromeType.sans(15, .medium))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          if let detail = face.detail {
            Text(detail)
              .font(face.detailIsLogin ? ChromeType.mono(11) : ChromeType.sans(11.5))
              .foregroundStyle(face.detailWantsAttention ? ChromePalette.attention : ChromePalette.inkTertiary)
              .lineLimit(1)
              .truncationMode(.middle)
          }
        }
        Spacer(minLength: 6)
        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ChromePalette.placeholder)
      }
      .padding(.leading, 8)
      .padding(.trailing, 14)
      .frame(width: Self.menuWidth - Self.circle, height: Self.circle, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(face.name.isEmpty ? "You" : face.name)\(face.detail.map { ", \($0)" } ?? "") — settings")
  }

  /// The rows above you, top to bottom as they stand on screen.
  private var rows: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let notice = face.notice {
        Text(notice)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.attention)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 14)
          .padding(.top, 10)
          .padding(.bottom, 6)
      }
      if face.canSignOut {
        AccountMenuRow(glyph: "rectangle.portrait.and.arrow.right", label: "Sign out", action: onSignOut)
      }
      if let act = face.connectionAct {
        AccountMenuRow(glyph: act.glyph, label: act.label) { onConnection(act) }
      }
      AccountMenuRow(glyph: "gearshape", label: "Settings…", action: onSettings)
      separator
      if !face.desktops.isEmpty {
        ChromeEyebrow("Your desktops")
          .padding(.horizontal, 14)
          .padding(.top, 8)
          .padding(.bottom, 4)
        ForEach(face.desktops) { row in
          AccountMenuRow(
            glyph: "laptopcomputer", label: row.name, word: row.word, wantsTheUser: row.wantsTheUser,
            action: nil)
        }
      }
      if let others = face.othersLine {
        Text(others)
          .font(ChromeType.sans(12.5))
          .foregroundStyle(ChromePalette.placeholder)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 14)
          .padding(.top, 2)
          .padding(.bottom, 8)
      }
      separator
    }
    .padding(.top, 6)
    .padding(.horizontal, 6)
  }

  private var separator: some View {
    Rectangle()
      .fill(ChromePalette.separator)
      .frame(height: 1)
      .padding(.horizontal, 6)
      .padding(.vertical, 4)
  }
}

extension FieldHomeModel.AccountFace.ConnectionAct {
  var label: String {
    switch self {
    case .connect: "Connect"
    case .signIn: "Sign in"
    case .disconnect: "Disconnect"
    }
  }

  var glyph: String {
    switch self {
    case .connect: "antenna.radiowaves.left.and.right"
    case .signIn: "key"
    case .disconnect: "antenna.radiowaves.left.and.right.slash"
    }
  }
}

/// One menu row: a glyph in the face's own 50 pt column, a label, and an
/// optional trailing word — orange with a dot when it is one of the things
/// only the person can fix.
struct AccountMenuRow: View {
  let glyph: String
  let label: String
  var word: String? = nil
  var wantsTheUser: Bool = false
  let action: (() -> Void)?

  var body: some View {
    Group {
      if let action {
        Button(action: action) { content }
          .buttonStyle(AccountRowStyle())
      } else {
        content
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var content: some View {
    HStack(spacing: 4) {
      Image(systemName: glyph)
        .font(.system(size: 17, weight: .regular))
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: AccountCornerView.circle - 6)
      Text(label)
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(ChromePalette.ink)
        .lineLimit(1)
      if let word {
        Spacer(minLength: 8)
        HStack(spacing: 6) {
          if wantsTheUser {
            Circle().fill(ChromePalette.attention).frame(width: 6, height: 6)
          }
          Text(word)
            .font(ChromeType.sans(13))
            .foregroundStyle(wantsTheUser ? ChromePalette.attention : ChromePalette.inkTertiary)
            .lineLimit(1)
        }
        .padding(.trailing, 12)
      } else {
        Spacer(minLength: 0)
      }
    }
    .frame(minHeight: 44)
    .contentShape(RoundedRectangle(cornerRadius: ChromeRadius.row, style: .continuous))
  }
}

private struct AccountRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background {
        RoundedRectangle(cornerRadius: ChromeRadius.row, style: .continuous)
          .fill(ChromePalette.rowSelected)
          .opacity(configuration.isPressed ? 1 : 0)
      }
  }
}
