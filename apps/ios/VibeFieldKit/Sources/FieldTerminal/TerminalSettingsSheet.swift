import FieldDesign
import Foundation
import GhostteaAppearance
import SwiftUI

/// The terminal's appearance, in our language (§10.4, D-i8).
///
/// Upstream exports DATA — 602 themes with their provenance, four shader ports
/// with their licenses — and this sheet renders it in the godview monochrome
/// rather than adopting upstream's Form. The one place color appears is the
/// theme swatches: those are the themes' own values, content rather than
/// chrome, and showing them is the only way a name like "Matte Black" means
/// anything before it is applied.
///
/// The sheet edits a local copy and reports every committed change; the host
/// owns persistence (`TerminalAppearanceStore`) and application (the sink's
/// `reconfigureDevicePresentation`, or a rebuild when the font size moved).
public struct TerminalSettingsSheet: View {
  @State private var draft: TerminalAppearance
  @State private var query = ""
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private let onChange: (TerminalAppearance) -> Void

  public init(
    appearance: TerminalAppearance, onChange: @escaping (TerminalAppearance) -> Void
  ) {
    _draft = State(initialValue: appearance)
    self.onChange = onChange
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        header
        themeSection
        transparencySection
        shaderSection
        fontSection
        Spacer(minLength: 28)
      }
      .padding(.horizontal, 22)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .scrollDismissesKeyboard(.interactively)
    // No background: the sheet's liquid glass is the surface (MeshSheet's rule).
  }

  // MARK: - Header

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      eyebrow("TERMINAL", size: 9, tracking: 0.18)
      // D-i9 said in the one place the user could otherwise wonder: these are
      // the phone's colors, and a desktop's theme never reaches through the
      // mesh to restyle them.
      Text("this phone's look — a host's theme never reaches through the mesh")
        .font(FieldType.mono(10))
        .foregroundStyle(FieldPalette.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.top, 24)
  }

  // MARK: - Color theme

  private var themeSection: some View {
    let results = TerminalSettingsModel.themeResults(query: query, selected: selectedThemeName)
    return VStack(alignment: .leading, spacing: 0) {
      eyebrow("COLOR THEME")
        .padding(.top, 30)

      searchField
        .padding(.top, 10)

      LazyVStack(spacing: 4) {
        ForEach(results.shown) { themeRow($0) }
      }
      .padding(.top, 10)

      Text(
        TerminalSettingsModel.themeCountLine(
          shown: results.shown.count, total: results.total, query: query)
      )
      .font(FieldType.mono(9))
      .monospacedDigit()
      .foregroundStyle(FieldPalette.textMuted)
      .padding(.top, 10)

      // Provenance, whole: the catalog is upstream's, pinned to one commit,
      // and saying so is the same honesty the desktop's appearance UI carries.
      Text("catalog · " + TerminalSettingsModel.catalogAttribution())
        .font(FieldType.mono(8))
        .foregroundStyle(FieldPalette.textFaint)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 4)
    }
  }

  private var searchField: some View {
    HStack(spacing: 8) {
      ZStack(alignment: .leading) {
        if query.isEmpty {
          Text("search \(GhostteaThemeCatalog.themes.count) themes")
            .font(FieldType.mono(11))
            .monospacedDigit()
            .foregroundStyle(FieldPalette.textFaint)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        TextField("", text: $query)
          .textFieldStyle(.plain)
          .font(FieldType.mono(11))
          .foregroundStyle(FieldPalette.textMain)
          .tint(FieldPalette.textMain)
          .autocorrectionDisabled()
          .textInputAutocapitalization(.never)
          .submitLabel(.done)
          .accessibilityLabel("Search themes")
      }
      if !query.isEmpty {
        Button { query = "" } label: {
          Text("CLEAR")
            .font(FieldType.mono(8, .heavy))
            .tracking(FieldType.tracking(0.1, of: 8))
            .foregroundStyle(FieldPalette.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 9)
    .background(RoundedRectangle(cornerRadius: 6).fill(FieldPalette.panelBackground.opacity(0.45)))
    .overlay(
      RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
  }

  private func themeRow(_ theme: GhostteaColorTheme) -> some View {
    let selected = theme.name == selectedThemeName
    return Button {
      commit { $0.themeName = theme.name }
    } label: {
      HStack(spacing: 10) {
        SwatchStrip(bytes: TerminalSettingsModel.swatchBytes(for: theme))
        Text(theme.name)
          .font(FieldType.mono(11, .medium))
          .foregroundStyle(selected ? FieldPalette.textMain : FieldPalette.textMuted)
          .lineLimit(1)
          .truncationMode(.tail)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(RoundedRectangle(cornerRadius: 8))
      .overlay(selectionRing(selected, cornerRadius: 8))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(theme.name)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }

  /// `nil` means our default by contract (`TerminalAppearance.default`), so the
  /// ring lands on the row that is actually rendering.
  private var selectedThemeName: String? {
    draft.themeName ?? TerminalAppearance.default.themeName
  }

  // MARK: - Transparency

  private var transparencySection: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        eyebrow("TRANSPARENCY")
        Spacer()
        Text(opacityText)
          .font(FieldType.mono(9, .heavy))
          .monospacedDigit()
          .foregroundStyle(FieldPalette.textMain)
      }
      .padding(.top, 30)

      Slider(
        value: Binding(
          get: { opacity },
          set: { value in commit { $0.backgroundOpacity = value } }),
        in: TerminalSettingsModel.opacityRange,
        step: 0.05
      )
      .tint(FieldPalette.textMain)
      .accessibilityLabel("Background opacity")
      .accessibilityValue(opacityText)
      .padding(.top, 4)

      Text(
        "below 100% the field shows through the terminal itself — its transparency "
          + "composes with the card's glass, so the swarm reads behind the text"
      )
      .font(FieldType.mono(9))
      .foregroundStyle(FieldPalette.textMuted)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 8)
    }
  }

  /// Read through the same sanitizer the projection uses: a stored value can be
  /// anything a decoder accepted, and `Int(Double.nan)` traps.
  private var opacity: Double { TerminalSettingsModel.clampedOpacity(draft.backgroundOpacity) }

  private var opacityText: String { "\(Int((opacity * 100).rounded()))%" }

  // MARK: - Shaders

  private var shaderSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      eyebrow("SHADERS")
        .padding(.top, 30)

      VStack(spacing: 4) {
        ForEach(GhostteaShaderOption.available) { shaderRow($0) }
      }
      .padding(.top, 10)

      // The rows keep upstream's order; the numerals carry the user's, which is
      // the one that composes.
      if draft.shaderEffects.count > 1 {
        Text("they compose in the numbered order")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .padding(.top, 8)
      }

      animateRow
        .padding(.top, 14)

      Text(TerminalSettingsModel.unavailableShaderLine())
        .font(FieldType.mono(9))
        .monospacedDigit()
        .foregroundStyle(FieldPalette.textMuted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 14)
    }
  }

  private func shaderRow(_ shader: GhostteaShaderOption) -> some View {
    let order = draft.shaderEffects.firstIndex(of: shader.id)
    let selected = order != nil
    return Button {
      commit {
        $0.shaderEffects = TerminalSettingsModel.toggling(shader: shader.id, in: $0.shaderEffects)
      }
    } label: {
      HStack(alignment: .top, spacing: 10) {
        VStack(alignment: .leading, spacing: 5) {
          HStack(spacing: 6) {
            Text(shader.name)
              .font(FieldType.mono(11, .heavy))
              .foregroundStyle(selected ? FieldPalette.textMain : FieldPalette.textMuted)
            if shader.animated { badge("ANIMATED") }
          }
          Text(shader.description)
            .font(FieldType.mono(9))
            .foregroundStyle(FieldPalette.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.leading)
          badge(shader.license)
        }
        Spacer(minLength: 0)
        if let order {
          Text("\(order + 1)")
            .font(FieldType.mono(10, .heavy))
            .monospacedDigit()
            .foregroundStyle(FieldPalette.textMain)
        }
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 9)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(RoundedRectangle(cornerRadius: 8))
      .overlay(selectionRing(selected, cornerRadius: 8))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(shaderAccessibilityLabel(shader, order: order))
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }

  private func shaderAccessibilityLabel(_ shader: GhostteaShaderOption, order: Int?) -> String {
    var label = "\(shader.name). \(shader.description) License \(shader.license)."
    if shader.animated { label += " Animated." }
    if let order { label += " Position \(order + 1)." }
    return label
  }

  private var animateRow: some View {
    let animatable = TerminalSettingsModel.hasAnimatedShader(in: draft.shaderEffects)
    return VStack(alignment: .leading, spacing: 5) {
      Toggle(
        isOn: Binding(
          get: { draft.shaderAnimation },
          set: { value in commit { $0.shaderAnimation = value } })
      ) {
        Text("Animate shaders")
          .font(FieldType.mono(11, .medium))
          .foregroundStyle(animatable ? FieldPalette.textMain : FieldPalette.textFaint)
      }
      .tint(FieldPalette.textMain)
      .disabled(!animatable)

      if !animatable {
        // Upstream gates the same switch on the same condition; saying why beats
        // a control that silently does nothing.
        Text("no animated shader is selected — this changes nothing until one is")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      } else if reduceMotion {
        // The sheet's own chrome already honours Reduce Motion; the shader runs
        // inside the terminal, where only this switch can stop it.
        Text("reduce motion is on system-wide — leaving this off keeps the terminal still")
          .font(FieldType.mono(9))
          .foregroundStyle(FieldPalette.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  // MARK: - Font size

  private var fontSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        eyebrow("FONT SIZE")
        Spacer()
        Text("\(fontSize) PT")
          .font(FieldType.mono(9, .heavy))
          .tracking(FieldType.tracking(0.08, of: 9))
          .monospacedDigit()
          .foregroundStyle(FieldPalette.textMain)
          .accessibilityLabel("Font size")
          .accessibilityValue("\(fontSize) points")
      }
      .padding(.top, 30)

      // Bounds are checked against the sanitized value, so a stored NaN leaves
      // both buttons live rather than trapping the user at a size they cannot
      // see or change.
      HStack(spacing: 8) {
        stepButton(
          "−", label: "Smaller font", enabled: Double(fontSize) > fontRange.lowerBound
        ) {
          commit { $0.fontSize = TerminalSettingsModel.steppedFontSize(from: $0.fontSize, by: -1) }
        }
        stepButton("+", label: "Larger font", enabled: Double(fontSize) < fontRange.upperBound) {
          commit { $0.fontSize = TerminalSettingsModel.steppedFontSize(from: $0.fontSize, by: 1) }
        }
      }
      .padding(.top, 10)

      // §10.1's second upstream law, stated before the cost is paid rather
      // than after: `requiresNewRuntime` is literally
      // `fontSize != other.fontSize`. It does NOT re-attach — the design doc
      // said so and was wrong (corrected at source 2026-08-06): upstream
      // swaps the runtime on the LIVE sink via
      // `reconfigureDevicePresentation(_, runtime:, generation:)`, so the
      // session never leaves. Saying otherwise would invent a cost the code
      // does not pay.
      Text(
        "font size is the one value the text runtime is rebuilt for — the session stays "
          + "attached; colors, opacity, and shaders go live in place"
      )
      .font(FieldType.mono(9))
      .foregroundStyle(FieldPalette.textMuted)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 10)
    }
  }

  private var fontRange: ClosedRange<Double> { TerminalSettingsModel.fontSizeRange }

  private var fontSize: Int {
    Int(TerminalSettingsModel.clampedFontSize(draft.fontSize).rounded())
  }

  private func stepButton(
    _ glyph: String, label: String, enabled: Bool, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Text(glyph)
        .font(FieldType.mono(14, .heavy))
        .foregroundStyle(enabled ? FieldPalette.textMain : FieldPalette.textFaint)
        .frame(width: 40, height: 32)
        .contentShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
          RoundedRectangle(cornerRadius: 6)
            .strokeBorder(
              enabled ? FieldPalette.panelBorder : FieldPalette.panelBorder.opacity(0.5),
              lineWidth: 1))
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .accessibilityLabel(label)
  }

  // MARK: - Shared chrome

  private func eyebrow(_ text: String, size: CGFloat = 8, tracking: CGFloat = 0.12) -> some View {
    Text(text)
      .font(FieldType.mono(size, .heavy))
      .tracking(FieldType.tracking(tracking, of: size))
      .foregroundStyle(FieldPalette.textFaint)
  }

  private func badge(_ text: String) -> some View {
    Text(text)
      .font(FieldType.mono(7, .heavy))
      .tracking(FieldType.tracking(0.1, of: 7))
      .foregroundStyle(FieldPalette.textFaint)
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .overlay(
        RoundedRectangle(cornerRadius: 4).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
  }

  /// DESIGN.md §7's selection ring — 1.5 pt, drawn inside, 120 ms fade. Drawn
  /// in `textMain` rather than `--vf-select`: the godview family (§2.7) is
  /// scoped monochrome and carries no selection hue, and status here is
  /// contrast like everywhere else on this screen.
  private func selectionRing(_ selected: Bool, cornerRadius: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: cornerRadius)
      .strokeBorder(FieldPalette.textMain, lineWidth: 1.5)
      .opacity(selected ? 1 : 0)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: selected)
  }

  /// One door for every edit: mutate a copy, drop no-ops (a slider drag fires
  /// many sets per stepped value), then tell the host exactly once.
  private func commit(_ mutate: (inout TerminalAppearance) -> Void) {
    var next = draft
    mutate(&next)
    guard next != draft else { return }
    draft = next
    onChange(next)
  }
}

