import FieldDesign
import FieldHistory
import FieldMesh
import FieldProduct
import Foundation
import SwiftUI

// UM-4 (UM-D25 and UM-D26 A; DESIGN.md §8 "The phone's corner", §9 "The meters' words") — THE ME MENU'S ROW AND THE
// AGENT PROFILES PAGE. `AgentProfilesWords` is every word and choice (pure): a circle's word (`word`, which the Me
// menu's row, `AgentProfilesMenuRow`, says), and every line of the page, from the home's meters (`MetersReading`), the
// lens (`ProfileLens`), the home's name and the clock. The views below draw what it says, in Settings' materials
// (`chromeList`, `chromeRows`, History's group heads).
//
// While the field is live a plan's row says its sessions and, with some, draws Show (Showing while it is the one
// chosen, UM-5b, UM-D14); the row itself takes no tap. *(Corrected 2026-11-09, UM-5b: this said wave 1's row carries no
// Show or Showing and no sessions line; a run's plan has been readable since SE-2's `monitor.profileSet` and the join.)*
// A plan that needs you says where it is fixed, with no act of its own (a phone signs in on no desktop).
//
// UM-6 (UM-D33, 2026-11-24; DESIGN.md §8 "The Agent Profiles page") — the page's ↻, before close, and pulling the page
// down ask the home to read its usage again (`MetersFeed.refresh`, `agents.usage` with `refresh: true`), which UM-D8
// had refused a phone: a person's ask, never a timer, so the phone still polls nothing (UM-L4). While that reading is
// out the head's line says "Reading usage…". Every line ends in its reset's cap with its out mark under it (UM-D29,
// UM-D32: `UsageLineView`), so the plan's forecast sentence ("Runs out in ~35m at this pace") retires; the bands key
// names only what the circle draws (UM-D31: `BandsLayout.keyItems`).

struct AgentProfilesWords: Equatable {
  /// One row of the page's Profiles group: All profiles (`id` nil) or a profile.
  struct ProfileRow: Equatable, Identifiable {
    /// the profile's id; nil for All profiles
    let profileId: String?
    let name: String
    /// "default · the agents' own sign-ins · 2 plans", "3 profiles · 5 plans"
    let line: String
    /// the tightest percent, "reading…", or nothing
    let word: String?
    let hot: Bool
    /// the lens is on it (several profiles only)
    let checked: Bool
    /// whose glyph the row's circle holds (nil: every profile's)
    let profile: MeterProfile?
    var id: String { profileId ?? "" }
  }

  /// One row of the page's Plans group.
  struct PlanRow: Equatable, Identifiable {
    /// UM-5b — what a plan's button does: show it (its union key, what `ProfileLens.showPlan` holds), or say it is shown.
    enum Show: Equatable {
      case show(String)
      case showing
    }

    enum Body: Equatable {
      /// every window as Settings' C1 line, the kept reading's age, the age said under the bar of each window read
      /// before its reset (`MeterWindow.passed`), by its line's id (none when no window was, or its time cannot be read;
      /// item 274: each its own read, Settings' `meterLines`' `ages`). *Since UM-6 (UM-D29):* no forecast sentence; a
      /// window that runs out first is marked under its own bar (`UsageLineView`).
      case reading(windows: [MeterWindow], kept: String?, ages: [String: String], stale: Bool)
      /// the first reading is out
      case firstRead
      /// what it needs, said with no act
      case needs(String)
      /// "Codex shows no meter" (an agent that reports no usage), "Claude Max: usage unavailable", or — a plan no
      /// agent named, or whose reading holds no window — its title alone: its own words are ‹to pick›, and "shows
      /// no meter" would be false of an agent that meters (the U3 review)
      case none(String)
    }

    /// DESIGN.md §8 "A plan's tier" — what follows a plan's title: its tier's label as given, or, its tier not read
    /// beside a sibling's, the empty capsule (`AgentProfilesWords.tierOf`).
    enum Tier: Equatable {
      case label(String)
      case unread
    }

