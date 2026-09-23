import FieldAgents
import FieldDesign
import SwiftUI

/// The small parts every History screen composes: the project's colour, an
/// agent's mark, the sparkline, the group head, the day header — chrome
/// family throughout (`ChromePalette`, `ChromeType`), never the godview ink.
enum HistoryParts {
  /// Record §02's dealt colour for a project, under the theme's tint.
  static func projectColor(seq: Int, scheme: ColorScheme) -> Color {
    let c = SwarmColor.project(seq, scheme == .dark ? .dark : .light)
    return Color(red: c.r, green: c.g, blue: c.b)
  }

  static let sidePadding: CGFloat = 20
}

/// An agent's mark at 13 pt: the vendor's letter in a rounded square, the
/// reference's own fallback for a mark that is not drawn — and here every
/// mark is a letter, because the History tab draws no vendor glyphs yet.
struct AgentMark: View {
  let agent: String
  var opacity: Double = 0.55
  var size: CGFloat = 13

  var body: some View {
    Text(agent.prefix(1).uppercased())
      .font(.system(size: size * 0.62, weight: .bold, design: .rounded))
      .foregroundStyle(ChromePalette.ink)
      .frame(width: size, height: size)
      .background(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(ChromePalette.fill))
      .overlay(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).strokeBorder(ChromePalette.ruleStrong, lineWidth: 0.5))
      .opacity(opacity)
      .accessibilityLabel(agent)
  }
}

/// The marks of who worked on a project, the lead at full strength and the
/// rest by their share, then `+N` for the ones that did not fit.
struct AgentMarks: View {
  let agents: [HistoryAgentShare]
  let more: Int

  var body: some View {
    let lead = Double(agents.first?.share ?? 1)
    HStack(spacing: 3) {
      ForEach(Array(agents.enumerated()), id: \.offset) { _, share in
        AgentMark(agent: share.agent, opacity: min(1, 0.34 + 0.3 * Double(share.share) / lead + 0.2))
      }
      if more > 0 {
        Text("+\(more)")
          .font(ChromeType.sans(10, .medium))
          .foregroundStyle(ChromePalette.inkFaint)
      }
    }
  }
}

/// Fifteen bars, 104 × 16, in the project's colour at 42%; a zero is a 1 pt
/// line at 30%, so the shape of an idle month is still a shape.
struct Sparkline: View {
  let values: [Int]
  let color: Color

  var body: some View {
    let peak = max(values.max() ?? 1, 1)
    HStack(alignment: .bottom, spacing: 1.5) {
      ForEach(Array(values.enumerated()), id: \.offset) { _, value in
        RoundedRectangle(cornerRadius: 1)
          .fill(color)
          .opacity(value == 0 ? 0.3 : 0.42)
          .frame(height: value == 0 ? 1 : max(16 * 0.14, 16 * CGFloat(value) / CGFloat(peak)))
      }
    }
    .frame(width: 104, height: 16, alignment: .bottom)
    .accessibilityHidden(true)
  }
}

/// The figure and its unit: `1.24` `B`, tabular.
struct FigureText: View {
  let figure: String
  let unit: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 1) {
      Text(figure)
        .font(ChromeType.sans(13.5, .medium))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(minWidth: 34, alignment: .trailing)
      Text(unit)
        .font(ChromeType.sans(11))
        .foregroundStyle(ChromePalette.inkFaint)
        .frame(width: 9, alignment: .leading)
    }
  }
}

/// `2h` · `yesterday` — or `now`, in green while the desktop is awake.
struct LastWord: View {
  let word: String
  let isLive: Bool
  let awake: Bool

  var body: some View {
    Text(word)
      .font(ChromeType.sans(12, isLive && awake ? .medium : .regular))
      .monospacedDigit()
      .foregroundStyle(isLive && awake ? ChromePalette.green : ChromePalette.inkFaint)
      .lineLimit(1)
  }
}

/// A group head: `LIVE NOW · 2` with the count in green, `PROJECTS`.
struct GroupHead<Trailing: View>: View {
  let label: String
  var count: Int? = nil
  @ViewBuilder var trailing: () -> Trailing

  init(_ label: String, count: Int? = nil, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
    self.label = label
    self.count = count
    self.trailing = trailing
  }

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      HStack(spacing: 4) {
        Text(label)
        if let count {
          Text("·")
          Text("\(count)").foregroundStyle(ChromePalette.green)
        }
      }
      .font(ChromeType.sans(11, .medium))
      .textCase(.uppercase)
      .tracking(ChromeType.tracking(0.08, of: 11))
      .foregroundStyle(ChromePalette.inkFaint)
      Spacer(minLength: 0)
      trailing()
    }
    .frame(minHeight: 30)
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.top, 22)
    .padding(.bottom, 8)
  }
}

/// The day a session list turns: sticky in the record; a header here.
struct DayHeader: View {
  let text: String

  var body: some View {
    Text(text)
      .font(ChromeType.sans(11, .medium))
      .textCase(.uppercase)
      .tracking(ChromeType.tracking(0.08, of: 11))
      .foregroundStyle(ChromePalette.inkFaint)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, HistoryParts.sidePadding)
      .padding(.top, 18)
      .padding(.bottom, 6)
  }
}

/// The green pulse beside a running line; still, under Reduce Motion or while
/// the desktop is asleep.
struct LivePulse: View {
  let awake: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var breathing = false

  var body: some View {
    Circle()
      .fill(awake ? ChromePalette.green : ChromePalette.inkFaint)
      .frame(width: 6, height: 6)
      .opacity(breathing ? 0.35 : 1)
      .onAppear {
        guard awake, !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { breathing = true }
      }
      .accessibilityHidden(true)
  }
}

/// A rule with words in it: `SESSION START · SAT 12 SEP`, `LIVE · NEW SINCE 11:45`.
struct RuleLine: View {
  let text: String
  var tone: Color = ChromePalette.inkFaint
  var rule: Color = ChromePalette.ruleStrong

  var body: some View {
    HStack(spacing: 10) {
      Rectangle().fill(rule).frame(height: 1)
      Text(text)
        .font(ChromeType.sans(10.5))
        .textCase(.uppercase)
        .tracking(ChromeType.tracking(0.07, of: 10.5))
        .monospacedDigit()
        .foregroundStyle(tone)
        .lineLimit(1)
        .fixedSize()
      Rectangle().fill(rule).frame(height: 1)
    }
    .padding(.vertical, 18)
  }
}

/// The quiet state: one strong line, one sentence.
struct QuietNote: View {
  let title: String
  let text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(ChromeType.sans(15, .semibold))
        .foregroundStyle(ChromePalette.ink)
      Text(text)
        .font(ChromeType.sans(13.5))
        .foregroundStyle(ChromePalette.inkTertiary)
        .lineSpacing(3)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.vertical, 24)
  }
}

/// A row's press: the fill, on the row's own radius (`.prow:active`).
struct HistoryRowStyle: ButtonStyle {
  var radius: CGFloat = 14

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(ChromePalette.fill)
          .opacity(configuration.isPressed ? 1 : 0)
      }
  }
}
