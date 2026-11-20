import FieldDesign
import FieldProduct
import SwiftUI
import UIKit

/// Item 586 (2026-11-19) — the launch sheet asks two things, where and who (DESIGN.md §8, "The phone's launch sheet
/// asks two things"). The header says what the bloom chose, once: the desktop and the Agent Profile. WHERE is the
/// recent places as pills, and Browse, which raises this same sheet into the browser (`LaunchBrowse`); WHO is the
/// desktop's agents as the bloom's buds; Start is the agent's ticket. It replaced FS-2's Form over a folder sheet of
/// its own, and PJ-7's Profile, Model and Effort rows; fix7 stands: the sheet is presented by its model, and a part
/// says what it waits on.
public struct CreateSessionSheet: View {
  @Bindable private var model: WorkspaceLaunch
  @State private var browsing = false
  @State private var browseOpens = LaunchBrowse.Opening.beside
  /// the menu's own height, which its detent takes: the sheet is as tall as what it holds
  @State private var menuHeight: CGFloat = 560
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  public init(model: WorkspaceLaunch) { self.model = model }

  public var body: some View {
    ZStack(alignment: .top) {
      if browsing {
        LaunchBrowse(model: model, opening: browseOpens) { show(browsing: false) }
          .transition(.opacity.combined(with: .move(edge: .trailing)))
      } else {
        menu
          .transition(.opacity.combined(with: .move(edge: .leading)))
      }
    }
    .tint(ChromePalette.ink)
    .interactiveDismissDisabled(model.busy)
    .presentationDetents(browsing ? [.large] : [.height(menuHeight)])
    .presentationDragIndicator(.visible)
    .presentationCornerRadius(40)
    .fieldGlassSheet()
    .task {
      #if DEBUG
        if LaunchArguments.current.contains(where: { $0.hasPrefix("-vf-demo-workspace=") }) {
          if let device = model.selected { await model.select(device) }
          await stageDemo()
          return
        }
      #endif
      // PJ-D12 (a): nowhere to start yet, Browse opens by itself
      if model.needsFolder { browsing = true }
      if let device = model.selected { await model.select(device) }
    }
  }

  /// Browse rises over the island curve and comes back down the same way; reduced motion, it is there.
  private func show(browsing: Bool) {
    browseOpens = .beside
    if reduceMotion {
      self.browsing = browsing
    } else {
      withAnimation(FieldMotion.island(0.38)) { self.browsing = browsing }
    }
  }

  // MARK: The menu

