import FieldDesign
import SwiftUI

/// The History tab's home (H-2): the ledger at full width — the large title,
/// the scope line, Live now, then the projects with the three lines the
/// desktop's ledger row keeps (identity, location, quantity) and its one
/// comparison, the wash of spend behind the row scaled to the biggest
/// project. Pushed screens ride the tab's own `NavigationStack`, whose path
/// is the router's so a search hit can land here from the other tab.
///
/// PJ-7 — ONE LEDGER of projects (`HistoryProjects`, `project.*` over one
/// door; DESIGN.md §8 "The phone's History is one ledger of projects"): no
/// longer grouped by desktop. Location is the desktops' marks in the path's
/// slot; the scope line ends in them, and each sleeping desktop has its own
/// honest sentence led by its mark. A session's document is read from its OWN
/// desktop's reader (the route's device). What a screen needs read it asks
/// through `onNeed`; the mock answers none, its corpus is whole.
public struct HistoryLedgerView: View {
  let history: HistoryDesktops
  @Bindable var router: HistoryRouter
  let onNeed: (HistoryNeed) -> Void

  public init(
    history: HistoryDesktops, router: HistoryRouter, onNeed: @escaping (HistoryNeed) -> Void = { _ in }
  ) {
    self.history = history
    self.router = router
    self.onNeed = onNeed
  }

  @State private var rank: FieldHistoryModel.Rank = .spend
  @Environment(\.colorScheme) private var scheme
  @Environment(\.historyActs) private var acts

  private var projects: HistoryProjects { history.projects }

