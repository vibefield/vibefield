import FieldDesign
import FieldHistory
import FieldProduct
import SwiftUI

// IOS-12f (PC-D8 A; NS-D1 A, NS-D2 B, NS-D5; DESIGN.md §8 "The phone's Chat", New spark; §9 "Chat on the phone") — THE
// NEW SPARK SHEET on the phone: the Mac's sheet (`NewSparkSheet.tsx` and `NewSparkSheetView.tsx`) at touch pitch, in
// the system's sheet at its large detent, on the paper. The sky deals the face; the name holds a free star; the agent
// pill pulls down the system's menu; "Runs on studio, your home" is said, not asked; the profiles' chips stand once
// the home has more than Default; Cancel and Create stand at the foot. Every ask is the home's, on Chat's door (VF-PM
// 13:11:45Z), and every word is §9's. The sky is the hatch (FieldDesign's `HatchSkyView`, f5): a star falls at an
// angle and the face is born where it lands; ↻ deals again. Created (f6), the face flies from the sky to its row in
// Chat's list as the sheet folds, and then Chat opens its thread (`NewSparkLanding`).

/// The sheet's controller (the Mac's `NewSparkSheet.tsx`): what it read as it opened, what the person chose, the
/// picker of the agent it thinks with, and the refusal said where it asked. Its choices are `NewSpark`'s.
@MainActor
@Observable
final class NewSparkSheet {
  var name: String
  private(set) var seed: UInt32
  private(set) var agents: [SparkAgent] = []
  private(set) var sets: [AgentProfileSet] = []
  private(set) var agentId: String?
  private(set) var thinksUnder: String?
  private(set) var profiles: [String] = []
  /// Each agent's picker under the profile it thinks under, as it was read (`agent.models`).
  private(set) var pickers: [String: ModelsReading] = [:]
  private(set) var selection: AgentModelSelection?
  private(set) var creating = false
  private(set) var refusal: SheetRefusal?
  /// Both reads have returned: the agents and the profiles stand, or a failed one is said at the foot.
  private(set) var opened = false

  init(taken: [String], random: () -> Double = { Double.random(in: 0..<1) }) {
    name = NewSpark.suggestName(taken)
    seed = NewSpark.dealSeed(random())
  }

  // MARK: What it holds

  var agent: SparkAgent? { agents.first { $0.id == agentId } }
  /// The chosen agent's picker key: its id and the profile it thinks under, once both are known and it can be a spark.
  var pickerKey: String? {
    guard let agentId, let thinksUnder, agent?.takes == true else { return nil }
    return "\(agentId)\u{1F}\(thinksUnder)"
  }
  var picker: ModelsReading? { pickerKey.flatMap { pickers[$0] } }
  var model: AgentModelChoice? {
    guard case .read(let answer)? = picker else { return nil }
    return answer.catalog?.models.first { $0.id == selection?.modelId }
  }
  var under: String? { NewSpark.under(sets, thinksUnder: thinksUnder) }
  var seen: [String] { NewSpark.seen(profiles, thinksUnder: thinksUnder) }
  var menu: [AgentMenuRow] {
    NewSpark.menu(agents, chosen: agentId, picker: picker, selection: selection, under: under)
  }
  var effort: EffortChoice? { NewSpark.effort(model, selection) }
  var line: String { NewSpark.agentLine(agent, model, selection) }
  var manyProfiles: Bool { sets.count > 1 }
  var chips: [ProfileChip] { NewSpark.profileChips(sets, chosen: profiles, thinksUnder: thinksUnder) }
  /// What Create needs is read: the agent it thinks with and the profile it thinks under (item 149).
  var ready: Bool { agentId != nil && thinksUnder != nil }
  var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  var canCreate: Bool { ready && !creating && !trimmed.isEmpty }

  /// The line under the chips, over the person's live sessions on the home (nil until the board is read).
  func reach(_ sessions: [RunProfileFacts]?) -> String {
    NewSpark.reach(
      NewSpark.sessionsSeen(sessions, sets: sets, chosen: seen),
      starts: NewSpark.starts(sets, chosen: profiles, thinksUnder: thinksUnder, agents: agents))
  }

  // MARK: Its reads

