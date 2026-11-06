import FieldDesign
import FieldMesh
import FieldProduct
import Foundation
import SwiftUI

// UM-4 (UM-D25 and UM-D26 A; DESIGN.md §8 "The phone's corner", §9 "The meters' words") — THE ME MENU'S ROW AND THE
// AGENT PROFILES PAGE. `AgentProfilesWords` is every word and choice (pure): what the row says, and every line of the
// page, from the home's meters (`MetersReading`), the lens (`ProfileLens`), the home's name and the clock. The views
// below draw what it says, in Settings' materials (`chromeList`, `chromeRows`, History's group heads).
//
// Wave 1 (UM-D14's interim, the lead's ruling 23, ‹for James›): a plan's row carries no Show or Showing and no sessions
// line, and takes no tap. A plan that needs you says where it is fixed, with no act (a phone signs in on no desktop,
// and its refresh spends no call, UM-D8).

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
    enum Body: Equatable {
      /// every window as Settings' C1 line, the kept reading's age, the reading's age said in the reset's place of each
      /// window read before its reset (`MeterWindow.passed`; nil when none was, or its time cannot be read), and the
      /// forecast's sentence
      case reading(windows: [MeterWindow], kept: String?, age: String?, forecast: String?, stale: Bool)
      /// the first reading is out
      case firstRead
      /// what it needs, said with no act
      case needs(String)
      /// "Codex shows no meter" (an agent that reports no usage), "Claude Max: usage unavailable", or — a plan no
      /// agent named, or whose reading holds no window — its title alone: its own words are ‹for James›, and "shows
      /// no meter" would be false of an agent that meters (the U3 review)
      case none(String)
    }

    let key: String
    let provider: String
    let title: String
    /// UM-D12 — a crowded agent's plan wears its profile's glyph (every plan in view)
    let glyph: MeterProfile?
    let body: Body
    var id: String { key }
  }

  /// The Me menu's row: its word and whether it runs hot.
  let menuWord: String?
  let menuHot: Bool
  /// "Read a minute ago, from studio", "Reading usage…", "studio doesn't share usage yet", "Usage unavailable"
  let read: String
  let profiles: [ProfileRow]
  /// "Plans", "Every plan", "Plans in Work"
  let plansHead: String
  let plans: [PlanRow]

  static let title = "Agent Profiles"
  static let foot = "Manage profiles in Settings → Agent Profiles. New profiles are made on a desktop."

  init(reading: MetersReading, lens: ProfileLens, home: String, now: Date) {
    let every = reading.meters(of: nil, now: now)
    let several = reading.profiles.count > 1
    let firstRead = reading.firstRead
    let menu = Self.word(every, firstRead: firstRead, notShared: reading.usage == .notShared)
    menuWord = menu.word
    menuHot = menu.hot
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
      PlanRow(
        key: entry.key, provider: entry.provider, title: entry.title,
        glyph: crowded.contains(entry.provider) ? entry.profiles.first : nil,
        body: Self.body(entry, home: home, now: now))
    }
  }

  /// The plans a circle draws: a reading, a first read, or one that needs you.
  static func onCircle(_ meters: ProfileMeters) -> Int { meters.entries.filter { $0.kind != .noMeter }.count }

  static func counted(_ count: Int, _ word: String) -> String { "\(count) \(word)\(count == 1 ? "" : "s")" }

  /// UM-D13 — a circle's word: its tightest percent ("42%"), orange when it runs hot; "reading…" while the first
  /// reading is out; nothing when nothing reads (or, for the Me menu's row, while the home does not share usage —
  /// that word is ‹for James›; the page says it).
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

  /// A plan's row below its title.
  static func body(_ entry: PlanMeter, home: String, now: Date) -> PlanRow.Body {
    switch entry.state {
    case .reading(let reading):
      return .reading(
        windows: reading.windows, kept: reading.stale ? entry.right?.words : nil,
        age: nil,  // RED STUB (UM-4d, M-phone): no window read before its reset says the reading's age yet
        forecast: reading.tightest.forecast?.long, stale: reading.stale)
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
/// materials — paper, the large title, close only (iOS 26's `role: .close`) — that rises as Settings' does. From the
/// top: the circle at 214 (a tap on a plan focuses it), the bands key, and where the reading comes from; Profiles (the
/// lens's rows, with a check, when there are several; with one, a row that takes no tap); the plans in view; the foot.
/// Opening it reads the home's profiles again (`MetersFeed.open`).
struct AgentProfilesPage: View {
  static let circle: Double = 214
  static let rowCircle: Double = 36

  let feed: MetersFeed
  @Binding var lens: ProfileLens
  /// the home's name ("studio")
  let home: String

  @State private var focus: String? = nil
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      page
        .navigationTitle(AgentProfilesWords.title)
        .navigationBarTitleDisplayMode(.large)
        .toolbar { closeItem }
    }
    .tint(ChromePalette.ink)
    .onAppear { feed.open() }
    .onChange(of: lens.profile) { focus = nil }
  }

  private var page: some View {
    let now = feed.clock()
    let reading = feed.reading
    let words = AgentProfilesWords(reading: reading, lens: lens, home: home, now: now)
    let mark = MeterCatalog(rows: reading.catalog).mark
    let several = reading.profiles.count > 1
    return List {
      Section {
        head(reading, read: words.read, now: now, mark: mark)
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
          AgentPlanRowView(row: row, mark: mark(row.provider))
        }
      } header: {
        ChromeListHead(words.plansHead)
      } footer: {
        ChromeListFoot(AgentProfilesWords.foot)
      }
      .chromeRows()
    }
    .chromeList()
  }

  /// The circle of the plans in view, the bands key, and where the reading comes from.
  private func head(_ reading: MetersReading, read: String, now: Date, mark: @escaping (String) -> String)
    -> some View
  {
    let geometry = BandsLayout.geometry(
      Self.circle, reading.meters(of: lens.profile, now: now).entries,
      .page(every: lens.profile == nil, several: reading.profiles.count > 1, focus: focus))
    return VStack(spacing: 6) {
      BandsDial(geometry: geometry, ground: ChromePalette.paper, mark: mark)
        .contentShape(Circle())
        .onTapGesture(coordinateSpace: .local) { spot in
          focus = geometry.plan(at: Double(spot.x), Double(spot.y))
        }
      BandsKey()
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
/// kept reading's age, every window as Settings' C1 line and the forecast in the attention ink; or the first read's
/// silhouette, or a need in words. An agent with no meter is a line of its own. Wave 1: it takes no tap.
private struct AgentPlanRowView: View {
  let row: AgentProfilesWords.PlanRow
  let mark: String

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
          }
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
          detail
        }
      }
      .padding(.vertical, 4)
      .accessibilityElement(children: .combine)
    }
  }

  @ViewBuilder
  private var detail: some View {
    switch row.body {
    case .reading(let windows, let kept, _, let forecast, let stale):
      if let kept {
        Text(kept)
          .font(ChromeListType.detail)
          .foregroundStyle(ChromePalette.inkTertiary)
      }
      UsageLinesView(windows: windows, stale: stale)
      if let forecast {
        Text(forecast)
          .font(ChromeListType.detail)
          .foregroundStyle(ChromePalette.attention)
      }
    case .firstRead:
      UsageLinesView.Loading()
    case .needs(let said), .none(let said):
      Text(said)
        .font(ChromeListType.detail)
        .foregroundStyle(ChromePalette.inkTertiary)
    }
  }
}
