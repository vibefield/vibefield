import FieldDesign
import SwiftUI

/// Search's results (H-5): the tab's own content, never a sheet held over the
/// room — the scopes pinned at the top (All · Prompts · Replies), recent
/// searches while the words are empty, then hits grouped under session heads
/// with the terms marked and the foot saying how many.
///
/// The FIELD is not here (IOS-9e): it is the bar's, where the search circle
/// morphs into it at the bottom above the keyboard — so this view takes the
/// words and the kind as bindings and never owns a text field of its own.
public struct HistorySearchView: View {
  let corpus: HistoryCorpus?
  let standing: FieldHistoryModel.DesktopStanding
  @Binding var query: String
  @Binding var kind: FieldHistoryModel.SearchKind
  /// A hit was tapped: where it lands. The home screen switches tabs.
  let onLand: (FieldHistoryModel.Landing, String) -> Void

  public init(
    corpus: HistoryCorpus?, standing: FieldHistoryModel.DesktopStanding, query: Binding<String>,
    kind: Binding<FieldHistoryModel.SearchKind>, onLand: @escaping (FieldHistoryModel.Landing, String) -> Void
  ) {
    self.corpus = corpus
    self.standing = standing
    _query = query
    _kind = kind
    self.onLand = onLand
  }

  @Environment(\.colorScheme) private var scheme

  public var body: some View {
    ScrollView {
      if let corpus {
        results(corpus)
      } else {
        QuietNote(
          title: "Search runs on your desktop's index",
          text: "This build has no search read yet — it lands with the index reads (H-1). The field is the bar's; the answers are owed.")
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .safeAreaInset(edge: .top, spacing: 0) { scopes }
    .background(ChromePalette.paper.ignoresSafeArea())
  }

  /// The kinds, as the system's own segmented control (glass on iOS 26).
  private var scopes: some View {
    Picker("Search in", selection: $kind) {
      ForEach(FieldHistoryModel.SearchKind.allCases, id: \.self) { candidate in
        Text(candidate.label).tag(candidate)
      }
    }
    .pickerStyle(.segmented)
    .padding(.horizontal, 16)
    .padding(.top, 6)
    .padding(.bottom, 8)
    .background(ChromePalette.paper)
  }

  private func results(_ corpus: HistoryCorpus) -> some View {
    let groups = FieldHistoryModel.hits(for: query, kind: kind, in: corpus)
    let matches = FieldHistoryModel.matchCount(groups)
    let quiet = FieldHistoryModel.quiet(query: query, kind: kind, matches: matches, corpus: corpus, standing: standing)
    let terms = FieldHistoryModel.terms(query)
    return LazyVStack(alignment: .leading, spacing: 0) {
      Text(FieldHistoryModel.searchFoot(query: query, matches: matches, standing: standing, desktop: corpus.desktop))
        .font(ChromeType.sans(12, .medium))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkFaint)
        .padding(.horizontal, HistoryParts.sidePadding)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .accessibilityAddTraits(.updatesFrequently)
      if let quiet {
        QuietNote(title: quiet.title, text: quiet.body)
      } else if terms.isEmpty {
        recent(corpus)
      } else {
        ForEach(groups) { group in
          groupHead(group, corpus: corpus)
          ForEach(group.rows) { hit in
            hitRow(hit, in: group, terms: terms)
          }
        }
      }
    }
    .padding(.bottom, 24)
  }

  private func recent(_ corpus: HistoryCorpus) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      DayHeader(text: "Recent")
      ForEach(corpus.recentSearches, id: \.self) { word in
        Button {
          query = word
        } label: {
          HStack(spacing: 12) {
            Image(systemName: "clock")
              .font(.system(size: 14, weight: .regular))
              .foregroundStyle(ChromePalette.inkFaint)
            Text(word)
              .font(ChromeType.sans(15))
              .foregroundStyle(ChromePalette.ink)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 12)
          .frame(minHeight: 44)
          .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(HistoryRowStyle(radius: 12))
        .padding(.horizontal, 8)
      }
    }
  }

