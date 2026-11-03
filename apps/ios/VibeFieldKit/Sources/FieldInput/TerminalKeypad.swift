import FieldDesign
import FieldTerminal
import SwiftUI

/// A task-focused keyboard with stable geometry across all three pages. Its
/// keys always target the terminal; ABC restores the system's text keyboard.
struct TerminalKeypad: View {
  let model: InputCardModel
  var isAccessibilitySize = false
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast
  @AppStorage("terminal.keypad.profile") private var profile = "common"
  @AppStorage("terminal.keypad.tmuxPrefix") private var tmuxPrefix = "b"

  private let gap: CGFloat = 8
  private let radius: CGFloat = 17
  private var labelSize: CGFloat { isAccessibilitySize ? 17 : 15 }
  private var ink: Color { ChromePalette.ink }
  private var prefix: Character {
    let value = tmuxPrefix.lowercased()
    return value.count == 1 && value.first!.isASCII && value.first!.isLetter ? value.first! : "b"
  }
  private var pack: ComboPack {
    switch profile {
    case "claude": return ComboCatalog.claude
    case "tmux": return ComboCatalog.tmux(prefix: prefix)
    case "emacs": return ComboCatalog.emacs
    case "screen": return ComboCatalog.screen
    default: return ComboCatalog.common
    }
  }

