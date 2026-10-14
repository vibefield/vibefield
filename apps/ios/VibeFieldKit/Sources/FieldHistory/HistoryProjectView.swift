import FieldDesign
import SwiftUI

/// A project (H-3): the column head grown (marker · name · count), the four
/// figures, the 53-week ribbon, and the sessions under their days.
///
/// SP-6 — over a door the project's sessions and figures are READ when it
/// opens (`onNeed(.project)`), and a session row opens its document, which is
/// read when it opens; the ribbon is the index's own count when the figures
/// have landed (`project.ribbon`), the record's seeded pattern until then.
///
/// PJ-7 — one project across every desktop (DESIGN.md §8 "The phone's History
/// is one ledger of projects"): the head says `N places on` and the marks; the
/// project's live sessions; DESKTOPS, one row per desktop that folds its places
/// out; and each session row names where it ran — the desktop's mark and name,
/// then the folder's name — and opens its document on that desktop's door.
struct HistoryProjectView: View {
  let project: HistoryProject
  let sessions: [HistorySession]
  let corpus: HistoryCorpus
  let standing: FieldHistoryModel.DesktopStanding
  /// fix7 — the ledger's index while it is not ready, in its sentence (nil:
  /// ready), led by its desktop's mark under the head
  var index: String? = nil
  var indexPlatform: String? = nil
  @Bindable var router: HistoryRouter
  var onNeed: (HistoryNeed) -> Void = { _ in }

  @Environment(\.colorScheme) private var scheme
  @Environment(\.historyActs) private var acts
  @State private var receipt: String?
  @State private var resuming: String?
  @State private var rung: String?
  @State private var unfolded: String?

