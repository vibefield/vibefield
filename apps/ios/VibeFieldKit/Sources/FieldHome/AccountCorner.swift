import FieldDesign
import SwiftUI

/// The account corner (IOS-8b, AP-D1/D5): the owner's face in a glass circle
/// at the bottom-left, and the menu that grows from it — the desktop's Me
/// corner (UA-D19, DESIGN.md §8) at touch pitch.
///
/// ONE element changes role: the circle around the face IS the menu, grown on
/// the island's curve into a 276 pt panel of solid chrome, corners concentric
/// with the circle. The face never moves, so the second tap lands on the same
/// face and folds it away. It reads bottom-up, nearest first: you · your
/// desktops · Settings… · Sign in (only while the tailnet asks for it) · Sign
/// out farthest from the thumb. There is no connect or disconnect: the phone
/// stays on the mesh by itself while it is signed in (2026-10-18).
///
/// Every word is `FieldHomeModel.accountFace`'s; this draws what it is handed.
///
/// **Where it stands (IOS-9e).** In the bar's LEFT corner, the search
/// circle's mirror, at the search circle's size — `circle` IS `AppBar.height`,
/// and a test pins that. (IOS-9a had put it beside the search circle at 50 pt,
/// because the system's tab bar gave the left to its capsule; the bar is ours
/// now and the capsule is centred between the two circles, as the page drew
/// it.) Its closed glass is the system's where the phone has it (Liquid Glass
/// on 26, `liquidGlassCircle`; the chrome family's recipe below). Not signed
/// in, it is the same circle saying `Sign in` under a glyph, like a tab: the
/// act in words, and never a shape of another size.
struct AccountCornerView: View {
  let face: FieldHomeModel.AccountFace
  let isOpen: Bool
  /// The tilt's seed — the login, so the face sits at one angle on every
  /// launch of this account.
  let seed: String
  let onToggle: () -> Void
  let onSettings: () -> Void
  let onSignOut: () -> Void
  let onSignIn: () -> Void

  /// The circle's diameter — the bar's row, so the corner and the search
  /// circle are one size — and the menu's corner radius twice over.
  static let circle: CGFloat = AppBar.height
  /// The face inside it: two thirds of the circle, the proportion the 50 pt
  /// corner wore (34), and over §2.8's 40 pt line, so it tilts.
  static let faceSize: CGFloat = 42
  static let menuWidth: CGFloat = 276
  /// The island's curve (`--vf-ease-island`, 600 ms) — the menu's grow.
  static let grow: Animation = .timingCurve(0.25, 1, 0.3, 1, duration: 0.6)

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    if face.control == .signIn {
      signInCircle
    } else {
      menu
    }
  }

  // MARK: - Not signed in: the corner is the act

  /// The same circle, saying the act in words under a glyph — the tab items'
  /// own voice (an icon over a 10 pt label) — so the corner keeps its size
  /// and place whether or not anyone is signed in.
  private var signInCircle: some View {
    Button {
      onSignIn()
    } label: {
      VStack(spacing: 2) {
        Image(systemName: "person.crop.circle")
          .font(.system(size: 21, weight: .medium))
        Text("Sign in")
          .font(.system(size: AppBar.labelSize, weight: .semibold))
          .lineLimit(1)
      }
      .foregroundStyle(ChromePalette.ink)
      .frame(width: Self.circle, height: Self.circle)
      .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .liquidGlassCircle()
    .accessibilityLabel("Sign in with Tailscale")
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
          .frame(width: 10, height: 10)
          .overlay { Circle().strokeBorder(ChromePalette.menuSurface, lineWidth: 2) }
          .padding(5)
          .transition(.opacity)
          .accessibilityHidden(true)
      }
    }
    .animation(reduceMotion ? .easeInOut(duration: 0.12) : Self.grow, value: isOpen)
  }

  /// Solid chrome when open (§8, James: "do not make it transparent"); the
  /// system's glass when it is only the circle — Liquid Glass on iOS 26, the
  /// chrome family's recipe before it.
  @ViewBuilder
  private var panel: some View {
    ZStack {
      Color.clear
        .frame(width: Self.circle, height: Self.circle)
        .liquidGlassCircle(shadow: nil)
        .opacity(isOpen ? 0 : 1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
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
            .font(.system(size: 24, weight: .regular))
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
      if face.offersSignIn {
        AccountMenuRow(glyph: "key", label: "Sign in", action: onSignIn)
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
        .frame(width: AccountCornerView.circle - 12)
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
