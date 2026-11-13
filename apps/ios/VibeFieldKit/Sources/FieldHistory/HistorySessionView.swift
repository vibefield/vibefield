import FieldDesign
import FieldMarkdown
import SwiftUI

/// The document (H-4): the prompt as the one filled panel, one head per
/// response, runs folded to a sentence of nouns with the failed count red at
/// the right, the day pill, and the live line under which the tail arrives.
/// A landed search rings its anchor and scrolls to it; the stepper (the
/// tab bar's accessory) walks the ring.
///
/// Item 362a — it opens at its END and keeps its end in view (`HistoryFollow`,
/// DESIGN.md §8 "The phone's session document"), as the desktop's transcript
/// does; a document a search landed in opens on the landed row instead.
///
/// SP-6 — over a door: "Earlier" at the top asks the page door for the older
/// page while the session has one (`document.nextCursor`); rows the tail
/// appends while the reader is up the page count in the ARRIVAL PILL at the
/// foot (`N new`), a tap scrolls to them; an attachment the index recorded is
/// a placeholder row (`image on studio`), never a broken image (H-D9).
///
/// *Corrected 2026-11-13 (item 362g):* "a placeholder row … never a broken image (H-D9)" is the door's road, as
/// that paragraph says, and it stands there: the door's row names an attachment with no digest and no address. Read
/// straight from the desktop's index the projection now keeps which recorded image an attachment is, beside the
/// row (`HistoryPicture`). As of this correction the view is not handed it, and draws the placeholder on both roads.
struct HistorySessionView: View {
  let document: HistoryDocument
  /// the document's own desktop's corpus (its reader's)
  let corpus: HistoryCorpus
  /// PJ-7 — the ledger the session's project is named and coloured from
  var ledger: HistoryCorpus? = nil
  let standing: FieldHistoryModel.DesktopStanding
  @Bindable var router: HistoryRouter
  var arrivals: Int = 0
  /// Item 362b — the reader is reading this session's earlier rows right now.
  var readingEarlier = false
  /// Item 362f — what this session's tool lines open to, by the line's id; empty through the home desktop.
  var opens: [String: HistoryToolDetail] = [:]
  var onNeed: (HistoryNeed) -> Void = { _ in }

  @Environment(\.colorScheme) private var scheme
  @State private var expanded: Set<String> = []
  /// Item 362f — the message whose whole text is open on its own sheet.
  @State private var whole: HistoryWholeMessage?
  @State private var atEnd = false
  /// Item 362a — whether the document keeps its foot in view, and where it opened.
  @State private var follow: HistoryFollow
  @State private var scroll: ScrollPosition
  @State private var reach = HistoryFollow.Reach(atFoot: true, away: false)
  /// Item 362b — within a screen of the top; the cursor the last ask went out on, and one a read left unmoved.
  @State private var nearTop = false
  @State private var askedCursor: String?
  @State private var stalledCursor: String?
  @State private var settling: Task<Void, Never>?
  /// Item 381 — the scroll is at rest (no finger on it, no move carrying it), and the page stands past its end.
  @State private var resting = true
  @State private var past = false

  init(
    document: HistoryDocument, corpus: HistoryCorpus, ledger: HistoryCorpus? = nil,
    standing: FieldHistoryModel.DesktopStanding, router: HistoryRouter, arrivals: Int = 0,
    readingEarlier: Bool = false, opens: [String: HistoryToolDetail] = [:],
    onNeed: @escaping (HistoryNeed) -> Void = { _ in }
  ) {
    self.document = document
    self.corpus = corpus
    self.ledger = ledger
    self.standing = standing
    self.router = router
    self.arrivals = arrivals
    self.readingEarlier = readingEarlier
    self.opens = opens
    self.onNeed = onNeed
    let landed = router.landed.map { $0.sessionId == document.id && $0.device == corpus.deviceId } ?? false
    let follow = HistoryFollow(landed: landed)
    _follow = State(initialValue: follow)
    _scroll = State(initialValue: ScrollPosition(edge: follow.opening == .end ? .bottom : .top))
  }