/// The theme swatch: a theme's own colors as one bar — background, foreground,
/// cursor, then the normal-intensity ANSI row. Decorative to VoiceOver (the row
/// says the theme's name), and the only colors in this sheet.
private struct SwatchStrip: View {
  let bytes: [[UInt8]]

  var body: some View {
    HStack(spacing: 0) {
      ForEach(Array(bytes.enumerated()), id: \.offset) { _, rgb in
        Rectangle()
          .fill(color(rgb))
          .frame(width: 7)
      }
    }
    .frame(width: 7 * CGFloat(TerminalSettingsModel.swatchCount), height: 16, alignment: .leading)
    .clipShape(RoundedRectangle(cornerRadius: 3))
    .overlay(
      RoundedRectangle(cornerRadius: 3).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
    .accessibilityHidden(true)
  }

  private func color(_ rgb: [UInt8]) -> Color {
    guard rgb.count == 3 else { return FieldPalette.panelBorder }
    return Color(
      red: Double(rgb[0]) / 255, green: Double(rgb[1]) / 255, blue: Double(rgb[2]) / 255)
  }
}

/// Everything about this sheet that is a decision rather than a layout, kept
/// out of the view so it can be tested without a simulator.
enum TerminalSettingsModel {
  /// A phone is not a place to scroll 602 rows; search is the interface, and
  /// the count line below the list states exactly what is being withheld.
  static let themeResultLimit = 10
  /// background + foreground + cursor + the 8 normal-intensity ANSI slots.
  static let swatchPaletteCount = 8
  static let swatchCount = swatchPaletteCount + 3
  static let opacityRange: ClosedRange<Double> = 0.2...1
  /// Upstream's bundled-font base is 13; the bounds are legibility on a phone
  /// at one end and a terminal that still fits 80 columns at the other.
  static let fontSizeRange: ClosedRange<Double> = 9...20

