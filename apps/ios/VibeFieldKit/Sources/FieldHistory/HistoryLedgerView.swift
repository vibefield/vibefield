import FieldDesign
import SwiftUI

/// The History tab's home (H-2): the ledger at full width — the large title,
/// the scope line, Live now, then the projects with the three lines the
/// desktop's ledger row keeps (identity, location, quantity) and its one
/// comparison, the wash of spend behind the row scaled to the biggest
/// project. Pushed screens ride the tab's own `NavigationStack`, whose path
/// is the router's so a search hit can land here from the other tab.
///
/// SP-6 — GROUPED BY DESKTOP: one ledger per self desktop (the home first),
/// each under its own name when there is more than one; a desktop whose door
/// does not answer draws what this phone last read of it, dimmed, under
/// H-D7's words with the desktop's name. What a screen needs read (a project's
/// sessions and figures, a session's document and tail, an older page) it
/// asks through `onNeed`; the mock answers none, its corpus is whole.
public struct HistoryLedgerView: View {
  let desktops: [HistoryDesktopReader]
  @Bindable var router: HistoryRouter
  let onNeed: (HistoryNeed) -> Void

  public init(
    desktops: [HistoryDesktopReader], router: HistoryRouter, onNeed: @escaping (HistoryNeed) -> Void = { _ in }
  ) {
    self.desktops = desktops
    self.router = router
    self.onNeed = onNeed
  }

  @State private var rank: FieldHistoryModel.Rank = .spend
  @Environment(\.colorScheme) private var scheme

  public var body: some View {
    NavigationStack(path: $router.path) {
      ScrollView {
        if desktops.isEmpty {
          noDesktop
        } else {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(desktops) { reader in
              if desktops.count > 1 { DesktopHead(name: reader.name, standing: reader.standing, isHome: reader.isHome) }
              ledger(reader)
            }
          }
          .padding(.bottom, 40)
        }
      }
      .foldsBar(router)
      .background(ChromePalette.paper.ignoresSafeArea())
      .navigationTitle("History")
      .navigationDestination(for: HistoryRouter.Route.self) { route in
        destination(route)
      }
    }
    .tint(ChromePalette.ink)
  }

  private func reader(_ device: String) -> HistoryDesktopReader? {
    desktops.first { $0.deviceId == device }
  }

  @ViewBuilder
  private func destination(_ route: HistoryRouter.Route) -> some View {
    switch route {
    case .project(let device, let id):
      if let reader = reader(device), let project = reader.corpus.project(id) {
        HistoryProjectView(
          project: project, sessions: reader.corpus.sessions(of: id), corpus: reader.corpus,
          standing: reader.standing, router: router, onNeed: onNeed)
      } else {
        QuietNote(title: "This project is not in the index", text: "Nothing was read for it on this phone.")
      }
    case .session(let device, let id):
      if let reader = reader(device), let document = reader.corpus.document(id) {
        HistorySessionView(
          document: document, corpus: reader.corpus, standing: reader.standing, router: router,
          arrivals: reader.arrivals[id] ?? 0, onNeed: onNeed)
      } else if let reader = reader(device), reader.standing.isAwake {
        QuietNote(title: "Reading the session on \(reader.name)", text: "Its header, its newest rows and its tail arrive over the desktop's door.")
          .onAppear { onNeed(.session(device: device, id: id)) }
      } else {
        QuietNote(
          title: "This session has no document here",
          text: "Only its row was read; the turns arrive with the timeline read once the desktop answers.")
      }
    }
  }

  // MARK: - One desktop's ledger

  private func ledger(_ reader: HistoryDesktopReader) -> some View {
    let corpus = reader.corpus
    let standing = reader.standing
    let awake = standing.isAwake
    let live = FieldHistoryModel.liveHeader(corpus, standing: standing)
    let ranked = FieldHistoryModel.projects(corpus.projects, rankedBy: rank)
    return LazyVStack(alignment: .leading, spacing: 0) {
      scope(corpus, standing: standing)
      if corpus.projects.isEmpty, !awake {
        QuietNote(
          title: "\(corpus.desktop) has not been read yet",
          text: "Nothing of its history is on this phone; its ledger arrives when its door answers.")
      } else if corpus.projects.isEmpty {
        QuietNote(
          title: "No project in \(corpus.desktop)'s index yet",
          text: "Its index lists no project. Choose whose history it reads on the desktop (Settings → Agents).")
      } else {
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
            projectRow(project, device: corpus.deviceId, among: corpus.projects, awake: awake)
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
    }
  }

  private func scope(_ corpus: HistoryCorpus, standing: FieldHistoryModel.DesktopStanding) -> some View {
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
    let device = corpus.deviceId
    return Button {
      switch row.destination {
      case .session(let id):
        onNeed(.session(device: device, id: id))
        router.path =
          row.projectId.isEmpty
          ? [.session(device: device, id: id)]
          : [.project(device: device, id: row.projectId), .session(device: device, id: id)]
      case .project:
        router.path = [.project(device: device, id: row.projectId)]
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

  private func projectRow(_ project: HistoryProject, device: String, among all: [HistoryProject], awake: Bool) -> some View {
    let color = HistoryParts.projectColor(seq: project.seq, scheme: scheme)
    let share = FieldHistoryModel.share(of: project, among: all)
    return Button {
      onNeed(.project(device: device, id: project.id))
      router.path = [.project(device: device, id: project.id)]
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
            if project.spark.isEmpty {
              // SP-6 — figures not read yet: the session count stands in,
              // honestly labelled, until `index.project` answers
              Text("sessions")
                .font(ChromeType.sans(11))
                .foregroundStyle(ChromePalette.inkFaint)
            } else {
              Sparkline(values: project.spark, color: color)
            }
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
    .accessibilityLabel("\(project.name), \(project.figure) \(project.unit.isEmpty ? "sessions" : project.unit + " tokens"), last \(project.last)")
  }

  // MARK: - Honest-missing: no desktop's door answers and nothing is cached

  private var noDesktop: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("no desktop has been read")
        .font(ChromeType.sans(13))
        .foregroundStyle(ChromePalette.inkTertiary)
        .padding(.horizontal, HistoryParts.sidePadding)
        .padding(.top, 2)
      QuietNote(
        title: "History reads your desktops' index over their doors",
        text:
          "No desktop of this account answers right now, and this phone has read none before. The ledger, a project and a session's document arrive from the first desktop whose door answers.")
    }
    .padding(.bottom, 40)
  }
}

/// SP-6 — a desktop's head over its ledger when the tab groups more than one:
/// the name, the home's mark, and the standing's dot.
struct DesktopHead: View {
  let name: String
  let standing: FieldHistoryModel.DesktopStanding
  let isHome: Bool

  var body: some View {
    HStack(spacing: 8) {
      Circle()
        .fill(standing.isAwake ? ChromePalette.green : ChromePalette.inkFaint)
        .frame(width: 7, height: 7)
      Text(name)
        .font(ChromeType.sans(17, .semibold))
        .foregroundStyle(ChromePalette.ink)
      if isHome {
        Text("home")
          .font(ChromeType.sans(10.5, .medium))
          .textCase(.uppercase)
          .tracking(ChromeType.tracking(0.07, of: 10.5))
          .foregroundStyle(ChromePalette.inkFaint)
          .padding(.horizontal, 7)
          .frame(height: 18)
          .background(Capsule().fill(ChromePalette.fill))
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.top, 26)
    .padding(.bottom, 6)
    .accessibilityElement(children: .combine)
  }
}
