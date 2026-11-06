import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12c (PC-D2, PC-L1, PC-L4; DESIGN.md §8 "The phone's Chat" → the thread, ruled 2026-11-06 09:35:20Z; §9 "Chat on
// the phone") — THE THREAD'S PAGE: the head on the bar's glass (back, the face at 30, the thread's ONE live face on a
// stage of its own; the name over its status word; Wake while it sleeps; ⋯), the flow the Mac's fold draws, and the
// composer in the bar's place. Every row of the flow is the Mac's at touch pitch; every face in it is a still.
// IOS-12d (PC-D4 A; §8 the thread's card): what waits on you stands at the foot, between the flow and the composer, one
// card at a time in the Mac's order (its own run's ask first, then the oldest), answered in place.

struct ChatThreadView: View {
  let entry: SparkEntry
  let feed: ChatFeed
  /// The spark's desktop, when it is away: its line stands at the top, and the draft waits under its own (Q7).
  let away: ChatAway?
  let onOpenPane: (AgentRemoteRow) -> Void

  @State private var model: ChatThread
  @State private var arrival = ChatArrival()
  @State private var atFoot = true
  /// The flow keeps its foot in view until you read up the page.
  @State private var following = true
  /// The tools lines opened, by their rows' identities on the page (`ChatThreads.drawn`).
  @State private var opened: Set<String> = []
  @State private var scroll = ScrollPosition(edge: .bottom)
  @State private var column: CGFloat = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// Nonisolated: the column's width is reckoned from it in `onGeometryChange`'s Sendable transform (the 11-06 rule).
  nonisolated static let side: CGFloat = 16
  static let lead: CGFloat = 28
  static let leadGap: CGFloat = 12
  static let rowGap: CGFloat = 14
  static let headFace: CGFloat = 30
  /// Your words at most this share of the column (§8).
  static let bubbleShare: CGFloat = 0.82

  init(entry: SparkEntry, feed: ChatFeed, away: ChatAway?, onOpenPane: @escaping (AgentRemoteRow) -> Void) {
    self.entry = entry
    self.feed = feed
    self.away = away
    self.onOpenPane = onOpenPane
    _model = State(initialValue: ChatThread(spark: entry.spark.id, feed: feed))
    _scroll = State(initialValue: ScrollPosition(edge: Self.opensAt == .top ? .top : .bottom))
  }

  /// Where the flow opens and stays as it grows: at its foot (DEBUG: the stills' `-vf-chat-at-top`, at its head).
  static var opensAt: UnitPoint {
    #if DEBUG
      if ChatFixtureDoor.atTop { return .top }
    #endif
    return .bottom
  }

  private var name: String { entry.spark.name }

  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let now = Int64((context.date.timeIntervalSince1970 * 1000).rounded())
      page(model.flow(entry, now: now))
    }
    .background(ChromePalette.paper.ignoresSafeArea())
    .safeAreaInset(edge: .bottom, spacing: 0) {
      let card = ChatNeeds.thread(entry, answering: feed.answering, reduced: reduceMotion)
      VStack(spacing: 12) {
        if let card {
          ChatNeedsCardView(
            card: card, place: .thread,
            away: away.map { ChatNeedsWords.away($0.name, $0.standing, device: DeviceWord.current) },
            labels: feed.labels,
            onAct: { choice in
              feed.press(card.item, choice: choice, spark: entry.spark.id, names: card.names)
            },
            onPane: { openPane(of: card.item) },
            onOpen: nil
          )
          .padding(.horizontal, Self.side)
          .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 8)))
        }
        ChatComposer(
          draft: $model.draft, name: name, away: away, busy: model.busy, note: model.sendNote,
          onSend: { Task { await model.send(entry, away: away) } })
      }
      .animation(reduceMotion ? .easeInOut(duration: 0.12) : .easeOut(duration: 0.24), value: card?.id)
    }
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { head }
    .onAppear {
      model.open(device: entry.spark.device)
      #if DEBUG
        // the stills under `-vf-mock`: a held draft stands as typed
        if let words = ChatFixtureDoor.draft, model.draft.isEmpty { model.draft = words }
      #endif
    }
    .onDisappear { model.close() }
    .onChange(of: feed.doorTurn) { model.redial(device: entry.spark.device) }
    .onChange(of: model.reading) { model.settleRecord() }
  }

  // MARK: - The head

  @ToolbarContentBuilder
  private var head: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      HStack(spacing: 10) {
        // the thread's one live face, on a stage of its own (one stage per screen: every face in the flow is a still)
        SparkStageHost {
          SparkFaceView(
            seed: entry.spark.seed, status: entry.status.rawValue, size: Self.headFace,
            live: ChatRow.atWork.contains(entry.status))
        }
        .frame(width: Self.headFace, height: Self.headFace)
        VStack(alignment: .leading, spacing: 1) {
          Text(name)
            .font(ChromeType.sans(17, .semibold))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          Text(headWord)
            .font(ChromeType.sans(13))
            .foregroundStyle(headAttention ? ChromePalette.attention : ChromePalette.inkTertiary)
            .lineLimit(1)
        }
      }
      .accessibilityElement(children: .combine)
    }
    ToolbarItemGroup(placement: .topBarTrailing) {
      if ChatThreadActs.head(entry) == .wake {
        Button {
          Task { await model.wake(entry.spark) }
        } label: {
          HStack(spacing: 6) {
            FieldGlyph(.resume, size: 14)
            Text(ChatWords.wake).font(ChromeType.sans(15, .medium))
          }
        }
        .disabled(model.busy)
      }
      let acts = ChatThreadActs.menu(entry)
      if !acts.isEmpty {
        Menu {
          ForEach(acts, id: \.self) { act in
            switch act {
            case .openPane:
              Button(ChatThreadWords.openPane) {
                if let run = entry.run { onOpenPane(run) }
              }
            case .wake:
              Button(ChatWords.wake) { Task { await model.wake(entry.spark) } }
                .disabled(model.busy)
            }
          }
        } label: {
          FieldGlyph(.ellipsis, size: 22)
            .accessibilityLabel("More")
        }
      }
    }
  }

  /// Answer in its pane (Q5): the asking run's session card on Field, found on the board at the press.
  private func openPane(of item: NeedsItem) -> Bool {
    guard let session = item.from.session, let run = feed.run(session) else { return false }
    onOpenPane(run)
    return true
  }

  /// The status's word, or "Waking…" while Wake runs, or the last act's refusal (§8: until the next act).
  private var headWord: String {
    if let note = model.headNote { return note }
    return model.waking ? ChatThreadWords.waking : entry.status.word
  }

  private var headAttention: Bool { model.headNote != nil || entry.needsYou }

  // MARK: - The page

  @ViewBuilder
  private func page(_ flow: ChatFlow) -> some View {
    VStack(spacing: 0) {
      if let away {
        // PC-L4: the desktop's line, as the list says it
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Image(systemName: "moon").font(.system(size: 12, weight: .medium))
          Text(ChatWords.away(away.name, away.standing, carried: true, device: DeviceWord.current))
            .font(ChromeType.sans(13))
            .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
      }
      switch flow {
      case .reading:
        // with no door and nothing held, nothing is being read: the away line above says why
        if model.reader != nil || away == nil { said(ChatFlowWords.reading(name)) } else { Spacer() }
      case .unreadable(let reason, _):
        said(ChatFlowWords.unreadable(name, reason))
      case .ready(let items):
        rows(items)
      }
    }
  }

  /// A reading said in the flow: 15 secondary, centred (§8).
  private func said(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.sans(15))
      .foregroundStyle(ChromePalette.inkSecondary)
      .multilineTextAlignment(.center)
      .padding(.horizontal, 24)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func rows(_ items: [ChatFlowItem]) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: Self.rowGap) {
        ForEach(ChatThreads.drawn(items)) { drawn in row(drawn) }
      }
      .padding(.horizontal, Self.side)
      .padding(.top, 6)
      .padding(.bottom, 26)
      .onGeometryChange(for: CGFloat.self) { $0.size.width - 2 * Self.side } action: { column = $0 }
    }
    .scrollPosition($scroll)
    .defaultScrollAnchor(Self.opensAt, for: .sizeChanges)
    .defaultScrollAnchor(Self.opensAt, for: .initialOffset)
    .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { _, _ in
      // the first offset is reckoned on the lazy stack's estimate, so rows laid out after it, and rows that land,
      // would leave the foot below the composer: while it follows, the flow keeps its foot in view
      if following, Self.opensAt == .bottom { scroll.scrollTo(edge: .bottom) }
    }
    .onScrollPhaseChange { _, phase in
      // a scroll of yours that comes to rest off the foot stops the following; one at the foot resumes it
      if phase == .idle { following = atFoot }
    }
    .onScrollGeometryChange(for: Bool.self) { geometry in
      geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 24
    } action: { _, foot in
      atFoot = foot
      if foot { arrival.read(items, atFoot: true) }
    }
    .onChange(of: items, initial: true) { _, now in
      arrival.read(now, atFoot: atFoot)
      #if DEBUG
        // the stills under `-vf-mock`: every turn's tools open, as a press would open them
        if ChatFixtureDoor.openTools {
          opened.formUnion(ChatThreads.drawn(now).filter { $0.item.toolsKey != nil }.map(\.id))
        }
      #endif
    }
    .overlay(alignment: .bottom) {
      if arrival.count > 0 {
        Button {
          withAnimation(.easeOut(duration: 0.3)) { scroll.scrollTo(edge: .bottom) }
        } label: {
          Text(ChatThreadWords.arrival(arrival.count))
            .font(ChromeType.sans(15, .semibold))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.keyOnInk)
            .padding(.horizontal, 16)
            .frame(height: 36)
            .background(Capsule().fill(ChromePalette.keyOnFill))
        }
        .padding(.bottom, 12)
        .transition(.opacity)
      }
    }
  }

  // MARK: - One row

  @ViewBuilder
  private func row(_ drawn: ChatDrawnRow) -> some View {
    switch drawn.item {
    case .earlier(_, let count):
      Button {
        model.showEarlier()
      } label: {
        quiet(FieldGlyph(.chevron, size: 13, turn: 270), ChatFlowWords.earlier(count))
      }
      .buttonStyle(.plain)
    case .day(_, let words):
      Text(words)
        .font(ChromeType.sans(12, .medium))
        .foregroundStyle(ChromePalette.inkTertiary)
        .frame(maxWidth: .infinity)
        .padding(.top, 14)
    case .honest(_, _, let words):
      // the quiet lines' look with no glyph, at the column's start
      Text(words)
        .font(ChromeType.sans(13))
        .foregroundStyle(ChromePalette.inkTertiary)
        .frame(minHeight: 22, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    case .hello(_, let seed, let status, let words, let starters):
      HStack(alignment: .top, spacing: Self.leadGap) {
        SparkFaceView(seed: seed, status: status.rawValue, size: Self.lead)
        VStack(alignment: .leading, spacing: 8) {
          Text(words)
            .font(ChromeType.sans(17))
            .foregroundStyle(ChromePalette.ink)
            .fixedSize(horizontal: false, vertical: true)
          ForEach(starters, id: \.words) { starter in
            Button {
              Task { await model.send(entry, away: away, words: starter.words) }
            } label: {
              HStack(spacing: 8) {
                FieldGlyph(Self.glyph(starter.glyph), size: 16)
                  .foregroundStyle(ChromePalette.inkSecondary)
                Text(starter.words)
                  .font(ChromeType.sans(15, .medium))
                  .foregroundStyle(ChromePalette.ink)
                  .multilineTextAlignment(.leading)
              }
              .padding(.horizontal, 16)
              .frame(minHeight: 48)
              .background(Capsule().fill(ChromePalette.menuSurface))
              .overlay(Capsule().strokeBorder(ChromePalette.cardHairline, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(model.busy || away != nil)
          }
        }
      }
    case .you(_, let text, let chips, let receipt):
      VStack(alignment: .trailing, spacing: 6) {
        ChatInk.text(text, chips: chips)
          .font(ChromeType.sans(15))
          .lineSpacing(3)
          .textRenderer(ChatInkRenderer())
          .foregroundStyle(ChromePalette.ink)
          .padding(.vertical, 10)
          .padding(.horizontal, 14)
          .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(ChromePalette.fill))
          .frame(maxWidth: column > 0 ? column * Self.bubbleShare : nil, alignment: .trailing)
        if let receipt {
          Text(receipt.words)
            .font(ChromeType.sans(11.5))
            .foregroundStyle(receipt.attention ? ChromePalette.attention : ChromePalette.inkTertiary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(ChatThreadWords.bubble(text, receipt: receipt))
    case .reply(_, let text, let lead):
      HStack(alignment: .top, spacing: Self.leadGap) {
        face(lead)
        ChatMarkdownView(blocks: ChatMarkdown.blocks(text))
      }
    case .tools(_, let words, let rows, let lead):
      HStack(alignment: .top, spacing: Self.leadGap) {
        face(lead)
        VStack(alignment: .leading, spacing: 6) {
          Button {
            if opened.contains(drawn.id) { opened.remove(drawn.id) } else { opened.insert(drawn.id) }
          } label: {
            quiet(FieldGlyph(.code, size: 14), words)
          }
          .buttonStyle(.plain)
          .accessibilityValue(opened.contains(drawn.id) ? "open" : "")
          if opened.contains(drawn.id) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, tool in
              VStack(alignment: .leading, spacing: 2) {
                Text(tool.words)
                  .font(ChromeType.sans(13))
                  .foregroundStyle(ChromePalette.inkSecondary)
                if let detail = tool.detail {
                  Text(detail)
                    .font(ChromeType.mono(12.5))
                    .foregroundStyle(ChromePalette.inkTertiary)
                    .lineLimit(3)
                }
              }
            }
          }
        }
      }
    case .act(_, let what, let words, let lead, _):
      HStack(alignment: .top, spacing: Self.leadGap) {
        face(lead)
        if let glyph = Self.actGlyphs[what] {
          quiet(FieldGlyph(glyph, size: 14), words)
        } else {
          quiet(EmptyView(), words)
        }
      }
    case .thinking(_, let lead):
      HStack(alignment: .top, spacing: Self.leadGap) {
        face(lead)
        HStack(spacing: 7) {
          ChatDots()
          Text(ChatFlowWords.thinking)
            .font(ChromeType.sans(13))
            .foregroundStyle(ChromePalette.inkTertiary)
        }
        .frame(minHeight: 22)
        .accessibilityElement(children: .combine)
      }
    }
  }

  /// The lead's place: its face at 28, a still, or the gap it leaves.
  @ViewBuilder
  private func face(_ lead: Bool) -> some View {
    if lead {
      SparkFaceView(seed: entry.spark.seed, status: entry.status.rawValue, size: Self.lead)
    } else {
      Color.clear.frame(width: Self.lead, height: 1)
    }
  }

  /// A quiet line: its glyph at 14, then 7, then its words, 13 tertiary, 22 tall at least.
  private func quiet(_ glyph: some View, _ words: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 7) {
      glyph.alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
      Text(words)
        .font(ChromeType.sans(13))
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .foregroundStyle(ChromePalette.inkTertiary)
    .frame(minHeight: 22, alignment: .leading)
  }

  /// VibeField's own acts' glyphs (the Mac's `ACT_GLYPHS`): an act this build does not know has none.
  static let actGlyphs: [String: FieldGlyphName] = [
    "wake": .resume, "answer": .check, "notify": .message, "crew": .agents,
  ]

  static func glyph(_ starter: ChatStarter.Glyph) -> FieldGlyphName {
    switch starter {
    case .agents: .agents
    case .panes: .panes
    case .duplicate: .duplicate
    }
  }
}

// MARK: - Thinking…'s dots

/// Three dots, 6 round and 5 apart, in tertiary ink: a breath (§6), still under reduced motion.
struct ChatDots: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 5) {
      ForEach(0..<3, id: \.self) { index in
        Circle()
          .fill(ChromePalette.inkTertiary)
          .frame(width: 6, height: 6)
          .phaseAnimator(reduceMotion ? [1.0] : [0.35, 1.0]) { dot, phase in
            dot.opacity(phase)
          } animation: { _ in
            .easeInOut(duration: 0.7).delay(Double(index) * 0.18)
          }
      }
    }
    .accessibilityHidden(true)
  }
}

#if DEBUG
  extension ChatFlowItem {
    /// A turn's tools line's key, or none for every other row (the stills' `-vf-chat-open-tools`).
    fileprivate var toolsKey: String? {
      if case .tools(let key, _, _, _) = self { key } else { nil }
    }
  }
#endif
