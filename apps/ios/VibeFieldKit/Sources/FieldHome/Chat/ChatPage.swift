import FieldDesign
import FieldHistory
import FieldProduct
import SwiftUI

// IOS-12b (PC-D1 A, PC-L1, PC-L4, PC-L5; DESIGN.md §8 "The phone's Chat", §9 "Chat on the phone") — CHAT'S PAGE:
// History's page (its large title, its paper, its group head), the list's subtitle counting what is true, a line for
// each desktop whose sparks are its last word, and one row per spark, newest activity first (CH-D1). A row says its
// spark's status and its dot; pressed, it opens the spark's thread (IOS-12c), pushed in this page's own stack; held,
// its menu offers Open its pane while its own run is live, and Wake while it sleeps. IOS-12d (PC-D4 A, Q7): Needs you
// heads the list while anything waits, one card per spark's item of the home's merged queue, answered in place.
// IOS-12f (PC-D8 A, Q1): New spark's door, `sparkle` at the title's right, opens its sheet (`NewSparkSheetView`).
// Created (f6), the face flies to the new row, whose own face waits for it, and then the row's thread opens.
// ES-5c (ES-D1…D7 A): with no spark, once the home has answered and every desktop has, the page is the night
// (`ChatNightView`), its title and ✦ in the night's ink.

/// Chat's words (§9 "Chat on the phone"), pure.
enum ChatWords {
  static let title = "Chat"
  static let sparks = "Sparks"
  static let wake = "Wake"

  /// The note over the bar (§9): "Vela needs you".
  static func note(_ name: String) -> String { "\(name) needs you" }

  /// "4 sparks on studio · 2 need you": what is true, the desktops the sparks live on by name.
  static func subtitle(sparks: Int, on desktops: [String], needing: Int) -> String {
    let count = sparks == 1 ? "1 spark" : "\(sparks) sparks"
    let places = desktops.isEmpty ? count : "\(count) on \(names(desktops))"
    guard needing > 0 else { return places }
    return "\(places) · \(needing == 1 ? "1 needs you" : "\(needing) need you")"
  }

  /// "studio", "studio and loft", "studio, loft and mini".
  static func names(_ names: [String]) -> String {
    guard names.count > 1, let last = names.last else { return names.first ?? "" }
    return "\(names.dropLast().joined(separator: ", ")) and \(last)"
  }

  /// A desktop that did not answer (PC-L4), in the fact that holds: asleep; not answering (a timeout, or
  /// unreachable — the same fact to the person); or answering with a build the phone can't read (VF-PM's ruling,
  /// 2026-11-05: never "isn't answering" about a desktop that answered and was refused). `carried`: the list holds a
  /// row of it, its last word; else the phone never heard it, and says so, never "as it last said" (§9, VF-PM
  /// 2026-11-05 02:06Z). The device is named as its platform names it (`DeviceWord`; L4's word pass, 2026-11-06).
  static func away(_ desktop: String, _ standing: ChatAway.Standing, carried: Bool, device: DeviceWord) -> String {
    switch (standing, carried) {
    case (.asleep, true):
      "\(desktop) is asleep. These are as it last said; your words wait here until it wakes."
    case (.silent, true):
      "\(desktop) isn't answering. These are as it last said; your words wait here until it answers."
    case (.incompatible, true):
      "\(desktop) runs a build \(device.this) can't read. These are as it last said; "
        + "your words wait here until it's updated."
    case (.asleep, false):
      "\(desktop) is asleep. Its sparks show here when it wakes."
    case (.silent, false):
      "\(desktop) isn't answering. Its sparks show here when it answers."
    case (.incompatible, false):
      "\(desktop) runs a build \(device.this) can't read. Its sparks show here when it's updated."
    }
  }