  struct ThemeResults: Equatable {
    var shown: [GhostteaColorTheme]
    /// Matches before the limit — the number the count line owes the user.
    var total: Int
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

  /// Filter, float the current selection to the top so its ring is never
  /// scrolled off, then cap. The selection is floated only when it survives the
  /// query — a search is an instruction, not a suggestion.
  static func themeResults(
    query: String,
    selected: String?,
    limit: Int = themeResultLimit,
    in catalog: [GhostteaColorTheme] = GhostteaThemeCatalog.themes
  ) -> ThemeResults {
    var matches = themes(matching: query, in: catalog)
    if let selected, let index = matches.firstIndex(where: { $0.name == selected }), index > 0 {
      matches.insert(matches.remove(at: index), at: 0)
    }
    return ThemeResults(shown: Array(matches.prefix(max(limit, 0))), total: matches.count)
  }

  static func themeCountLine(shown: Int, total: Int, query: String) -> String {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if total == 0 {
      return trimmed.isEmpty ? "the catalog is empty" : "no theme matches “\(trimmed)”"
    }
    if shown < total {
      return "\(shown) of \(total) shown — search narrows the list"
    }
    return total == 1 ? "1 theme" : "\(total) themes"
  }

  /// A theme's colors for the strip, malformed entries dropped rather than
  /// substituted: an invented color would misrepresent the theme, and the
  /// catalog's own format is the only one `parseHexColor` blesses.
  static func swatchBytes(for theme: GhostteaColorTheme) -> [[UInt8]] {
    let values = [theme.background, theme.foreground, theme.cursor]
      + theme.palette.prefix(swatchPaletteCount)
    return values.compactMap(parseHexColor)
  }