  /// The two reads, once, as it opens (or as the home answers again): the agents and the profiles together.
  func open(on feed: ChatFeed) async {
    guard !opened else { return }
    async let offered = try? feed.providers()
    async let listed = try? feed.profileSets()
    let read = await (offered.map(NewSpark.sparkAgents), listed)
    let opening = NewSpark.opening(agents: read.0, sets: read.1)
    agents = read.0 ?? []
    sets = read.1 ?? []
    if agentId == nil { agentId = opening.agent }
    if thinksUnder == nil { thinksUnder = opening.thinksUnder }
    if profiles.isEmpty { profiles = opening.profiles }
    if let refused = opening.refusal { refusal = refused }
    opened = true
  }

  /// The chosen agent's picker, read once per agent and profile. A system menu says nothing as it opens, so the phone
  /// reads it as soon as the agent and the profile are known, where the Mac reads it as its menu first opens.
  func readPicker(on feed: ChatFeed) async {
    guard let key = pickerKey, let agentId, let thinksUnder, pickers[key] == nil else { return }
    pickers[key] = .reading
    do {
      pickers[key] = .read(try await feed.models(provider: agentId, profileSet: thinksUnder))
    } catch {
      pickers[key] = .failed(Self.words(error))
    }
  }

  // MARK: What the person does

  /// The name as typed: at most 32 characters (`SparkName`), and a refusal under it goes once it changes.
  func named() {
    if name.count > 32 { name = String(name.prefix(32)) }
    if refusal?.at == .name { refusal = nil }
  }

  /// ↻: another face; the name stays (NS-D2 B).
  func reroll(_ random: () -> Double = { Double.random(in: 0..<1) }) {
    seed = NewSpark.dealSeed(random())
  }

  func choose(agent id: String) {
    agentId = id
    selection = nil
  }

  /// A model of the picker, or nil for the agent's own.
  func choose(model id: String?) {
    selection = id.map { AgentModelSelection(modelId: $0) }
    if refusal?.at == .agent { refusal = nil }
  }

  func choose(effort value: String) {
    guard let selection, let control = model?.effort else { return }
    var controls = selection.controls
    controls[control.id] = value
    self.selection = AgentModelSelection(modelId: selection.modelId, controls: controls, custom: selection.custom)
  }

  /// A chip pressed: checked or not, but never the one it thinks under.
  func toggle(profile id: String) {
    guard id != thinksUnder else { return }
    if profiles.contains(id) { profiles.removeAll { $0 == id } } else { profiles.append(id) }
    if refusal?.at == .profiles { refusal = nil }
  }

  /// Create: the hatch on the home with what the sheet holds. Made, the spark; refused, the refusal is said where the
  /// sheet asked (fieldd's reason), in the phone's words for a profile (Default).
  func create(on feed: ChatFeed) async -> SparkSummary? {
    let name = trimmed
    guard !name.isEmpty, let agentId, let thinksUnder, !creating else { return nil }
    creating = true
    refusal = nil
    do {
      return try await feed.hatch(
        SparkHatchParams(
          name: name, seed: seed, agent: agentId, modelSelection: selection, profiles: seen,
          thinksUnder: thinksUnder))
    } catch {
      creating = false
      let fieldd = error as? FieldProductError
      let profile = sets.first(where: { $0.id == thinksUnder }).map(NewSpark.label)
      refusal = NewSpark.refusal(
        reason: fieldd?.details?["reason"]?.stringValue, message: Self.words(error),
        ask: RefusalAsk(name: name, agent: agent?.label, profile: profile))
      return nil
    }
  }

  /// An error in the door's words.
  static func words(_ error: Error) -> String {
    (error as? FieldProductError)?.message ?? error.localizedDescription
  }
}

/// IOS-12f's f6 (PC-D8 A, Q2, Q3, Q5; DESIGN.md §8 "The phone's Chat", Created) — CREATE'S ORDER, the Mac's `create`
/// (NewSparkSheet.tsx :218–250) where the phone allows:
/// - made, Chat's list reads again (the feed's hatch asks it), and the new row's own face waits, unseen;
/// - the new spark's row says where its face is, within 1,500 ms (the Mac's ROW_WAIT_MS);
/// - in that tick the hero leaves the sky for the flight window and the sheet folds, and the face flies 660 ms;
/// - landed, the face is the row's: the phone draws one face, never two (Q3). Then Chat opens the thread.
/// No row within the wait: nothing flies, the sheet folds, and the thread opens on the row. Under reduced motion, or
/// where nothing can fly: the sheet folds, the row's face fades in on plainEase(0.32), then the thread opens.
@MainActor
@Observable
final class NewSparkLanding {
  /// The new row's own face while its spark lands.
  enum Face: Equatable {
    /// Unseen: its row is awaited, or the face flies to it.
    case waits
    /// Fading in, where nothing flies.
    case fades
  }

