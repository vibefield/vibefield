import FieldDesign
import SwiftUI

// Item 362f (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "i think all
// message type and views are different from desktop, needs thorough audit") — WHAT A TOOL LINE OPENS TO, DRAWN.
//
// The room's own blocks at the room's own figures (styles/transcript.css: 11.5 px mono for a diff and a list of
// paths; a diff's three cells, number · sign · text; an added line on green at 11 %, a line taken out on red at
// 10 %), set at the group's indent under the line that opened. One thing is the phone's: a line of a diff WRAPS,
// where the room lets it run on and scrolls sideways, because a page that scrolls down does not also scroll
// across.
//
// Everything here is text (EL7: a recorded text is the adversary's). A path is its words and opens nothing.
// DESIGN.md §8 "The phone's session document" → a tool line opens.

struct HistoryToolDetailView: View, Equatable {
  let detail: HistoryToolDetail

  nonisolated static func == (a: HistoryToolDetailView, b: HistoryToolDetailView) -> Bool { a.detail == b.detail }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let folder = detail.folder { folderLine(folder) }
      if let command = detail.command { well(command) }
      ForEach(Array(detail.files.enumerated()), id: \.offset) { _, file in
        fileBlock(file)
      }
      if detail.moreFiles > 0 {
        quiet("… \(detail.moreFiles) more \(detail.moreFiles == 1 ? "file" : "files") in this change")
      }
      if !detail.paths.isEmpty { pathList }
      if let failure = detail.failure { well(failure) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // MARK: A command

  private func folderLine(_ folder: String) -> some View {
    HStack(spacing: 5) {
      Image(systemName: "folder")
        .font(.system(size: 10, weight: .medium))
      Text(verbatim: folder)
        .font(ChromeType.mono(11.5))
        .lineLimit(1)
        .truncationMode(.head)
    }
    .foregroundStyle(ChromePalette.inkTertiary)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Working folder: \(folder)")
  }

  /// A command's source, or a failure's summary: mono on the fill, wrapped.
  private func well(_ words: String) -> some View {
    Text(verbatim: words)
      .font(ChromeType.mono(11.5))
      .lineSpacing(3)
      .foregroundStyle(ChromePalette.inkSecondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
      .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ChromePalette.fill))
  }

  // MARK: A change

  private func fileBlock(_ file: HistoryToolDetail.File) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(verbatim: file.path)
        .font(ChromeType.mono(11.5))
        .foregroundStyle(ChromePalette.inkTertiary)
        .lineLimit(1)
        .truncationMode(.head)
      if file.lines.isEmpty {
        quiet("no diff recorded")
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(file.lines.enumerated()), id: \.offset) { _, line in
            diffLine(line)
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        if file.more > 0 { quiet("… \(file.more) more \(file.more == 1 ? "line" : "lines")") }
      }
    }
  }

  private func diffLine(_ line: HistoryToolDetail.DiffLine) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      Text(verbatim: line.number.map(String.init) ?? "")
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkTertiary)
        .lineLimit(1)
        .frame(width: 30, alignment: .trailing)
        .padding(.trailing, 6)
      Text(verbatim: sign(line.kind))
        .foregroundStyle(ChromePalette.inkTertiary)
        .frame(width: 12, alignment: .leading)
      Text(verbatim: line.text)
        .foregroundStyle(line.kind == .context ? ChromePalette.inkSecondary : ChromePalette.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(ChromeType.mono(11.5))
    .padding(.vertical, 1.5)
    .background(tint(line.kind))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(spoken(line.kind))\(line.text)")
  }

  /// `+` for a line added, the minus sign for one taken out, nothing for context: the room's second cell.
  private func sign(_ kind: HistoryToolDetail.DiffLine.Kind) -> String {
    switch kind {
    case .add: "+"
    case .del: "\u{2212}"
    case .context: " "
    }
  }

  private func spoken(_ kind: HistoryToolDetail.DiffLine.Kind) -> String {
    switch kind {
    case .add: "added: "
    case .del: "removed: "
    case .context: ""
    }
  }

  private func tint(_ kind: HistoryToolDetail.DiffLine.Kind) -> Color {
    switch kind {
    case .add: ChromePalette.green.opacity(0.11)
    case .del: ChromePalette.red.opacity(0.10)
    case .context: .clear
    }
  }

  // MARK: Paths

  private var pathList: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(detail.paths.enumerated()), id: \.offset) { _, path in
        pathLine(path)
      }
      if detail.morePaths > 0 { quiet("… \(detail.morePaths) more") }
    }
  }

  /// A path as the line itself names one: its last two folders dim, its name bright; then its range.
  private func pathLine(_ path: HistoryToolDetail.Path) -> some View {
    let (dir, name) = FieldHistoryModel.splitPath(path.path, family: "file_read")
    return HStack(spacing: 6) {
      Image(systemName: "doc.text")
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(ChromePalette.inkT4)
      HStack(spacing: 0) {
        if let dir {
          Text(verbatim: dir).foregroundStyle(ChromePalette.inkTertiary)
        }
        Text(verbatim: name).foregroundStyle(ChromePalette.inkSecondary)
      }
      .font(ChromeType.mono(11.5))
      .lineLimit(1)
      .truncationMode(.head)
      if let range = path.range {
        Text(verbatim: range)
          .font(ChromeType.sans(11.5))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .fixedSize()
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(path.range.map { "\(path.path), \($0)" } ?? path.path)
  }

  // MARK: The quiet lines

  /// `… 3 more lines` · `no diff recorded`: the room's words, the count stated and the noun agreeing.
  private func quiet(_ words: String) -> some View {
    Text(verbatim: words)
      .font(ChromeType.sans(11.5))
      .monospacedDigit()
      .foregroundStyle(ChromePalette.inkTertiary)
  }
}