  var body: some View {
    GeometryReader { geometry in
      let wide = geometry.size.width > 560 && geometry.size.height < 300
      Group {
        if wide {
          HStack(spacing: 12) {
            pagePicker(vertical: true).frame(width: 100)
            page(wide: true).frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        } else {
          VStack(spacing: gap) {
            page(wide: false).frame(maxWidth: .infinity, maxHeight: .infinity)
            pagePicker(vertical: false).frame(height: 44)
          }
        }
      }
      .padding(.horizontal, wide ? 18 : 12)
      .padding(.top, wide ? 4 : 8)
      .padding(.bottom, max(8, model.keypadGeometry.bottomInset))
      .frame(maxWidth: 760, maxHeight: .infinity)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background { surface }
    }
    .clipped()
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder private var surface: some View {
    let shape = UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
    if reduceTransparency {
      shape.fill(Color(uiColor: .secondarySystemBackground))
    } else if #available(iOS 26, *) {
      shape.fill(Color.clear)
        .glassEffect(.regular, in: shape)
    } else {
      shape.fill(.regularMaterial)
    }
  }

  private func pagePicker(vertical: Bool) -> some View {
    let layout =
      vertical ? AnyLayout(VStackLayout(spacing: 2)) : AnyLayout(HStackLayout(spacing: 6))
    return layout {
      ForEach(KeypadPage.allCases, id: \.self) { candidate in
        Button {
          guard model.keypadPage != candidate else { return }
          model.keypadPage = candidate
          InputHaptics.page()
        } label: {
          Text(candidate.title)
            .font(.system(size: isAccessibilitySize ? 16 : 14, weight: .medium))
            .foregroundStyle(model.keypadPage == candidate ? ink : ChromePalette.inkSecondary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background {
              if model.keypadPage == candidate {
                Capsule().fill(ink.opacity(colorScheme == .dark ? 0.11 : 0.07))
                  .overlay { Capsule().strokeBorder(ink.opacity(0.08), lineWidth: 0.5) }
              }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(candidate.title) page")
        .accessibilityAddTraits(model.keypadPage == candidate ? [.isSelected] : [])
        .accessibilityIdentifier("keypad-page-\(candidate.rawValue)")
      }
    }
  }

  @ViewBuilder private func page(wide: Bool) -> some View {
    switch model.keypadPage {
    case .keys: navigation(wide: wide)
    case .combos: shortcuts(wide: wide)
    case .functions:
      keyGrid(columns: wide ? 6 : 4, count: 12) { index in
        key("F\(index + 1)", label: "F\(index + 1)") { model.tapKey(.function(index + 1)) }
      }
    }
  }

  private func navigation(wide: Bool) -> some View {
    GeometryReader { geometry in
      if wide {
        let order = [0, 1, 2, 4, 5, 12, 13, 3, 9, 6, 7, 8, 10, 11]
        keyGrid(columns: 7, count: order.count) { index in navigationKey(index: order[index]) }
      } else {
        let unit = max(1, (geometry.size.height - gap * 3) / 4)
        HStack(spacing: gap) {
          VStack(spacing: gap) {
            keyGrid(columns: 3, count: 9) { index in navigationKey(index: index) }
            HStack(spacing: gap) {
              navigationKey(index: 9)
              navigationKey(index: 10)
              navigationKey(index: 11)
            }.frame(height: unit)
          }
          VStack(spacing: gap) {
            navigationKey(index: 12)
            navigationKey(index: 13)
          }
          .frame(width: max(1, (geometry.size.width - gap * 3) / 4))
        }
      }
    }
  }

  @ViewBuilder private func navigationKey(index: Int) -> some View {
    switch index {
    case 0: key("Home", label: "Home") { model.tapKey(.home) }
    case 1: key("Tab", label: "Tab") { model.tapKey(.tab) }
    case 2: key("PgUp", label: "Page up", repeats: true) { model.tapKey(.pageUp) }
    case 3: key("End", label: "End") { model.tapKey(.end) }
    case 4:
      key("", symbol: "arrow.up", label: "Up arrow", repeats: true, navigation: true) {
        model.tapKey(.arrowUp)
      }
    case 5: key("PgDn", label: "Page down", repeats: true) { model.tapKey(.pageDown) }
    case 6:
      key("", symbol: "arrow.left", label: "Left arrow", repeats: true, navigation: true) {
        model.tapKey(.arrowLeft)
      }
    case 7:
      key("", symbol: "arrow.down", label: "Down arrow", repeats: true, navigation: true) {
        model.tapKey(.arrowDown)
      }
    case 8:
      key("", symbol: "arrow.right", label: "Right arrow", repeats: true, navigation: true) {
        model.tapKey(.arrowRight)
      }
    case 9: key("⇧ Tab", label: "Shift Tab") { model.tapChord(.shiftTab) }
    case 10: key("Delete", label: "Forward delete", repeats: true) { model.tapKey(.deleteForward) }
    case 11: key("Space", label: "Space") { model.tapKey(.character(" ")) }
    case 12:
      key("", symbol: "delete.left", label: "Backspace", repeats: true) { model.tapKey(.backspace) }
    default: key("", symbol: "return", label: "Enter") { model.tapKey(.enter) }
    }
  }

  @ViewBuilder private func shortcuts(wide: Bool) -> some View {
    if wide {
      // Keep the profile beside the grid in a short keyboard. A header above
      // it would squeeze the shortcut targets below a comfortable tap size.
      HStack(spacing: gap) {
        VStack(alignment: .leading, spacing: 0) {
          profileMenu
          if profile == "tmux" { prefixMenu }
        }
        .frame(width: 126, alignment: .leading)
        shortcutKeys(columns: 5)
      }
    } else {
      VStack(spacing: gap) {
        HStack {
          if profile == "tmux" {
            prefixMenu
          } else {
            Text("Send to terminal").font(.system(size: 12))
              .foregroundStyle(ChromePalette.inkSecondary)
          }
          Spacer(minLength: 8)
          profileMenu
        }
        .frame(height: 44)
        shortcutKeys(columns: 3)
      }
    }
  }

  private var prefixMenu: some View {
    Menu {
      Button("Control B (default)") { tmuxPrefix = "b" }
      Button("Control A") { tmuxPrefix = "a" }
      Menu("Other Control key") {
        ForEach(Array("cdefghijklmnopqrstuvwxyz"), id: \.self) { character in
          Button("Control \(String(character).uppercased())") {
            tmuxPrefix = String(character)
          }
        }
      }
    } label: {
      Text("Prefix: ⌃\(String(prefix).uppercased())")
        .font(.system(size: 13, weight: .medium)).frame(minHeight: 44)
    }
    .foregroundStyle(ink)
    .accessibilityLabel("tmux prefix, Control \(String(prefix).uppercased())")
  }

  private var profileMenu: some View {
    Menu {
      Picker("Shortcut profile", selection: $profile) {
        Text("Common").tag("common")
        Text("Claude").tag("claude")
        Text("tmux").tag("tmux")
        Text("Emacs").tag("emacs")
        Text("Screen").tag("screen")
      }
    } label: {
      HStack(spacing: 6) {
        Text(pack.title)
        Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
      }
      .font(.system(size: 14, weight: .medium))
      .padding(.horizontal, 12).frame(minHeight: 44)
    }
    .foregroundStyle(ink)
    .accessibilityLabel("Shortcut profile, \(pack.title)")
    .accessibilityIdentifier("keypad-profile")
  }

  private func shortcutKeys(columns: Int) -> some View {
    let combos = pack.combos
    return keyGrid(columns: columns, count: combos.count) { index in
      let combo = combos[index]
      key(
        combo.label.replacingOccurrences(of: "^", with: "⌃"),
        subtitle: combo.subtitle, label: combo.accessibilityLabel
      ) {
        model.sendCombo(combo)
        InputHaptics.chord()
      }
    }
  }

  private func keyGrid<Content: View>(
    columns: Int, count: Int, @ViewBuilder content: @escaping (Int) -> Content
  ) -> some View {
    let rows = (count + columns - 1) / columns
    return VStack(spacing: gap) {
      ForEach(0..<rows, id: \.self) { row in
        HStack(spacing: gap) {
          ForEach(0..<columns, id: \.self) { column in
            let index = row * columns + column
            if index < count {
              content(index)
            } else {
              Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
          }
        }.frame(maxHeight: .infinity)
      }
    }
  }

  private func key(
    _ text: String, symbol: String? = nil, subtitle: String? = nil,
    label: String, repeats: Bool = false, navigation: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      VStack(spacing: 4) {
        if let symbol {
          Image(systemName: symbol).font(
            .system(size: isAccessibilitySize ? 25 : 22, weight: .regular))
        } else {
          Text(text).font(
            .system(
              size: labelSize, weight: .medium, design: subtitle == nil ? .default : .monospaced))
        }
        if let subtitle {
          Text(subtitle).font(.system(size: isAccessibilitySize ? 12 : 11))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1).minimumScaleFactor(0.85)
        }
      }
      .foregroundStyle(ink)
      .lineLimit(1)
      .padding(.horizontal, 4)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(
            ink.opacity(
              colorScheme == .dark ? (navigation ? 0.14 : 0.08) : (navigation ? 0.09 : 0.045))
          )
          .overlay {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
              .strokeBorder(
                ink.opacity(contrast == .increased ? 0.35 : 0.1),
                lineWidth: contrast == .increased ? 1 : 0.5)
          }
      }
      .contentShape(RoundedRectangle(cornerRadius: radius))
    }
    .buttonStyle(KeyPressStyle(radius: radius))
    .buttonRepeatBehavior(repeats ? .enabled : .disabled)
    .accessibilityLabel(label)
    .accessibilityIdentifier("keypad-key-\(label)")
  }
}
