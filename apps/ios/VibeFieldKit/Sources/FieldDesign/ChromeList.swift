import SwiftUI

/// The phone's lists of settings (IOS-10a): iOS's inset-grouped `List` on the
/// History tab's paper, in the chrome family's voice — the parts Settings and
/// its Terminal page share, so the two targets draw one page.
///
/// Every size is a system text style, so these pages move with the reader's
/// text size; at the default size each lands on the design page's own number
/// ("Settings in a Pocket": a 17 pt label, a 13 pt detail and foot, an 11 pt
/// head). The colours are the ramp the History tab already draws (§2.4): no
/// hue but §2.5's, and those only for what the person alone can fix.
public enum ChromeListType {
  /// A row's label and its value: 17 pt.
  public static let row: Font = .body
  /// A value that is data — a machine name, a tailnet — in mono (§3).
  public static let valueMono: Font = .system(.subheadline, design: .monospaced)
  /// The line under a label, and a section's foot: 13 pt.
  public static let detail: Font = .footnote
  public static let detailMono: Font = .system(.footnote, design: .monospaced)
  /// A section's head: 11 pt medium, uppercased by `chromeGroupHead`.
  public static let head: Font = .caption2.weight(.medium)
  /// The account's name at the head of Settings: 20 pt semibold.
  public static let accountName: Font = .title3.weight(.semibold)
  /// A page's own head — a desktop's name, the account's name: 28 pt bold.
  public static let pageName: Font = .title.weight(.bold)
}

extension View {
  /// The group head History and Settings share (`.gh`, History's `GroupHead`):
  /// uppercase, 0.08 em, in the ramp's faint step. The font is the caller's:
  /// History keeps its fixed 11 pt, Settings the caption style, which moves
  /// with the reader's text size.
  public func chromeGroupHead(font: Font = ChromeType.sans(11, .medium)) -> some View {
    self
      .font(font)
      .textCase(.uppercase)
      .tracking(ChromeType.tracking(0.08, of: 11))
      .foregroundStyle(ChromePalette.inkFaint)
  }

  /// A page of settings: the inset-grouped list on paper, with the system's
  /// own ground hidden so the paper shows.
  public func chromeList() -> some View {
    self
      .listStyle(.insetGrouped)
      .scrollContentBackground(.hidden)
      .background(ChromePalette.paper)
  }

  /// A section's rows on their tile — `fill`, as History's panels are — with
  /// the hairlines between them in the list's separator ink.
  public func chromeRows() -> some View {
    self
      .listRowBackground(ChromePalette.fill)
      .listRowSeparatorTint(ChromePalette.separator)
  }
}

/// A section's head: its words on the left and, on the right, whose the
/// settings are and when they land (§8 "Fact labels — scope and timing").
public struct ChromeListHead: View {
  private let title: String?
  private let tags: [FactTag]

  public init(_ title: String? = nil, tags: [FactTag] = []) {
    self.title = title
    self.tags = tags
  }