    let key: String
    let provider: String
    let title: String
    /// after the title; nil, nothing is drawn
    let tier: Tier?
    /// the plan's sign-in, veiled (`MeterModel.veiledAccount`); nil when no account is named
    let account: String?
    /// UM-D12 — a crowded agent's plan wears its profile's glyph (every plan in view)
    let glyph: MeterProfile?
    let body: Body
    /// UM-5b — while the field is live: "3 sessions · 1 working · 1 waiting for you", "no sessions"; nil while it is
    /// not, and on a plan with no meter (a line of its own).
    let sessions: String?
    /// nil, no act: nothing to show, or a plan that needs you
    let show: Show?
    var id: String { key }

    /// The plan's name aloud: its title and its tier's label joined by a space ("ChatGPT Pro 200"), so the badge is
    /// heard as part of the name and never as an element of its own. A tier not read says nothing: the title alone.
    /// The Bands circle's arc words say the same name (`PlanMeter.spokenTitle`).
    var spoken: String {
      guard case .label(let label) = tier else { return title }
      return PlanMeter.spoken(title, label: label)
    }
  }

  /// "Read a minute ago, from studio", "Reading usage…", "studio doesn't share usage yet", "Usage unavailable"
  let read: String
  let profiles: [ProfileRow]
  /// "Plans", "Every plan", "Plans in Work"
  let plansHead: String
  let plans: [PlanRow]

  static let title = "Agent Profiles"
  static let foot = "Manage profiles in Settings → Agent Profiles. New profiles are made on a desktop."
  /// UM-D33 — ↻ aloud, and the head's line while its reading is out (§9 "The popover", the phone's page)
  static let refreshLabel = "Refresh usage"
  static let refreshing = "Reading usage…"

  init(reading: MetersReading, lens: ProfileLens, home: String, now: Date, live: PhoneSearch.Live? = nil) {
    let every = reading.meters(of: nil, now: now)
    let several = reading.profiles.count > 1
    let firstRead = reading.firstRead
    read = Self.readWords(reading, home: home, now: now)
    var rows: [ProfileRow] = []
    if several {
      let said = Self.word(every, firstRead: firstRead, notShared: false)
      rows.append(
        ProfileRow(
          profileId: nil, name: "All profiles",
          line: "\(reading.profiles.count) profiles · \(Self.counted(Self.onCircle(every), "plan"))", word: said.word,
          hot: said.hot, checked: lens.profile == nil, profile: nil))
    }
    for set in reading.profiles {
      let meters = reading.meters(of: set.id, now: now)
      let said = Self.word(meters, firstRead: firstRead, notShared: false)
      let parts = [
        several && set.isDefault ? "default" : nil, set.kind == "native" ? "the agents' own sign-ins" : nil,
        Self.counted(Self.onCircle(meters), "plan"),
      ]
      rows.append(
        ProfileRow(
          profileId: set.id, name: set.label, line: parts.compactMap { $0 }.joined(separator: " · "), word: said.word,
          hot: said.hot, checked: several && lens.profile == set.id, profile: MeterModel.profileOf(set)))
    }
    profiles = rows
    let chosen = lens.chosen
    plansHead = chosen.map { "Plans in \($0.label)" } ?? (several ? "Every plan" : "Plans")
    let shown = chosen == nil ? every : reading.meters(of: chosen?.id, now: now)
    let crowded = chosen == nil && several ? Self.crowded(shown.entries) : []
    plans = shown.entries.map { entry in
      // the key the filter holds: under a lens a row's key is its own profile's, every plan's is already whole
      let key = chosen.map { "\($0.id)/\(entry.key)" } ?? entry.key
      let family = PlanSessions.family(reading.profiles, key: key)
      let runs = entry.kind == .noMeter ? nil : live.map { Self.runs($0, keys: Set(family), profile: chosen?.id) }
      return PlanRow(
        key: entry.key, provider: entry.provider, title: entry.title, tier: Self.tierOf(entry, in: shown.entries),
        account: MeterModel.veiledAccount(entry.plan?.account),
        glyph: crowded.contains(entry.provider) ? entry.profiles.first : nil,
        body: Self.body(entry, home: home, now: now),
        sessions: runs.map { $0.isEmpty ? "no sessions" : PhoneSearch.sessWords($0) },
        show: Self.show(entry, key: key, family: family, runs: runs, lens: lens))
    }
  }

