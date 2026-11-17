import FieldDesign
import SwiftUI

/// The History tab's home (H-2): the ledger at full width — the head (item
/// 390: "Projects" and how many, in a bubble), Live now, then the projects
/// with the three lines the
/// desktop's ledger row keeps (identity, location, quantity) and its one
/// comparison, the wash of spend behind the row scaled to the biggest
/// project. Pushed screens ride the tab's own `NavigationStack`, whose path
/// is the router's so a search hit can land here from the other tab.
///
/// PJ-7 — ONE LEDGER of projects (`HistoryProjects`, `project.*` over one
/// door; DESIGN.md §8 "The phone's History is one ledger of projects"): no
/// longer grouped by desktop. Location is the desktops' marks in the path's
/// slot, and each sleeping desktop has its own honest sentence led by its
/// mark (the scope line, which ended in the marks, went at item 390). A
/// session's document is read from its OWN
/// desktop's reader (the route's device). What a screen needs read it asks
/// through `onNeed`; the mock answers none, its corpus is whole.
public struct HistoryLedgerView: View {
  let history: HistoryDesktops
  @Bindable var router: HistoryRouter
  /// Item 353 — the tab is the one on screen: the ledger's figures are read only while it is.
  let shown: Bool
  let onNeed: (HistoryNeed) -> Void

  public init(
    history: HistoryDesktops, router: HistoryRouter, shown: Bool = true,
    onNeed: @escaping (HistoryNeed) -> Void = { _ in }
  ) {
    self.history = history
    self.router = router
    self.shown = shown
    self.onNeed = onNeed
  }

  /// Item 353 — the desktop's ledger opens on the most recent project; the phone's does too.
  @State private var rank: FieldHistoryModel.Rank = .recent
  /// Item 353 — the figures stand open until their toggle folds them, as the desktop's do; the phone keeps the choice.
  @AppStorage("vf.history.figures") private var figuresOpen = true
  @Environment(\.colorScheme) private var scheme
  @Environment(\.historyActs) private var acts

  private var projects: HistoryProjects { history.projects }

