import FieldDesign
import SwiftUI

/// The History tab's home (H-2): the ledger at full width — the large title,
/// the scope line, Live now, then the projects with the three lines the
/// desktop's ledger row keeps (identity, location, quantity) and its one
/// comparison, the wash of spend behind the row scaled to the biggest
/// project. Pushed screens ride the tab's own `NavigationStack`, whose path
/// is the router's so a search hit can land here from the other tab.
public struct HistoryLedgerView: View {
  let corpus: HistoryCorpus?
  let standing: FieldHistoryModel.DesktopStanding
  @Bindable var router: HistoryRouter
  /// A change of tab bar visibility the home screen asks for (the bar folds
  /// while the account menu stands).
  let tabBarHidden: Bool

  public init(corpus: HistoryCorpus?, standing: FieldHistoryModel.DesktopStanding, router: HistoryRouter, tabBarHidden: Bool = false) {
    self.corpus = corpus
    self.standing = standing
    self.router = router
    self.tabBarHidden = tabBarHidden
  }

  @State private var rank: FieldHistoryModel.Rank = .spend
  @Environment(\.colorScheme) private var scheme

  public var body: some View {
    NavigationStack(path: $router.path) {
      ScrollView {
        if let corpus {
          ledger(corpus)
        } else {
          notBuilt
        }
      }
      .background(ChromePalette.paper.ignoresSafeArea())
      .navigationTitle("History")
      .toolbarVisibility(tabBarHidden ? .hidden : .visible, for: .tabBar)
      .navigationDestination(for: HistoryRouter.Route.self) { route in
        destination(route)
          .toolbarVisibility(tabBarHidden ? .hidden : .visible, for: .tabBar)
      }
    }
    .tint(ChromePalette.ink)
  }

  @ViewBuilder
  private func destination(_ route: HistoryRouter.Route) -> some View {
    switch route {
    case .project(let id):
      if let corpus, let project = corpus.project(id) {
        HistoryProjectView(project: project, sessions: corpus.sessions(of: id), corpus: corpus, standing: standing, router: router)
      } else {
        QuietNote(title: "This project is not in the index", text: "Nothing was read for it on this phone.")
      }
    case .session(let id):
      if let corpus, let document = corpus.document(id) {
        HistorySessionView(document: document, corpus: corpus, standing: standing, router: router)
      } else {
        QuietNote(title: "This session has no document here", text: "Only its row was read; the turns arrive with the timeline read.")
      }
    }
  }

  // MARK: - The ledger

  private func ledger(_ corpus: HistoryCorpus) -> some View {
    let awake = standing != .asleep
    let live = FieldHistoryModel.liveHeader(corpus, standing: standing)
    let ranked = FieldHistoryModel.projects(corpus.projects, rankedBy: rank)
    return LazyVStack(alignment: .leading, spacing: 0) {
      scope(corpus)
      GroupHead(live.label, count: live.count)
      VStack(spacing: 6) {
        ForEach(corpus.live) { row in
          liveRow(row, corpus: corpus, awake: awake)
        }
      }
      .padding(.horizontal, 16)
      GroupHead("Projects") { rankSegment }
      LazyVStack(spacing: 0) {
        ForEach(ranked) { project in
          projectRow(project, among: corpus.projects, awake: awake)
        }
      }
      .padding(.horizontal, 8)
      Text("Spend over 30 days · the wash is scaled to \(ranked.first?.name ?? "the biggest project")")
        .font(ChromeType.sans(11.5))
        .foregroundStyle(ChromePalette.inkFaint)
        .padding(.horizontal, HistoryParts.sidePadding)
        .padding(.top, 14)
        .padding(.bottom, 24)
    }
    .padding(.bottom, 40)
  }