  /// What the sheet and Chat do as a spark lands.
  struct Steps {
    /// The hero leaves the sky (`HatchSkyHero.take`): its place in the window, or nil with no face to give.
    let hero: @MainActor () -> SparkFlight.Start?
    /// The sheet folds.
    let fold: @MainActor () -> Void
    /// Chat opens the spark's thread.
    let open: @MainActor (String) -> Void
  }

  /// The row awaited: the spark, the landing that waits on it, and its wait's end.
  private struct Awaited {
    let spark: String
    let resume: CheckedContinuation<CGRect?, Never>
    let timer: Task<Void, Never>
  }

  /// The flight window, or nil where nothing can fly (`SparkFlightWindow.make`).
  let flying: (any SparkFlying)?
  let rowWait: Duration
  let fadeWait: Duration
  private var faces: [String: Face] = [:]
  /// Each row's face box in the window's space, as it last said.
  @ObservationIgnored private var boxes: [String: CGRect] = [:]
  @ObservationIgnored private var awaited: Awaited?

  /// `rowWait` is the Mac's ROW_WAIT_MS, and `fadeWait` the row's fade, plainEase(0.32).
  init(flying: (any SparkFlying)?, rowWait: Duration = .milliseconds(1_500), fadeWait: Duration = .milliseconds(320)) {
    self.flying = flying
    self.rowWait = rowWait
    self.fadeWait = fadeWait
  }

  /// The row's own face while its spark lands; nil for every other row, and once it has landed.
  func face(of spark: String) -> Face? { faces[spark] }

  /// A row's face says where it is, at each change of its box: the landing that awaits it goes on.
  func row(_ spark: String, box: CGRect) {
    boxes[spark] = box
    guard let awaited, awaited.spark == spark else { return }
    self.awaited = nil
    awaited.timer.cancel()
    awaited.resume.resume(returning: box)
  }

  /// Create pressed: the hatch with what the sheet holds (`NewSparkSheet.create`); made, the spark lands. Refused,
  /// the refusal stands where the sheet asked, and nothing flies.
  func create(_ sheet: NewSparkSheet, on feed: ChatFeed, reducedMotion: Bool, cut: SIMD3<Double>, steps: Steps) async {
    guard let made = await sheet.create(on: feed) else { return }
    await land(made, reducedMotion: reducedMotion, cut: cut, steps: steps)
  }

  /// Made: the row's face waits and its row is awaited; then the face flies to it as the sheet folds, or nothing
  /// flies. Returns once the face is in flight, or once the thread is open. `cut` is the ground behind the row.
  func land(_ made: SparkSummary, reducedMotion: Bool, cut: SIMD3<Double>, steps: Steps) async {
    let spark = made.id
    faces[spark] = .waits
    guard let box = await box(of: spark) else {
      faces[spark] = nil
      steps.fold()
      steps.open(spark)
      return
    }
    if !reducedMotion, let flying, let from = steps.hero(),
      flying.fly(
        seed: made.seed, from: from, cut: cut, to: { [weak self] in self?.boxes[spark] ?? box },
        landed: { [weak self] in self?.landed(spark, open: steps.open) })
    {
      // the fold runs under the flight, from its tick
      steps.fold()
      return
    }
    steps.fold()
    withAnimation(FieldMotion.plainEase(0.32)) { faces[spark] = .fades }
    try? await Task.sleep(for: fadeWait)
    faces[spark] = nil
    steps.open(spark)
  }

  /// Landed: the face is the row's, and its thread opens.
  private func landed(_ spark: String, open: @MainActor (String) -> Void) {
    faces[spark] = nil
    open(spark)
  }

  /// The row's face box once it says it, or nil past the wait.
  private func box(of spark: String) async -> CGRect? {
    if let box = boxes[spark] { return box }
    let wait = rowWait
    return await withCheckedContinuation { resume in
      // a landing still awaiting its row waits no more: one sheet makes one spark at a time
      if let before = awaited {
        before.timer.cancel()
        before.resume.resume(returning: nil)
      }
      let timer = Task { [weak self] in
        guard (try? await Task.sleep(for: wait)) != nil else { return }
        self?.expire(spark)
      }
      awaited = Awaited(spark: spark, resume: resume, timer: timer)
    }
  }

  private func expire(_ spark: String) {
    guard let awaited, awaited.spark == spark else { return }
    self.awaited = nil
    awaited.resume.resume(returning: nil)
  }
}