  /// A row's accessible name: the name, the word, the time, and a dot the word does not say (§9's "unread",
  /// "needed you").
  static func row(_ entry: SparkEntry, time: String, mark: ThreadMark?) -> String {
    var parts = [entry.spark.name, entry.status.word, time]
    switch mark {
    case .needs where !entry.needsYou: parts.append("needed you")
    case .unread: parts.append("unread")
    default: break
    }
    return parts.joined(separator: ", ")
  }
}

/// One desktop line under the subtitle: a desktop that did not answer, why, and whether the list holds its last word.
struct ChatAway: Equatable, Identifiable {
  enum Standing: Equatable {
    case asleep
    /// Asked, and no answer: a timeout, unreachable, or a word this build does not know.
    case silent
    /// It answered, with a build the home cannot merge.
    case incompatible

    /// How the merge says a desktop answered (`ComposeDesktopState`, OPEN), as the person reads it.
    init(_ state: ComposeDesktopState?) {
      switch state {
      case .asleep: self = .asleep
      case .incompatible: self = .incompatible
      default: self = .silent
      }
    }
  }

  let device: String
  let name: String
  let standing: Standing
  /// The list holds a spark or an ask of it: its last word. Else the phone never heard it.
  let carried: Bool
  var id: String { device }

  /// The lines under the subtitle, in the merge's order (PC-L4; §9, VF-PM 2026-11-05 02:06Z). A desktop the merge
  /// says did not answer says its last word only while the reading carries a spark or an ask of it, and is said as
  /// never heard otherwise. With no door the home answers for every desktop: it says the whole list's last word while
  /// the reading carries any row, and is never heard otherwise (a cold start, the common case: the list lives in
  /// memory). `homeListed`: the tailnet still lists the home, so it is not answering rather than asleep. `name(nil)`
  /// is the home's name (the page's own, on the main actor).
  @MainActor
  static func lines(
    _ reading: ChatReading, home: String?, homeListed: Bool, name: @MainActor (String?) -> String
  ) -> [ChatAway] {
    guard reading.connected else {
      let carried = !reading.sparks.isEmpty || !reading.items.isEmpty
      return [
        ChatAway(device: home ?? "", name: name(nil), standing: homeListed ? .silent : .asleep, carried: carried)
      ]
    }
    let held = Set(reading.sparks.compactMap { $0.device } + reading.items.compactMap { $0.device })
    return reading.desktops.filter { $0.known != .answered }.map { desktop in
      ChatAway(
        device: desktop.device, name: name(desktop.device), standing: Standing(desktop.known),
        carried: held.contains(desktop.device))
    }
  }
}

struct ChatPage: View {
  let entries: [SparkEntry]
  let ledger: ThreadLedger
  /// The names of the desktops the sparks live on, in the list's order.
  let desktops: [String]
  let away: [ChatAway]
  /// The home has answered the list at least once (else nothing is claimed, not even the night).
  let heard: Bool
  /// IOS-12f — the home's name, for New spark's "Runs on studio, your home".
  let homeName: String
  /// IOS-12f — the person's live sessions on the home, for New spark's reach; nil until the board is read.
  let sessions: [RunProfileFacts]?
  let onWake: (SparkSummary) -> Void
  /// IOS-12c — the threads' reads and sends go through Chat's feed, and the thread shown is the screen's (the bar
  /// steps aside for it, and the ledger reads it).
  let feed: ChatFeed
  @Binding var thread: String?
  /// Open its pane: the spark's own run's session card, which is the attach (FW-D2).
  let onOpenPane: (AgentRemoteRow) -> Void
  /// IOS-12d — the field has a pane for this run key (HomeScreen's session cards, d5); until it says, every run has.
  var paneOpens: (String) -> Bool = { _ in true }
  /// ES-5c — the home's live runs, for the night's starters; out until the board is read.
  var nightRuns: ChatStarters.Read<ChatStarters.Run> = .out
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var phase
  /// IOS-12f — the New spark sheet stands.
  @State private var newSpark = false
  /// ES-5c — the home's agents and catalog, as the night last read them: a reading stands until the next one lands, so
  /// the night never flickers back to reading.
  @State private var nightAgents: ChatNight.Agents = .reading
  @State private var nightCatalog: AgentCatalogResult?
  /// ES-5d (ES-D2 A) — the first job the sheet opens carrying: a starter's on the night, none from New spark or ✦.
  @State private var carried: ChatStarter?
  /// IOS-12f's f6 — Create's order: the flight to the new row, and its row's face meanwhile.
  @State private var landing = NewSparkLanding(flying: SparkFlightWindow.make())
  /// A new spark's thread to open, once the list holds its spark.
  @State private var opening: String?
  #if DEBUG
    /// The stills' thread has been opened once (`ChatFixtureDoor.openThread`); back then stays back.
    @State private var openedForStills = false
    /// IOS-12d — the stills' act has been pressed once (`ChatFixtureDoor.needsPress`).
    @State private var pressedForStills = false
    /// IOS-12f — the stills' New spark has been opened once (`ChatFixtureDoor.openNewSpark`).
    @State private var newSparkForStills = false
  #endif

