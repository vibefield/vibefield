import FieldDesign
import SwiftUI

// Item 353 (James, 2026-11-12 11:38:00Z) — the ledger's figures, drawn: the four chips and the treemap the desktop's
// History heads its projects with (rosetta's room, `PortfolioSummaryPanel`), and the toggle that shows and hides
// them at the top right of the title's band. The values are `HistoryStats.swift`'s; nothing here counts.

/// The figures toggle: the room's three ascending bars, standing where Chat stands its ✦.
struct FiguresToggle: View {
  @Binding var open: Bool

  var body: some View {
    Button {
      withAnimation(FieldMotion.ease(0.3)) { open.toggle() }
    } label: {
      FiguresGlyph()
        .stroke(open ? ChromePalette.ink : ChromePalette.inkTertiary, style: StrokeStyle(lineWidth: 2, lineCap: .round))
        .frame(width: 22, height: 22)
        .frame(width: 34, height: 34)
        .background {
          if open { Circle().fill(ChromePalette.fill) }
        }
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(open ? "Hide the figures" : "Show the figures")
    .accessibilityAddTraits(open ? [.isSelected] : [])
  }
}

/// Three ascending bars, the room's `StatsGlyph` (a 16-unit box: bars at 3.7, 8 and 12.3, from 12.1 up).
struct FiguresGlyph: Shape {
  func path(in rect: CGRect) -> Path {
    let unit = min(rect.width, rect.height) / 16
    var path = Path()
    for (x, top) in [(3.7, 9.3), (8.0, 6.5), (12.3, 4.1)] {
      path.move(to: CGPoint(x: rect.minX + x * unit, y: rect.minY + 12.1 * unit))
      path.addLine(to: CGPoint(x: rect.minX + x * unit, y: rect.minY + top * unit))
    }
    return path
  }
}

/// One figure on its chip: the digits, their unit, the label under them. The project screen's four and the
/// ledger's four are the same chip.
struct StatChip: View {
  let figure: String
  var unit: String? = nil
  let label: String

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack(alignment: .firstTextBaseline, spacing: 1) {
        Text(figure)
          .font(ChromeType.sans(20, .light))
          .tracking(ChromeType.tracking(-0.02, of: 20))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.ink)
        if let unit, !unit.isEmpty {
          Text(unit)
            .font(ChromeType.sans(12))
            .foregroundStyle(ChromePalette.inkFaint)
        }
      }
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      Text(label)
        .font(ChromeType.sans(9, .medium))
        .textCase(.uppercase)
        .tracking(ChromeType.tracking(0.04, of: 9))
        .foregroundStyle(ChromePalette.inkFaint)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 8)
    .padding(.top, 10)
    .padding(.bottom, 9)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(ChromePalette.fill))
    .accessibilityElement(children: .combine)
  }
}

/// The ledger's figures: sessions, messages, tokens and estimated cost over every listed project, then the ten
/// projects that cost most as a treemap whose tiles open their projects.
struct HistoryFiguresPanel: View {
  let portfolio: HistoryPortfolio
  /// The listed projects, for a tile's ink.
  let projects: [HistoryProject]
  let note: String?
  let awake: Bool
  let onOpen: (String) -> Void

  @Environment(\.colorScheme) private var scheme