/// The agent menu's sections (§8): each agent its own, the chosen one holding its rows under its head.
struct NewSparkMenuSection: Identifiable {
  let agent: SparkAgent
  let under: String?
  /// the chosen agent's rows under its head; none for any other
  let rows: [AgentMenuRow]
  var id: String { agent.id }

  /// The menu's rows, one section per agent's head.
  static func of(_ rows: [AgentMenuRow]) -> [NewSparkMenuSection] {
    var sections: [NewSparkMenuSection] = []
    for row in rows {
      if case .agent(let agent, let under) = row {
        sections.append(NewSparkMenuSection(agent: agent, under: under, rows: []))
      } else if let last = sections.popLast() {
        sections.append(NewSparkMenuSection(agent: last.agent, under: last.under, rows: last.rows + [row]))
      }
    }
    return sections
  }
}

/// The sheet (§8): the sky, the name and ↻, the agent pill or the home away, Runs on, the profiles, the foot.
struct NewSparkSheetView: View {
  let feed: ChatFeed
  /// The home's name, as Chat says it.
  let homeName: String
  /// The home away (PC-L4): its line stands in the pill's place, and Create waits.
  let away: ChatAway?
  /// The person's live sessions on the home; nil until the board is read.
  let sessions: [RunProfileFacts]?
  /// IOS-12f's f6 — Create's order, and where Chat opens the thread once the spark has landed.
  let landing: NewSparkLanding
  let onOpen: @MainActor (String) -> Void
  @State private var sheet: NewSparkSheet
  @State private var hero = HatchSkyHero()
  @State private var nameSelection: TextSelection?
  @FocusState private var naming: Bool
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The ground behind the new row's face, its cut ring's (`sparkGround`, the paper).
  @Environment(\.sparkGround) private var ground
  @Environment(\.self) private var environment
  #if DEBUG
    @State private var pressedForStills = false
  #endif

  static let skyHeight: CGFloat = 300
  static let skyInset: CGFloat = 10
  static let skyCorners: CGFloat = 30
  static let face: CGFloat = 120
  static let side: CGFloat = 16
  static let touch: CGFloat = 44

  init(
    feed: ChatFeed, taken: [String], homeName: String, away: ChatAway?, sessions: [RunProfileFacts]?,
    landing: NewSparkLanding, onOpen: @escaping @MainActor (String) -> Void
  ) {
    self.feed = feed
    self.homeName = homeName
    self.away = away
    self.sessions = sessions
    self.landing = landing
    self.onOpen = onOpen
    _sheet = State(initialValue: Self.sheet(taken: taken))
  }