  /// Item 390 (James, 2026-11-13) — what the root's head says: "Projects" and how many the ledger lists.
  private var head: FieldHistoryModel.Head {
    FieldHistoryModel.rootHead(projects: projects.corpus.projects.count, cut: projects.cut)
  }

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
      .readsTopPull()
      // Item 350 (James, 2026-11-12): the root's title stands in the band Field's Stories row stands in, on the
      // page's paper, and the ledger scrolls under it. The system's bar is hidden here; its name stays for a pushed
      // screen's back button.
      .underRootHead {
        // Item 390 (James, 2026-11-13) — the head says Projects and, in the bubble beside it, how many the ledger
        // lists, and nothing else. Item 353 — the figures toggle at the head's right, where Chat stands its ✦ (its
        // disc's edge on the lists' margin)
        RootHeadRow(head.title, count: head.count, spoken: head.spoken) {
          FiguresToggle(open: $figuresOpen)
            .padding(.trailing, RootHead.side - 5)
        }
        .frame(maxWidth: .infinity)
        .background(ChromePalette.paper)
      }
      // Item 353 — every listed project's figures are read while the figures are open on the tab on screen
      .task(id: figuresOpen && shown) { onNeed(.figures(wanted: figuresOpen && shown)) }
      .background(ChromePalette.paper.ignoresSafeArea())
      // Item 390 — the root's name follows its head: a pushed screen's back button says Projects
      .navigationTitle(head.title)
      .toolbar(.hidden, for: .navigationBar)
      .navigationDestination(for: HistoryRouter.Route.self) { route in
        destination(route)
          // Item 417 — a session's first reading is the hold, over the session's place (HistoryOpening.swift)
          .historyOpening(opening(route))
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

  /// Item 417 — what a pushed screen's hold waits on (`HistoryOpening.wait`): a session whose desktop answers and
  /// has not handed its document over yet, and whether a search landed in it. A project's page has no hold.
  private func opening(_ route: HistoryRouter.Route) -> HistoryOpening.Wait? {
    guard case .session(let device, let id) = route, let desktop = reader(device) else { return nil }
    return HistoryOpening.wait(
      held: desktop.corpus.document(id) != nil, awake: desktop.standing.isAwake,
      landed: router.landed.map { $0.sessionId == id && $0.device == device } ?? false)
  }

  @ViewBuilder
  private func destination(_ route: HistoryRouter.Route) -> some View {
    switch route {
    case .project(let id):
      if let project = projects.corpus.project(id) {
        HistoryProjectView(
          project: project, sessions: projects.corpus.sessions(of: id), corpus: projects.corpus,
          standing: projects.standing,
          index: FieldHistoryModel.indexSentence(projects.index, desktop: projects.sourceName),
          indexPlatform: projects.sourcePlatform, router: router, onNeed: onNeed)
      } else {
        let note = FieldHistoryModel.projectNotRead(device: DeviceWord.current)
        QuietNote(title: note.title, text: note.text)
          .onAppear { onNeed(.project(id: id)) }
      }
    case .session(let device, let id):
      if let reader = reader(device), let document = reader.corpus.document(id) {
        HistorySessionView(
          document: document, corpus: reader.corpus, ledger: projects.corpus, standing: reader.standing,
          router: router, arrivals: reader.arrivals[id] ?? 0, readingEarlier: reader.readingEarlier.contains(id),
          opens: reader.toolDetails[id] ?? [:], pictures: reader.pictures[id] ?? [:], onNeed: onNeed)
      } else if let reader = reader(device), reader.standing.isAwake {
        // Item 417 — a session being read is the hold's, which stands over this place once it is late
        // (`historyOpening`, on the destination). Under it the place is the page's paper alone. A note stood here
        // at once: "Reading the session on ‹desktop›", over a sentence that named the door.
        ChromePalette.paper
          .ignoresSafeArea()
          .onAppear { onNeed(.session(device: device, id: id)) }
      } else {
        let note = FieldHistoryModel.sessionNotRead(device: DeviceWord.current)
        QuietNote(title: note.title, text: note.text)
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
    let portfolio = FieldHistoryModel.portfolio(corpus.projects, sessions: corpus.sessionCount)
    let costed = corpus.projects.contains { FieldHistoryModel.lifetimeCost($0) > 0 }
    return LazyVStack(alignment: .leading, spacing: 0) {
      headNotes(corpus, standing: standing)
      if figuresOpen, !corpus.projects.isEmpty {
        HistoryFiguresPanel(
          portfolio: portfolio, projects: corpus.projects,
          note: FieldHistoryModel.portfolioNote(portfolio, failed: projects.figuresFailed.count, awake: awake),
          awake: awake
        ) { id in
          onNeed(.project(id: id))
          router.path = [.project(id: id)]
        }
        .transition(.opacity)
      }
      if corpus.projects.isEmpty {
        // fix7 — never "no project" while the door's index is not ready
        let empty = FieldHistoryModel.emptyLedger(
          standing: standing, index: projects.index, desktop: projects.sourceName, device: DeviceWord.current)
        QuietNote(title: empty.title, text: empty.text)
      } else {
        GroupHead(live.label, count: live.count)
        VStack(spacing: 6) {
          ForEach(corpus.live) { row in
            liveRow(row, corpus: corpus, awake: awake)
          }
        }
        .padding(.horizontal, 16)
        GroupHead("Projects") { rankSegment }
        LazyVStack(spacing: 3) {
          ForEach(ranked) { project in
            projectRow(project, corpus: corpus, awake: awake)
          }
        }
        .padding(.horizontal, 8)
        Text(
          costed
            ? "Estimated cost, all time · the wash is scaled to \(FieldHistoryModel.costliest(corpus.projects)?.name ?? "the costliest project")"
            : "Spend over 30 days · the wash is scaled to \(FieldHistoryModel.projects(corpus.projects, rankedBy: .spend).first?.name ?? "the biggest project")")
          .font(ChromeType.sans(11.5))
          .foregroundStyle(ChromePalette.inkTertiary)
          .padding(.horizontal, HistoryParts.sidePadding)
          .padding(.top, 14)
          .padding(.bottom, projects.cut ? 6 : 24)
        if projects.cut {
          // Item 352 — the listing went on past the phone's bound: said, never a silent cut
          Text(FieldHistoryModel.cutLedger(corpus.projects.count, desktop: projects.sourceName))
            .font(ChromeType.sans(11.5))
            .foregroundStyle(ChromePalette.inkTertiary)
            .padding(.horizontal, HistoryParts.sidePadding)
            .padding(.bottom, 24)
        }
      }
    }
  }

  /// Under the head, only what says the ledger is not whole (item 390; the scope line's summary and the desktops'
  /// marks stood here): the ledger's own desktop while it does not answer; then each sleeping desktop's own
  /// sentence, led by its mark; then the door's index while it is not ready (fix7), led by its desktop's mark the
  /// same way. A whole ledger has no line here.
  private func headNotes(_ corpus: HistoryCorpus, standing: FieldHistoryModel.DesktopStanding) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      if let note = FieldHistoryModel.headNote(corpus, standing: standing, device: DeviceWord.current) {
        Text(note)
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
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
      if standing.isAwake, let line = FieldHistoryModel.indexSentence(projects.index, desktop: projects.sourceName) {
        HStack(spacing: 5) {
          DeviceMark(platform: projects.sourcePlatform, size: 12)
          Text(line)
            .font(ChromeType.sans(13))
            .monospacedDigit()
        }
        .foregroundStyle(ChromePalette.inkTertiary)
        .accessibilityElement(children: .combine)
      }
    }
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.top, 2)
  }

  private var rankSegment: some View {
    HStack(spacing: 2) {
      ForEach([FieldHistoryModel.Rank.recent, .spend], id: \.self) { candidate in
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
        Capsule().fill(color).opacity(0.45).frame(width: 3).frame(maxHeight: .infinity)
        VStack(alignment: .leading, spacing: 0) {
          HStack(alignment: .center, spacing: 10) {
            Text(project.name)
              .font(ChromeType.sans(16, .medium))
              .foregroundStyle(ChromePalette.ink)
              .lineLimit(1)
            Spacer(minLength: 0)
            AgentMarks(agents: project.agents, more: project.moreAgents, size: 15)
          }
          // PJ-7 — location is the desktops' marks in the path's slot (the
          // mock's corpus, which names no desktop, keeps its path)
          if project.devices.isEmpty {
            Text(project.path)
              .font(ChromeType.mono(11.5))
              .italic(project.missing)
              .foregroundStyle(ChromePalette.inkTertiary)
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
            if !project.spark.isEmpty {
              Sparkline(values: project.spark, color: color)
            } else if project.lifetime == nil {
              // SP-6 — figures not read yet: the session count stands in,
              // honestly labelled, until `project.figures` answers
              Text("sessions")
                .font(ChromeType.sans(11))
                .foregroundStyle(ChromePalette.inkTertiary)
            }
            // Item 353 — the row's "how much" is the desktop's: lifetime estimated cost, once its figures are read
            if let lifetime = project.lifetime {
              SpendText(spend: lifetime.spend)
            } else {
              FigureText(figure: project.figure, unit: project.unit)
            }
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
      .background(alignment: .leading) {
        // The wash: the project's colour from the row's left, as WIDE as its spend earns against the costliest
        // project's, fading as it goes (item 353: the desktop row's wash; it was the whole row at a strength).
        GeometryReader { geometry in
          RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(
              LinearGradient(
                stops: [
                  .init(color: color.opacity(0.15), location: 0),
                  .init(color: color.opacity(0.08), location: 0.64),
                  .init(color: color.opacity(0), location: 1),
                ], startPoint: .leading, endPoint: .trailing)
            )
            .frame(width: max(3, geometry.size.width * share))
        }
      }
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(HistoryRowStyle())
    .accessibilityLabel(
      project.lifetime.map { lifetime in
        let word = FieldHistoryModel.spendWord(lifetime.spend)
        return "\(project.name), \(word.figure)\(word.unit) estimated cost, last \(project.last)"
      } ?? "\(project.name), \(project.figure) \(project.unit.isEmpty ? "sessions" : project.unit + " tokens"), last \(project.last)")
  }

  // MARK: - Honest-missing: no desktop's door answers and nothing is cached

  private var noDesktop: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("no desktop has been read")
        .font(ChromeType.sans(13))
        .foregroundStyle(ChromePalette.inkTertiary)
        .padding(.horizontal, HistoryParts.sidePadding)
        .padding(.top, 2)
      let note = FieldHistoryModel.noDesktopRead(device: DeviceWord.current)
      QuietNote(title: note.title, text: note.text)
    }
    .padding(.bottom, 40)
  }
}

// RETIRED 2026-11-06 (SE-2): `DesktopHead`, a desktop's head over search's page's hits when more than one desktop
// answered. Its one reader, `HistorySearchView`, retired with the page.
