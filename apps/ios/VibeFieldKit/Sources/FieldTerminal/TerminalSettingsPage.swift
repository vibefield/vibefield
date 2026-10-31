import FieldDesign
import Foundation
import GhostteaAppearance
import SwiftUI

/// Settings › Terminal (IOS-10a): the terminal's look on this phone, in the
/// chrome family's voice and the desktop's words (its Terminal › Look tab:
/// Theme, Background opacity, Effects, Animate effects).
///
/// It was the terminal settings sheet (D-i8), drawn in the godview mono, and
/// the phone's only settings; Settings pushes it now, and the card's `···`
/// opens Settings on it. Upstream exports DATA — 602 themes with their
/// provenance, four shader ports with their licences — and these pages render
/// it. The one place colour appears is a theme's swatch: the theme's own
/// values, content rather than chrome.
///
/// What these values decide (TM-5's erratum, kept true): a remote terminal's
/// glyphs are rasterised on the desktop that runs it, so its type and its
/// styled colours are that desktop's. Every value here goes live, none of them
/// reaches the desktop, and what they style is this renderer's own ground.
///
/// The host owns persistence (`TerminalAppearanceStore`) and application (the
/// attachment's `apply(appearance:)`) behind the binding; `commit` tells it
/// once per real change.
///
/// Its two pages are pushed by value (`TerminalSettingsRoute`), so the stack
/// that holds this page registers their destination (`destination(appearance:)`)
/// and can open on either.
public struct TerminalSettingsPage: View {
  @Binding private var appearance: TerminalAppearance

  public init(appearance: Binding<TerminalAppearance>) {
    _appearance = appearance
  }

  public var body: some View {
    List {
      Section {
        NavigationLink(value: TerminalSettingsRoute.theme) {
          ChromeRow("Theme", value: TerminalSettingsModel.themeName(of: appearance))
        }
        opacityRow
        fontRow
        NavigationLink(value: TerminalSettingsRoute.effects) {
          ChromeRow("Effects", value: TerminalSettingsModel.effectsWord(appearance.shaderEffects))
        }
      } header: {
        ChromeListHead("Look", tags: [FactTag("This phone"), FactTag("Live")])
      } footer: {
        ChromeListFoot(
          "A terminal’s text is drawn on the desktop that runs it, so its type and colours are "
            + "that desktop’s. These set the ground this phone draws under it.")
      }
      .chromeRows()
    }
    .chromeList()
    .navigationTitle("Terminal")
    .navigationBarTitleDisplayMode(.inline)
  }

  // MARK: - Background opacity

  private var opacityRow: some View {
    let opacity = TerminalSettingsModel.clampedOpacity(appearance.backgroundOpacity)
    let text = TerminalSettingsModel.percent(opacity)
    return VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("Background opacity")
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.ink)
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        Spacer(minLength: 8)
        Text(text)
          .font(ChromeListType.row)
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
      }
      Slider(
        value: Binding(
          get: { opacity },
          set: { value in commit { $0.backgroundOpacity = value } }),
        in: TerminalSettingsModel.opacityRange,
        step: 0.05
      ) {
        Text("Background opacity")
      } minimumValueLabel: {
        Text(TerminalSettingsModel.percent(TerminalSettingsModel.opacityRange.lowerBound))
      } maximumValueLabel: {
        Text(TerminalSettingsModel.percent(TerminalSettingsModel.opacityRange.upperBound))
      }
      .font(ChromeListType.detail)
      .foregroundStyle(ChromePalette.inkTertiary)
      .tint(ChromePalette.ink)
      .accessibilityValue(text)
      Text(TerminalSettingsModel.opacityDetail(opacity))
        .font(ChromeListType.detail)
        .foregroundStyle(ChromePalette.inkTertiary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.vertical, 6)
  }

  // MARK: - Font size

  /// The system's stepper, in the ink. The size is read through the clamp, so
  /// a stored NaN steps from the base rather than trapping the person at a
  /// size they cannot see or change.
  private var fontRow: some View {
    Stepper {
      ChromeRow("Font size", value: TerminalSettingsModel.pointsText(appearance.fontSize))
    } onIncrement: {
      commit { $0.fontSize = TerminalSettingsModel.steppedFontSize(from: $0.fontSize, by: 1) }
    } onDecrement: {
      commit { $0.fontSize = TerminalSettingsModel.steppedFontSize(from: $0.fontSize, by: -1) }
    }
    .accessibilityValue("\(Int(TerminalSettingsModel.clampedFontSize(appearance.fontSize).rounded())) points")
  }

  /// One door for every edit: mutate a copy, drop no-ops (a slider drag fires
  /// many sets per stepped value, a stepper at its bound fires one more), then
  /// tell the host exactly once.
  private func commit(_ mutate: (inout TerminalAppearance) -> Void) {
    var next = appearance
    mutate(&next)
    guard next != appearance else { return }
    appearance = next
  }
}