  /// How close to the foot counts as "at the end": the bar's clearance plus a
  /// line, so the end is seen when the last row is readable above the glass.
  static let endSlack: CGFloat = 120
  /// The app bar's row and its margin stand over the scroll's foot: the
  /// content's last row and the arrival pill both clear it, or the pill
  /// hangs behind the glass where no one sees it.
  static let barClearance: CGFloat = 80
  /// Item 362a — how long after the rows above land the foot is still held: their layout, and a beat.
  static let earlierSettles = Duration.milliseconds(250)
  /// Item 381 — the id of the document's last row, the bar's clearance: at the screen's foot, the page is at its end.
  static let endRow = "end"

  private var awake: Bool { standing.isAwake }
  /// The project the document belongs to: the ledger's (by key, when the
  /// route came through a project), else the desktop's own corpus's.
  private var project: HistoryProject? {
    router.path.lazy.compactMap { route -> HistoryProject? in
      if case .project(let id) = route { return ledger?.project(id) }
      return nil
    }.first ?? ledger?.project(document.projectId) ?? corpus.project(document.projectId)
  }
  private var color: Color {
    HistoryParts.projectColor(project, scheme: scheme)
  }
  private var litAnchor: String? {
    guard let landed = router.landed, landed.sessionId == document.id, landed.device == corpus.deviceId else { return nil }
    return landed.anchor
  }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          head
          switch HistoryFollow.head(hasEarlier: document.nextCursor != nil, reading: readingEarlier, awake: awake) {
          case .start: RuleLine(text: "Session start · \(document.startDay)")
          case .reading: RuleLine(text: "Reading earlier…")
          case .earlier, .asleep: earlier
          }
          // Item 381 — a row is one part of a turn, never a whole turn (`HistoryRow.of`)
          ForEach(HistoryRow.of(document.turns)) { row in
            rowView(row)
          }
          if let since = document.liveSince, awake {
            RuleLine(text: "Live · new since \(since)", tone: ChromePalette.green, rule: ChromePalette.green.opacity(0.38))
          }
          // the end is the bar's clearance itself, so the end's own row at the screen's foot is the page at its
          // end (item 381: it is where a page found past its end is put back). It was a point over a padding.
          Color.clear.frame(height: Self.barClearance + 1).id(Self.endRow)
        }
        .padding(.horizontal, HistoryParts.sidePadding)
      }
      // Item 362a — it opens at its end; while it follows, a change in its height keeps the foot, and off the foot a
      // row arriving below or a run opened by hand leaves the reader's place alone (`HistoryFollow.growth`).
      .scrollPosition($scroll)
      .defaultScrollAnchor(follow.opening == .end ? .bottom : .top, for: .initialOffset)
      .defaultScrollAnchor(follow.growth == .foot ? .bottom : .top, for: .sizeChanges)
      .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { _, _ in
        // the first offset is reckoned on the lazy stack's estimate, and rows land: while it follows, the foot is
        // put back in view (Chat's own rule)
        if follow.following { scroll.scrollTo(edge: .bottom) }
      }
      .onScrollPhaseChange { _, phase in
        resting = phase == .idle
        switch phase {
        case .interacting: follow.dragged()
        case .idle: follow.rested(atFoot: reach.atFoot)
        default: break
        }
        putBack(proxy, past: past, resting: phase == .idle)
      }
      // Item 381 — a page found at rest past its end stands on nothing: it is put back on its end
      .onScrollGeometryChange(for: Bool.self) { geometry in
        HistoryFollow.pastEnd(
          offset: geometry.contentOffset.y, container: geometry.containerSize.height,
          content: geometry.contentSize.height, topInset: geometry.contentInsets.top,
          bottomInset: geometry.contentInsets.bottom)
      } action: { _, now in
        past = now
        putBack(proxy, past: now, resting: resting)
      }
      .onScrollGeometryChange(for: HistoryFollow.Reach.self) { geometry in
        HistoryFollow.reach(
          offset: geometry.contentOffset.y, container: geometry.containerSize.height,
          content: geometry.contentSize.height)
      } action: { _, now in
        reach = now
      }
      // Item 362b — within a screen of the top the rows above are read in by themselves. The document's height
      // rides in the value so the first layout is heard, whatever the offset was when it was first reckoned.
      .onScrollGeometryChange(for: TopReach.self) { geometry in
        TopReach(
          near: HistoryFollow.nearTop(
            offset: geometry.contentOffset.y + geometry.contentInsets.top, container: geometry.containerSize.height),
          height: geometry.contentSize.height.rounded())
      } action: { _, now in
        if nearTop != now.near { nearTop = now.near }
      }
      .onChange(of: wantsEarlier, initial: true) { _, wants in
        if wants { askEarlier() }
      }
      .onChange(of: readingEarlier, initial: true) { was, reading in
        if reading {
          // what the read adds lands above the reader's place
          settling?.cancel()
          follow.askedEarlier()
        } else if was {
          // a read that left the cursor where it was is not asked again by itself
          if document.nextCursor == askedCursor { stalledCursor = askedCursor }
          settling = Task { @MainActor in
            try? await Task.sleep(for: Self.earlierSettles)
            guard !Task.isCancelled else { return }
            follow.earlierSettled()
          }
        }
      }
      // The arrival pill's one fact: whether the document's END is on screen.
      // Read from the scroll's geometry, not an `onAppear` on the end marker —
      // a lazy stack lays its last rows out ahead of the viewport, which read
      // as "seen" and cleared the count before anyone saw a row.
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.containerSize.height
          >= geometry.contentSize.height - Self.endSlack
      } action: { _, endOnScreen in
        atEnd = endOnScreen
        if endOnScreen { onNeed(.seen(device: corpus.deviceId, session: document.id)) }
      }
      .foldsBar(router)
      .background(ChromePalette.paper.ignoresSafeArea())
      .navigationTitle(document.title)
      .navigationBarTitleDisplayMode(.inline)
      .overlay(alignment: .bottom) { footPill }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("Open every run") { expanded.formUnion(FieldHistoryModel.everyRun(document)) }
            Button("Copy session id") { UIPasteboard.general.string = document.id }
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel("More")
        }
      }
      .sheet(item: $whole) { message in
        HistoryMessageView(message: message)
          .presentationDetents([.large])
          .presentationDragIndicator(.visible)
          .presentationCornerRadius(40)
          .presentationBackground(ChromePalette.paper)
      }
      .onAppear { onNeed(.session(device: corpus.deviceId, id: document.id)) }
      .onChange(of: litAnchor, initial: true) { _, anchor in
        guard let anchor else { return }
        follow.landed()
        withAnimation(FieldMotion.ease(0.45)) { proxy.scrollTo(anchor, anchor: .center) }
      }
      .onDisappear {
        // Leaving the document ends the landing: the stepper has nothing to walk.
        if router.landed?.sessionId == document.id,
          !router.path.contains(.session(device: corpus.deviceId, id: document.id))
        {
          router.clearLanding()
        }
      }
    }
  }

  private var head: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Capsule().fill(color).frame(width: 3, height: 13)
        Text(project?.name ?? corpus.desktop)
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
        if !document.branch.isEmpty {
          Text("·")
          HStack(spacing: 4) {
            Image(systemName: "arrow.triangle.branch").font(.system(size: 10, weight: .medium))
            Text(document.branch).font(ChromeType.mono(11.5))
          }
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

  /// Item 381 — the end's row is put at the screen's foot when the page is found past its end at rest
  /// (`HistoryFollow.putsBack`), with no move to watch: there is nothing on screen to move from.
  private func putBack(_ proxy: ScrollViewProxy, past: Bool, resting: Bool) {
    guard HistoryFollow.putsBack(past: past, resting: resting) else { return }
    proxy.scrollTo(Self.endRow, anchor: .bottom)
  }

  /// Item 362b — the rows above are wanted now (`HistoryFollow.asksEarlier`).
  private var wantsEarlier: Bool {
    follow.asksEarlier(
      nearTop: nearTop, cursor: document.nextCursor, stalled: stalledCursor, awake: awake, reading: readingEarlier)
  }

  private func askEarlier() {
    guard document.nextCursor != nil, awake, !readingEarlier else { return }
    askedCursor = document.nextCursor
    onNeed(.older(device: corpus.deviceId, session: document.id))
  }

  /// What the top's geometry says: near it, and the document's height (so a first layout is a change).
  private struct TopReach: Equatable {
    var near: Bool
    var height: CGFloat
  }

  /// SP-6 — the older page's door: a rule with a button in it. Item 362b — the rows above arrive by themselves as
  /// the reader nears the top; the press stays, and asks again after a read that brought nothing.
  private var earlier: some View {
    HStack(spacing: 10) {
      Rectangle().fill(ChromePalette.ruleStrong).frame(height: 1)
      Button {
        // a press asks again where a read by itself would not
        stalledCursor = nil
        askEarlier()
      } label: {
        Text(awake ? "Earlier" : "Earlier · needs \(corpus.desktop)")
          .font(ChromeType.sans(10.5, .medium))
          .textCase(.uppercase)
          .tracking(ChromeType.tracking(0.07, of: 10.5))
          .foregroundStyle(awake ? ChromePalette.inkSecondary : ChromePalette.inkFaint)
          .fixedSize()
      }
      .buttonStyle(.plain)
      .disabled(!awake)
      .accessibilityLabel("Read the earlier rows")
      Rectangle().fill(ChromePalette.ruleStrong).frame(height: 1)
    }
    .padding(.vertical, 18)
  }

  /// SP-6 — the arrival pill: rows the tail appended while the reader was
  /// up the page; a tap scrolls to the end and the count clears. Item 362a —
  /// with nothing unread and the end more than a screen below it says
  /// `Latest`, and a press follows again.
  @ViewBuilder
  private var footPill: some View {
    if let pill = follow.pill(arrivals: arrivals, endOnScreen: atEnd, away: reach.away) {
      Button {
        follow.pressed()
        withAnimation(FieldMotion.ease(0.45)) { scroll.scrollTo(edge: .bottom) }
        if arrivals > 0 { onNeed(.seen(device: corpus.deviceId, session: document.id)) }
      } label: {
        HStack(spacing: 6) {
          if case .arrivals = pill { LivePulse(awake: awake) }
          Text(HistoryFollow.words(pill))
            .font(ChromeType.sans(13, .medium))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.ink)
          Image(systemName: "arrow.down")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(ChromePalette.inkTertiary)
        }
        .padding(.horizontal, 14)
        .frame(height: 36)
        .liquidGlassCapsule()
      }
      .buttonStyle(.plain)
      .padding(.bottom, Self.barClearance + 12)
      .transition(.opacity.combined(with: .offset(y: 6)))
      .accessibilityLabel(HistoryFollow.spoken(pill))
    }
  }

  // MARK: - A row

  /// Item 381 — one part of a turn, drawn: the lazy stack lays out a part at a time (`HistoryRow`).
  @ViewBuilder
  private func rowView(_ row: HistoryRow) -> some View {
    switch row {
    case .gap:
      Color.clear.frame(height: HistoryRow.turnGap)
    case .sitting(_, let pill):
      sitting(pill)
    case .prompt(let turn):
      prompt(turn)
    case .promptClipped(_, let words):
      clippedNote(words)
    case .promptAttachment(_, _, let words):
      placeholder(words)
    case .head(let turn):
      responseHead(turn)
    case .segment(let segment, let turn):
      segmentView(segment, in: turn)
    }
  }

  /// Item 362c — the pill a sitting opens with, centred.
  private func sitting(_ pill: HistoryDayPill) -> some View {
    HStack {
      Spacer()
      HStack(spacing: 6) {
        Text(pill.lead)
        if let after = pill.after {
          Text(after).foregroundStyle(ChromePalette.inkFaint)
        }
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

  private func prompt(_ turn: HistoryTurn) -> some View {
    HistoryExcerptView(
      text: turn.prompt, blank: "(an empty prompt)", measure: HistoryWords.prompt,
      lead: "You, at \(turn.at)",
      open: {
        whole = HistoryWholeMessage(
          id: "prompt-\(turn.id)", who: "You", at: turn.at, text: turn.prompt, cut: turn.promptClipped)
      }
    )
    .equatable()
    .padding(.horizontal, 15)
    .padding(.top, 11)
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(ChromePalette.fill))
    .overlay {
      if let anchor = turn.promptAnchor, litAnchor == anchor {
        RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(ChromePalette.attention, lineWidth: 1.5)
      }
    }
    .id(turn.promptAnchor ?? "prompt-\(turn.id)")
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
  private func segmentView(_ segment: HistorySegment, in turn: HistoryTurn) -> some View {
    switch segment {
    case .prose(let id, let at, let text, let anchor):
      HistoryExcerptView(
        text: text, blank: "(no words)", measure: HistoryWords.reply,
        lead: "\(document.agentName), at \(at)",
        open: {
          whole = HistoryWholeMessage(
            id: id, who: document.agentName, at: at, text: text, cut: cutNote(under: id, in: turn))
        }
      )
      .equatable()
      .padding(.vertical, 6)
      .padding(.horizontal, 4)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(ChromePalette.attention.opacity(0.14))
          .opacity(anchor != nil && litAnchor == anchor ? 1 : 0)
      }
      .id(anchor ?? id)
    case .ledger(let id, let summary, let duration, let failed, let isLive, let lines):
      ledger(id: id, summary: summary, duration: duration, failed: failed, isLive: isLive, lines: lines)
    case .attachment(_, _, let label):
      placeholder(label ?? "attachment on \(corpus.desktop)")
    case .clipped(_, let words):
      clippedNote(words)
    case .request(_, let question, let words, let result, let failed):
      request(question: question, words: words, result: result, failed: failed)
    }
  }

  /// Item 362e — a question to the reader, or a request for permission: alone between groups and open, on a
  /// hairline card, because the session stopped there for a person (the room's `request` block).
  private func request(question: Bool, words: String, result: String, failed: Bool) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: question ? "questionmark.circle" : "hand.raised")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(failed ? ChromePalette.red : ChromePalette.inkTertiary)
        .frame(width: 14)
        .padding(.top, 2)
      VStack(alignment: .leading, spacing: 3) {
        Text(question ? "Question" : "Permission requested")
          .font(ChromeType.sans(12.5, .medium))
          .foregroundStyle(ChromePalette.inkTertiary)
        if !words.isEmpty {
          Text(verbatim: words)
            .font(ChromeType.sans(13))
            .foregroundStyle(ChromePalette.inkSecondary)
            .multilineTextAlignment(.leading)
        }
        if !result.isEmpty {
          Text(verbatim: result)
            .font(ChromeType.sans(11.5))
            .foregroundStyle(failed ? ChromePalette.red : ChromePalette.inkFaint)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5))
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  /// SP-6 — the honest-state line under a text the door cut: `clipped · 14 KB
  /// on studio`, the record's voice, never a body that reads as whole.
  private func clippedNote(_ words: String) -> some View {
    HistoryCutNote(words: words)
      .padding(.horizontal, 4)
      .padding(.vertical, 2)
  }

  /// Item 362f — the note under a reply whose words the desktop cut, for the message's own sheet: the fold puts
  /// it right after the reply, under the reply's id (`HistoryFold.segments`). Read when the sheet is asked for.
  private func cutNote(under id: String, in turn: HistoryTurn) -> String? {
    for segment in turn.segments {
      if case .clipped(let cutId, let words) = segment, cutId == "\(id)/clipped" { return words }
    }
    return nil
  }

  /// SP-6 — what the phone does not carry, said: `image shot.png on studio`.
  private func placeholder(_ words: String) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "photo")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ChromePalette.inkFaint)
      Text(words)
        .font(ChromeType.sans(12.5))
        .foregroundStyle(ChromePalette.inkTertiary)
        // the reason an attachment has no bytes is the row's point: wrap, never cut the middle out
        .lineLimit(2)
        .truncationMode(.tail)
        .multilineTextAlignment(.leading)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(minHeight: 34)
    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5))
    .padding(.vertical, 4)
    .accessibilityLabel(words)
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
            if line.kind == nil {
              ledgerLine(line)
            } else {
              memberLine(line)
            }
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

  /// Item 362e — a member of a group that is not a tool line: a thought, a session notice, a summary, a
  /// compaction, a team message. One line: what it is and its first words. Where its words say more it is a button
  /// with a chevron and opens in place; the words are built only while it is open, and nothing opens members in
  /// bulk (`FieldHistoryModel.everyRun`).
  @ViewBuilder
  private func memberLine(_ line: HistoryLedgerLine) -> some View {
    let key = FieldHistoryModel.memberKey(line.id)
    let open = expanded.contains(key)
    VStack(alignment: .leading, spacing: 0) {
      if line.words == nil {
        memberHead(line, open: nil)
      } else {
        Button {
          withAnimation(FieldMotion.ease(0.3)) {
            if open { expanded.remove(key) } else { expanded.insert(key) }
          }
        } label: {
          memberHead(line, open: open)
        }
        .buttonStyle(HistoryRowStyle(radius: 6))
        .accessibilityValue(open ? "expanded" : "collapsed")
      }
      if open, let words = line.words {
        VStack(alignment: .leading, spacing: 4) {
          if line.kind == .compaction {
            Text("Agent-generated context for continuing this session.")
              .font(ChromeType.sans(11.5))
              .foregroundStyle(ChromePalette.inkFaint)
          }
          HistoryWordsView(text: words, blank: "", measure: HistoryWords.member)
            .equatable()
          if let clipped = line.clipped { clippedNote(clipped) }
        }
        .padding(.leading, 22)
        .padding(.trailing, 4)
        .padding(.bottom, 6)
        .transition(.opacity)
      }
    }
  }

  private func memberHead(_ line: HistoryLedgerLine, open: Bool?) -> some View {
    HStack(spacing: 8) {
      Image(systemName: memberSymbol(line))
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(line.state == .failed ? ChromePalette.red : ChromePalette.inkFaint)
        .frame(width: 14)
      Text(line.verb)
        .font(ChromeType.sans(12.5, .medium))
        .foregroundStyle(line.state == .failed ? ChromePalette.red : ChromePalette.inkTertiary)
        .lineLimit(1)
        .fixedSize()
      Text(verbatim: line.object)
        .font(ChromeType.sans(12.5))
        .foregroundStyle(ChromePalette.inkSecondary)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 6)
      if let open {
        Image(systemName: "chevron.right")
          .font(.system(size: 9, weight: .semibold))
          .rotationEffect(.degrees(open ? 90 : 0))
          .foregroundStyle(ChromePalette.inkFaint)
      }
    }
    .frame(minHeight: 26)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  private func memberSymbol(_ line: HistoryLedgerLine) -> String {
    if line.state == .failed { return "xmark.circle" }
    switch line.kind {
    case .thought: return "ellipsis.bubble"
    case .notice: return "info.circle"
    case .summary: return "text.alignleft"
    case .compaction: return "arrow.down.right.and.arrow.up.left"
    case .team: return "person.2"
    case nil: return "pencil.line"
    }
  }

  /// Item 362f — a tool line. Where the direct read kept what it opens to (`opens`), it is a button with a chevron
  /// and opens in place, as a member does; otherwise it is the line it was. Its open state is kept under a
  /// member's key, so `Open every run` does not open it: a detail exists on the page only while its line is open.
  @ViewBuilder
  private func ledgerLine(_ line: HistoryLedgerLine) -> some View {
    if let detail = opens[line.id] {
      let key = FieldHistoryModel.memberKey(line.id)
      let open = expanded.contains(key)
      VStack(alignment: .leading, spacing: 0) {
        Button {
          withAnimation(FieldMotion.ease(0.3)) {
            if open { expanded.remove(key) } else { expanded.insert(key) }
          }
        } label: {
          ledgerHead(line, open: open)
        }
        .buttonStyle(HistoryRowStyle(radius: 6))
        .accessibilityValue(open ? "expanded" : "collapsed")
        if open {
          HistoryToolDetailView(detail: detail)
            .equatable()
            .padding(.leading, 22)
            .padding(.trailing, 4)
            .padding(.bottom, 6)
            .transition(.opacity)
        }
      }
    } else {
      ledgerHead(line, open: nil)
    }
  }

  private func ledgerHead(_ line: HistoryLedgerLine, open: Bool?) -> some View {
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
      if let open {
        Image(systemName: "chevron.right")
          .font(.system(size: 9, weight: .semibold))
          .rotationEffect(.degrees(open ? 90 : 0))
          .foregroundStyle(ChromePalette.inkFaint)
      }
    }
    .frame(minHeight: 26)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// Item 362f — a prompt's or a reply's words under the room's excerpt rule: the words to the bound, and `View full