  private func groupHead(_ group: HistoryHitGroup, corpus: HistoryCorpus) -> some View {
    let project = corpus.project(group.projectId)
    let color = HistoryParts.projectColor(seq: project?.seq ?? 0, scheme: scheme)
    return HStack(alignment: .center, spacing: 8) {
      Capsule().fill(color).frame(width: 3, height: 14)
      HStack(spacing: 4) {
        Text(project?.name ?? group.projectId)
          .fontWeight(.semibold)
          .foregroundStyle(ChromePalette.ink)
        Text("›").foregroundStyle(ChromePalette.inkFaint)
        Text(group.sessionTitle)
          .foregroundStyle(ChromePalette.inkSecondary)
          .lineLimit(1)
      }
      .font(ChromeType.sans(13))
      AgentMark(agent: group.agent)
      Spacer(minLength: 6)
      Text(FieldHistoryModel.groupWords(group))
        .font(ChromeType.sans(11.5))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkFaint)
        .lineLimit(1)
        .fixedSize()
    }
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.top, 18)
    .padding(.bottom, 6)
    .accessibilityElement(children: .combine)
  }

  private func hitRow(_ hit: HistoryHit, in group: HistoryHitGroup, terms: [String]) -> some View {
    Button {
      guard let corpus else { return }
      onLand(FieldHistoryModel.landing(for: hit, in: group, corpus: corpus), query.trimmingCharacters(in: .whitespaces))
    } label: {
      HStack(alignment: .top, spacing: 10) {
        Group {
          if hit.who == .you {
            Circle().fill(ChromePalette.inkSecondary).frame(width: 7, height: 7).padding(3)
          } else {
            AgentMark(agent: group.agent)
          }
        }
        .frame(width: 14, height: 20)
        snippet(hit.text, terms: terms)
        Spacer(minLength: 4)
        Text(hit.at)
          .font(ChromeType.sans(11.5))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkFaint)
          .padding(.top, 2)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
      .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
    .buttonStyle(HistoryRowStyle(radius: 12))
    .padding(.horizontal, 8)
    .accessibilityLabel("\(hit.who == .you ? "You" : group.agent), \(hit.at): \(hit.text)")
  }

  /// The snippet with every term marked — a wash of the select hue behind
  /// the word, the way `mark` draws it on the page.
  private func snippet(_ text: String, terms: [String]) -> some View {
    var line = AttributedString()
    for run in FieldHistoryModel.marked(text, terms: terms) {
      var piece = AttributedString(run.text)
      piece.foregroundColor = ChromePalette.ink
      if run.marked {
        piece.backgroundColor = ChromePalette.markWash
        piece.font = ChromeType.sans(14, .semibold)
      } else {
        piece.font = ChromeType.sans(14)
      }
      line += piece
    }
    return Text(line)
      .lineSpacing(3)
      .multilineTextAlignment(.leading)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The match stepper — the island's third role (IOS-9e: a glass capsule the
/// bar carries above itself, or inline between its circles while folded):
/// the query word, `2 of 3`, and the two steps.
public struct HistoryStepperView: View {
  @Bindable var router: HistoryRouter

  public init(router: HistoryRouter) {
    self.router = router
  }

  public var body: some View {
    if let landed = router.landed {
      HStack(spacing: 4) {
        Text(landed.query)
          .font(ChromeType.sans(15, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .truncationMode(.tail)
        Text(landed.words)
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
          .padding(.leading, 6)
        Spacer(minLength: 6)
        stepButton("chevron.up", "Previous match") { router.step(-1) }
        stepButton("chevron.down", "Next match") { router.step(1) }
      }
      .padding(.leading, 18)
      .padding(.trailing, 6)
      .frame(maxWidth: .infinity, minHeight: 44)
    }
  }

  private func stepButton(_ glyph: String, _ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: glyph)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(width: 40, height: 40)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}
