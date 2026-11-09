import FieldDesign
import FieldHistory
import SwiftUI

// IOS-12f's M-f2 (plan-12f's Q8 A; VF-PM 2026-11-09 02:24:16Z, Q4 (a); DESIGN.md §8 "The phone's Chat") — @'S LIST on
// the phone: the Mac's `AtRowsView` and `AtAgentMenuView` at touch pitch, a solid menu from the composer up, as wide as
// the field, its foot 8 above it, read bottom-up. A row is a tap (the phone has no ↑ ↓ walk), so the hot row is only
// the nearest drawn. Taking an agent turns the list into that agent's menu, in the list's own box.

/// What the box holds.
enum ChatAtContent {
  case list(ChatAtList)
  case menu(rows: [AgentMenuRow], effort: EffortChoice?)
}

struct ChatAtView: View {
  let content: ChatAtContent
  /// How tall the box may stand: the page above the composer.
  let room: CGFloat
  let onAgent: (ChatAtAgentRow) -> Void
  let onSession: (ChatAtSessionRow) -> Void
  let onModel: (String?) -> Void
  let onEffort: (String) -> Void

  static let foot: CGFloat = 8
  static let agentRow: CGFloat = 48
  static let sessionRow: CGFloat = 56
  static let rowCorner: CGFloat = 12

  var body: some View {
    ScrollView {
      VStack(spacing: 0) { rows }
        .padding(6)
    }
    .defaultScrollAnchor(.bottom)
    .scrollBounceBehavior(.basedOnSize)
    .frame(maxHeight: room)
    .fixedSize(horizontal: false, vertical: true)
    .clipShape(RoundedRectangle(cornerRadius: ChromeRadius.menu, style: .continuous))
    .background(ChromeMaterial.floating())
  }

  @ViewBuilder
  private var rows: some View {
    switch content {
    case .list(let list): self.list(list)
    case .menu(let rows, let effort): menu(rows, effort: effort)
    }
  }

  // MARK: The list

  @ViewBuilder
  private func list(_ list: ChatAtList) -> some View {
    let hot = list.sessions.last?.id ?? list.agents.last?.id
    if list.reading {
      eyebrow(ChatAtWords.agents)
      quiet(ChatAtWords.reading)
    }
    if !list.agents.isEmpty {
      eyebrow(ChatAtWords.agents)
      ForEach(list.agents) { row in agentRow(row, hot: row.id == hot) }
    }
    if list.sessionsFailed {
      eyebrow(ChatAtWords.sessions)
      quiet(ChatAtWords.sessionsFailed)
    } else if !list.sessions.isEmpty {
      eyebrow(ChatAtWords.sessions)
      ForEach(list.sessions) { row in sessionRow(row, hot: row.id == hot) }
    }
    if let words = list.quiet { quiet(words) }
  }

  private func eyebrow(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.mono(10))
      .textCase(.uppercase)
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.horizontal, 10)
      .padding(.top, 8)
      .padding(.bottom, 4)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func quiet(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.sans(13))
      .foregroundStyle(ChromePalette.inkSecondary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func fill(hot: Bool) -> some View {
    RoundedRectangle(cornerRadius: Self.rowCorner, style: .continuous)
      .fill(hot ? ChromePalette.rowSelected : Color.clear)
  }

  private func agentRow(_ row: ChatAtAgentRow, hot: Bool) -> some View {
    Button {
      onAgent(row)
    } label: {
      HStack(spacing: 10) {
        AgentMark(agent: row.agent, opacity: 1, size: 20)
        Text(row.label)
          .font(ChromeType.sans(15, .medium))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        Spacer(minLength: 8)
        if let pill = row.pill {
          Text(pill)
            .font(ChromeType.sans(12))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1)
        }
      }
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, minHeight: Self.agentRow, alignment: .leading)
      .background(fill(hot: hot))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func sessionRow(_ row: ChatAtSessionRow, hot: Bool) -> some View {
    Button {
      onSession(row)
    } label: {
      HStack(spacing: 10) {
        AgentMark(agent: row.agent, opacity: 1, size: 20)
        VStack(alignment: .leading, spacing: 2) {
          Text(row.handle)
            .font(ChromeType.mono(15, .medium))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          HStack(spacing: 0) {
            Text(row.label)
            if let word = row.word {
              Text(" · ")
              Text(word.rawValue)
                .foregroundStyle(word == .needsYou ? ChromePalette.attention : ChromePalette.inkTertiary)
            }
          }
          .font(ChromeType.sans(12))
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, minHeight: Self.sessionRow, alignment: .leading)
      .background(fill(hot: hot))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  // MARK: An agent's menu

  @ViewBuilder
  private func menu(_ rows: [AgentMenuRow], effort: EffortChoice?) -> some View {
    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
      switch row {
      case .agent(let agent, let under):
        HStack(spacing: 8) {
          Text(agent.label)
            .font(ChromeType.sans(13, .semibold))
            .foregroundStyle(ChromePalette.ink)
          if let under {
            Text(under)
              .font(ChromeType.sans(12))
              .foregroundStyle(ChromePalette.inkTertiary)
          }
          Spacer(minLength: 0)
        }
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
      case .model(let id, let label, let on):
        modelRow(id: id, label: label, on: on)
      case .note(let words):
        quiet(words)
      }
    }
    if let effort {
      HStack(spacing: 10) {
        Text(effort.label)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
        Picker(
          effort.label,
          selection: Binding(get: { effort.values.first { $0.on }?.id ?? "" }, set: { onEffort($0) })
        ) {
          ForEach(effort.values, id: \.id) { value in
            Text(value.label).tag(value.id)
          }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
    }
  }

  private func modelRow(id: String?, label: String, on: Bool) -> some View {
    Button {
      onModel(id)
    } label: {
      HStack(spacing: 10) {
        Text(label)
          .font(ChromeType.sans(15, .medium))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        Spacer(minLength: 8)
        if on {
          FieldGlyph(.check, size: 14)
            .foregroundStyle(ChromePalette.ink)
        }
      }
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, minHeight: Self.agentRow, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}