  private func scope(_ corpus: HistoryCorpus) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(FieldHistoryModel.scopeLine(corpus, standing: standing))
        .font(ChromeType.sans(13))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkTertiary)
      if case .indexing(let percent, _, _) = standing, let denominator = FieldHistoryModel.indexingDenominator(standing: standing) {
        HStack(spacing: 8) {
          Capsule().fill(ChromePalette.fill).frame(width: 96, height: 4)
            .overlay(alignment: .leading) {
              Capsule().fill(ChromePalette.inkSecondary).frame(width: 96 * CGFloat(percent) / 100, height: 4)
            }
          Text(denominator)
            .font(ChromeType.sans(11.5))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkFaint)
        }
      }
    }
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.top, 2)
  }

  private var rankSegment: some View {
    HStack(spacing: 2) {
      ForEach(FieldHistoryModel.Rank.allCases, id: \.self) { candidate in
        Button {
          withAnimation(FieldMotion.ease(0.3)) { rank = candidate }
        } label: {
          Text(candidate.rawValue)
            .font(ChromeType.sans(12, .medium))
            .foregroundStyle(rank == candidate ? ChromePalette.segSelectedInk : ChromePalette.segInk)
            .padding(.horizontal, 11)
            .frame(height: 26)
            .background {
              if rank == candidate {
                Capsule().fill(ChromePalette.segSelected)
                  .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
              }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(rank == candidate ? [.isSelected] : [])
      }
    }
    .padding(2)
    .background(Capsule().fill(ChromePalette.segTrack))
    .accessibilityLabel("Rank projects")
  }

  private func liveRow(_ row: HistoryLive, corpus: HistoryCorpus, awake: Bool) -> some View {
    let color = HistoryParts.projectColor(seq: corpus.project(row.projectId)?.seq ?? 0, scheme: scheme)
    return Button {
      switch row.destination {
      case .session(let id): router.path = [.project(row.projectId), .session(id)]
      case .project: router.path = [.project(row.projectId)]
      }
    } label: {
      HStack(alignment: .center, spacing: 12) {
        Capsule().fill(color).frame(width: 3).frame(maxHeight: .infinity)
        VStack(alignment: .leading, spacing: 1) {
          Text(row.title)
            .font(ChromeType.sans(14.5, .medium))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          HStack(spacing: 6) {
            LivePulse(awake: awake)
            Text(row.running)
              .font(ChromeType.mono(11.5))
              .foregroundStyle(awake ? ChromePalette.green : ChromePalette.inkTertiary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 8)
        AgentMark(agent: row.agent)
      }
      .padding(.leading, 12)
      .padding(.trailing, 14)
      .padding(.top, 10)
      .padding(.bottom, 11)
      .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(ChromePalette.fill))
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(row.title), \(row.agent), running \(row.running)")
  }

  private func projectRow(_ project: HistoryProject, among all: [HistoryProject], awake: Bool) -> some View {
    let color = HistoryParts.projectColor(seq: project.seq, scheme: scheme)
    let share = FieldHistoryModel.share(of: project, among: all)
    return Button {
      router.path = [.project(project.id)]
    } label: {
      HStack(alignment: .top, spacing: 12) {
        Capsule().fill(color).opacity(0.5).frame(width: 3).frame(maxHeight: .infinity)
        VStack(alignment: .leading, spacing: 0) {
          HStack(alignment: .center, spacing: 10) {
            Text(project.name)
              .font(ChromeType.sans(16, .medium))
              .foregroundStyle(ChromePalette.ink)
              .lineLimit(1)
            Spacer(minLength: 0)
            AgentMarks(agents: project.agents, more: project.moreAgents)
          }
          Text(project.path)
            .font(ChromeType.mono(11.5))
            .italic(project.missing)
            .foregroundStyle(ChromePalette.inkFaint)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.top, 2)
          HStack(alignment: .center, spacing: 10) {
            Sparkline(values: project.spark, color: color)
            FigureText(figure: project.figure, unit: project.unit)
            Spacer(minLength: 0)
            LastWord(word: project.last, isLive: project.isLive, awake: awake)
          }
          .padding(.top, 8)
          .opacity(awake ? 1 : 0.55)
        }
      }
      .padding(.leading, 12)
      .padding(.trailing, 14)
      .padding(.vertical, 12)
      .background {
        // The wash: the project's colour, as much of it as its spend earns.
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(color.opacity(0.14 * share))
      }
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(HistoryRowStyle())
    .accessibilityLabel("\(project.name), \(project.figure) \(project.unit) tokens, last \(project.last)")
  }

  // MARK: - Honest-missing (the real path, before the reads)

  private var notBuilt: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("no desktop has been read")
        .font(ChromeType.sans(13))
        .foregroundStyle(ChromePalette.inkTertiary)
        .padding(.horizontal, HistoryParts.sidePadding)
        .padding(.top, 2)
      QuietNote(
        title: "History reads your desktop's index over its door",
        text:
          "This build has no reads for it yet — the ledger, a project and a session's document arrive with the index reads (H-1). Until then the tab shows the shape of what it will read, and says so.")
    }
    .padding(.bottom, 40)
  }
}