  /// UM-5b — the field's runs that spend one of `keys` (a plan and its twins); under a lens only those in its profile,
  /// which is what the filter would keep (lens AND plan: `PlanSessions.recedes`, `PhoneSearch.liveRows`), so a row
  /// promises no session the field would recede (DESIGN.md §8 "The phone's corner", 2026-11-09).
  private static func runs(
    _ live: PhoneSearch.Live, keys: Set<String>, profile: String?
  ) -> [PhoneSearch.LiveSession] {
    live.sessions.filter { session in
      guard let key = session.planKey, keys.contains(key) else { return false }
      return profile == nil || session.profileSet == profile
    }
  }

  /// UM-5b — a plan's act: none while the field is not live or the plan needs you, **Showing** while the plan or its
  /// twin is the one chosen, **Show** while it has sessions.
  private static func show(
    _ entry: PlanMeter, key: String, family: [String], runs: [PhoneSearch.LiveSession]?, lens: ProfileLens
  ) -> PlanRow.Show? {
    guard let runs, entry.kind != .needsYou else { return nil }
    if let plan = lens.plan, family.contains(plan) { return .showing }
    return runs.isEmpty ? nil : .show(key)
  }

  /// The plans a circle draws: a reading, a first read, or one that needs you.
  static func onCircle(_ meters: ProfileMeters) -> Int { meters.entries.filter { $0.kind != .noMeter }.count }

  static func counted(_ count: Int, _ word: String) -> String { "\(count) \(word)\(count == 1 ? "" : "s")" }

  /// UM-D13 — a circle's word: its tightest percent ("42%"), orange when it runs hot; "reading…" while the first
  /// reading is out; nothing when nothing reads (or, for the Me menu's row, while the home does not share usage —
  /// that word is ‹to pick›; the page says it).
  static func word(_ meters: ProfileMeters, firstRead: Bool, notShared: Bool) -> (word: String?, hot: Bool) {
    if notShared { return (nil, false) }
    if let tightest = meters.tightest, let reading = tightest.reading {
      return ("\(wholeWords(reading.tightest.line.usedPercent))%", tightest.hot)
    }
    if firstRead || meters.entries.contains(where: { $0.kind == .firstRead }) { return ("reading…", false) }
    return (nil, false)
  }

  /// Where the reading comes from (§9): its age and the home, or why there is none. The home's honest empty is a
  /// first read, never "Read a minute ago" over nothing read.
  static func readWords(_ reading: MetersReading, home: String, now: Date) -> String {
    switch reading.usage {
    case .notShared: return "\(home) doesn't share usage yet"
    case .unavailable: return "Usage unavailable"
    case .waiting, .batch:
      guard !reading.firstRead, case .batch(let batch) = reading.usage else { return "Reading usage…" }
      guard let at = parseWireDate(batch.generatedAt) else { return "Read from \(home)" }
      let minutes = max(0, now.timeIntervalSince(at) / 60)
      let age = minutes < 1.5 ? "a minute" : MeterRules.durationWords(minutes)
      return "Read \(age) ago, from \(home)"
    }
  }

  /// A plan's row below its title. A window read before its reset says the reading's age, as Settings' line does
  /// (`meterLines`' `ages`, 48a30767d) — a kept reading's too, under its own age above — and only while that age can be
  /// said. *Since item 274 (2026-11-10, UM-274-D2 A):* each passed line says its own read's age
  /// (`MeterRules.meterReadAt`), as Settings' line now does. *Since UM-6:* under its bar, its cap dashed.
  static func body(_ entry: PlanMeter, home: String, now: Date) -> PlanRow.Body {
    switch entry.state {
    case .reading(let reading):
      // item 274 (UM-274-D2 A): each passed line says its own read's age, as Settings' `meterLines` says it
      let passed: [(String, String)] = reading.windows.filter(\.passed).compactMap { window in
        let read = MeterRules.meterReadAt(window.metric, readingAt: reading.fetchedAt)
        let age = MeterRules.ageWords(fetchedAt: read, now: now)
        return age.isEmpty ? nil : (window.line.id, age)
      }
      let ages = Dictionary(passed, uniquingKeysWith: { first, _ in first })
      return .reading(
        windows: reading.windows, kept: reading.stale ? entry.right?.words : nil, ages: ages, stale: reading.stale)
    case .firstRead:
      return .firstRead
    case .needsYou(let need):
      switch need {
      case .signIn: return .needs("Not signed in · sign in on \(home)")
      case .signingIn: return .needs("Signing in…")
      case .retry: return .needs("Couldn't read · retry")
      }
    case .noMeter(let why):
      switch why {
      case .unavailable: return .none("\(entry.title): usage unavailable")
      case .unreported: return .none("\(entry.agent) shows no meter")
      case .unnamed, .noWindows: return .none(entry.title)
      }
    }
  }