  /// The sheet's controller, dealing its first face at random as it ships. Under DEBUG, `-vf-new-spark-seed=<n>`
  /// deals face n instead, for the stills (f6b).
  private static func sheet(taken: [String]) -> NewSparkSheet {
    #if DEBUG
      if let seed = ChatFixtureDoor.newSparkSeed {
        return NewSparkSheet(taken: taken, random: { NewSpark.draw(dealing: seed) })
      }
    #endif
    return NewSparkSheet(taken: taken)
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        sky
        nameRow
          .padding(.top, 16)
        refusal(at: .name)
        if let away {
          awayLine(away)
            .padding(.top, 12)
        } else {
          agentPill
            .padding(.top, 12)
          refusal(at: .agent)
          Text(NewSparkWords.runsOn(homeName))
            .font(ChromeType.sans(13))
            .foregroundStyle(ChromePalette.inkTertiary)
            .padding(.top, 8)
          profilesRow
          refusal(at: .profiles)
        }
      }
      .padding(.bottom, 16)
    }
    .scrollBounceBehavior(.basedOnSize)
    .safeAreaInset(edge: .bottom, spacing: 0) { foot }
    .background(ChromePalette.paper)
    .presentationDetents([.large])
    .presentationDragIndicator(.hidden)
    .presentationCornerRadius(40)
    .presentationBackground(ChromePalette.paper)
    .interactiveDismissDisabled(sheet.creating)
    // the reads begin as it opens, or once the home answers again; the name stays as typed meanwhile
    .task(id: away == nil) {
      if away == nil { await sheet.open(on: feed) }
    }
    .task(id: away == nil ? sheet.pickerKey : nil) {
      if away == nil { await sheet.readPicker(on: feed) }
    }
    .onChange(of: sheet.name) { sheet.named() }
    // pressing the name raises the keys with the name selected, so typing replaces it (§8)
    .onChange(of: naming) { _, now in
      guard now else { return }
      nameSelection = TextSelection(range: sheet.name.startIndex..<sheet.name.endIndex)
    }
    #if DEBUG
      // the stills, under `-vf-mock`: Create pressed once the reads are in (no OS input on the stills' host)
      .onChange(of: sheet.opened, initial: true) { _, opened in
        guard opened, !pressedForStills, ChatFixtureDoor.pressCreate else { return }
        pressedForStills = true
        create()
      }
    #endif
  }

  // MARK: - The sky

  private var sky: some View {
    // the hatch: the night, the star that falls, and the face born where it lands (the flat star where Metal fails)
    HatchSkyView(seed: sheet.seed, faceSize: Self.face, hero: hero)
      .frame(height: Self.skyHeight)
      .clipShape(RoundedRectangle(cornerRadius: Self.skyCorners, style: .continuous))
      .padding([.top, .horizontal], Self.skyInset)
  }

  // MARK: - The name

  private var nameRow: some View {
    HStack(spacing: 8) {
      // ↻'s width on the other side, so the name stands at the sheet's middle
      Color.clear.frame(width: Self.touch, height: Self.touch)
      TextField(NewSparkWords.nameLabel, text: $sheet.name, selection: $nameSelection)
        .font(ChromeType.sans(30, .semibold))
        .tracking(ChromeType.tracking(-0.02, of: 30))
        .multilineTextAlignment(.center)
        .foregroundStyle(ChromePalette.ink)
        .textInputAutocapitalization(.words)
        .autocorrectionDisabled()
        .submitLabel(.done)
        .focused($naming)
        .frame(height: 46)
      Button {
        sheet.reroll()
      } label: {
        FieldGlyph(.reset, size: 18)
      }
      .buttonStyle(AnotherFaceStyle())
      .accessibilityLabel(NewSparkWords.anotherFace)
    }
    .padding(.horizontal, Self.side)
  }

  // MARK: - The agent

  private var agentPill: some View {
    Menu {
      ForEach(NewSparkMenuSection.of(sheet.menu)) { section in
        menuSection(section)
      }
    } label: {
      HStack(spacing: 8) {
        if !sheet.opened {
          // the home's agents are being read: never "No agent can be a spark yet" before it has said so
          ProgressView()
            .controlSize(.small)
            .padding(.horizontal, 8)
        } else {
          if let agent = sheet.agent {
            AgentMark(agent: agent.label, opacity: 1, size: 20)
          }
          Text(sheet.line)
            .font(ChromeType.sans(15, .medium))
            .foregroundStyle(ChromePalette.ink)
            .lineLimit(1)
        }
        if sheet.opened, let under = sheet.under {
          Text(under)
            .font(ChromeType.sans(15, .medium))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1)
            .padding(.leading, 9)
            .overlay(alignment: .leading) {
              Rectangle().fill(ChromePalette.ruleStrong).frame(width: 1, height: 18)
            }
        }
      }
      .padding(.leading, 12)
      .padding(.trailing, 16)
      .frame(height: Self.touch)
      .background(Capsule().fill(ChromePalette.fill))
      .contentShape(Capsule())
    }
    .disabled(!sheet.opened || sheet.agents.isEmpty)
    .padding(.horizontal, Self.side)
  }

  @ViewBuilder
  private func menuSection(_ section: NewSparkMenuSection) -> some View {
    if section.rows.isEmpty {
      Section {
        Button {
          sheet.choose(agent: section.agent.id)
        } label: {
          Text(section.agent.label)
          if let why = section.agent.why { Text(why) }
        }
        .disabled(!section.agent.takes)
      }
    } else {
      Section(section.under.map { "\(section.agent.label) · \($0)" } ?? section.agent.label) {
        ForEach(Array(section.rows.enumerated()), id: \.offset) { _, row in
          switch row {
          case .model(let id, let label, let on):
            Toggle(label, isOn: Binding(get: { on }, set: { _ in sheet.choose(model: id) }))
          case .note(let words):
            Text(words)
          case .agent:
            EmptyView()
          }
        }
        if let effort = sheet.effort {
          Picker(effort.label, selection: effortChoice(effort)) {
            ForEach(effort.values, id: \.id) { value in
              Text(value.label).tag(value.id)
            }
          }
          .pickerStyle(.palette)
        }
      }
    }
  }

  private func effortChoice(_ effort: EffortChoice) -> Binding<String> {
    Binding(get: { effort.values.first { $0.on }?.id ?? "" }, set: { sheet.choose(effort: $0) })
  }

  /// The home away, in the pill's place (§9): the agent, its menu and the profiles are the home's.
  private func awayLine(_ away: ChatAway) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Image(systemName: "moon")
        .font(.system(size: 12, weight: .medium))
      Text(NewSparkWords.away(away.name, away.standing, device: DeviceWord.current))
        .font(ChromeType.sans(13))
        .fixedSize(horizontal: false, vertical: true)
    }
    .foregroundStyle(ChromePalette.inkSecondary)
    .frame(minHeight: Self.touch)
    .padding(.horizontal, Self.side)
    .accessibilityElement(children: .combine)
  }

  // MARK: - The profiles (NS-D5)

  @ViewBuilder
  private var profilesRow: some View {
    if sheet.manyProfiles {
      VStack(spacing: 8) {
        ChatActsLayout(spacing: 8, centred: true) {
          ForEach(sheet.chips, id: \.id) { chip in
            chipView(chip)
          }
        }
        .frame(maxWidth: .infinity)
        Text(sheet.reach(sessions))
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkTertiary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.horizontal, Self.side)
      .padding(.top, 16)
    }
  }

  /// A chip: checked, it takes the fill and a 1.5 inset ring; the one it thinks under can't be unchecked.
  private func chipView(_ chip: ProfileChip) -> some View {
    let label = sheet.sets.first(where: { $0.id == chip.id }).map(NewSpark.label) ?? chip.label
    return Button {
      sheet.toggle(profile: chip.id)
    } label: {
      Text(label)
        .font(ChromeType.sans(14, .medium))
        .foregroundStyle(chip.checked ? ChromePalette.ink : ChromePalette.inkSecondary)
        .lineLimit(1)
        .padding(.horizontal, 14)
        .frame(height: 32)
        .background {
          if chip.checked { Capsule().fill(ChromePalette.fill) }
        }
        .overlay {
          if chip.checked { Capsule().strokeBorder(ChromePalette.ink, lineWidth: 1.5) }
        }
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(chip.checked ? .isSelected : [])
  }

  // MARK: - The refusals and the foot

  /// A refusal under what it asked about, 13 in the attention ink, centred.
  @ViewBuilder
  private func refusal(at place: RefusalPlace) -> some View {
    if let refusal = sheet.refusal, refusal.at == place {
      Text(refusal.words)
        .font(ChromeType.sans(13))
        .foregroundStyle(ChromePalette.attention)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Self.side)
        .padding(.top, 6)
    }
  }

  private var foot: some View {
    VStack(spacing: 8) {
      refusal(at: .foot)
      HStack(spacing: 8) {
        Button(NewSparkWords.cancel) { dismiss() }
          .buttonStyle(ChromePillStyle(.secondary, wide: true))
          .disabled(sheet.creating)
        Button(NewSparkWords.create(sheet.name)) { create() }
          .buttonStyle(ChromePillStyle(.primary, wide: true))
          .disabled(!sheet.canCreate || away != nil)
      }
    }
    .padding(.horizontal, Self.side)
    .padding(.top, 8)
    .padding(.bottom, 16)
    .background(ChromePalette.paper)
  }

  /// Create pressed: made, the face flies to its row as the sheet folds, then Chat opens its thread; refused, the
  /// refusal stands where it asked (`NewSparkLanding`).
  private func create() {
    naming = false
    let resolved = ground.resolve(in: environment)
    let cut = SIMD3(Double(resolved.red), Double(resolved.green), Double(resolved.blue))
    let steps = NewSparkLanding.Steps(hero: { hero.take() }, fold: { dismiss() }, open: onOpen)
    Task {
      await landing.create(sheet, on: feed, reducedMotion: reduceMotion, cut: cut, steps: steps)
    }
  }
}

/// ↻ Another face: 44 round in the fill, `reset` 18; pressed, it turns −60° on the pop curve (§8; the Mac's 280 ms).
private struct AnotherFaceStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(ChromePalette.inkSecondary)
      .rotationEffect(.degrees(configuration.isPressed ? -60 : 0))
      .animation(.timingCurve(FieldMotion.popCurve, duration: 0.28), value: configuration.isPressed)
      .frame(width: NewSparkSheetView.touch, height: NewSparkSheetView.touch)
      .background(Circle().fill(ChromePalette.fill))
      .contentShape(Circle())
  }
}
