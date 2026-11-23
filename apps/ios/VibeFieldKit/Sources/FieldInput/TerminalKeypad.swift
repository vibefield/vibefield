import FieldDesign
import FieldTerminal
import SwiftUI

/// A task-focused keyboard with stable geometry across all three pages. Its
/// keys always target the terminal; ABC restores the system's text keyboard.
///
/// Shortcuts leads the pages (PF-16, 2026-11-23; DESIGN.md §8 "The keys page's
/// Shortcuts are an agent's keys"): a fixed row of five keys, a strip of
/// profiles in sight, and the chosen profile's fifteen keys.
struct TerminalKeypad: View {
  let model: InputCardModel
  var isAccessibilitySize = false
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorSchemeContrast) private var contrast
  @AppStorage("terminal.keypad.profile") private var profile = ComboCatalog.fallback.id
  @AppStorage("terminal.keypad.tmuxPrefix") private var tmuxPrefix = "b"

  private let gap: CGFloat = 8
  /// The Shortcuts page's own gap: twenty keys and a strip in the room nine
  /// keys and a header had.
  private let shortcutGap: CGFloat = 6
  private let stripHeight: CGFloat = 30
  private let radius: CGFloat = 17
  private var labelSize: CGFloat { isAccessibilitySize ? 17 : 15 }
  private var ink: Color { ChromePalette.ink }
  private var prefix: Character {
    let value = tmuxPrefix.lowercased()
    return value.count == 1 && value.first!.isASCII && value.first!.isLetter ? value.first! : "b"
  }
  private var profiles: [ComboPack] { ComboCatalog.profiles(tmuxPrefix: prefix) }
  /// The hand's choice for this card, else the card's agent's, else the one
  /// last chosen by hand (PF-17).
  private var pack: ComboPack {
    ComboCatalog.chosen(
      picked: model.pickedProfile, session: model.sessionProfile, stored: profile,
      tmuxPrefix: prefix)
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

  // MARK: - Shortcuts (PF-16)

  /// The fixed row, the strip, and the chosen profile's three rows of five.
  ///
  /// The four rows of keys are one height, so the fixed row's keys are the
  /// size of every other. In a short, wide keyboard the twenty keys are two
  /// rows of ten under the strip, the fixed five leading the first: four rows
  /// there would put every target under a comfortable tap size.
  @ViewBuilder private func shortcuts(wide: Bool) -> some View {
    let fixed = ComboCatalog.fixedRow(for: pack)
    let own = pack.combos
    if wide {
      VStack(spacing: shortcutGap) {
        profileStrip.frame(height: stripHeight)
        keyGrid(columns: 10, count: fixed.count + own.count, spacing: shortcutGap) { index in
          if index < fixed.count {
            comboKey(fixed[index], fixed: true)
          } else {
            comboKey(own[index - fixed.count], fixed: false)
          }
        }
      }
    } else {
      GeometryReader { geometry in
        let unit = max(1, (geometry.size.height - stripHeight - shortcutGap * 4) / 4)
        VStack(spacing: shortcutGap) {
          keyGrid(columns: fixed.count, count: fixed.count, spacing: shortcutGap) { index in
            comboKey(fixed[index], fixed: true)
          }
          .frame(height: unit)
          profileStrip.frame(height: stripHeight)
          keyGrid(columns: 5, count: own.count, spacing: shortcutGap) { index in
            comboKey(own[index], fixed: false)
          }
        }
      }
    }
  }

  private func comboKey(_ combo: Combo, fixed: Bool) -> some View {
    key(
      combo.label.replacingOccurrences(of: "^", with: "⌃"),
      subtitle: combo.subtitle, label: combo.accessibilityLabel, mono: true, strong: fixed
    ) {
      model.sendCombo(combo)
      InputHaptics.chord()
    }
  }

  /// The profiles, in sight: the agents, a hairline, the tools. The chosen one
  /// wears the segment's selected fill and is kept in view. With tmux chosen,
  /// its prefix stands after it and opens the prefix's menu.
  private var profileStrip: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 2) {
          ForEach(profiles) { candidate in
            if candidate.id == profiles.first(where: { $0.kind == .tool })?.id {
              Rectangle()
                .fill(ink.opacity(0.14))
                .frame(width: 0.5, height: 16)
                .padding(.horizontal, 6)
                .accessibilityHidden(true)
            }
            profileChip(candidate).id(candidate.id)
            if candidate.id == pack.id, pack.id == ComboCatalog.tmux(prefix: prefix).id {
              prefixMenu
            }
          }
        }
        .padding(.horizontal, 1)
      }
      .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
      .onAppear { proxy.scrollTo(pack.id, anchor: .center) }
      .onChange(of: pack.id) { _, chosen in
        if reduceMotion {
          proxy.scrollTo(chosen, anchor: .center)
        } else {
          withAnimation(FieldMotion.ease(0.24)) { proxy.scrollTo(chosen, anchor: .center) }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Shortcut profile")
  }

  private func profileChip(_ candidate: ComboPack) -> some View {
    let chosen = candidate.id == pack.id
    return Button {
      guard !chosen else { return }
      // Held for this card over its agent's profile, and kept as the profile
      // of the cards whose agent names none (PF-17).
      model.pickedProfile = candidate.id
      profile = candidate.id
      InputHaptics.page()
    } label: {
      Text(candidate.title)
        .font(.system(size: isAccessibilitySize ? 15 : 13, weight: .medium))
        .foregroundStyle(chosen ? ChromePalette.segSelectedInk : ChromePalette.segInk)
        .lineLimit(1)
        .padding(.horizontal, 11)
        .frame(height: stripHeight)
        .background {
          if chosen { Capsule().fill(ChromePalette.segSelected) }
        }
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(candidate.title) shortcuts")
    .accessibilityAddTraits(chosen ? [.isSelected] : [])
    .accessibilityIdentifier("keypad-profile-\(candidate.id)")
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
      HStack(spacing: 4) {
        Text("Prefix ⌃\(String(prefix).uppercased())")
        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
      }
      .font(.system(size: isAccessibilitySize ? 15 : 13, weight: .medium))
      .padding(.horizontal, 9)
      .frame(height: stripHeight)
      .contentShape(Rectangle())
    }
    .foregroundStyle(ChromePalette.segInk)
    .accessibilityLabel("tmux prefix, Control \(String(prefix).uppercased())")
    .accessibilityIdentifier("keypad-tmux-prefix")
  }

  private func keyGrid<Content: View>(
    columns: Int, count: Int, spacing: CGFloat? = nil,
    @ViewBuilder content: @escaping (Int) -> Content
  ) -> some View {
    let rows = (count + columns - 1) / columns
    let spacing = spacing ?? gap
    return VStack(spacing: spacing) {
      ForEach(0..<rows, id: \.self) { row in
        HStack(spacing: spacing) {
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

  /// One cap. `mono` is a chord's face (a chord is data, DESIGN.md §3), a
  /// little smaller when the face is two presses long; `strong` is the fixed
  /// row's and the arrows' brighter cap.
  private func key(
    _ text: String, symbol: String? = nil, subtitle: String? = nil,
    label: String, repeats: Bool = false, navigation: Bool = false,
    mono: Bool = false, strong: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    let bright = navigation || strong
    let word = subtitle.flatMap { $0.isEmpty ? nil : $0 }
    let faceSize = mono && text.count > 4 ? labelSize - 2.5 : labelSize
    return Button(action: action) {
      VStack(spacing: mono ? 3 : 4) {
        if let symbol {
          Image(systemName: symbol).font(
            .system(size: isAccessibilitySize ? 25 : 22, weight: .regular))
        } else {
          Text(text)
            .font(.system(size: faceSize, weight: .medium, design: mono ? .monospaced : .default))
            .minimumScaleFactor(0.75)
        }
        if let word {
          Text(word).font(.system(size: isAccessibilitySize ? 12 : 10))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1).minimumScaleFactor(0.8)
        }
      }
      .foregroundStyle(ink)
      .lineLimit(1)
      .padding(.horizontal, mono ? 2 : 4)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        RoundedRectangle(cornerRadius: mono ? 13 : radius, style: .continuous)
          .fill(
            ink.opacity(
              colorScheme == .dark ? (bright ? 0.14 : 0.08) : (bright ? 0.09 : 0.045))
          )
          .overlay {
            RoundedRectangle(cornerRadius: mono ? 13 : radius, style: .continuous)
              .strokeBorder(
                ink.opacity(contrast == .increased ? 0.35 : 0.1),
                lineWidth: contrast == .increased ? 1 : 0.5)
          }
      }
      .contentShape(RoundedRectangle(cornerRadius: mono ? 13 : radius))
    }
    .buttonStyle(KeyPressStyle(radius: mono ? 13 : radius))
    .buttonRepeatBehavior(repeats ? .enabled : .disabled)
    .accessibilityLabel(label)
    .accessibilityIdentifier("keypad-key-\(label)")
  }
}