  public var body: some View {
    NavigationStack(path: $router.path) {
      ScrollView {
        if projects.corpus.projects.isEmpty, projects.isReplaying, history.readers.isEmpty {
          noDesktop
        } else {
          ledger
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
    // D9 — a key that regrouped: the route that names it follows
    .onChange(of: projects.moves) { _, moves in
      for move in moves { router.rekey(from: move.from, to: move.to) }
    }
  }

  private func reader(_ device: String) -> HistoryDesktopReader? {
    history.reader(for: device)
  }

  @ViewBuilder
  private func destination(_ route: HistoryRouter.Route) -> some View {
    switch route {
    case .project(let id):
      if let project = projects.corpus.project(id) {
        HistoryProjectView(
          project: project, sessions: projects.corpus.sessions(of: id), corpus: projects.corpus,
          standing: projects.standing, router: router, onNeed: onNeed)
      } else {
        QuietNote(title: "This project is not in the ledger", text: "Nothing was read for it on this phone.")
          .onAppear { onNeed(.project(id: id)) }
      }
    case .session(let device, let id):
      if let reader = reader(device), let document = reader.corpus.document(id) {
        HistorySessionView(
          document: document, corpus: reader.corpus, ledger: projects.corpus, standing: reader.standing,
          router: router, arrivals: reader.arrivals[id] ?? 0, onNeed: onNeed)
      } else if let reader = reader(device), reader.standing.isAwake {
        QuietNote(title: "Reading the session on \(reader.name)", text: "Its header, its newest rows and its tail arrive over the desktop's door.")
          .onAppear { onNeed(.session(device: device, id: id)) }
      } else {
        QuietNote(
          title: "This session has no document here",
          text: "Its desktop does not answer, and this phone has not read its turns before.")
          .onAppear { onNeed(.session(device: device, id: id)) }
      }
    }
  }

  // MARK: - The ledger

  private var ledger: some View {
    let corpus = projects.corpus
    let standing = projects.standing
    let awake = standing.isAwake
    let live = FieldHistoryModel.liveHeader(corpus, standing: standing)
    let ranked = FieldHistoryModel.projects(corpus.projects, rankedBy: rank)
    return LazyVStack(alignment: .leading, spacing: 0) {
      scope(corpus, standing: standing)
      if corpus.projects.isEmpty, !awake {
        QuietNote(
          title: "Your projects have not been read yet",
          text: "Nothing of your history is on this phone; the ledger arrives when a desktop's door answers.")
      } else if corpus.projects.isEmpty {
        QuietNote(
          title: "No project in your desktops' index yet",
          text: "The index lists no project. Choose whose history it reads on a desktop (Settings → Agents).")
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
            projectRow(project, corpus: corpus, awake: awake)
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

  /// The scope line, ending in the marks of the desktops read; then each
  /// sleeping desktop's own sentence, led by its mark.
  private func scope(_ corpus: HistoryCorpus, standing: FieldHistoryModel.DesktopStanding) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      if corpus.desktops.isEmpty {
        Text(FieldHistoryModel.scopeLine(corpus, standing: standing))
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
      } else {
        HStack(spacing: 6) {
          Text(standing.isAwake ? FieldHistoryModel.ledgerScope(corpus) : FieldHistoryModel.scopeLine(corpus, standing: standing))
            .font(ChromeType.sans(13))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkTertiary)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
          if standing.isAwake {
            DeviceMarks(ids: corpus.desktops.map(\.id), desktops: corpus.desktops, size: 12)
          }
        }
        ForEach(corpus.desktops.filter(\.asleep)) { desktop in
          HStack(spacing: 5) {
            DeviceMark(platform: desktop.platform, size: 12)
            Text(FieldHistoryModel.asleepSentence(desktop))
              .font(ChromeType.sans(13))
              .monospacedDigit()
          }
          .foregroundStyle(ChromePalette.inkTertiary)
          .accessibilityElement(children: .combine)
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
    let color = HistoryParts.projectColor(corpus.project(row.projectId), scheme: scheme)
    let device = row.device ?? corpus.deviceId
    return Button {
      switch row.destination {
      case .session(let id):
        onNeed(.session(device: device, id: id))
        router.path =
          row.projectId.isEmpty
          ? [.session(device: device, id: id)]
          : [.project(id: row.projectId), .session(device: device, id: id)]
      case .project:
        router.path = [.project(id: row.projectId)]
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
            if let id = row.device {
              DeviceName(device: corpus.desktop(id), fallback: nil, size: 11)
                .font(ChromeType.sans(11.5, .medium))
                .foregroundStyle(ChromePalette.inkSecondary)
                .fixedSize()
            }
            Text(row.running)
              .font(ChromeType.mono(11.5))
              .foregroundStyle(awake ? ChromePalette.green : ChromePalette.inkTertiary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 8)
        AgentMark(agent: row.agent)
        if jumpable(row) != nil { Color.clear.frame(width: 32, height: 32) }
      }
      .padding(.leading, 12)
      .padding(.trailing, 14)
      .padding(.top, 10)
      .padding(.bottom, 11)
      .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(ChromePalette.fill))
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(.plain)
    // PJ-7 — a live row ends in the jump circle when the field holds its run
    // (over the row, so its own tap is its own)
    .overlay(alignment: .trailing) {
      if let native = jumpable(row) {
        JumpCircle { acts.jump(native) }
          .padding(.trailing, 14)
      }
    }
    .accessibilityLabel("\(row.title), \(row.agent), running \(row.running)")
  }

  /// The conversation a live row can jump to: the field holds its run.
  private func jumpable(_ row: HistoryLive) -> String? {
    row.nativeSessionId.flatMap { acts.inField($0) ? $0 : nil }
  }

  private func projectRow(_ project: HistoryProject, corpus: HistoryCorpus, awake: Bool) -> some View {
    let color = HistoryParts.projectColor(project, scheme: scheme)
    let share = FieldHistoryModel.share(of: project, among: corpus.projects)
    return Button {
      onNeed(.project(id: project.id))
      router.path = [.project(id: project.id)]
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
          // PJ-7 — location is the desktops' marks in the path's slot (the
          // mock's corpus, which names no desktop, keeps its path)
          if project.devices.isEmpty {
            Text(project.path)
              .font(ChromeType.mono(11.5))
              .italic(project.missing)
              .foregroundStyle(ChromePalette.inkFaint)
              .lineLimit(1)
              .truncationMode(.middle)
              .padding(.top, 2)
          } else {
            DeviceMarks(ids: project.devices, desktops: corpus.desktops)
              .opacity(project.missing ? 0.55 : 1)
              .frame(height: 16)
              .padding(.top, 3)
          }
          HStack(alignment: .center, spacing: 10) {
            if project.spark.isEmpty {
              // SP-6 — figures not read yet: the session count stands in,
              // honestly labelled, until `project.figures` answers
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