/// The Terminal page's own pages, pushed by value.
public enum TerminalSettingsRoute: Hashable, Sendable {
  case theme
  case effects

  /// The page this route opens, over the same binding as the Terminal page.
  @MainActor @ViewBuilder
  public func destination(appearance: Binding<TerminalAppearance>) -> some View {
    switch self {
    case .theme: TerminalThemePage(appearance: appearance)
    case .effects: TerminalEffectsPage(appearance: appearance)
    }
  }
}

/// Settings › Terminal › Theme: every theme the phone carries, searchable, the
/// one in use first. A `List` draws the 602 rows lazily, so the page shows
/// them all rather than the ten the sheet once capped at.
struct TerminalThemePage: View {
  @Binding var appearance: TerminalAppearance
  @State private var query = ""

  var body: some View {
    let selected = TerminalSettingsModel.themeName(of: appearance)
    let matches = TerminalSettingsModel.themes(matching: query)
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return List {
      if trimmed.isEmpty, let current = GhostteaThemeCatalog.themes.first(where: { $0.name == selected }) {
        Section {
          themeRow(current, selected: true)
        } header: {
          ChromeListHead("In use")
        }
        .chromeRows()
      }
      Section {
        if matches.isEmpty {
          ChromeRow("No theme matches", detail: "Nothing called “\(trimmed)”.")
        } else {
          ForEach(matches) { theme in
            themeRow(theme, selected: theme.name == selected)
          }
        }
      } header: {
        ChromeListHead(trimmed.isEmpty ? "All themes" : TerminalSettingsModel.themeCountWord(matches.count))
      } footer: {
        ChromeListFoot(TerminalSettingsModel.catalogFoot())
      }
      .chromeRows()
    }
    .chromeList()
    .searchable(
      text: $query, placement: .navigationBarDrawer(displayMode: .always),
      prompt: "Search \(GhostteaThemeCatalog.themes.count) themes"
    )
    .autocorrectionDisabled()
    .textInputAutocapitalization(.never)
    .navigationTitle("Theme")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func themeRow(_ theme: GhostteaColorTheme, selected: Bool) -> some View {
    Button {
      guard appearance.themeName != theme.name else { return }
      appearance.themeName = theme.name
    } label: {
      HStack(spacing: 12) {
        SwatchStrip(bytes: TerminalSettingsModel.swatchBytes(for: theme))
        Text(theme.name)
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .truncationMode(.tail)
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        Spacer(minLength: 8)
        if selected {
          FieldGlyph(.check, size: 18)
            .foregroundStyle(ChromePalette.ink)
            .accessibilityHidden(true)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(theme.name)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }
}

/// Settings › Terminal › Effects: the four ports ghosttea ships, each with its
/// licence, in the order the person turns them on — the order they compose.
struct TerminalEffectsPage: View {
  @Binding var appearance: TerminalAppearance
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let selection = appearance.shaderEffects
    let animatable = TerminalSettingsModel.hasAnimatedShader(in: selection)
    return List {
      Section {
        ForEach(GhostteaShaderOption.available) { shader in
          Toggle(isOn: binding(for: shader.id)) {
            effectLabel(shader, order: selection.count > 1 ? selection.firstIndex(of: shader.id) : nil)
          }
          .accessibilityLabel(TerminalSettingsModel.effectAccessibilityLabel(shader, in: selection))
        }
      } header: {
        ChromeListHead("Drawn over the terminal", tags: [FactTag("This phone"), FactTag("Live")])
      } footer: {
        ChromeListFoot(TerminalSettingsModel.effectsOrderFoot(selection))
      }
      .chromeRows()
      Section {
        Toggle(
          isOn: Binding(
            get: { appearance.shaderAnimation && animatable },
            set: { value in
              guard appearance.shaderAnimation != value else { return }
              appearance.shaderAnimation = value
            })
        ) {
          ChromeRow(
            "Animate effects",
            detail: TerminalSettingsModel.animateDetail(selection: selection, reduceMotion: reduceMotion))
        }
        .disabled(!animatable)
      } footer: {
        ChromeListFoot(TerminalSettingsModel.unavailableShaderLine())
      }
      .chromeRows()
    }
    .chromeList()
    .toggleStyle(ChromeSwitchStyle())
    .navigationTitle("Effects")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func binding(for id: String) -> Binding<Bool> {
    Binding(
      get: { appearance.shaderEffects.contains(id) },
      set: { on in
        guard on != appearance.shaderEffects.contains(id) else { return }
        appearance.shaderEffects = TerminalSettingsModel.toggling(shader: id, in: appearance.shaderEffects)
      })
  }

  private func effectLabel(_ shader: GhostteaShaderOption, order: Int?) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 8) {
        Text(shader.name)
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.ink)
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        if let order {
          Text("\(order + 1)")
            .font(ChromeListType.detailMono.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkTertiary)
        }
      }
      Text(shader.description)
        .font(ChromeListType.detail)
        .foregroundStyle(ChromePalette.inkTertiary)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 4) {
        if shader.animated { FactTag("Moves") }
        FactTag(shader.license)
      }
      .padding(.top, 2)
    }
    .padding(.vertical, 4)
  }
}