  /// DESIGN.md §8 "A plan's tier" — a plan's tier badge among the plans in view: its label as its sign-in read it; the
  /// empty capsule when it carries no tier record while another plan of its family carries a label, so a missing badge
  /// never reads as the lowest tier; else nothing. A family is the same sign-in service and the same title, compared
  /// value to value between two plans, never with a literal. A record with no label (the agent says the plan has no
  /// tier) draws nothing, beside a tiered sibling too. The tier names the plan, not its reading: a plan with no meter
  /// still draws its title, so it keeps its badge and counts as a sibling. An agent on no plan has no tier.
  static func tierOf(_ entry: PlanMeter, in entries: [PlanMeter]) -> PlanRow.Tier? {
    guard let plan = entry.plan else { return nil }
    if let tier = plan.tier { return tier.label.map(PlanRow.Tier.label) }
    let sibling = entries.contains { other in
      other.key != entry.key && other.plan?.service.id == plan.service.id && other.title == entry.title
        && other.plan?.tier?.label != nil
    }
    return sibling ? .unread : nil
  }

  /// A tier's label as its badge draws it: whole up to the contract's cap, else cut to the cap with an ellipsis inside
  /// the capsule (the row's spoken name keeps it whole). The phone caps by count, not by the desktop's 8ch width
  /// (DESIGN.md §8 "The phone's corner"); the wire refuses a longer label, so the cut is a guard.
  static func badgeWords(_ label: String) -> String {
    let cap = AgentPlanTier.labelMax
    return label.count <= cap ? label : "\(label.prefix(cap - 1))…"
  }

  /// UM-D12 — the agents with more than one plan in view.
  static func crowded(_ entries: [PlanMeter]) -> Set<String> {
    var seen = Set<String>()
    var crowded = Set<String>()
    for entry in entries {
      if !seen.insert(entry.provider).inserted { crowded.insert(entry.provider) }
    }
    return crowded
  }
}

/// UM-4 — the Me menu's Agent Profiles row (UM-D25 A), as the corner draws it: every plan's Bands circle at 26 with
/// nothing in its middle, the row's word (`AgentProfilesWords.word`), whether it runs hot, and the act — the corner
/// folds its menu and the page opens.
struct AgentProfilesMenuRow {
  static let size: Double = 26

  let geometry: BandsGeometry
  let word: String?
  let hot: Bool
  /// an agent's mark key, from the home's catalog
  let mark: (String) -> String
  let open: () -> Void

  init(reading: MetersReading, now: Date, open: @escaping () -> Void) {
    let every = reading.meters(of: nil, now: now)
    geometry = BandsLayout.geometry(Self.size, every.entries, .menuRow(every: reading.profiles.count > 1))
    let said = AgentProfilesWords.word(every, firstRead: reading.firstRead, notShared: reading.usage == .notShared)
    word = said.word
    hot = said.hot
    mark = MeterCatalog(rows: reading.catalog).mark
    self.open = open
  }
}

/// UM-4 — the Agent Profiles page (UM-D26 A; DESIGN.md §8 "The phone's corner"): a sheet of its own in Settings'
/// materials — paper, the large title, close (iOS 26's `role: .close`) and, since UM-6 (UM-D33), ↻ before it — that
/// rises as Settings' does. From the top: the circle at 214 (a tap on a plan focuses it), the bands key, and where the
/// reading comes from; Profiles (the lens's rows, with a check, when there are several; with one, a row that takes no
/// tap); the plans in view; the foot. Opening it reads the home's profiles again (`MetersFeed.open`); ↻ and pulling
/// the page down ask the home for a fresh reading (`MetersFeed.refresh`).
struct AgentProfilesPage: View {
  static let circle: Double = 214
  static let rowCircle: Double = 36