  public var body: some View {
    HStack(spacing: 8) {
      if let title {
        Text(title).chromeGroupHead(font: ChromeListType.head)
      }
      Spacer(minLength: 8)
      HStack(spacing: 4) {
        ForEach(tags.indices, id: \.self) { tags[$0] }
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// A section's foot: one or two sentences in the tertiary ink.
public struct ChromeListFoot: View {
  private let text: String
  private let tone: Color

  public init(_ text: String, attention: Bool = false) {
    self.text = text
    self.tone = attention ? ChromePalette.attention : ChromePalette.inkTertiary
  }

  public var body: some View {
    Text(text)
      .font(ChromeListType.detail)
      .foregroundStyle(tone)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// §8's fact label: a hairline chip, no fill, no hue, in §8's grammar — solid
/// for a standing fact (scope, whose word a value is, Live), dashed for a value
/// known but not shown yet (the desktop's "Kept, not drawn"; the phone's "No
/// desktop yet"), dotted for one not in this build (the desktop's "Next
/// ghosttea"; the phone's "Not yet"). It sits on a section head, or on a row
/// only where the row is itself the unit (an ability). Ownership and timing are
/// not states of concern, so a tag never takes a hue.
public struct FactTag: View {
  public enum Line: Sendable {
    case solid, dashed, dotted
  }

  private let text: String
  private let line: Line
  /// The chip at the default text size, scaled with the reader's relative to
  /// `.caption2`, the group head's style, so a tag grows with the head it
  /// stands in.
  @ScaledMetric(relativeTo: .caption2) private var size: CGFloat = 9.5
  @ScaledMetric(relativeTo: .caption2) private var height: CGFloat = 18
  @ScaledMetric(relativeTo: .caption2) private var inset: CGFloat = 5

  public init(_ text: String, line: Line = .solid) {
    self.text = text
    self.line = line
  }

  public var body: some View {
    Text(text)
      .font(ChromeType.sans(size, .semibold))
      .textCase(.uppercase)
      .tracking(ChromeType.tracking(0.06, of: size))
      .foregroundStyle(ChromePalette.inkTertiary)
      .lineLimit(1)
      .padding(.horizontal, inset)
      .frame(minHeight: height)
      .overlay {
        RoundedRectangle(cornerRadius: inset, style: .continuous)
          .strokeBorder(
            line == .solid ? ChromePalette.ruleStrong : ChromePalette.placeholder,
            style: StrokeStyle(lineWidth: 1, dash: dash))
      }
  }

  private var dash: [CGFloat] {
    switch line {
    case .solid: []
    case .dashed: [3, 2]
    case .dotted: [1, 2]
    }
  }
}

/// One row of a settings list: a glyph or a desktop's OS mark in a fixed
/// column, a label with an optional line under it, and a value in the
/// tertiary ink. Rows that switch or tick compose this with their control.
public struct ChromeRow: View {
  public enum Lead: Equatable {
    case none
    case glyph(FieldGlyphName)
    /// A desktop is its operating system's mark (PJ-D24), at History's 19 pt.
    case device(platform: String?)
  }

  private let title: String
  private let lead: Lead
  private let detail: String?
  private let detailWantsTheUser: Bool
  private let detailIsMono: Bool
  private let value: String?
  private let valueIsMono: Bool

  /// - Parameters:
  ///   - detailWantsTheUser: the line under the label is one of the things only
  ///     the person can fix: §2.5 orange, with the dot beside the words.
  public init(
    _ title: String, lead: Lead = .none, detail: String? = nil, detailWantsTheUser: Bool = false,
    detailIsMono: Bool = false, value: String? = nil, valueIsMono: Bool = false
  ) {
    self.title = title
    self.lead = lead
    self.detail = detail
    self.detailWantsTheUser = detailWantsTheUser
    self.detailIsMono = detailIsMono
    self.value = value
    self.valueIsMono = valueIsMono
  }

  /// The lead column's width: History's and the design page's 28.
  public static let leadWidth: CGFloat = 28

  public var body: some View {
    HStack(spacing: 12) {
      leadView
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.ink)
          // The hairline starts where the words do.
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        if let detail {
          HStack(spacing: 6) {
            if detailWantsTheUser {
              Circle().fill(ChromePalette.attention).frame(width: 6, height: 6)
            }
            Text(detail)
              .font(detailIsMono ? ChromeListType.detailMono : ChromeListType.detail)
              .foregroundStyle(detailWantsTheUser ? ChromePalette.attention : ChromePalette.inkTertiary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      Spacer(minLength: 8)
      if let value {
        Text(value)
          .font(valueIsMono ? ChromeListType.valueMono : ChromeListType.row)
          .foregroundStyle(ChromePalette.inkTertiary)
          .monospacedDigit()
          .lineLimit(1)
          .truncationMode(.middle)
      }
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder
  private var leadView: some View {
    switch lead {
    case .none:
      EmptyView()
    case .glyph(let glyph):
      FieldGlyph(glyph, size: 22)
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: Self.leadWidth)
        .accessibilityHidden(true)
    case .device(let platform):
      DeviceMark(platform: platform, size: 19)
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: Self.leadWidth)
    }
  }
}

/// The switch (IOS-10a): the design kit's `.vf-ui-switch` at iOS's measure —
/// a 51 × 31 track in the ink, its 27 pt knob the ink's inverse. Green says
/// working or healthy here (§2.5), so an "on" switch cannot wear it.
///
/// Only the track toggles, as the system's switch does in a list; the label is
/// the row beside it, and the pair is one element to a screen reader.
public struct ChromeSwitchStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    ChromeSwitch(configuration: configuration)
  }
}

private struct ChromeSwitch: View {
  let configuration: ToggleStyleConfiguration
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  static let width: CGFloat = 51
  static let height: CGFloat = 31
  static let inset: CGFloat = 2

  var body: some View {
    HStack(spacing: 12) {
      configuration.label
      Spacer(minLength: 0)
      track
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isToggle)
    .accessibilityValue(configuration.isOn ? "On" : "Off")
    .accessibilityAction { configuration.isOn.toggle() }
  }

  private var track: some View {
    let knob = Self.height - 2 * Self.inset
    return Capsule()
      .fill(configuration.isOn ? ChromePalette.switchOn : ChromePalette.switchOff)
      .frame(width: Self.width, height: Self.height)
      .overlay(alignment: configuration.isOn ? .trailing : .leading) {
        Circle()
          .fill(ChromePalette.switchKnob)
          .frame(width: knob, height: knob)
          .shadow(color: ChromeShadow.knob.color, radius: ChromeShadow.knob.radius, y: ChromeShadow.knob.y)
          .padding(Self.inset)
      }
      .opacity(isEnabled ? 1 : 0.4)
      .animation(reduceMotion ? nil : FieldMotion.plainEase(0.2), value: configuration.isOn)
      .contentShape(Capsule())
      .onTapGesture {
        guard isEnabled else { return }
        configuration.isOn.toggle()
      }
  }
}