  private var menu: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      LaunchLabel("WHERE").padding(.top, 24)
      places.padding(.top, 10)
      browseRow.padding(.top, 8)
      if let line = model.whereLine {
        Text(line)
          .font(ChromeType.mono(12))
          .foregroundStyle(ChromePalette.inkSecondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .padding(.horizontal, 4)
          .padding(.top, 10)
      }
      LaunchLabel("WHO").padding(.top, 24)
      buds.padding(.top, 12)
      if let message = model.message {
        Text(message)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 14)
      }
      actions.padding(.top, 22)
    }
    .padding(.horizontal, 20)
    .padding(.top, 24)
    .padding(.bottom, 22)
    .fixedSize(horizontal: false, vertical: true)
    .onGeometryChange(for: CGFloat.self) { proxy in
      proxy.size.height
    } action: { height in
      menuHeight = height
    }
  }

  /// The bloom's words, `New agent on studio`, the verb at 40%; under them the profile the sheet runs under, in mono.
  private var header: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        (Text("New agent on ").foregroundStyle(ChromePalette.ink.opacity(0.4))
          + Text(model.desktop?.name ?? "a desktop").foregroundStyle(ChromePalette.ink))
          .font(ChromeType.sans(28, .heavy))
          .tracking(ChromeType.tracking(-0.04, of: 28))
          .lineLimit(1)
          .minimumScaleFactor(0.75)
          .accessibilityAddTraits(.isHeader)
        if let words = model.profileWords {
          HStack(spacing: 6) {
            if let profile = model.profile {
              Image(
                systemName: ProfileGlyphSymbols.symbol(
                  glyph: profile.glyph, native: profile.kind == "native", filled: profile.isDefault)
              )
              .font(.system(size: 11, weight: .semibold))
            }
            Text(words)
              .font(FieldType.mono(11, .bold))
              .tracking(FieldType.tracking(0.1, of: 11))
          }
          .foregroundStyle(ChromePalette.inkTertiary)
          .frame(height: 16)
          .accessibilityElement(children: .combine)
        }
      }
      Spacer(minLength: 0)
      Button {
        dismiss()
      } label: {
        FieldGlyph(.close, size: 14)
          .foregroundStyle(ChromePalette.inkSecondary)
          .frame(width: 34, height: 34)
          .background(Circle().fill(ChromePalette.wellFill))
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .disabled(model.busy)
      .accessibilityLabel("Cancel")
    }
  }

  /// WHERE: the recent places as pills, two to a row; a dashed pill when there is none yet.
  @ViewBuilder private var places: some View {
    let choices = model.whereChoices
    if choices.isEmpty {
      Text("No recent folders on \(model.desktop?.name ?? "this desktop") yet")
        .font(ChromeType.sans(14))
        .foregroundStyle(ChromePalette.inkTertiary)
        .lineLimit(1)
        .frame(maxWidth: .infinity, minHeight: 40)
        .overlay(Capsule().strokeBorder(ChromePalette.wellHairline, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
    } else {
      LazyVGrid(columns: pillColumns, alignment: .leading, spacing: 8) {
        ForEach(choices) { choice in pill(choice) }
      }
    }
  }

  private var pillColumns: [GridItem] { [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)] }

  /// A recent folder: the `folder` glyph and its name, inverted when chosen. A project's place on another desktop
  /// wears that desktop's OS mark where the glyph stands, and choosing it moves the sheet there (Q7).
  private func pill(_ choice: LaunchWhere) -> some View {
    let on = model.chosen == choice
    let elsewhere = choice.desktop == model.selected ? nil : model.desktops.first { $0.id == choice.desktop }
    return Button {
      Task { await model.choose(choice) }
    } label: {
      HStack(spacing: 7) {
        if let elsewhere {
          DeviceMark(platform: elsewhere.platform, size: 16)
        } else {
          FieldGlyph(.folder, size: 16)
        }
        Text(choice.name)
          .font(ChromeType.sans(15, .medium))
          .lineLimit(1)
          .truncationMode(.middle)
      }
      .padding(.leading, 12)
      .padding(.trailing, 14)
      .frame(maxWidth: .infinity, minHeight: 40, maxHeight: 40, alignment: .leading)
      .foregroundStyle(on ? ChromePalette.keyOnInk : ChromePalette.ink)
      .background(Capsule().fill(on ? ChromePalette.keyOnFill : ChromePalette.wellFill))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .disabled(model.busy)
    .accessibilityLabel(pillWords(choice, elsewhere: elsewhere?.name))
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  private func pillWords(_ choice: LaunchWhere, elsewhere: String?) -> String {
    var words = choice.name
    if case .place(let place) = choice, let branch = place.branch { words += ", \(branch)" }
    if let elsewhere { words += ", on \(elsewhere)" }
    return words
  }

  /// Browse studio: an outlined pill with the desktop's OS mark; it raises the sheet into the browser.
  private var browseRow: some View {
    Button {
      show(browsing: true)
    } label: {
      HStack(spacing: 7) {
        DeviceMark(platform: model.desktop?.platform, size: 16)
          .foregroundStyle(ChromePalette.inkSecondary)
        Text("Browse \(model.desktop?.name ?? "the desktop")")
          .font(ChromeType.sans(15, .medium))
          .lineLimit(1)
        Spacer(minLength: 0)
        FieldGlyph(.chevron, size: 12)
          .foregroundStyle(ChromePalette.inkTertiary)
      }
      .padding(.leading, 12)
      .padding(.trailing, 14)
      .frame(height: 40)
      .foregroundStyle(ChromePalette.ink)
      .overlay(Capsule().strokeBorder(ChromePalette.wellHairline, lineWidth: 1))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .disabled(model.busy || model.reader == nil)
  }

  /// WHO: the desktop's agents as the bloom's buds, sideways past five; what the row waits on is said in its place.
  @ViewBuilder private var buds: some View {
    if let words = model.whoWords {
      HStack(spacing: 8) {
        if !model.agentsRead && model.desktop?.online == true { ProgressView().controlSize(.small) }
        Text(words)
          .font(ChromeType.sans(14))
          .foregroundStyle(ChromePalette.inkSecondary)
      }
      .frame(maxWidth: .infinity, minHeight: LaunchBud.height, alignment: .leading)
    } else {
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: 2) {
          ForEach(model.agents) { agent in
            LaunchBud(
              agent: agent, chosen: agent.id == model.provider, runs: model.runs(agent),
              profile: model.profile.map { LaunchModel.profileLabel($0) } ?? LaunchModel.nativeLabel
            ) {
              model.chooseAgent(agent.id)
            }
          }
        }
        .padding(.horizontal, 20)
      }
      .scrollIndicators(.hidden)
      .scrollClipDisabled()
      .padding(.horizontal, -20)
      .frame(height: LaunchBud.height)
      .disabled(model.busy)
    }
  }

  /// Start, the agent's ticket. "Starting…" keeps its look while it runs (item 241): enabled, its hits off.
  private var start: some View {
    Button {
      guard !model.busy else { return }
      Task {
        // DESIGN.md §8: success or warning at the birth
        let born = await model.spawn()
        UINotificationFeedbackGenerator().notificationOccurred(born ? .success : .warning)
        if born { dismiss() }
      }
    } label: {
      LaunchTicket(
        agent: model.agent, line: model.startLine, folder: model.chosen?.name ?? "Choose a folder",
        starting: model.spawning)
    }
    .buttonStyle(ChromeCapsuleStyle(live: .primary, off: .quiet))
    // DESIGN.md §7 "Off" (item 241): the pill draws off itself
    .disabled(!model.canSpawn && !model.spawning)
    .allowsHitTesting(model.canSpawn)
    .accessibilityLabel(model.startSentence)
  }

  /// Item 587 — the row under WHO: Start, the agent's ticket, and Terminal beside it.
  private var actions: some View {
    HStack(spacing: 8) {
      start
      terminal
    }
  }

  /// Item 587 (2026-11-19) — Terminal: `prompt` and the word in the well's fill and hairline, a shell in the chosen
  /// folder under the header's profile. Opening, the glyph turns to a spinner and the word to `Opening…`, so the pill
  /// keeps its look with its hits off (§7, item 241); Off until the profile is read, with no folder, with the desktop
  /// asleep, or while Start starts, as Start is while it opens.
  private var terminal: some View {
    Button {
      guard !model.busy else { return }
      Task {
        let opened = await model.openTerminal()
        UINotificationFeedbackGenerator().notificationOccurred(opened ? .success : .warning)
        if opened { dismiss() }
      }
    } label: {
      HStack(spacing: 6) {
        if model.opening {
          ProgressView().controlSize(.small)
        } else {
          FieldGlyph(.prompt, size: 18)
        }
        Text(model.opening ? "Opening…" : "Terminal")
          .font(ChromeType.sans(15, .medium))
          .lineLimit(1)
      }
      .padding(.horizontal, 16)
      .frame(minHeight: ChromePillStyle.wideHeight, maxHeight: ChromePillStyle.wideHeight)
      .fixedSize(horizontal: true, vertical: false)
    }
    .buttonStyle(
      ChromeCapsuleStyle(
        live: ChromePillLook(
          fill: ChromePalette.wellFill, ink: ChromePalette.ink, hairline: ChromePalette.wellHairline),
        off: .quiet))
    .disabled(!model.canOpenShell && !model.opening)
    .allowsHitTesting(model.canOpenShell)
    .accessibilityLabel(model.shellSentence)
  }

  #if DEBUG
    /// The demo door's scenes (`-vf-demo-workspace=…`, DEBUG only): Browse in a folder, the menu with it chosen, a
    /// refused start or one running, a shell refused by a desktop older than its door or one opening (item 587), the
    /// desktop's places, the desktop asleep.
    private func stageDemo() async {
      guard
        let scene = LaunchArguments.current.first(where: { $0.hasPrefix("-vf-demo-workspace=") })?
          .split(separator: "=").last.map(String.init)
      else { return }
      let menuScenes = ["folder", "launch", "refused", "spawning", "shell-older", "shell-opening"]
      if menuScenes.contains(scene), let reader = model.reader,
        let home = reader.roots.first(where: { $0.browse == "home" })
      {
        await reader.open(home, path: "Projects/workbench")
        if scene != "folder" { _ = model.chooseCurrentFolder() }
      }
      if scene == "offline" {
        model.update(model.desktops.map { .init(id: $0.id, name: $0.name, platform: $0.platform, online: false) })
      }
      browseOpens = scene == "roots" ? .places : .asIs
      browsing = ["roots", "folder", "offline"].contains(scene)
      if scene == "refused" { _ = await model.spawn() }
      if scene == "spawning" { Task { _ = await model.spawn() } }
      if scene == "shell-older" { _ = await model.openTerminal() }
      if scene == "shell-opening" { Task { _ = await model.openTerminal() } }
    }
  #endif
}

/// Item 586 — a part's word over it (`WHERE`, `WHO`), in the bloom's mono.
private struct LaunchLabel: View {
  let words: String
  init(_ words: String) { self.words = words }

  var body: some View {
    Text(words)
      .font(FieldType.mono(10, .heavy))
      .tracking(FieldType.tracking(0.1, of: 10))
      .foregroundStyle(ChromePalette.inkTertiary)
      .accessibilityAddTraits(.isHeader)
  }
}

/// Item 586 — an agent as the bloom's bud (DESIGN.md §8, "Hold, reach, let go"): a disc in `bloomBud` ringed at 22%
/// ink, the agent's own mark, its name in mono under it. Chosen, it inverts to the ink and lifts; one the sheet's
/// profile holds no sign-in for stays in its place, its disc dashed and faint, and cannot be chosen. Its name and
/// `NO SIGN-IN` say why, so they are words that must be read: t3 (item 242), never the disc's fade.
private struct LaunchBud: View {
  /// the row's height: the disc, its gap, two lines of name
  static let height: CGFloat = 86

  let agent: AgentCatalogRow
  let chosen: Bool
  let runs: Bool
  let profile: String
  let choose: @MainActor () -> Void
  @Environment(\.accessibilityReduceMotion) var reduceMotion

  var body: some View {
    Button(action: choose) {
      VStack(spacing: 8) {
        ZStack {
          Circle().fill(chosen ? FieldPalette.textMain : FieldPalette.bloomBud)
          Circle().strokeBorder(
            FieldPalette.textMain.opacity(chosen ? 0 : 0.22),
            style: StrokeStyle(lineWidth: 1.25, dash: runs ? [] : [3, 3]))
          LaunchAgentGlyph(agent: agent, size: 22)
            .foregroundStyle(chosen ? FieldPalette.bloomBud : FieldPalette.textMain)
        }
        .frame(width: 52, height: 52)
        .opacity(runs ? 1 : 0.45)
        .scaleEffect(chosen && !reduceMotion ? 1.08 : 1)
        Text(runs ? agent.label.uppercased() : "\(agent.label.uppercased())\nNO SIGN-IN")
          .font(FieldType.mono(9.5, .bold))
          .tracking(0.57)
          .multilineTextAlignment(.center)
          .lineLimit(2)
          .foregroundStyle(runs ? FieldPalette.textMain.opacity(chosen ? 1 : 0.78) : ChromePalette.inkTertiary)
          .frame(width: 66, height: 26, alignment: .top)
      }
      .frame(width: 66)
      .contentShape(Rectangle())
    }
    // drawn as it is given, off or not: the plain style would fade an off bud's words under t3
    .buttonStyle(LaunchBudStyle())
    .disabled(!runs)
    .animation(reduceMotion ? nil : FieldMotion.lift(0.18), value: chosen)
    .accessibilityLabel(runs ? agent.label : "\(agent.label), no sign-in as \(profile)")
    .accessibilityAddTraits(chosen ? .isSelected : [])
  }
}

/// A bud's button draws its label as it is given: the bud says itself what it is.
private struct LaunchBudStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View { configuration.label }
}