  let feed: MetersFeed
  @Binding var lens: ProfileLens
  /// the home's name ("studio")
  let home: String
  /// UM-5b — the field while it is live: a plan's sessions line and its Show (`AgentProfilesWords`); nil, neither.
  var live: PhoneSearch.Live? = nil

  @State private var focus: String? = nil
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      page
        .navigationTitle(AgentProfilesWords.title)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
          refreshItem
          closeItem
        }
    }
    .tint(ChromePalette.ink)
    .onAppear { feed.open() }
    .onChange(of: lens.profile) { focus = nil }
  }

  private var page: some View {
    let now = feed.clock()
    let reading = feed.reading
    let words = AgentProfilesWords(reading: reading, lens: lens, home: home, now: now, live: live)
    let mark = MeterCatalog(rows: reading.catalog).mark
    let several = reading.profiles.count > 1
    return List {
      Section {
        // while the page's own ask is out the line says so; when the batch lands, its age again (UM-D33)
        head(reading, read: feed.refreshing ? AgentProfilesWords.refreshing : words.read, now: now, mark: mark)
      }
      .listRowBackground(Color.clear)
      Section {
        ForEach(words.profiles) { row in
          profileRow(row, reading: reading, now: now, several: several, mark: mark)
        }
      } header: {
        ChromeListHead("Profiles")
      }
      .chromeRows()
      Section {
        ForEach(words.plans) { row in
          AgentPlanRowView(row: row, mark: mark(row.provider)) { show in
            switch show {
            case .show(let key): lens.showPlan(key)
            case .showing: lens.showPlan(nil)
            }
            dismiss()
          }
        }
      } header: {
        ChromeListHead(words.plansHead)
      } footer: {
        ChromeListFoot(AgentProfilesWords.foot)
      }
      .chromeRows()
    }
    .chromeList()
    // pulling the page down asks the home to read again, as ↻ does, with the system's spinner (UM-D33)
    .refreshable { await feed.refresh() }
  }

  /// The circle of the plans in view, the bands key, and where the reading comes from.
  private func head(_ reading: MetersReading, read: String, now: Date, mark: @escaping (String) -> String)
    -> some View
  {
    let entries = reading.meters(of: lens.profile, now: now).entries
    let geometry = BandsLayout.geometry(
      Self.circle, entries, .page(every: lens.profile == nil, several: reading.profiles.count > 1, focus: focus))
    // UM-D31 — the key names only what this circle draws; with nothing read yet, there is none
    let key = BandsLayout.keyItems(entries)
    return VStack(spacing: 6) {
      BandsDial(geometry: geometry, ground: ChromePalette.paper, mark: mark)
        .contentShape(Circle())
        .onTapGesture(coordinateSpace: .local) { spot in
          focus = geometry.plan(at: Double(spot.x), Double(spot.y))
        }
      if !key.isEmpty {
        BandsKey(items: key)
      }
      Text(read)
        .font(ChromeListType.detail)
        .foregroundStyle(ChromePalette.inkTertiary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
  }

  /// A profile's row: its circle at 36, its name and line, its word, and — with several — the lens's check.
  @ViewBuilder
  private func profileRow(
    _ row: AgentProfilesWords.ProfileRow, reading: MetersReading, now: Date, several: Bool,
    mark: @escaping (String) -> String
  ) -> some View {
    let label = AgentProfileRowLabel(
      row: row,
      geometry: BandsLayout.geometry(
        Self.rowCircle, reading.meters(of: row.profileId, now: now).entries,
        row.profileId == nil ? .allProfilesRow : .profileRow),
      several: several, mark: mark)
    if several {
      Button { lens.show(row.profileId) } label: { label }
        .buttonStyle(.plain)
        .accessibilityAddTraits(row.checked ? .isSelected : [])
    } else {
      label
    }
  }

  /// UM-D33 — ↻, before close: asks the home to read its usage again. While that reading is out it turns (the symbol's
  /// own rotate, which Reduce Motion stills) and takes no press.
  private var refreshItem: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Button {
        Task { await feed.refresh() }
      } label: {
        Image(systemName: "arrow.clockwise")
          .symbolEffect(.rotate, options: .repeat(.continuous), isActive: feed.refreshing)
      }
      .disabled(feed.refreshing)
      .accessibilityLabel(AgentProfilesWords.refreshLabel)
    }
  }

  private var closeItem: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      if #available(iOS 26.0, *) {
        Button(role: .close) { dismiss() }
      } else {
        Button("Done") { dismiss() }
          .fontWeight(.semibold)
      }
    }
  }
}

