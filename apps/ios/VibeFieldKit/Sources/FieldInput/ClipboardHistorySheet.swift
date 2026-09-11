import FieldDesign
import SwiftUI

/// What this card has pasted, newest first.
///
/// The empty state says whose history it is, because that is the fact a person
/// wants when a clipboard-history screen is blank and their phone's clipboard
/// plainly is not: nothing here is read off the pasteboard. An entry exists
/// because the user handed it over through the paste control, which is the
/// only way this app ever sees a clipboard's contents.
public struct ClipboardHistorySheet: View {
  private let history: ClipboardHistory
  private let onUse: (String) -> Void

  public init(history: ClipboardHistory, onUse: @escaping (String) -> Void) {
    self.history = history
    self.onUse = onUse
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if history.entries.isEmpty {
        Text("Nothing pasted through this card yet")
          .font(ChromeType.sans(ChromeType.sheetBodySize))
          .foregroundStyle(ChromePalette.inkTertiary)
          .padding(.horizontal, 22)
          .padding(.top, 18)
        Text("The paste chip above the card is what fills this")
          .font(ChromeType.sans(ChromeType.rowSummarySize))
          .foregroundStyle(ChromePalette.placeholder)
          .padding(.horizontal, 22)
          .padding(.top, 6)
      } else {
        list
      }
      Spacer(minLength: 0)
    }
    .padding(.top, 26)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var header: some View {
    HStack(alignment: .center) {
      VStack(alignment: .leading, spacing: 2) {
        ChromeEyebrow("Clipboard history")
        Text("Pasted through this card")
          .font(ChromeType.sans(ChromeType.sheetTitleSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
      }
      Spacer(minLength: 0)
      if !history.entries.isEmpty {
        Button {
          history.clear()
        } label: {
          Text("Clear")
        }
        .buttonStyle(ChromePillStyle(.secondary))
        .accessibilityLabel("Clear the history")
      }
    }
    .padding(.horizontal, 22)
  }

  private var list: some View {
    List {
      ForEach(Array(history.entries.enumerated()), id: \.offset) { _, entry in
        Button {
          onUse(entry)
        } label: {
          row(entry)
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(ChromePalette.separator)
        .listRowInsets(EdgeInsets(top: 8, leading: 22, bottom: 8, trailing: 22))
      }
      .onDelete { offsets in history.delete(atOffsets: offsets) }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .padding(.top, 8)
  }

  /// The first line and the count. Not the whole block: a paste is often a
  /// stack trace, and a row that renders one is a row nobody can scan past.
  private func row(_ entry: String) -> some View {
    HStack(alignment: .center, spacing: 10) {
      Text(firstLine(of: entry))
        .font(ChromeType.mono(ChromeType.rowCommandSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .lineLimit(1)
      Spacer(minLength: 0)
      Text(lineSummary(entry))
        .font(ChromeType.sans(ChromeType.rowSummarySize))
        .foregroundStyle(ChromePalette.inkTertiary)
    }
    .frame(minHeight: 44)
    .contentShape(Rectangle())
  }

  private func firstLine(of entry: String) -> String {
    entry.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? entry
  }

  private func lineSummary(_ entry: String) -> String {
    let count = pasteLineCount(entry)
    return count == 1 ? "1 line" : "\(count) lines"
  }
}