  /// Multi-select that keeps the order the user built, because the order is the
  /// composition order. Removal always works (an id stored before it left the
  /// available set must still be removable); adding is gated on availability,
  /// so we never hold an id the renderer would drop.
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

  /// The count is read, never written down: the day upstream clears one port's
  /// rights, this line stops claiming it.
  static func unavailableShaderLine() -> String {
    "\(GhostteaShaderOption.unavailableUpstreamNames.count) more ports exist upstream — "
      + "their redistribution terms are unclear, so we do not ship them."
  }

  /// The projection's own rule (`presentationConfig`: non-finite ⇒ fully
  /// opaque, otherwise clamped to 0…1), repeated here so the readout states
  /// what the terminal will actually do rather than what was stored.
  static func clampedOpacity(_ value: Double) -> Double {
    guard value.isFinite else { return 1 }
    return min(max(value, 0), 1)
  }

  static func steppedFontSize(from value: Double, by delta: Double) -> Double {
    clampedFontSize((value.isFinite ? value.rounded() : 13) + delta)
  }

  static func clampedFontSize(_ value: Double) -> Double {
    guard value.isFinite else { return 13 }
    return min(max(value, fontSizeRange.lowerBound), fontSizeRange.upperBound)
  }

  /// `owner/repo @ sha` from the catalog's source URL, which points at the
  /// exact tree the themes were generated from. Anything that does not look
  /// like that URL is shown whole rather than guessed at.
  static func catalogAttribution(
    source: String = GhostteaThemeCatalog.source,
    revision: String = GhostteaThemeCatalog.revision
  ) -> String {
    var label = source
    if let tree = label.range(of: "/tree/") {
      label = String(label[label.startIndex..<tree.lowerBound])
    }
    for prefix in ["https://", "http://", "www.", "github.com/"] where label.hasPrefix(prefix) {
      label.removeFirst(prefix.count)
    }
    let name = label.isEmpty ? source : label
    return revision.isEmpty ? name : "\(name) @ \(revision)"
  }
}
