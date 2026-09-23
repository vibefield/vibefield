import FieldDesign
import SwiftUI

/// The document (H-4): the prompt as the one filled panel, one head per
/// response, runs folded to a sentence of nouns with the failed count red at
/// the right, the day pill, and the live line under which the tail arrives.
/// A landed search rings its anchor and scrolls to it; the stepper (the
/// tab bar's accessory) walks the ring.
struct HistorySessionView: View {
  let document: HistoryDocument
  let corpus: HistoryCorpus
  let standing: FieldHistoryModel.DesktopStanding
  @Bindable var router: HistoryRouter

  @Environment(\.colorScheme) private var scheme
  @State private var expanded: Set<String> = []

  private var awake: Bool { standing != .asleep }
  private var color: Color {
    HistoryParts.projectColor(seq: corpus.project(document.projectId)?.seq ?? 0, scheme: scheme)
  }
  private var litAnchor: String? {
    guard let landed = router.landed, landed.sessionId == document.id else { return nil }
    return landed.anchor
  }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          head
          RuleLine(text: "Session start · \(document.startDay)")
          ForEach(document.turns) { turn in
            turnView(turn)
          }
          if let since = document.liveSince, awake {
            RuleLine(text: "Live · new since \(since)", tone: ChromePalette.green, rule: ChromePalette.green.opacity(0.38))
          }
        }
        .padding(.horizontal, HistoryParts.sidePadding)
        .padding(.bottom, 80)
      }
      .background(ChromePalette.paper.ignoresSafeArea())
      .navigationTitle(document.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("Open every run") { expanded = Set(document.turns.flatMap { $0.segments.map(\.id) }) }
            Button("Copy session id") { UIPasteboard.general.string = document.id }
            Button("Open in the field") {}
              .disabled(true)
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel("More")
        }
      }
      .onChange(of: litAnchor, initial: true) { _, anchor in
        guard let anchor else { return }
        withAnimation(FieldMotion.ease(0.45)) { proxy.scrollTo(anchor, anchor: .center) }
      }
      .onDisappear {
        // Leaving the document ends the landing: the stepper has nothing to walk.
        if router.landed?.sessionId == document.id, !router.path.contains(.session(document.id)) {
          router.clearLanding()
        }
      }
    }
  }

  private var head: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Capsule().fill(color).frame(width: 3, height: 13)
        Text(corpus.project(document.projectId)?.name ?? document.projectId)
          .font(ChromeType.sans(13, .medium))
          .foregroundStyle(ChromePalette.inkTertiary)
      }
      Text(document.title)
        .font(ChromeType.sans(22, .semibold))
        .tracking(ChromeType.tracking(-0.016, of: 22))
        .foregroundStyle(ChromePalette.ink)
        .lineSpacing(3)
        .padding(.top, 8)
      HStack(spacing: 8) {
        AgentMark(agent: document.agent, opacity: 0.8)
        Text(document.agentName)
        Text("·")
        HStack(spacing: 4) {
          Image(systemName: "arrow.triangle.branch").font(.system(size: 10, weight: .medium))
          Text(document.branch).font(ChromeType.mono(11.5))
        }
        Text("·")
        HStack(spacing: 4) {
          Text("\(document.startedAt) →")
          Text(awake ? "now" : corpus.readAt)
            .fontWeight(awake ? .medium : .regular)
            .foregroundStyle(awake ? ChromePalette.green : ChromePalette.inkTertiary)
        }
      }
      .font(ChromeType.sans(12.5))
      .monospacedDigit()
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.top, 6)
    }
  }

  // MARK: - A turn

  @ViewBuilder
  private func turnView(_ turn: HistoryTurn) -> some View {
    if let pill = turn.dayPill {
      HStack {
        Spacer()
        HStack(spacing: 6) {
          Text(pill.time)
          Text(pill.after).foregroundStyle(ChromePalette.inkFaint)
        }
        .font(ChromeType.sans(11.5, .medium))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkTertiary)
        .padding(.horizontal, 12)
        .frame(height: 26)
        .background(Capsule().fill(ChromePalette.fill))
        Spacer()
      }
      .padding(.vertical, 18)
    }
    VStack(alignment: .leading, spacing: 0) {
      prompt(turn)
      responseHead(turn)
      ForEach(turn.segments) { segment in
        segmentView(segment)
      }
    }
    .padding(.top, turn.dayPill == nil ? 30 : 0)
  }

  private func prompt(_ turn: HistoryTurn) -> some View {
    Text(turn.prompt)
      .font(ChromeType.sans(15))
      .lineSpacing(4)
      .foregroundStyle(ChromePalette.ink)
      .padding(.horizontal, 15)
      .padding(.top, 11)
      .padding(.bottom, 12)
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(ChromePalette.fill))
      .overlay {
        if let anchor = turn.promptAnchor, litAnchor == anchor {
          RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(ChromePalette.attention, lineWidth: 1.5)
        }
      }
      .id(turn.promptAnchor ?? "prompt-\(turn.id)")
      .accessibilityLabel("You, at \(turn.at): \(turn.prompt)")
  }

  private func responseHead(_ turn: HistoryTurn) -> some View {
    HStack(spacing: 7) {
      AgentMark(agent: document.agent, opacity: 0.8, size: 14)
      Text(document.agentName)
        .font(ChromeType.sans(10.5, .medium))
        .textCase(.uppercase)
        .tracking(ChromeType.tracking(0.07, of: 10.5))
        .foregroundStyle(ChromePalette.inkTertiary)
      Text(turn.model)
        .font(ChromeType.sans(10.5))
        .foregroundStyle(ChromePalette.inkFaint)
        .lineLimit(1)
      Spacer(minLength: 4)
      Text(turn.facts)
        .font(ChromeType.sans(10.5))
        .monospacedDigit()
        .foregroundStyle(turn.isLive && awake ? ChromePalette.green : ChromePalette.inkFaint)
    }
    .frame(height: 22)
    .padding(.top, 16)
    .padding(.bottom, 6)
  }

  @ViewBuilder
  private func segmentView(_ segment: HistorySegment) -> some View {
    switch segment {
    case .prose(let id, let at, let text, let anchor):
      Text(text)
        .font(ChromeType.sans(15))
        .lineSpacing(4)
        .foregroundStyle(ChromePalette.ink)
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .background {
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(ChromePalette.attention.opacity(0.14))
            .opacity(anchor != nil && litAnchor == anchor ? 1 : 0)
        }
        .id(anchor ?? id)
        .accessibilityLabel("\(document.agentName), at \(at): \(text)")
    case .ledger(let id, let summary, let duration, let failed, let isLive, let lines):
      ledger(id: id, summary: summary, duration: duration, failed: failed, isLive: isLive, lines: lines)
    }
  }

  private func ledger(id: String, summary: String, duration: String, failed: Int, isLive: Bool, lines: [HistoryLedgerLine]) -> some View {
    let open = expanded.contains(id)
    return VStack(alignment: .leading, spacing: 0) {
      Button {
        withAnimation(FieldMotion.ease(0.3)) {
          if open { expanded.remove(id) } else { expanded.insert(id) }
        }
      } label: {
        HStack(spacing: 8) {
          if isLive && awake {
            LivePulse(awake: true).frame(width: 14)
          } else {
            Image(systemName: failed > 0 ? "xmark.circle" : "terminal")
              .font(.system(size: 12, weight: .medium))
              .foregroundStyle(failed > 0 ? ChromePalette.red : ChromePalette.inkTertiary)
              .frame(width: 14)
          }
          Text(summary)
            .font(ChromeType.sans(13))
            .foregroundStyle(open ? ChromePalette.inkSecondary : ChromePalette.inkTertiary)
            .lineLimit(1)
          Spacer(minLength: 8)
          HStack(spacing: 8) {
            if failed > 0 {
              Text("\(failed) failed")
                .foregroundStyle(ChromePalette.red)
                .fontWeight(.medium)
            }
            Text(duration)
              .foregroundStyle(isLive && awake ? ChromePalette.green : ChromePalette.inkFaint)
            Image(systemName: "chevron.right")
              .font(.system(size: 10, weight: .semibold))
              .rotationEffect(.degrees(open ? 90 : 0))
              .foregroundStyle(ChromePalette.inkFaint)
          }
          .font(ChromeType.sans(12))
          .monospacedDigit()
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 36)
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      }
      .buttonStyle(HistoryRowStyle(radius: 10))
      .accessibilityLabel("\(summary), \(duration)\(failed > 0 ? ", \(failed) failed" : "")")
      .accessibilityValue(open ? "expanded" : "collapsed")
      if open {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(lines) { line in
            ledgerLine(line)
          }
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) { Rectangle().fill(ChromePalette.cardHairline).frame(width: 1) }
        .padding(.leading, 11)
        .padding(.bottom, 6)
        .transition(.opacity)
      }
    }
    .padding(.vertical, 4)
  }

  private func ledgerLine(_ line: HistoryLedgerLine) -> some View {
    HStack(spacing: 8) {
      Group {
        switch line.state {
        case .ok: Image(systemName: line.verb == "Read" ? "doc.text" : line.verb == "Searched" ? "magnifyingglass" : line.verb == "Ran" ? "terminal" : "pencil.line")
        case .failed: Image(systemName: "xmark.circle").foregroundStyle(ChromePalette.red)
        case .running: LivePulse(awake: awake)
        }
      }
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(ChromePalette.inkFaint)
      .frame(width: 14)
      Text(line.verb)
        .font(ChromeType.sans(12.5, .medium))
        .foregroundStyle(line.state == .failed ? ChromePalette.red : ChromePalette.inkTertiary)
        .frame(width: 58, alignment: .leading)
      HStack(spacing: 0) {
        if let dir = line.dir {
          Text(dir).foregroundStyle(ChromePalette.inkFaint)
        }
        Text(line.object).foregroundStyle(ChromePalette.inkSecondary)
      }
      .font(ChromeType.mono(12))
      .lineLimit(1)
      .truncationMode(.head)
      Spacer(minLength: 6)
      Text(line.result)
        .font(ChromeType.sans(11.5))
        .monospacedDigit()
        .foregroundStyle(line.state == .running && awake ? ChromePalette.green : line.state == .failed ? ChromePalette.red : ChromePalette.inkFaint)
        .lineLimit(1)
    }
    .frame(minHeight: 26)
    .accessibilityElement(children: .combine)
  }
}