/// The theme swatch: a theme's own colours as one bar — background,
/// foreground, cursor, then the normal-intensity ANSI row. Decorative to
/// VoiceOver (the row says the theme's name).
private struct SwatchStrip: View {
  let bytes: [[UInt8]]

  var body: some View {
    HStack(spacing: 0) {
      ForEach(Array(bytes.enumerated()), id: \.offset) { _, rgb in
        Rectangle()
          .fill(color(rgb))
          .frame(width: 5)
      }
    }
    .frame(width: 5 * CGFloat(TerminalSettingsModel.swatchCount), height: 18, alignment: .leading)
    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 4, style: .continuous)
        .strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5))
    .accessibilityHidden(true)
  }

  private func color(_ rgb: [UInt8]) -> Color {
    guard rgb.count == 3 else { return .clear }
    return Color(red: Double(rgb[0]) / 255, green: Double(rgb[1]) / 255, blue: Double(rgb[2]) / 255)
  }
}

/// Everything about these pages that is a decision rather than a layout, kept
/// out of the views so it can be tested without a simulator.
enum TerminalSettingsModel {
  /// background + foreground + cursor + the 8 normal-intensity ANSI slots.
  static let swatchPaletteCount = 8
  static let swatchCount = swatchPaletteCount + 3
  static let opacityRange: ClosedRange<Double> = 0.2...1
  /// Upstream's bundled-font base is 13; the bounds are legibility on a phone
  /// at one end and a terminal that still fits 80 columns at the other.
  static let fontSizeRange: ClosedRange<Double> = 9...20

  /// The theme the terminal is wearing. `nil` means our default by contract
  /// (`TerminalAppearance.default`), so the tick lands on the row that is
  /// actually rendering.
  static func themeName(of appearance: TerminalAppearance) -> String {
    appearance.themeName ?? TerminalAppearance.default.themeName ?? ""
  }

