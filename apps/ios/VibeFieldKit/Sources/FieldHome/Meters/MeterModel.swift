import FieldMesh
import FieldProduct
import Foundation

// UM-4 (track UM; UM-D16 = E "Bands", UM-D3, D4, D12, D13 and D15 at their leans, James 2026-11-06 03:11Z) — THE
// PROFILES' METERS ON THE PHONE, PURE: the desktop's meter model (`packages/field-app/src/usage/meters.ts` and its
// leaf `rules.ts`) and the part of Settings' join it reads (`panels/agents/profiles-model.ts`: `usageOf`,
// `signInState`, `accountWords`, `isHot`, `usageLines`, `resetWords`), transcribed so the phone and the desktop never
// say different things (UM-D3, one meter everywhere). It is held to the desktop's numbers by the usage bands golden
// (`packages/field-app/test/fixtures/usage/usage-bands.golden.json`, mirrored into FieldHomeTests; BandsParityTests).
//
// AR-L1: no agent is named here. The order, the names and whether an agent reports usage are the HOME's catalog
// (`agent.catalog`, `MeterCatalog`), as the desktop's are its own `AGENT_CATALOG`; a plan is titled by the company
// it is billed through (`PlanTitles`, puppeteer-views' `planTitle`).

// MARK: - The catalog the meters read

/// The home's agent catalog, as the meters read it: its order (UM-D15), its names, and which agents report usage
/// (the contracts' `isOffered(id, "usage")`: an offered status and `offers.usage`).
struct MeterCatalog: Equatable, Sendable {
  let rows: [AgentCatalogRow]

  /// The catalog's place for an agent; one the catalog has no row for stands after every row.
  func rank(_ provider: String) -> Int {
    rows.firstIndex { $0.id == provider } ?? rows.count
  }

  /// The catalog's name for an agent, or its id: a newer desktop's agent is carried, never renamed.
  func name(_ provider: String) -> String {
    rows.first { $0.id == provider }?.label ?? provider
  }

  /// The agent's mark key (the catalog's `mark`), or its id: what `AgentGlyph` draws.
  func mark(_ provider: String) -> String {
    rows.first { $0.id == provider }?.mark ?? provider
  }

  /// Whether a reading comes for an account this agent signs in to.
  func readsUsage(_ provider: String) -> Bool {
    guard let row = rows.first(where: { $0.id == provider }) else { return false }
    return Self.offered.contains(row.status) && row.offersUsage
  }

  /// `AGENT_OFFERED_STATUSES`: a deprecated row is shown and offers nothing new.
  static let offered: Set<String> = ["supported", "preview"]
}

// MARK: - The rules (rules.ts, and Settings' pace rule)