/// A Profiles row: 60 tall, the circle at 36, the name at 17, its line at 13 in the tertiary ink, the word at 15 (the
/// attention ink at 600 when hot), and the check column when the rows are the lens. All profiles' circle has nothing
/// in its middle (`BandsOptions.allProfilesRow`, the golden's), and the profiles glyph at 15 stands over it in the
/// secondary ink, the row's own (§8; the drawing's `ap-allg`, `round4/src/p4f-frames.js`).
private struct AgentProfileRowLabel: View {
  let row: AgentProfilesWords.ProfileRow
  let geometry: BandsGeometry
  let several: Bool
  let mark: (String) -> String

  static let everyGlyph: CGFloat = 15

  var body: some View {
    HStack(spacing: 12) {
      BandsDial(geometry: geometry, profile: row.profile, ground: ChromePalette.fill, mark: mark)
        .overlay {
          if row.profileId == nil {
            Image(systemName: ProfileGlyphSymbols.everyProfile)
              .font(.system(size: Self.everyGlyph * 0.8))
              .foregroundStyle(ChromePalette.inkSecondary)
              .frame(width: Self.everyGlyph, height: Self.everyGlyph)
              .accessibilityHidden(true)
          }
        }
      VStack(alignment: .leading, spacing: 1) {
        Text(row.name)
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        Text(row.line)
          .font(ChromeListType.detail)
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      if let word = row.word {
        Text(word)
          .font(.subheadline.weight(row.hot ? .semibold : .regular))
          .monospacedDigit()
          .foregroundStyle(row.hot ? ChromePalette.attention : ChromePalette.inkTertiary)
      }
      if several {
        Image(systemName: "checkmark")
          .font(.body.weight(.semibold))
          .foregroundStyle(ChromePalette.ink)
          .opacity(row.checked ? 1 : 0)
          .frame(width: 20)
          .accessibilityHidden(true)
      }
    }
    .frame(minHeight: 60)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// A Plans row: its agent's mark (18), its title (a crowded agent's wearing its profile's glyph), and under it the
/// kept reading's age and every window as Settings' C1 line, each ending in its reset's cap with its out mark under it
/// (UM-6); or the first read's
/// silhouette, or a need in words; while the field is live, its sessions and its **Show** or **Showing** (UM-5b). An
/// agent with no meter is a line of its own. The row itself takes no tap; only its button does.
private struct AgentPlanRowView: View {
  let row: AgentProfilesWords.PlanRow
  let mark: String
  let onShow: (AgentProfilesWords.PlanRow.Show) -> Void

  var body: some View {
    switch row.body {
    case .none(let said):
      HStack(spacing: 8) {
        AgentGlyph(mark: mark, letterSize: 10)
          .frame(width: 13, height: 13)
          .accessibilityHidden(true)
        Text(said)
          .font(ChromeListType.detail)
          .foregroundStyle(ChromePalette.inkTertiary)
      }
    default:
      HStack(alignment: .top, spacing: 8) {
        HStack(alignment: .top, spacing: 12) {
          AgentGlyph(mark: mark, letterSize: 13)
            .frame(width: 18, height: 18)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
              if let glyph = row.glyph {
                Image(
                  systemName: ProfileGlyphSymbols.symbol(
                    glyph: glyph.glyph, native: glyph.kind == "native", filled: glyph.filled)
                )
                .font(.system(size: 12))
                .foregroundStyle(ChromePalette.inkSecondary)
                .accessibilityLabel(glyph.label)
              }
              Text(row.title)
                .font(ChromeListType.row)
                .foregroundStyle(ChromePalette.ink)
                .lineLimit(1)
                .layoutPriority(1)
                .accessibilityLabel(row.spoken)
              // the badge is part of the plan's name: after the title, before whose it is; it never gives way, so the
              // sign-in truncates first and the title next
              if let tier = row.tier {
                PlanTierBadge(tier: tier)
                  .layoutPriority(2)
              }
              if let account = row.account {
                Text(account)
                  .font(ChromeListType.detail)
                  .foregroundStyle(ChromePalette.inkTertiary)
                  .lineLimit(1)
                  .truncationMode(.tail)
                  .accessibilityLabel(account.replacingOccurrences(of: "•••", with: "…"))
              }
            }
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            detail
            if let sessions = row.sessions {
              Text(sessions)
                .font(ChromeListType.detail)
                .monospacedDigit()
                .foregroundStyle(ChromePalette.inkTertiary)
            }
          }
        }
        .accessibilityElement(children: .combine)
        if let show = row.show {
          Spacer(minLength: 0)
          showButton(show)
        }
      }
      .padding(.vertical, 4)
    }
  }

  /// UM-5b — **Show**, or **Showing** while it is the one chosen: the row's one act, 44 tall, which closes the page. It
  /// stands outside the row's combined element so VoiceOver reaches it as a button.
  private func showButton(_ show: AgentProfilesWords.PlanRow.Show) -> some View {
    let showing = show == .showing
    let word = showing ? "Showing" : "Show"
    return Button {
      onShow(show)
    } label: {
      Text(word)
        .font(ChromeListType.detail)
        .fontWeight(showing ? .semibold : .regular)
        .foregroundStyle(showing ? ChromePalette.ink : ChromePalette.inkSecondary)
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(word) \(row.spoken)")
    .accessibilityAddTraits(showing ? .isSelected : [])
  }

  @ViewBuilder
  private var detail: some View {
    switch row.body {
    case .reading(let windows, let kept, let ages, let stale):
      if let kept {
        Text(kept)
          .font(ChromeListType.detail)
          .foregroundStyle(ChromePalette.inkTertiary)
      }
      // each line ends in its reset's cap and marks its own run-out under its bar (UM-D29, UM-D32)
      UsageLinesView(windows: windows, stale: stale, ages: ages)
    case .firstRead:
      UsageLinesView.Loading()
    case .needs(let said), .none(let said):
      Text(said)
        .font(ChromeListType.detail)
        .foregroundStyle(ChromePalette.inkTertiary)
    }
  }
}

/// DESIGN.md §8 "A plan's tier" and "The phone's corner" — a plan's tier after its title, the popover's **default** tag
/// in the phone's chrome: 10/600 in the secondary ink with tabular figures (so 100x and 500x stand the same width),
/// padded 3 6 around its one line, a capsule ringed by the strong hairline. It never gives way (`fixedSize`); a label
/// past the cap is cut inside it (`AgentProfilesWords.badgeWords`). Its tier not read beside a sibling's: the same
/// capsule's height and ring, empty and dashed with the Bands' empty ring's dash (2 3), twice as wide as it is tall.
/// VoiceOver never meets it alone: the title says the label (`PlanRow.spoken`), and the empty capsule says nothing.
private struct PlanTierBadge: View {
  static let size: CGFloat = 10
  static let inset: CGFloat = 3
  static let side: CGFloat = 6
  /// one line at the type's size inside its padding: the desktop tag's box at `line-height: 1`
  static let height: CGFloat = size + 2 * inset
  static let ring: CGFloat = 1
  static let dash: [CGFloat] = [2, 3]

  let tier: AgentProfilesWords.PlanRow.Tier

  var body: some View {
    switch tier {
    case .label(let label):
      Text(AgentProfilesWords.badgeWords(label))
        .font(.system(size: Self.size, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.inkSecondary)
        .lineLimit(1)
        .padding(.horizontal, Self.side)
        .frame(height: Self.height)
        .overlay { Capsule().strokeBorder(ChromePalette.ruleStrong, lineWidth: Self.ring) }
        .fixedSize()
        .accessibilityHidden(true)
    case .unread:
      Capsule()
        .strokeBorder(ChromePalette.ruleStrong, style: StrokeStyle(lineWidth: Self.ring, dash: Self.dash))
        .frame(width: 2 * Self.height, height: Self.height)
        .accessibilityHidden(true)
    }
  }
}