  /// The stack's path: the shown thread, or none.
  private var path: Binding<[String]> {
    Binding(get: { thread.map { [$0] } ?? [] }, set: { thread = $0.last })
  }

  /// ES-5c — no spark, and the home and every desktop have answered: the page is the night.
  private var nightStands: Bool { Self.nightStands(sparks: entries.count, heard: heard, away: away.count) }

  /// Whether the night stands, for the page and for the bar (`HomeScreen`) to read one rule.
  nonisolated static func nightStands(sparks: Int, heard: Bool, away: Int) -> Bool {
    sparks == 0 && heard && away == 0
  }

  // ES-5c — typed apart, so `body`'s long chain has no conditional of implicit members to solve
  private var barScheme: ColorScheme? { nightStands ? .dark : nil }
  private var barBackground: Visibility { nightStands ? .hidden : .automatic }
  private var sparkleInk: Color { nightStands ? ChromePalette.nightInkPrimary : ChromePalette.ink }

  /// ES-5c — what stands on the stage: the night, or the list on its paper.
  @ViewBuilder private var nightOrList: some View {
    if nightStands {
      night
    } else {
      list
        .background(ChromePalette.paper.ignoresSafeArea())
    }
  }

  var body: some View {
    NavigationStack(path: path) {
      // IOS-12e (§2.10): Chat's list is one stage; a row's face moves on it while its spark works
      SparkStageHost { nightOrList }
      .navigationTitle(ChatWords.title)
      // ES-5c (§8): the status bar, "Chat" and its ✦ wear the night's ink, and the bar floats clear on it
      .toolbarColorScheme(barScheme, for: .navigationBar)
      .toolbarBackground(barBackground, for: .navigationBar)
      // IOS-12f (Q1) — New spark's door at the title's right, as the Mac's create stands in Chat's line
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            carried = nil
            newSpark = true
          } label: {
            FieldGlyph(.sparkle, size: 22)
              .foregroundStyle(sparkleInk)
              .frame(width: 44, height: 44)
              .contentShape(Rectangle())
          }
          .accessibilityLabel(NewSparkWords.title)
        }
      }
      .navigationDestination(for: String.self) { spark in
        if let entry = entries.first(where: { $0.spark.id == spark }) {
          ChatThreadView(
            entry: entry, feed: feed,
            away: ChatThreads.away(of: entry.spark, in: away, connected: feed.reading.connected),
            onOpenPane: onOpenPane, paneOpens: paneOpens)
        } else {
          // the spark left the list while its thread stood: the list again
          Color.clear.onAppear { thread = nil }
        }
      }
    }
    .tint(ChromePalette.ink)
    // ES-5c — the night's agents, read each time the night stands, and again when the app comes back while it is Off: an
    // agent installed meanwhile turns New spark on
    .task(id: nightStands) { await readNight() }
    .onChange(of: phase) {
      guard phase == .active, ChatNight.offNames(nightAgents) != nil else { return }
      Task { await readNight() }
    }
    // IOS-12f — the sheet: a spark made on the home, its words §9's (Cancel or pulled down, nothing is made)
    .sheet(isPresented: $newSpark, onDismiss: { carried = nil }) {
      NewSparkSheetView(
        feed: feed, taken: feed.reading.sparks.map(\.name), homeName: homeName,
        away: feed.reading.connected ? nil : away.first, sessions: sessions, carried: carried, landing: landing,
        onOpen: { open(made: $0, job: $1) })
    }
    // the new spark's thread opens once the list holds it: at once when its face lands on its row, or once the list
    // reads it where no row stood within the wait. Both read the page as it stands now, never as the sheet's press did
    .onChange(of: opening) { openListed() }
    .onChange(of: entries.map(\.spark.id)) { openListed() }
    #if DEBUG
      // IOS-12f — the stills' sheet, once the list is heard (no OS input on the stills' host)
      .onChange(of: heard, initial: true) { _, heard in
        guard heard, !newSparkForStills, ChatFixtureDoor.openNewSpark else { return }
        newSparkForStills = true
        if ChatFixtureDoor.newSparkJob { carried = ChatFlowWords.starters.first }
        newSpark = true
      }
      // the stills, under `-vf-mock`: the named thread opens once the list holds its spark (set before then, the
      // destination would find no spark and stand the list again)
      .onChange(of: entries.map(\.spark.id), initial: true) { _, ids in
        guard !openedForStills, let spark = ChatFixtureDoor.openThread, ids.contains(spark) else { return }
        openedForStills = true
        thread = spark
      }
      // IOS-12d — the stills' press, once the queue holds its item (no OS input on the stills' host)
      .onChange(of: feed.reading.items.map(\.id), initial: true) { _, ids in
        guard !pressedForStills, let press = ChatFixtureDoor.needsPress, ids.contains(press.item),
          let item = feed.reading.items.first(where: { $0.id == press.item })
        else { return }
        pressedForStills = true
        feed.press(item, choice: press.choice, spark: item.spark ?? "", names: NeedsCards.names(of: item))
      }
      // IOS-12d — `-vf-needs-case=away`: both lists heard with mini awake, it sleeps and they are asked again, so what
      // it said arrives carried. On "heard", never a timer: a reading has to stand before there is anything to carry.
      .onChange(of: feed.reading.heard && feed.reading.needsHeard, initial: true) { _, both in
        guard both, ChatFixtureDoor.needsCase == "away" else { return }
        ChatFixtureDoor.shared.miniSleeps()
        feed.refresh()
      }
    #endif
  }

  /// ES-5c — the night. ES-5d: a starter opens the sheet carrying itself as its first job (ES-D2 A).
  private var night: some View {
    ChatNightView(
      agents: nightAgents,
      starters: ChatNight.starters(agents: nightAgents, runs: nightRuns, catalog: nightCatalog),
      homeName: homeName,
      onNewSpark: {
        carried = nil
        newSpark = true
      },
      onJob: { job in
        carried = job
        newSpark = true
      })
  }

  /// ES-5c — the home's agents and catalog for the night, while it stands.
  private func readNight() async {
    guard nightStands else { return }
    async let providers = try? feed.providers()
    async let catalog = try? feed.catalog()
    let (read, known) = await (providers, catalog)
    nightCatalog = known
    nightAgents = read.map { ChatNight.agents($0, catalog: known) } ?? .unread
  }

  private var list: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        head
        group
        if !entries.isEmpty {
          HStack(spacing: 4) {
            Text(ChatWords.sparks)
            Text("·")
            Text("\(entries.count)")
          }
          .chromeGroupHead()
          .frame(minHeight: 30)
          .padding(.horizontal, 20)
          .padding(.top, 22)
          .padding(.bottom, 8)
          TimelineView(.periodic(from: .now, by: 60)) { context in
            let now = Int64((context.date.timeIntervalSince1970 * 1000).rounded())
            VStack(spacing: 0) {
              ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                ChatRow(
                  entry: entry, mark: ledger.mark(of: entry), now: now, separated: index > 0,
                  landing: landing.face(of: entry.spark.id), onFaceBox: { landing.row(entry.spark.id, box: $0) },
                  onWake: onWake, onOpen: { thread = entry.spark.id }, onOpenPane: onOpenPane)
              }
            }
          }
        }
      }
      .padding(.bottom, 24)
    }
    .readsTopPull()
  }

  /// IOS-12d (PC-D4 A; Q7) — Needs you heads the list while anything waits: one card per spark's item, oldest asked
  /// first, each answered in place; an agent's own ask goes to its pane (PC-L3).
  @ViewBuilder
  private var group: some View {
    let cards = ChatNeeds.group(
      items: feed.reading.items, entries: entries, answering: feed.answering, reduced: reduceMotion)
    if !cards.isEmpty {
      HStack(spacing: 4) {
        Text(ChatNeedsWords.group)
        Text("·")
        Text("\(cards.count)")
      }
      .chromeGroupHead()
      .frame(minHeight: 30)
      .padding(.horizontal, 20)
      .padding(.top, 22)
      .padding(.bottom, 8)
      VStack(spacing: 10) {
        ForEach(cards) { card in
          let opens = entries.contains { $0.spark.id == card.spark }
          ChatNeedsCardView(
            card: card, place: .group,
            away: ChatNeeds.away(of: card.item, in: away, connected: feed.reading.connected).map {
              ChatNeedsWords.away($0.name, $0.standing, device: DeviceWord.current)
            },
            labels: feed.labels,
            onAct: { choice in feed.press(card.item, choice: choice, spark: card.spark, names: card.names) },
            onPane: { openPane(of: card.item) },
            onOpen: opens ? { thread = card.spark } : nil
          )
          .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 8)))
        }
      }
      .padding(.horizontal, 16)
      .animation(
        reduceMotion ? .easeInOut(duration: 0.12) : .easeOut(duration: 0.24), value: cards.map(\.id))
    }
  }

  /// IOS-12f's f6 — the new spark's thread, asked for once its face has landed (or where nothing flew).
  private func open(made spark: String, job: String?) {
    // ES-5d — the job reaches the feed only now the spark has hatched; its thread sends it, once
    if let job { feed.carry(job, to: spark) }
    #if DEBUG
      // the stills' row after the flight: the list holds, the thread unopened (`ChatFixtureDoor.holdLanding`)
      if ChatFixtureDoor.holdLanding { return }
    #endif
    opening = spark
  }

  /// The asked thread, once the list holds its spark.
  private func openListed() {
    guard let opening, entries.contains(where: { $0.spark.id == opening }) else { return }
    self.opening = nil
    thread = opening
  }

  /// Answer in its pane (Q5): the asking run's session card on Field, found at the press; else the card says so.
  private func openPane(of item: NeedsItem) -> Bool {
    guard let run = feed.pane(of: item, opens: paneOpens) else { return false }
    onOpenPane(run)
    return true
  }

  private var head: some View {
    VStack(alignment: .leading, spacing: 5) {
      if heard || !entries.isEmpty {
        Text(ChatWords.subtitle(sparks: entries.count, on: desktops, needing: SparkEntries.needing(entries)))
          .font(ChromeType.sans(13))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(2)
      }
      ForEach(away) { desktop in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Image(systemName: "moon")
            .font(.system(size: 12, weight: .medium))
          Text(ChatWords.away(desktop.name, desktop.standing, carried: desktop.carried, device: DeviceWord.current))
            .font(ChromeType.sans(13))
            .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(ChromePalette.inkSecondary)
        .accessibilityElement(children: .combine)
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 2)
  }
}