  /// The treemap's plot, the room's 140 at the phone's width.
  static let plotHeight: CGFloat = 148

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      chips
      if let note {
        Text(note)
          .font(ChromeType.sans(11.5))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkFaint)
          .padding(.horizontal, 4)
          .fixedSize(horizontal: false, vertical: true)
      }
      card
    }
    .padding(.horizontal, 16)
    .padding(.top, 14)
    .opacity(awake ? 1 : 0.55)
  }

  private var chips: some View {
    let unread = portfolio.read == 0
    let messages = FieldHistoryModel.tokensWord(portfolio.messages)
    let tokens = FieldHistoryModel.tokensWord(portfolio.tokens)
    let cost = FieldHistoryModel.spendWord(unread ? nil : portfolio.spend)
    let estimated = !unread && portfolio.spend.costMicroUsd != nil
    return HStack(spacing: 4) {
      StatChip(figure: FieldHistoryModel.figure(portfolio.sessions), label: "sessions")
      StatChip(
        figure: unread ? "—" : messages.figure,
        unit: unread ? nil : messages.unit + (portfolio.messagesLowerBound ? "+" : ""), label: "messages")
      StatChip(figure: unread ? "—" : tokens.figure, unit: unread ? nil : tokens.unit, label: "tokens")
      StatChip(figure: (estimated ? "~" : "") + cost.figure, unit: cost.unit, label: "est. cost")
    }
  }

  private var card: some View {
    VStack(alignment: .leading, spacing: 8) {
      if portfolio.tiles.isEmpty {
        Text(portfolio.isWhole || !awake ? "No priced project usage" : "Reading the projects' figures")
          .font(ChromeType.sans(11.5))
          .foregroundStyle(ChromePalette.inkFaint)
          .frame(maxWidth: .infinity)
          .frame(height: Self.plotHeight)
      } else {
        GeometryReader { geometry in
          plot(in: geometry.size)
        }
        .frame(height: Self.plotHeight)
      }
      if let unpriced = FieldHistoryModel.unpricedNote(portfolio.unpriced) {
        Text(unpriced)
          .font(ChromeType.sans(11))
          .foregroundStyle(ChromePalette.inkFaint)
          .frame(maxWidth: .infinity)
      }
    }
    .padding(9)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(ChromePalette.fill))
  }

  private func plot(in size: CGSize) -> some View {
    let tiles = HistoryTreemap.layout(portfolio.tiles.map(\.value), in: size)
    return ZStack(alignment: .topLeading) {
      ForEach(tiles, id: \.index) { tile in
        let item = portfolio.tiles[tile.index]
        let color = HistoryParts.projectColor(projects.first { $0.id == item.id }, scheme: scheme)
        let word = FieldHistoryModel.usdWord(item.value)
        let cost = word.figure + word.unit + (item.lowerBound ? "+" : "")
        Button {
          onOpen(item.id)
        } label: {
          RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(color.opacity(scheme == .dark ? 0.34 : 0.26))
            .overlay(alignment: .topLeading) {
              if tile.labelled {
                Text(item.name)
                  .font(ChromeType.sans(10.5, .medium))
                  .foregroundStyle(ChromePalette.inkSecondary)
                  .lineLimit(1)
                  .padding(.horizontal, 6)
                  .padding(.top, 5)
              }
            }
            .overlay(alignment: .bottomTrailing) {
              if tile.labelled {
                Text(cost)
                  .font(ChromeType.sans(10.5))
                  .monospacedDigit()
                  .foregroundStyle(ChromePalette.ink)
                  .lineLimit(1)
                  .padding(.horizontal, 6)
                  .padding(.bottom, 4)
              }
            }
            // the room's gutter: each tile gives up 2 at its right and its foot
            .padding(.trailing, 2)
            .padding(.bottom, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(HistoryRowStyle())
        .frame(width: tile.rect.width, height: tile.rect.height)
        .offset(x: tile.rect.minX, y: tile.rect.minY)
        .accessibilityLabel(
          "\(item.name), \(cost) estimated cost\(item.lowerBound ? ", a lower bound" : ""), "
            + "\(Int((tile.share * 100).rounded())) percent of the lifetime spend shown")
      }
    }
    .frame(width: size.width, height: size.height, alignment: .topLeading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The projects that cost most, by lifetime estimated spend")
  }
}

/// A row's "how much" with its coverage: `$1.24` `K+`, `n/p`, a dash.
struct SpendText: View {
  let spend: HistorySpend?

  var body: some View {
    let word = FieldHistoryModel.spendWord(spend)
    HStack(alignment: .firstTextBaseline, spacing: 1) {
      Text(word.figure)
        .font(ChromeType.sans(13.5, .medium))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(minWidth: 34, alignment: .trailing)
      Text(word.unit)
        .font(ChromeType.sans(11))
        .foregroundStyle(ChromePalette.inkFaint)
        .frame(minWidth: 9, alignment: .leading)
    }
    .lineLimit(1)
  }
}