  private var color: Color { HistoryParts.projectColor(project, scheme: scheme) }
  private var awake: Bool { standing.isAwake }
  private var live: [HistoryLive] { corpus.live.filter { $0.projectId == project.id } }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          head
          stats
          card
          if !live.isEmpty { liveList }
          if !project.places.isEmpty { desktopList }
          sessionList
        }
        .padding(.bottom, 60)
      }
      .foldsBar(router)
      .background(ChromePalette.paper.ignoresSafeArea())
      .navigationTitle(project.name)
      .navigationBarTitleDisplayMode(.inline)
      .overlay(alignment: .bottom) { receiptView }
      .onAppear {
        onNeed(.project(id: project.id))
        // A hit landed here for a session with no document: ring its row.
        if let session = router.rungSession {
          router.rungSession = nil
          rung = session
          withAnimation(FieldMotion.ease(0.5)) { proxy.scrollTo(session, anchor: .center) }
          Task {
            try? await Task.sleep(for: .seconds(1.4))
            withAnimation(FieldMotion.ease(0.4)) { rung = nil }
          }
        }
      }
    }
  }

  private var head: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 10) {
        Capsule().fill(color).frame(width: 4, height: 26)
        Text(project.name)
          .font(ChromeType.sans(28, .bold))
          .tracking(ChromeType.tracking(-0.02, of: 28))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        Text("\(sessions.count)")
          .font(ChromeType.sans(12, .medium))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkSecondary)
          .padding(.horizontal, 8)
          .frame(height: 22)
          .background(Capsule().fill(ChromePalette.fill))
      }
      if project.devices.isEmpty {
        Text(project.path)
          .font(ChromeType.mono(11.5))
          .italic(project.missing)
          .foregroundStyle(ChromePalette.inkFaint)
          .lineLimit(1)
          .truncationMode(.middle)
          .padding(.top, 4)
      } else {
        // PJ-7 — the places, as marks: the path never shows
        HStack(spacing: 6) {
          Text("\(project.places.count) \(project.places.count == 1 ? "place" : "places") on")
            .font(ChromeType.sans(12.5))
            .foregroundStyle(ChromePalette.inkFaint)
          DeviceMarks(ids: project.devices, desktops: corpus.desktops)
        }
        .padding(.top, 5)
      }
      if let index {
        HStack(spacing: 5) {
          DeviceMark(platform: indexPlatform, size: 12)
          Text(index)
            .font(ChromeType.sans(12.5))
            .monospacedDigit()
        }
        .foregroundStyle(ChromePalette.inkTertiary)
        .padding(.top, 5)
        .accessibilityElement(children: .combine)
      }
    }
    .padding(.horizontal, HistoryParts.sidePadding)
    .padding(.top, 6)
  }

  private var stats: some View {
    let s = project.stats
    return HStack(spacing: 4) {
      stat(s?.sessions ?? "—", nil, "sessions")
      stat(s?.messages ?? "—", nil, "messages")
      stat(s?.tokens ?? "—", s?.tokensUnit, "tokens")
      stat(s?.activeDays ?? "—", nil, "active days")
    }
    .padding(.horizontal, 16)
    .padding(.top, 16)
    .opacity(awake ? 1 : 0.55)
  }

  private func stat(_ figure: String, _ unit: String?, _ label: String) -> some View {
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
  }

  /// The overview card: the ribbon and the facts line.
  private var card: some View {
    VStack(alignment: .leading, spacing: 10) {
      ChromeEyebrow("Overview")
      ribbon
      HStack {
        ForEach(["Sep", "Dec", "Mar", "Jun", "Sep"], id: \.self) { month in
          Text(month)
          if month != "Sep" || true { Spacer(minLength: 0) }
        }
      }
      .font(ChromeType.sans(9.5))
      .foregroundStyle(ChromePalette.inkFaint)
      if let facts = project.stats?.facts {
        Text(facts)
          .font(ChromeType.sans(12.5))
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(2)
      } else if awake {
        Text("Reading the figures…")
          .font(ChromeType.sans(12.5))
          .foregroundStyle(ChromePalette.inkFaint)
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ChromePalette.fill.opacity(0.6)))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5))
    .padding(.horizontal, 16)
    .padding(.top, 12)
  }

  private var ribbon: some View {
    let weeks = project.ribbon ?? FieldHistoryModel.ribbon(seq: project.seq, start: project.id == "mille" ? 22 : 3)
    return GeometryReader { geo in
      let gap: CGFloat = 1.5
      let cell = (geo.size.width - gap * 52) / 53
      HStack(spacing: gap) {
        ForEach(Array(weeks.enumerated()), id: \.offset) { _, days in
          VStack(spacing: gap) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, level in
              RoundedRectangle(cornerRadius: 1)
                .fill(level == 0 ? ChromePalette.ruleStrong.opacity(0.5) : color.opacity(0.25 + 0.19 * Double(level)))
                .frame(width: cell, height: cell)
            }
          }
        }
      }
    }
    .frame(height: 7 * 5.2 + 6 * 1.5)
    .accessibilityLabel("Activity over 53 weeks")
  }

  /// The project's sessions that are running now.
  private var liveList: some View {
    VStack(alignment: .leading, spacing: 0) {
      GroupHead(awake ? "Live now" : "Last seen live · \(corpus.readAt)", count: awake ? live.count : nil)
      VStack(spacing: 6) {
        ForEach(live) { row in
          Button {
            if case .session(let id) = row.destination {
              let device = row.device ?? corpus.deviceId
              onNeed(.session(device: device, id: id))
              router.path.append(.session(device: device, id: id))
            }
          } label: {
            HStack(spacing: 10) {
              LivePulse(awake: awake)
              VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                  .font(ChromeType.sans(14.5, .medium))
                  .foregroundStyle(ChromePalette.ink)
                  .lineLimit(1)
                if let id = row.device {
                  DeviceName(device: corpus.desktop(id), fallback: nil, size: 11)
                    .font(ChromeType.sans(11.5))
                    .foregroundStyle(ChromePalette.inkTertiary)
                }
              }
              Spacer(minLength: 8)
              AgentMark(agent: row.agent)
              if row.nativeSessionId.map(acts.inField) == true { Color.clear.frame(width: 32, height: 32) }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(ChromePalette.fill))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
          }
          .buttonStyle(.plain)
          .overlay(alignment: .trailing) {
            if let native = row.nativeSessionId, acts.inField(native) {
              JumpCircle { acts.jump(native) }
                .padding(.trailing, 12)
            }
          }
        }
      }
      .padding(.horizontal, 16)
    }
  }

  /// DESKTOPS — one row per desktop the project lives on (its mark, its name,
  /// how many work there or that it sleeps), each folding its places out.
  private var desktopList: some View {
    let byDesktop = FieldHistoryModel.placesByDesktop(project, desktops: corpus.desktops, live: live)
    return VStack(alignment: .leading, spacing: 0) {
      GroupHead("Desktops", count: nil)
      VStack(spacing: 0) {
        ForEach(byDesktop, id: \.desktop) { group in
          let device = corpus.desktop(group.desktop)
          let open = unfolded == group.desktop
          Button {
            withAnimation(FieldMotion.ease(0.25)) { unfolded = open ? nil : group.desktop }
          } label: {
            HStack(spacing: 10) {
              DeviceMark(platform: device?.platform, size: 19)
                .foregroundStyle(ChromePalette.ink)
                .opacity(device?.asleep == true ? HistoryParts.asleepMark : 1)
              Text(device?.name ?? "a desktop")
                .font(ChromeType.sans(15, .medium))
                .foregroundStyle(ChromePalette.ink)
              Spacer(minLength: 8)
              Text(group.words)
                .font(ChromeType.sans(12.5))
                .monospacedDigit()
                .foregroundStyle(group.working > 0 && device?.asleep != true ? ChromePalette.green : ChromePalette.inkFaint)
              Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ChromePalette.inkFaint)
                .rotationEffect(.degrees(open ? 90 : 0))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
          }
          .buttonStyle(HistoryRowStyle())
          .accessibilityLabel("\(device?.name ?? "a desktop"), \(group.words)")
          .accessibilityValue(open ? "open" : "folded")
          if open {
            ForEach(group.places) { place in
              HStack(spacing: 8) {
                Text(place.branch.map { "\(place.name) · \($0)" } ?? place.name)
                  .font(ChromeType.sans(13.5))
                  .foregroundStyle(place.reason == nil ? ChromePalette.inkSecondary : ChromePalette.inkFaint)
                  .lineLimit(1)
                Spacer(minLength: 8)
                Text(place.reason ?? place.last)
                  .font(ChromeType.sans(12))
                  .monospacedDigit()
                  .foregroundStyle(ChromePalette.inkFaint)
              }
              .padding(.leading, 41)
              .padding(.trailing, 12)
              .frame(minHeight: 34)
            }
          }
        }
      }
      .padding(.horizontal, 8)
    }
  }

  private var sessionList: some View {
    LazyVStack(alignment: .leading, spacing: 0) {
      if sessions.isEmpty {
        QuietNote(
          title: awake ? "Reading the sessions…" : "No sessions read for this project",
          text: awake ? "The listing arrives over the desktop's door." : "They arrive once \(corpus.desktop) answers.")
      }
      ForEach(sessions) { session in
        if let day = session.day { DayHeader(text: day) }
        sessionRow(session)
      }
    }
    .padding(.top, 6)
  }

  private func sessionRow(_ session: HistorySession) -> some View {
    let device = session.device ?? corpus.deviceId
    return Button {
      onNeed(.session(device: device, id: session.id))
      router.path.append(.session(device: device, id: session.id))
    } label: {
      HStack(alignment: .top, spacing: 12) {
        Circle()
          .fill(session.tone == .orange ? ChromePalette.attention : ChromePalette.inkFaint)
          .frame(width: 8, height: 8)
          .padding(.top, 6)
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 10) {
            Text(session.title)
              .font(ChromeType.sans(15, .medium))
              .foregroundStyle(ChromePalette.ink)
              .lineLimit(1)
            Spacer(minLength: 0)
            AgentMark(agent: session.agent)
          }
          Text(session.meta)
            .font(ChromeType.sans(12.5))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkFaint)
            .opacity(awake ? 1 : 0.55)
          HStack(spacing: 10) {
            // PJ-7 — where it ran: the desktop's mark and name, then the folder
            if let id = session.device {
              HStack(spacing: 6) {
                DeviceName(device: corpus.desktop(id), fallback: session.deviceName, size: 11)
                if let folder = session.folder {
                  Text(folder)
                    .font(ChromeType.mono(11.5))
                    .lineLimit(1)
                }
              }
              .font(ChromeType.sans(11.5))
              .foregroundStyle(ChromePalette.inkTertiary)
            }
            if !session.branch.isEmpty {
              HStack(spacing: 4) {
                Image(systemName: "arrow.triangle.branch")
                  .font(.system(size: 10, weight: .medium))
                Text(session.branch)
                  .font(ChromeType.mono(11.5))
              }
              .foregroundStyle(ChromePalette.inkTertiary)
              .lineLimit(1)
            }
            Spacer(minLength: 0)
            switch acts.act(for: session) {
            case .why(let reason):
              Text(reason)
                .font(ChromeType.sans(12))
                .foregroundStyle(ChromePalette.inkFaint)
            case nil:
              LastWord(word: session.last, isLive: session.isLive, awake: awake)
            default:
              // the act stands over the row (below), so its tap is its own
              Color.clear.frame(width: 90, height: 28)
            }
          }
          .padding(.top, 2)
        }
      }
      .padding(.horizontal, 12)
      .padding(.top, 11)
      .padding(.bottom, 12)
      .background {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(ChromePalette.fill)
          .opacity(rung == session.id ? 1 : 0)
      }
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(HistoryRowStyle())
    .overlay(alignment: .bottomTrailing) {
      sessionAct(session)
        .padding(.trailing, 12)
        .padding(.bottom, 8)
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 2)
    .id(session.id)
    .accessibilityLabel("\(session.title), \(session.agent), \(session.meta), \(session.branch), last \(session.last)")
  }

  // MARK: - The session's act (PJ-7: Resume or Jump to, or why not)

  /// The last-word slot's act, over the row: Resume or Jump to as a 28 pt
  /// pill (the reason and the last word stand in the row itself).
  @ViewBuilder
  private func sessionAct(_ session: HistorySession) -> some View {
    switch acts.act(for: session) {
    case .jump:
      ActPill(glyph: .jump, title: "Jump to") {
        if let native = session.nativeSessionId { acts.jump(native) }
      }
    case .resume:
      ActPill(glyph: .resume, title: resuming == session.id ? "Resuming…" : "Resume") {
        guard resuming == nil else { return }
        resuming = session.id
        Task {
          let words = await acts.resume(session)
          resuming = nil
          note(words)
        }
      }
    case .why, nil:
      EmptyView()
    }
  }

  // MARK: - The receipt (a row that does not open, said once)

  private func note(_ text: String) {
    withAnimation(FieldMotion.ease(0.25)) { receipt = text }
    Task {
      try? await Task.sleep(for: .seconds(1.9))
      withAnimation(FieldMotion.ease(0.25)) { receipt = nil }
    }
  }

  @ViewBuilder
  private var receiptView: some View {
    if let receipt {
      Text(receipt)
        .font(ChromeType.sans(13, .medium))
        .foregroundStyle(ChromePalette.ink)
        .padding(.horizontal, 16)
        .frame(height: 40)
        .liquidGlassCapsule()
        .padding(.bottom, 12)
        .transition(.opacity.combined(with: .offset(y: 6)))
        .accessibilityAddTraits(.updatesFrequently)
    }
  }
}