/// A spark's row (DESIGN.md §8): 76 tall, 16 from the sides, its face at 48 on its disc; the name 17 semibold and its
/// time 15 tertiary; its status's word 15 tertiary, in the attention ink when it needs you (S-4); its dot 10, orange
/// for a need until its thread is opened, else cyan while unread (PC-L5); its separator from the words' edge.
/// IOS-12f's f6 — a new spark's row: its face waits, unseen, while the face flies to it, or fades in where nothing
/// flies; it says where its face is, in the window's space, at each change of its box.
struct ChatRow: View {
  let entry: SparkEntry
  let mark: ThreadMark?
  let now: Int64
  let separated: Bool
  var landing: NewSparkLanding.Face?
  var onFaceBox: (CGRect) -> Void = { _ in }
  let onWake: (SparkSummary) -> Void
  /// IOS-12c — pressed: its thread
  let onOpen: () -> Void
  let onOpenPane: (AgentRemoteRow) -> Void

  static let height: CGFloat = 76
  static let face: CGFloat = 48
  static let side: CGFloat = 16
  static let gap: CGFloat = 12
  static let dot: CGFloat = 10
  /// The statuses a face moves through while its spark works: "live while it works" (§2.10's table), the Mac's
  /// `AT_WORK` (ChatPanelView.tsx). Any other status is a still.
  static let atWork: Set<SparkStatus> = [.thinking, .planning, .searching, .reviewing, .running, .focus]