  /// Case-insensitive substring on the name. An empty (or all-whitespace) query
  /// matches everything: nothing typed is not a filter.
  static func themes(
    matching query: String, in catalog: [GhostteaColorTheme] = GhostteaThemeCatalog.themes
  ) -> [GhostteaColorTheme] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return catalog }
    return catalog.filter { $0.name.range(of: trimmed, options: .caseInsensitive) != nil }
  }

  /// A search's head: what it found, counted.
  static func themeCountWord(_ count: Int) -> String {
    count == 1 ? "1 theme" : "\(count) themes"
  }

  /// The catalog's provenance, in the desktop's sentence (its Look tab): how
  /// many, from where, and the exact revision. A source that is not the
  /// upstream URL is named whole rather than guessed at.
  static func catalogFoot(
    count: Int = GhostteaThemeCatalog.themes.count,
    source: String = GhostteaThemeCatalog.source,
    revision: String = GhostteaThemeCatalog.revision
  ) -> String {
    var label = source
    if let tree = label.range(of: "/tree/") {
      label = String(label[label.startIndex..<tree.lowerBound])
    }
    var isURL = false
    for prefix in ["https://", "http://", "www.", "github.com/"] where label.hasPrefix(prefix) {
      label.removeFirst(prefix.count)
      isURL = true
    }
    // `owner/repo` → the repo's own name, which is what the desktop says.
    let repo = label.split(separator: "/").last.map(String.init) ?? ""
    let from = isURL && !repo.isEmpty ? repo : source
    let line = "\(count) themes from \(from), as ghosttea bundles them"
    return revision.isEmpty ? line : "\(line) · revision \(revision.prefix(8))"
  }

  /// A theme's colours for the strip, malformed entries dropped rather than
  /// substituted: an invented colour would misrepresent the theme, and the
  /// catalog's own format is the only one `parseHexColor` blesses.
  static func swatchBytes(for theme: GhostteaColorTheme) -> [[UInt8]] {
    let values = [theme.background, theme.foreground, theme.cursor]
      + theme.palette.prefix(swatchPaletteCount)
    return values.compactMap(parseHexColor)
  }

  /// Multi-select that keeps the order the person built, because the order is
  /// the composition order. Removal always works (an id stored before it left
  /// the available set must still be removable); adding is gated on
  /// availability, so we never hold an id the renderer would drop.
  static func toggling(shader id: String, in selection: [String]) -> [String] {
    if let index = selection.firstIndex(of: id) {
      var next = selection
      next.remove(at: index)
      return next
    }
    guard GhostteaShaderOption.available.contains(where: { $0.id == id }) else { return selection }
    return selection + [id]
  }

  static func hasAnimatedShader(in selection: [String]) -> Bool {
    GhostteaShaderOption.available.contains { $0.animated && selection.contains($0.id) }
  }

  /// The Effects row's value: none, the one by name, or how many. An id the
  /// renderer would drop is not an effect the terminal wears, so it is not
  /// counted.
  static func effectsWord(_ selection: [String]) -> String {
    let on = GhostteaShaderOption.available.filter { selection.contains($0.id) }
    switch on.count {
    case 0: return "None"
    case 1: return on[0].name
    default: return "\(on.count) on"
    }
  }

  static func effectsOrderFoot(_ selection: [String]) -> String {
    selection.count > 1
      ? "They compose in the numbered order: the order you turned them on."
      : "They compose in the order you turn them on."
  }

  /// Animate effects' line, in the desktop's words. The names are read from
  /// upstream's list, never written down. The switch is the one thing that
  /// stops a shader's motion — the renderer runs it whatever Reduce Motion
  /// says — so with Reduce Motion on, the line says so.
  static func animateDetail(selection: [String], reduceMotion: Bool) -> String {
    let moving = GhostteaShaderOption.available.filter(\.animated).map(\.name)
    let names = moving.count == 2 ? "\(moving[0]) and \(moving[1])" : moving.joined(separator: ", ")
    guard hasAnimatedShader(in: selection) else {
      return "Only \(names) move. Turn one on to use this."
    }
    if reduceMotion {
      return "Reduce Motion is on. Leave this off to keep the terminal still."
    }
    return "Runs the motion in \(names)."
  }

  static func effectAccessibilityLabel(_ shader: GhostteaShaderOption, in selection: [String]) -> String {
    var label = "\(shader.name). \(shader.description) Licence \(shader.license)."
    if shader.animated { label += " Moves." }
    if selection.count > 1, let order = selection.firstIndex(of: shader.id) {
      label += " Position \(order + 1)."
    }
    return label
  }

  /// The count is read, never written down: the day upstream clears one port's
  /// rights, this line stops claiming it. The desktop's words.
  static func unavailableShaderLine() -> String {
    "\(GhostteaShaderOption.unavailableUpstreamNames.count) more of Ghostty’s community shaders "
      + "aren’t bundled: their redistribution terms are unclear."
  }

  /// The projection's own rule (`presentationConfig`: non-finite ⇒ fully
  /// opaque, otherwise clamped to 0…1), repeated here so the readout states
  /// what the terminal will actually do rather than what was stored.
  static func clampedOpacity(_ value: Double) -> Double {
    guard value.isFinite else { return 1 }
    return min(max(value, 0), 1)
  }

  /// `85%` — read through the clamp, because `Int(.nan)` traps.
  static func percent(_ fraction: Double) -> String {
    "\(Int((clampedOpacity(fraction) * 100).rounded()))%"
  }

  /// The desktop's line under its Background opacity, with the field in place
  /// of Godview's cover.
  static func opacityDetail(_ opacity: Double) -> String {
    clampedOpacity(opacity) >= 1
      ? "Solid: the field stays behind the terminal."
      : "The field shows through the terminal."
  }

  static func steppedFontSize(from value: Double, by delta: Double) -> Double {
    clampedFontSize((value.isFinite ? value.rounded() : 13) + delta)
  }

  static func clampedFontSize(_ value: Double) -> Double {
    guard value.isFinite else { return 13 }
    return min(max(value, fontSizeRange.lowerBound), fontSizeRange.upperBound)
  }

  /// `13 pt` — read through the clamp, for the same reason.
  static func pointsText(_ value: Double) -> String {
    "\(Int(clampedFontSize(value).rounded())) pt"
  }
}

extension TerminalAppearance {
  /// The theme as Settings' Terminal row says it: the one in use, our
  /// default's name for nil.
  public var shownThemeName: String { TerminalSettingsModel.themeName(of: self) }
}

/// The effects the phone ships, each with its licence, for About's credits —
/// read from upstream's list, never written down.
public enum TerminalCredits {
  public struct Effect: Equatable, Sendable, Identifiable {
    public let name: String
    public let licence: String
    public var id: String { name }
  }

  public static var effects: [Effect] {
    GhostteaShaderOption.available.map { Effect(name: $0.name, licence: $0.license) }
  }
}