/// JavaScript's `Math.round`: halves toward +∞, so the phone rounds as the desktop does.
func roundedAsJS(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

/// A whole number as the desktop writes it ("42", never "42.0").
func wholeWords(_ value: Double) -> String { String(Int(roundedAsJS(value))) }

/// The meter's rules: Settings' pace rule (`isHot`), the window's pressure and the tightest (UM-D13), the forecast
/// (UM-D4), and how a length and a reset are said.
enum MeterRules {
  /// Settings' `resetWords` says a reset this many minutes off, or more, by its day and clock.
  static let resetByDayMinutes: Double = 24 * 60

  /// How a reset is said: as a length, by its day, or "now".
  enum ResetForm: String, Sendable { case length, day, now }

  static func resetForm(resetIn: Double?) -> ResetForm? {
    guard let resetIn else { return nil }
    if resetIn <= 0 { return .now }
    return roundedAsJS(resetIn) >= resetByDayMinutes ? .day : .length
  }

  /// The record's rule (`isHot`): orange at 100 or more; with no pace to judge, at 80 or more; else when some time
  /// has gone and it is past 40 and running more than 1.05 times ahead of it.
  static func isHot(used: Double, elapsed: Double?) -> Bool {
    if used >= 100 { return true }
    guard let elapsed else { return used >= 80 }
    return elapsed > 0 && used > 40 && used / elapsed > 1.05
  }

  /// A window's length as a person says it ("7 days", "5 hours"), or its label when it names none.
  static func windowWords(label: String, durationMinutes: Int?) -> String {
    guard let minutes = durationMinutes, minutes > 0 else { return label }
    if minutes % 1440 == 0 { return counted(minutes / 1440, "day") }
    if minutes % 60 == 0 { return counted(minutes / 60, "hour") }
    return counted(minutes, "minute")
  }

  private static func counted(_ count: Int, _ word: String) -> String {
    "\(count) \(word)\(count == 1 ? "" : "s")"
  }

  /// A length as the drawing says it: "45m", "2h 10m", "3d 4h".
  static func durationWords(_ minutes: Double) -> String {
    let whole = Int(roundedAsJS(minutes))
    if whole < 60 { return "\(max(1, whole))m" }
    if whole < 24 * 60 {
      let hours = whole / 60
      let rest = whole % 60
      return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
    }
    let hours = Int(roundedAsJS(Double(whole) / 60))
    let days = hours / 24
    let rest = hours % 24
    return rest == 0 ? "\(days)d" : "\(days)d \(rest)h"
  }

  /// A window's own name from its length: "5H", "7D" (a line under a heading).
  static func usageWindowLabel(_ minutes: Int?) -> String? {
    guard let minutes, minutes > 0 else { return nil }
    if minutes % 1440 == 0 { return "\(minutes / 1440)D" }
    if minutes % 60 == 0 { return "\(minutes / 60)H" }
    return "\(minutes)M"
  }

  /// UM-D13 — how close a window is to its limit: ahead of pace first, then spent, then the fuller. A window read
  /// before its reset presses nothing (0): what it metered is gone (rules.ts' `pressureOf`).
  static func pressure(hot: Bool, used: Double, passed: Bool = false) -> Double {
    if passed { return 0 }
    return (hot ? 1000 : 0) + (used >= 100 ? 500 : 0) + used
  }

  /// UM-D13 — whether `a` ranks above `b`: the more pressed, and at equal pressure a window still running above one
  /// read before its reset. Both press 0 at that tie (a running window at 0%), so a passed window ranks below every
  /// running window, an empty one too; equals of one kind keep their order (rules.ts' `outranks`).
  static func outranks(_ a: MeterWindow, _ b: MeterWindow) -> Bool {
    if a.pressure != b.pressure { return a.pressure > b.pressure }
    return !a.passed && b.passed
  }

  /// A reading's age as the meters say it (§9 "A reading": "as of 5m ago", "as of 3h ago"), in place of a forecast or
  /// a reset: a kept reading's, and one with a window read before its reset. Nothing when its time cannot be read,
  /// rather than words §9 does not rule (rules.ts' `ageWords`). The meters' right words say it from here.
  static func ageWords(fetchedAt: String, now: Date) -> String {
    guard let at = parseWireDate(fetchedAt) else { return "" }
    return "as of \(durationWords(max(0, (now.timeIntervalSince1970 - at.timeIntervalSince1970) / 60))) ago"
  }

  /// Settings' reset words: "2h 10m" under a day, its weekday and clock from a day on (the phone's own zone and
  /// locale, as Settings says it in the desktop's), "now" once it has passed.
  static func resetWords(at: Date, now: Date) -> String {
    let ms = (at.timeIntervalSince1970 - now.timeIntervalSince1970) * 1000
    if ms <= 0 { return "now" }
    let minutes = Int(roundedAsJS(ms / 60_000))
    if minutes < 60 { return "\(max(1, minutes))m" }
    if minutes < 24 * 60 {
      let hours = minutes / 60
      let rest = minutes % 60
      return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
    }
    // the weekday and a 24-hour clock, as Settings' `hour12: false` says it
    let formatter = DateFormatter()
    formatter.locale = .current
    formatter.setLocalizedDateFormatFromTemplate("EEEHHmm")
    return formatter.string(from: at)
  }

  /// UM-D4 — the forecast: at this pace the window is spent before it resets. Never for a budget, a window already
  /// spent, one whose length, time gone or reset is unknown, or one not ahead of pace.
  static func forecast(_ window: ForecastInput) -> MeterForecast? {
    guard !window.budget, let length = window.durationMinutes, let elapsed = window.elapsedPercent,
      let resetIn = window.resetIn
    else { return nil }
    let used = window.usedPercent
    if used >= 100 || !window.hot || elapsed <= 0 { return nil }
    let perMinute = used / ((elapsed / 100) * Double(length))
    let minutes = (100 - used) / perMinute
    if minutes >= resetIn { return nil }
    // round first (to the minute under 10, to 5 under the hour, to 15 from it), then choose the form: 57.5 to 60
    // minutes round to the hour and say "~1h", never "~60m" (rules.ts' `forecastOf`, DESIGN.md §8 "Hot, and the
    // forecast")
    let rounded =
      minutes < 10
      ? max(1, roundedAsJS(minutes))
      : minutes < 60 ? roundedAsJS(minutes / 5) * 5 : roundedAsJS(minutes / 15) * 15
    let said = rounded >= 60 ? durationWords(rounded) : "\(Int(rounded))m"
    let words = "~\(said)"
    return MeterForecast(
      minutes: minutes, words: words, short: "out in \(words)", long: "Runs out in \(words) at this pace")
  }
}

/// What the forecast reads of a window.
struct ForecastInput: Equatable, Sendable {
  var usedPercent: Double
  var elapsedPercent: Double?
  var durationMinutes: Int?
  var resetIn: Double?
  var budget: Bool
  var hot: Bool
}

/// UM-D4 — when a window runs out at this pace.
struct MeterForecast: Equatable, Sendable {
  /// minutes to the limit at this pace, unrounded
  let minutes: Double
  /// "~35m"
  let words: String
  /// "out in ~35m"
  let short: String
  /// "Runs out in ~35m at this pace"
  let long: String
}

// MARK: - A plan's name (puppeteer-views' planTitle)

/// A plan as its product sells it ("Claude Max"), as Settings' card names it: puppeteer-views' `planTitle` over its
/// `SERVICE_PRODUCTS` (`icons/ServiceMark.js`, 0.3.3), keyed by the company a sign-in is billed through — never by
/// an agent. A company it has no product for is said by its own label.
enum PlanTitles {
  static let products: [String: String] = [
    "anthropic": "Claude", "openai": "ChatGPT", "xai": "Grok", "github": "Copilot", "google": "Google AI",
    "kimi": "Kimi", "nous": "Nous Portal", "opencode": "OpenCode", "openrouter": "OpenRouter", "meta": "Meta AI",
  ]

  /// "Claude Max", "ChatGPT Pro", "SuperGrok" (a label that names the product stands alone), the product alone when
  /// no plan was reported ("Kimi").
  static func title(service: AgentSignInService, plan: String?) -> String {
    let product = products[service.id] ?? service.label
    let words = plan.map(planWords) ?? ""
    if words.isEmpty { return product }
    let first = product.split(whereSeparator: \.isWhitespace).first.map { $0.lowercased() } ?? ""
    return words.lowercased().contains(first) ? words : "\(product) \(words)"
  }

  /// An agent's own token spelt out ("max" → "Max", "individual_pro" → "Individual Pro"); a cased label stays.
  private static func planWords(_ plan: String) -> String {
    let trimmed = plan.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed != trimmed.lowercased() { return trimmed }
    return
      trimmed
      .split { $0.isWhitespace || $0 == "_" || $0 == "-" }
      .map { word in word.prefix(1).uppercased() + word.dropFirst() }
      .joined(separator: " ")
  }

  /// Settings' card's title: the product's name for the plan once an agent named its account, the product alone
  /// before.
  static let settings: PlanTitle = { plan, named in
    title(service: plan.service, plan: named ? plan.account?.plan : nil)
  }
}

/// How a plan is titled, given whether an agent named its account.
typealias PlanTitle = @Sendable (AgentPlan, Bool) -> String

// MARK: - The meters (meters.ts)

/// Settings' C1 line for one window (`UsageLine`).
struct UsageLine: Equatable, Sendable {
  struct Group: Equatable, Sendable {
    let id: String
    let label: String
  }

  let id: String
  /// the adapter's short label ("5H"); under a heading, the window alone ("7D")
  let label: String
  let group: Group?
  let usedPercent: Double
  /// where now sits, when the window's length is known
  let elapsedPercent: Double?
  /// "2h 10m", "Thu 09:00"
  let reset: String?
  /// a reset closes the track (a window, not a budget)
  let resets: Bool
  let hot: Bool
}

/// UM-D15's groups.
enum MeterKind: String, Sendable {
  case reading
  case firstRead = "first-read"
  case needsYou = "needs-you"
  case noMeter = "no-meter"
}

/// What a plan that needs you asks for.
enum MeterNeed: String, Sendable {
  case signIn = "sign-in"
  case signingIn = "signing-in"
  case retry
}

/// Why a plan shows no meter.
enum NoMeterReason: String, Sendable {
  case unnamed
  case unreported
  case noWindows = "no-windows"
  case unavailable
}

/// One window of a reading, as the meters draw it.
struct MeterWindow: Equatable, Sendable {
  let metric: AgentAccountUsageMetric
  /// Settings' C1 line; a budget's is pace-less
  let line: UsageLine
  let budget: Bool
  /// "7 days", "5 hours"
  let lengthWords: String
  /// minutes to the reset, unrounded (negative once it has passed); nil for a window naming none and for a budget
  let resetIn: Double?
  /// its `resetsAt` is at or before now, whether its reset came before or after its reading: what it metered is
  /// gone, so it is never hot, has no forecast, presses 0 and ranks below every running window (`outranks`), and its
  /// fill draws at the kept half (DESIGN.md §8 "A window read before its reset"; ‹for James›)
  let passed: Bool
  /// UM-D13's rank: 0 once passed
  let pressure: Double
  let forecast: MeterForecast?

  var resetForm: MeterRules.ResetForm? { MeterRules.resetForm(resetIn: resetIn) }
}

/// The words at a meter's right.
struct MeterRight: Equatable, Sendable {
  /// `kept`: a reading kept after a failed refresh; `passed`: one with a window read before its reset. Both say the
  /// reading's age.
  enum Kind: String, Sendable { case forecast, reset, kept, passed, reading, need, none }
  let kind: Kind
  let words: String
  /// said in the attention ink
  let hot: Bool
  /// the reset's mark before the words
  let icon: Bool
}

/// A profile a meter is in, as its glyph draws it and as it is named.
struct MeterProfile: Equatable, Sendable {
  let setId: String
  let kind: String
  let glyph: String?
  /// the default profile's glyph is filled
  let filled: Bool
  let label: String
}

/// A reading's facts.
struct MeterReading: Equatable, Sendable {
  let windows: [MeterWindow]
  /// UM-D13 — the window closest to its limit
  let tightest: MeterWindow
  let hot: Bool
  /// the last good reading, kept after a refresh failed
  let stale: Bool
  let fetchedAt: String
}

/// One plan's meter (or an agent's on no plan).
struct PlanMeter: Equatable, Sendable {
  enum State: Equatable, Sendable {
    case reading(MeterReading)
    case firstRead
    case needsYou(MeterNeed)
    case noMeter(NoMeterReason)
  }

  struct Plan: Equatable, Sendable {
    let id: String
    let service: AgentSignInService
    let account: String?
  }

  /// `plan:<id>` or `agent:<profileId>`; in the union, the first profile holding it, a slash, then that
  var key: String
  /// the agent whose mark it wears
  let provider: String
  /// the catalog's name for it
  let agent: String
  /// the plan as Settings names it, or the agent's name
  let title: String
  let profileId: String?
  let plan: Plan?
  /// the profiles it is in
  var profiles: [MeterProfile]
  let state: State
  /// the words at its right (none for a plan with no meter)
  let right: MeterRight?

  var kind: MeterKind {
    switch state {
    case .reading: return .reading
    case .firstRead: return .firstRead
    case .needsYou: return .needsYou
    case .noMeter: return .noMeter
    }
  }

  var reading: MeterReading? {
    guard case .reading(let reading) = state else { return nil }
    return reading
  }

  var need: MeterNeed? {
    guard case .needsYou(let need) = state else { return nil }
    return need
  }

  var why: NoMeterReason? {
    guard case .noMeter(let why) = state else { return nil }
    return why
  }

  /// Settings' pace rule on its tightest window
  var hot: Bool { reading?.hot ?? false }

  /// a first read, or a sign-in under way: nothing to read yet, nothing to ask
  var waiting: Bool { kind == .firstRead || need == .signingIn }
}

/// One profile's meters, or every profile's.
struct ProfileMeters: Equatable, Sendable {
  /// UM-D15's order
  let entries: [PlanMeter]
  /// UM-D13 — the plan whose tightest window is the most pressed
  let tightest: PlanMeter?
  /// some plan runs hot: the circle's dot
  let hot: Bool
}

/// What the meters are asked with.
struct MetersOptions: Sendable {
  /// the home's catalog
  var catalog: MeterCatalog
  /// This Mac's agents as Settings lists them; nil, every agent
  var installed: Set<String>? = nil
  var title: PlanTitle = PlanTitles.settings
  /// false when the home's usage door could not answer (ruling 10; ruling 17's home that does not share usage)
  var usageReadable: Bool = true
}

enum MeterModel {
  // Settings' join (profiles-model.ts)

  /// The reading that belongs to a sign-in: its own row, or — for an agent's own folder — the unkeyed row.
  static func usageOf(_ rows: [AgentAccountUsageEntry], _ persona: AgentPersona) -> AgentAccountUsageEntry? {
    rows.first { entry in
      entry.provider == persona.provider
        && (entry.profileId == persona.profileId || (persona.kind == "native-default" && entry.profileId == nil))
    }
  }

  enum SignInState { case signingIn, unread, signedOut, expired, signedIn }

  static func signInState(_ persona: AgentPersona, _ usage: AgentAccountUsageEntry?) -> SignInState {
    if persona.signingIn { return .signingIn }
    guard let identity = persona.identity else { return .unread }
    if !identity.loggedIn { return .signedOut }
    return usage?.state == .unauthenticated ? .expired : .signedIn
  }

  /// "kim@work.example · Northlight", or nil when nobody is named; an organisation named after the account adds
  /// nothing.
  static func accountWords(_ account: AgentPlanAccount?) -> String? {
    guard let account, let who = account.account ?? account.email else { return nil }
    guard let organization = account.organization else { return who }
    let echoes = [account.email, account.account].contains { name in
      name.map { organization.lowercased().hasPrefix($0.lowercased()) } ?? false
    }
    return echoes ? who : "\(who) · \(organization)"
  }

  /// A standby allowance stays out of sight until it is in play.
  private static func inPlay(_ metric: AgentAccountUsageMetric, _ all: [AgentAccountUsageMetric]) -> Bool {
    guard let group = metric.group, group.standby == true else { return true }
    if all.contains(where: { $0.group?.id == group.id && $0.usedPercent > 0 }) { return true }
    return all.contains { $0.group == nil && $0.kind != "budget" && $0.usedPercent >= 100 }
  }

  /// Settings' C1 lines: the windows in play, in the adapter's order.
  static func usageLines(_ metrics: [AgentAccountUsageMetric], now: Date) -> [UsageLine] {
    metrics.filter { inPlay($0, metrics) }.map { metric in
      let resetsAt = parseWireDate(metric.resetsAt)
      var elapsed: Double?
      if let minutes = metric.durationMinutes, let resetsAt {
        let window = Double(minutes) * 60_000
        let left = (resetsAt.timeIntervalSince1970 - now.timeIntervalSince1970) * 1000
        elapsed = min(100, max(0, (1 - left / window) * 100))
      }
      let budget = metric.kind == "budget"
      return UsageLine(
        id: metric.id,
        label: (metric.group != nil ? MeterRules.usageWindowLabel(metric.durationMinutes) : nil) ?? metric.label,
        group: metric.group.map { UsageLine.Group(id: $0.id, label: $0.label) },
        usedPercent: metric.usedPercent,
        elapsedPercent: elapsed,
        reset: resetsAt != nil && !budget ? resetsAt.map { MeterRules.resetWords(at: $0, now: now) } : nil,
        resets: !budget && resetsAt != nil,
        hot: MeterRules.isHot(used: metric.usedPercent, elapsed: elapsed))
    }
  }

  // The meters (meters.ts)

  /// A reading's windows as the meters draw them; a budget's line is pace-less, and one read before its reset is
  /// unlit.
  static func meterWindows(_ metrics: [AgentAccountUsageMetric], now: Date) -> [MeterWindow] {
    var byId: [String: AgentAccountUsageMetric] = [:]
    for metric in metrics where byId[metric.id] == nil { byId[metric.id] = metric }
    return usageLines(metrics, now: now).compactMap { settings in
      guard let metric = byId[settings.id] else { return nil }
      let budget = metric.kind == "budget"
      let paced =
        budget
        ? UsageLine(
          id: settings.id, label: settings.label, group: settings.group, usedPercent: settings.usedPercent,
          elapsedPercent: nil, reset: settings.reset, resets: settings.resets,
          hot: MeterRules.isHot(used: settings.usedPercent, elapsed: nil))
        : settings
      var resetIn: Double?
      if paced.resets, let at = parseWireDate(metric.resetsAt) {
        resetIn = (at.timeIntervalSince1970 - now.timeIntervalSince1970) / 60
      }
      // read before its reset (DESIGN.md §8 "A window read before its reset"): its reset is at or before now, whether
      // it came before or after the reading, so what it metered is gone and it runs ahead of nothing. Only its orange
      // leaves Settings' line; its words and its now line stand (meters.ts' `meterWindows`).
      let passed = resetIn.map { $0 <= 0 } ?? false
      let line =
        passed
        ? UsageLine(
          id: paced.id, label: paced.label, group: paced.group, usedPercent: paced.usedPercent,
          elapsedPercent: paced.elapsedPercent, reset: paced.reset, resets: paced.resets, hot: false)
        : paced
      let forecast = MeterRules.forecast(
        ForecastInput(
          usedPercent: line.usedPercent, elapsedPercent: line.elapsedPercent, durationMinutes: metric.durationMinutes,
          resetIn: resetIn, budget: budget, hot: line.hot))
      return MeterWindow(
        metric: metric, line: line, budget: budget,
        lengthWords: MeterRules.windowWords(label: metric.label, durationMinutes: metric.durationMinutes),
        resetIn: resetIn, passed: passed,
        pressure: MeterRules.pressure(hot: line.hot, used: line.usedPercent, passed: passed), forecast: forecast)
    }
  }

  /// UM-D13 — the most pressed of `items` by a window of each, one still running before one read before its reset
  /// (`MeterRules.outranks`), the first of equals (rules.ts' `tightestOf`).
  static func mostPressed<T>(_ items: [T], window: (T) -> MeterWindow) -> T? {
    var best: (item: T, window: MeterWindow)?
    for item in items {
      let each = window(item)
      if let held = best, !MeterRules.outranks(each, held.window) { continue }
      best = (item, each)
    }
    return best?.item
  }

  private static let needWords: [MeterNeed: String] = [
    .signIn: "not signed in", .signingIn: "signing in…", .retry: "couldn't read",
  ]

  static func profileOf(_ set: AgentProfileSet) -> MeterProfile {
    MeterProfile(setId: set.id, kind: set.kind, glyph: set.glyph, filled: set.isDefault, label: set.label)
  }

  private static func rightOf(
    _ windows: [MeterWindow], _ window: MeterWindow, stale: Bool, fetchedAt: String, now: Date
  ) -> MeterRight {
    // a kept reading says its age, and so does one with a window read before its reset (DESIGN.md §8 "A window read
    // before its reset"): a forecast or a reset read from it would claim a reading it is not
    if stale || windows.contains(where: { $0.passed }) {
      return MeterRight(
        kind: stale ? .kept : .passed, words: MeterRules.ageWords(fetchedAt: fetchedAt, now: now), hot: false,
        icon: false)
    }
    if let forecast = window.forecast {
      return MeterRight(kind: .forecast, words: forecast.short, hot: true, icon: false)
    }
    guard let reset = window.line.reset else {
      return MeterRight(kind: .none, words: "", hot: window.line.hot, icon: false)
    }
    return MeterRight(kind: .reset, words: reset, hot: window.line.hot, icon: true)
  }

  private struct Base {
    let key: String
    let provider: String
    let agent: String
    let title: String
    let profileId: String?
    let plan: PlanMeter.Plan?
    let profiles: [MeterProfile]

    func meter(_ state: PlanMeter.State, right: MeterRight? = nil) -> PlanMeter {
      PlanMeter(
        key: key, provider: provider, agent: agent, title: title, profileId: profileId, plan: plan,
        profiles: profiles, state: state, right: right)
    }
  }

  /// A sign-in's meter, read as Settings' card reads it.
  private static func readOf(
    _ base: Base, _ persona: AgentPersona, _ rows: [AgentAccountUsageEntry], now: Date, _ options: MetersOptions
  ) -> PlanMeter {
    if !options.usageReadable {
      return base.meter(.noMeter(options.catalog.readsUsage(persona.provider) ? .unavailable : .unreported))
    }
    let usage = usageOf(rows, persona)
    let state = signInState(persona, usage)
    func needs(_ need: MeterNeed) -> PlanMeter {
      base.meter(
        .needsYou(need), right: MeterRight(kind: .need, words: needWords[need] ?? "", hot: false, icon: false))
    }
    if state == .expired { return needs(.signIn) }
    if let usage, usage.state == .available || usage.stale == true, !usage.metrics.isEmpty {
      let windows = meterWindows(usage.metrics, now: now)
      guard let tightest = mostPressed(windows, window: { $0 }) else {
        return base.meter(.noMeter(.noWindows))
      }
      let stale = usage.stale == true
      return base.meter(
        .reading(
          MeterReading(
            windows: windows, tightest: tightest, hot: tightest.line.hot, stale: stale, fetchedAt: usage.fetchedAt)),
        right: rightOf(windows, tightest, stale: stale, fetchedAt: usage.fetchedAt, now: now))
    }
    if state == .signingIn { return needs(.signingIn) }
    if state == .signedOut || usage?.state == .unauthenticated { return needs(.signIn) }
    guard let usage else {
      return options.catalog.readsUsage(persona.provider)
        ? base.meter(.firstRead, right: MeterRight(kind: .reading, words: "reading…", hot: false, icon: false))
        : base.meter(.noMeter(.unreported))
    }
    if usage.state == .unsupported { return base.meter(.noMeter(.unreported)) }
    if usage.state == .available { return base.meter(.noMeter(.noWindows)) }
    return needs(.retry)
  }

  private static func planEntry(
    _ set: AgentProfileSet, _ plan: AgentPlan, holder: AgentPersona, _ rows: [AgentAccountUsageEntry], now: Date,
    _ options: MetersOptions
  ) -> PlanMeter {
    let namer = set.personas.first { $0.profileId == plan.namedBy }
    let account = accountWords(plan.account)
    let provider = (namer ?? holder).provider
    let base = Base(
      key: "plan:\(plan.id)", provider: provider, agent: options.catalog.name(provider),
      title: options.title(plan, account != nil), profileId: namer?.profileId,
      plan: PlanMeter.Plan(id: plan.id, service: plan.service, account: account), profiles: [profileOf(set)])
    guard account != nil, let namer else { return base.meter(.noMeter(.unnamed)) }
    return readOf(base, namer, rows, now: now, options)
  }

  private static let groupRank: [MeterKind: Int] = [.reading: 0, .firstRead: 0, .needsYou: 1, .noMeter: 2]

  /// UM-D15's order (stable: equals keep the order given), UM-D13's tightest plan and the hot rule.
  private static func metersOf(_ ranked: [(entry: PlanMeter, rank: Int)], _ catalog: MeterCatalog) -> ProfileMeters {
    let entries = ranked.enumerated().sorted { a, b in
      let (x, y) = (a.element, b.element)
      let groups = (groupRank[x.entry.kind] ?? 0, groupRank[y.entry.kind] ?? 0)
      if groups.0 != groups.1 { return groups.0 < groups.1 }
      let places = (catalog.rank(x.entry.provider), catalog.rank(y.entry.provider))
      if places.0 != places.1 { return places.0 < places.1 }
      if x.rank != y.rank { return x.rank < y.rank }
      return a.offset < b.offset
    }.map { $0.element.entry }
    let readings = entries.compactMap { entry in entry.reading.map { (entry: entry, window: $0.tightest) } }
    let tightest = mostPressed(readings, window: { $0.window })?.entry
    return ProfileMeters(entries: entries, tightest: tightest, hot: entries.contains { $0.hot })
  }

  /// One profile's meters: every plan its agents run on (each once), and every agent of it on no plan, read through
  /// Settings' join, in UM-D15's order.
  static func planMeters(
    _ set: AgentProfileSet, rows: [AgentAccountUsageEntry], now: Date, options: MetersOptions
  ) -> ProfileMeters {
    let listed = set.personas.filter { persona in
      set.kind != "native" || options.installed == nil || options.installed?.contains(persona.provider) == true
        || persona.signingIn
    }
    let shown = Dictionary(listed.map { ($0.profileId, $0) }, uniquingKeysWith: { _, last in last })
    var holding = Set<String>()
    var found: [PlanMeter] = []
    for plan in set.plans ?? [] {
      guard let holder = plan.holders.lazy.compactMap({ shown[$0] }).first else { continue }
      holding.formUnion(plan.holders)
      found.append(planEntry(set, plan, holder: holder, rows, now: now, options))
    }
    for persona in listed where !holding.contains(persona.profileId) {
      let agent = options.catalog.name(persona.provider)
      let base = Base(
        key: "agent:\(persona.profileId)", provider: persona.provider, agent: agent, title: agent,
        profileId: persona.profileId, plan: nil, profiles: [profileOf(set)])
      found.append(readOf(base, persona, rows, now: now, options))
    }
    return metersOf(found.map { (entry: $0, rank: 0) }, options.catalog)
  }

  /// Ruling 7 (AO-D14) — a profile stands on a circle unless it is a draft no agent has signed in to yet.
  static func hasCircle(_ set: AgentProfileSet) -> Bool {
    !set.draft || set.personas.contains { $0.identity?.loggedIn == true }
  }

  /// Which plan of another profile is this one: the same company and account, or the same borrowed sign-in.
  private static func sharedKey(_ plan: AgentPlan) -> String? {
    let who = (plan.account?.account ?? plan.account?.email)?
      .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if let who, !who.isEmpty { return "named\u{0}\(plan.service.id)\u{0}\(who)" }
    if let borrowed = plan.borrowedFrom { return "via\u{0}\(plan.service.id)\u{0}\(borrowed)" }
    return nil
  }

  private static let shownFirst: [MeterKind: Int] = [.reading: 0, .firstRead: 1, .needsYou: 2, .noMeter: 3]

  /// UM-D12 — every profile's meters at once: a plan two profiles share is ONE entry that is in both, its meter the
  /// better of the two readings; a profile with no circle is left out.
  static func everyPlan(
    _ sets: [AgentProfileSet], rows: [AgentAccountUsageEntry], now: Date, options: MetersOptions
  ) -> ProfileMeters {
    struct Held {
      var entry: PlanMeter
      let key: String
      var sets: [AgentProfileSet]
      let shared: String?
      let first: Int
    }
    var held: [Held] = []
    for (index, set) in sets.filter(hasCircle).enumerated() {
      for entry in planMeters(set, rows: rows, now: now, options: options).entries {
        let plan = entry.plan.flatMap { meter in (set.plans ?? []).first { $0.id == meter.id } }
        let shared = plan.flatMap(sharedKey)
        if let plan, let shared,
          let same = held.firstIndex(where: { other in
            other.shared == shared && other.sets.contains { plan.alsoIn.contains($0.id) }
          })
        {
          held[same].sets.append(set)
          if (shownFirst[entry.kind] ?? 3) < (shownFirst[held[same].entry.kind] ?? 3) { held[same].entry = entry }
          continue
        }
        held.append(Held(entry: entry, key: "\(set.id)/\(entry.key)", sets: [set], shared: shared, first: index))
      }
    }
    let ranked = held.map { each -> (entry: PlanMeter, rank: Int) in
      var entry = each.entry
      let managed = each.sets.filter { $0.kind != "native" }
      entry.key = each.key
      entry.profiles = (managed.isEmpty ? each.sets : managed).map(profileOf)
      return (entry, each.first)
    }
    return metersOf(ranked, options.catalog)
  }
}