  var body: some View {
    let time = SparkEntries.activityWords(at: entry.activityAt, now: now)
    HStack(spacing: Self.gap) {
      Group {
        if landing == .waits {
          Color.clear
        } else {
          SparkFaceView(
            seed: entry.spark.seed, status: entry.status.rawValue, size: Self.face,
            live: Self.atWork.contains(entry.status)
          )
          .transition(.opacity)
        }
      }
      .frame(width: Self.face, height: Self.face)
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { onFaceBox($0) }
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(entry.spark.name)
            .font(ChromeType.sans(17, .semibold))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
          Spacer(minLength: 0)
          Text(time)
            .font(ChromeType.sans(15))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkTertiary)
        }
        HStack(spacing: 8) {
          Text(entry.status.word)
            .font(ChromeType.sans(15))
            .foregroundStyle(entry.needsYou ? ChromePalette.attention : ChromePalette.inkTertiary)
            .lineLimit(1)
          Spacer(minLength: 0)
          if let mark {
            Circle()
              .fill(mark == .needs ? ChromePalette.attention : ChromePalette.info)
              .frame(width: Self.dot, height: Self.dot)
          }
        }
      }
    }
    .padding(.horizontal, Self.side)
    .frame(minHeight: Self.height)
    .overlay(alignment: .top) {
      if separated {
        Rectangle()
          .fill(ChromePalette.separator)
          .frame(height: 1)
          .padding(.leading, Self.side + Self.face + Self.gap)
      }
    }
    .contentShape(Rectangle())
    .onTapGesture(perform: onOpen)
    .contextMenu { acts }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(ChatWords.row(entry, time: time, mark: mark))
    .accessibilityAddTraits(.isButton)
    .accessibilityAction(.default, onOpen)
    .accessibilityActions { acts }
  }

  /// §8's row menu, in its order: **Open its pane** while its own run is live, then **Wake** while it sleeps (IOS-12c,
  /// `ChatThreadActs.menu`, the thread's ⋯ too). Put to sleep and Its profile join when the phone has their doors.
  @ViewBuilder
  private var acts: some View {
    ForEach(ChatThreadActs.menu(entry), id: \.self) { act in
      switch act {
      case .openPane:
        Button(ChatThreadWords.openPane) {
          if let run = entry.run { onOpenPane(run) }
        }
      case .wake:
        Button(ChatWords.wake) { onWake(entry.spark) }
      }
    }
  }
}