/// message` when there are more. Item 380 — and in the room's window: the words stand from their top in a window
/// of 21.7 em at most; where more is left to read than it shows (the excerpt cut, or the words overrun it) they
/// fade toward its foot by the room's ramp and `View full message` stands centred over the foot. The words drawn
/// are one element to a reader of the screen, as they were (the blocks are not read out piece by piece): who and
/// when (`lead`), then those words; the control is its own. Equatable on what it draws, so the bound is not
/// worked out again when the document's scroll state changes.
private struct HistoryExcerptView: View, Equatable {
  let text: String
  let blank: String
  let measure: ChatMarkdownMeasure
  let lead: String
  let open: () -> Void

  /// The words as drawn overrun the window: read from their own height once they are laid out. The window's
  /// height never waits on it (`HistoryWindow` reckons it in the layout's own pass); the fade and the control do.
  @State private var overruns = false

  nonisolated static func == (a: HistoryExcerptView, b: HistoryExcerptView) -> Bool {
    a.text == b.text && a.blank == b.blank && a.measure == b.measure && a.lead == b.lead
  }

  var body: some View {
    let excerpt = HistoryWords.excerpt(text)
    let size = measure.size
    let more = excerpt.omitted || overruns
    HistoryWindow(omitted: excerpt.omitted, size: size) {
      HistoryWordsView(text: excerpt.text, blank: blank, measure: measure)
        .onGeometryChange(for: Bool.self) { geometry in
          HistoryWords.window(natural: geometry.size.height, omitted: false, size: size).more
        } action: { now in
          overruns = now
        }
    }
    // the mask is the window's edge too: what overruns the window is not drawn
    .mask { HistoryFade(more: more) }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(lead): \(excerpt.text)")
    .overlay(alignment: .bottom) {
      if more {
        Button(action: open) {
          Text("View full message")
            .font(ChromeType.sans(12.5, .medium))
            .foregroundStyle(ChromePalette.inkSecondary)
            .padding(.horizontal, 12)
            .frame(minHeight: HistoryWords.openBand)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
  }
}

/// Item 380 — the window's layout: its words from their top at their own height, and the window as tall as
/// `HistoryWords.window` says, across the width it is given. One pass: a row's height never waits on a reading.
private struct HistoryWindow: Layout {
  let omitted: Bool
  let size: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let words = subviews.first else { return .zero }
    let natural = words.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
    let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? natural.width
    return CGSize(
      width: width, height: HistoryWords.window(natural: natural.height, omitted: omitted, size: size).height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(
      at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: nil))
  }
}

/// Item 380 — the window's mask: whole where nothing more is left to read, else the room's ramp down its height
/// (`HistoryWords.fade`).
private struct HistoryFade: View {
  let more: Bool

  var body: some View {
    if more {
      GeometryReader { geometry in
        LinearGradient(
          stops: HistoryWords.fade(height: geometry.size.height).map { stop in
            Gradient.Stop(color: .black.opacity(stop.shows), location: stop.at)
          },
          startPoint: .top, endPoint: .bottom)
      }
    } else {
      Rectangle()
    }
  }
}

/// Item 362d — a recorded message's words, drawn: read by `HistoryWords` and set by the view Chat draws a spark's
/// words with, at the document's measure. Equatable, so words that did not change are not read again when the
/// document's scroll state does.
private struct HistoryWordsView: View, Equatable {
  let text: String
  /// What stands for words that are nothing but space.
  let blank: String
  let measure: ChatMarkdownMeasure

  nonisolated static func == (a: HistoryWordsView, b: HistoryWordsView) -> Bool {
    a.text == b.text && a.blank == b.blank && a.measure == b.measure
  }

  var body: some View {
    switch HistoryWords.reading(text) {
    case .blank:
      plain(blank).foregroundStyle(ChromePalette.inkFaint)
    case .typed(let typed):
      plain(typed).foregroundStyle(ChromePalette.ink)
    case .blocks(let blocks):
      ChatMarkdownView(blocks: blocks, measure: measure)
    }
  }

  private func plain(_ words: String) -> some View {
    Text(verbatim: words)
      .font(ChromeType.sans(measure.size))
      .lineSpacing(measure.lineSpacing)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}