/// Item 586 — Start as the agent's ticket: its mark in a disc of the inverse ink, its name small in the buds' mono
/// over the folder, big, and the `start` glyph as the verb; a spinner while it starts. The name is a word that must be
/// read, so it is t3 (item 242), the inversion's: `inkTertiary` as the other theme draws it, as a card's ink takes its
/// ground's scheme. Off (§7), the disc gives up its inversion with the pill, and every word is t4.
private struct LaunchTicket: View {
  let agent: AgentCatalogRow?
  let line: String
  let folder: String
  let starting: Bool
  @Environment(\.isEnabled) var isEnabled
  @Environment(\.colorScheme) var colorScheme

  /// the scheme the pill's own words are drawn in: the other one while it is inverted
  private var inkScheme: ColorScheme { isEnabled ? (colorScheme == .dark ? .light : .dark) : colorScheme }

  var body: some View {
    HStack(spacing: 9) {
      ZStack {
        Circle().fill(isEnabled ? ChromePalette.keyOnInk : ChromePalette.wellFill)
        if let agent {
          LaunchAgentGlyph(agent: agent, size: 20)
            .foregroundStyle(isEnabled ? ChromePalette.keyOnFill : ChromePalette.inkT4)
        }
      }
      .frame(width: 38, height: 38)
      VStack(alignment: .leading, spacing: 2) {
        Text(line)
          .font(FieldType.mono(9.5, .heavy))
          .tracking(FieldType.tracking(0.06, of: 9.5))
          .lineLimit(1)
          .foregroundStyle(isEnabled ? ChromePalette.inkTertiary : ChromePalette.inkT4)
          .environment(\.colorScheme, inkScheme)
        HStack(spacing: 5) {
          FieldGlyph(.folder, size: 14)
          Text(folder)
            .font(ChromeType.sans(16, .bold))
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if starting {
        ProgressView().controlSize(.small).tint(ChromePalette.keyOnInk)
      } else {
        FieldGlyph(.start, size: 20)
      }
    }
    .padding(.leading, 6)
    .padding(.trailing, 15)
    .frame(maxWidth: .infinity, minHeight: ChromePillStyle.wideHeight, maxHeight: ChromePillStyle.wideHeight)
    .accessibilityElement(children: .ignore)
  }
}

/// Item 586 — how the launch sheet draws an agent's mark. The sheet knows no vendor glyph (AR-L1): the home hands
/// its drawing in, as it does History's (`HistoryAgentGlyph`). Without one, and for an agent the home draws no mark
/// for, the agent's letter stands in the mark's place.
public struct LaunchAgentMark: Sendable {
  /// The mark for a catalog row, fitted to a square of the size given; nil where the home draws none for it.
  public let draw: @MainActor @Sendable (AgentCatalogRow, CGFloat) -> AnyView?

  public init(_ draw: @escaping @MainActor @Sendable (AgentCatalogRow, CGFloat) -> AnyView?) {
    self.draw = draw
  }
}

private struct LaunchAgentMarkKey: EnvironmentKey {
  static let defaultValue: LaunchAgentMark? = nil
}

extension EnvironmentValues {
  /// The home's drawing of an agent's mark for the launch sheet; nil draws the agent's letter.
  public var launchAgentMark: LaunchAgentMark? {
    get { self[LaunchAgentMarkKey.self] }
    set { self[LaunchAgentMarkKey.self] = newValue }
  }
}

/// An agent's mark in the ink it sits in: the home's drawing, else the id's first character (the reference's own
/// fallback, `AgentIcon.tsx`).
private struct LaunchAgentGlyph: View {
  let agent: AgentCatalogRow
  let size: CGFloat
  @Environment(\.launchAgentMark) var mark

  var body: some View {
    if let drawn = mark?.draw(agent, size) {
      drawn.frame(width: size, height: size)
    } else {
      Text(agent.id.prefix(1).uppercased())
        .font(.system(size: size * 0.78, weight: .heavy, design: .monospaced))
        .frame(width: size, height: size)
    }
  }
}
