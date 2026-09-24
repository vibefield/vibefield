import FieldDesign
import SwiftUI

/// A project (H-3): the column head grown (marker · name · count), the four
/// figures, the 53-week ribbon, and the sessions under their days.
struct HistoryProjectView: View {
  let project: HistoryProject
  let sessions: [HistorySession]
  let corpus: HistoryCorpus
  let standing: FieldHistoryModel.DesktopStanding
  @Bindable var router: HistoryRouter

  @Environment(\.colorScheme) private var scheme
  @State private var receipt: String?
  @State private var rung: String?

  private var color: Color { HistoryParts.projectColor(seq: project.seq, scheme: scheme) }
  private var awake: Bool { standing != .asleep }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          head
          stats
          card
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
      Text(project.path)
        .font(ChromeType.mono(11.5))
        .italic(project.missing)
        .foregroundStyle(ChromePalette.inkFaint)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.top, 4)
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
        if let unit {
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
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ChromePalette.fill.opacity(0.6)))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5))
    .padding(.horizontal, 16)
    .padding(.top, 12)
  }

  private var ribbon: some View {
    let weeks = FieldHistoryModel.ribbon(seq: project.seq, start: project.id == "mille" ? 22 : 3)
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

  private var sessionList: some View {
    LazyVStack(alignment: .leading, spacing: 0) {
      ForEach(sessions) { session in
        if let day = session.day { DayHeader(text: day) }
        sessionRow(session)
      }
    }
    .padding(.top, 6)
  }

  private func sessionRow(_ session: HistorySession) -> some View {
    Button {
      if corpus.document(session.id) != nil {
        router.path.append(.session(session.id))
      } else {
        note("Only \(corpus.documents.values.first?.title.prefix(4) ?? "one") opens in the mock")
      }
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
            HStack(spacing: 4) {
              Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 10, weight: .medium))
              Text(session.branch)
                .font(ChromeType.mono(11.5))
            }
            .foregroundStyle(ChromePalette.inkTertiary)
            .lineLimit(1)
            Spacer(minLength: 0)
            LastWord(word: session.last, isLive: session.isLive, awake: awake)
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
    .padding(.horizontal, 8)
    .padding(.bottom, 2)
    .id(session.id)
    .accessibilityLabel("\(session.title), \(session.agent), \(session.meta), \(session.branch), last \(session.last)")
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
