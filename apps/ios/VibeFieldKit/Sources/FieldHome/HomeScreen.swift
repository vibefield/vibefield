import FieldAgents
import FieldDesign
import FieldHistory
import FieldInput
import FieldMesh
import FieldProduct
import FieldWorkspace
import FieldSwarm
import FieldTerminal
import SwiftUI
import UIKit

/// The VibeField home: the whole screen is the field. Bubbles are the
/// sessions — the mock fleet's agents and, since IOS-3, every terminal a peer
/// on the mesh is serving. Tapping one raises its card; holding empty ground
/// raises a new agent.
///
/// The two sources compose behind one seam and neither pretends to be the
/// other: the mock is a preview until fieldd's agent feed exists, and a
/// remote bubble is a fact about a machine that answered. Order says so —
/// agents in launch order, then the mesh's own as their own segment, because
/// a peer's session is a guest here.
public struct HomeScreen: View {
  @State private var feed = MockAgentField()
  @State private var createSheetOpen = false
  @State private var workspaceLaunch: WorkspaceLaunch?
  @State private var mesh = MeshModel()
  @State private var remoteField = RemoteSessionField(source: nil)
  /// IOS-4b — the live field: the devices store, the doors it names, and the
  /// boards behind them. Built when the mesh comes up and void when it goes,
  /// exactly like discovery's own door; nil means nobody has been asked, which
  /// is not the same as a mesh that answered with no agents.
  @State private var link: FieldLink?
  /// Whether an open is already in flight. Assigned synchronously by
  /// `openLink`, before it awaits the mesh node, because the window between
  /// that await and the assignment below is exactly where a second caller
  /// used to build a second link.
  @State private var linkOpening = false
  #if DEBUG
    /// Whether the scripted fleet is driving the field. Since IOS-4b the mock
    /// is NOT the live path: it runs only behind the lab and the demo
    /// arguments, because a preview that cannot be told from a daemon is the
    /// demo path the corpus forbids.
    @State private var mockActive = false
    /// Whether the link on screen is a FIXTURE one, installed by a launch
    /// argument. It is its own flag because no other flag answers the
    /// question: the scripted fleet and the demo peer own the field's ROWS
    /// and install no link at all.
    @State private var fixtureLink = false
  #endif
  @State private var selection: SessionSelection?
  /// The card's SUBJECT, remembered rather than looked up fresh every frame.
  /// A card is about the session it opened on, and the field's listing is only
  /// the field's current view of it — one that a four-second discovery hiccup
  /// can withdraw while the terminal below is still rendering frames.
  @State private var cardBubble: FieldBubble?
  /// IOS-8b — the account corner's menu, grown from the face. Folded by a
  /// tap anywhere else, by any act it offers, and by an arriving login page.
  @State private var accountMenuOpen = false
  /// IOS-8c — what this phone remembers about the account: its desktops and
  /// its face, by login. Value types over UserDefaults; `identityEpoch` is
  /// what makes a deal or a new memory redraw the corner.
  @State private var desktopMemory = DesktopMemory()
  @State private var faceStore = AccountFaceStore()
  @State private var identityEpoch = 0
  /// IOS-8d — Sign out asks first: it is the one act in the menu that is
  /// destructive, and the sentence says what goes and what stays.
  @State private var signOutPending = false
  // --- IOS-9a/9e: the two tabs, search, and the account in one bar ---------
  /// Which page stands: the field, History, or search.
  @State private var selectedTab: AppTab = .field
  /// The page search goes back to when it closes.
  @State private var tabBeforeSearch: AppTab = .field
  /// The History tab's stack, its landed search and whether its scroll has
  /// folded the bar — shared with search, so a hit can land across the switch.
  @State private var history = HistoryRouter()
  /// SP-6 — History grouped by desktop: one reader per self desktop whose
  /// door answers (over the link's doors), the cache's reader for one that
  /// does not; the mock and the demo arguments mount a fixed one instead.
  @State private var historyDesktops = HistoryDesktops()
  #if DEBUG
    /// `-vf-demo-history` (the mock's corpus, no tailnet) and
    /// `-vf-demo-history-door` / `-offline` (the REAL reads over an in-process
    /// door answering the contracts' goldens; the latter then replays them
    /// from the cache with the door gone).
    @State private var demoHistory = false
  #endif
  /// Search's words and kind: the bar's field writes them, the page reads them.
  @State private var searchQuery = ""
  @State private var searchKind: FieldHistoryModel.SearchKind = .any
  @FocusState private var searchFocused: Bool
  /// The home indicator's inset, read with the keyboard ignored: the bar
  /// rests where iOS 26 rests its own (`AppBar.bottomGap`), and rides the
  /// keyboard only while search is typing.
  @State private var homeInset: CGFloat = 34
  /// The bottom inset WITH the keyboard. Above the home inset only while a
  /// software keyboard stands — a hardware keyboard (the simulator with the
  /// Mac's attached, an iPad's) raises none, and the row must stay at rest.
  @State private var keyboardInset: CGFloat = 0
  /// The bar's glass morphs (the search circle into the field, the capsule
  /// into its folded circle) and, apart, the tab pill's slide.
  @Namespace private var barGlass
  @Namespace private var tabPill
  #if DEBUG
    /// `-vf-mock`: the whole phone over invented facts and no tailnet (IOS-9d).
    @State private var mock: MockAccount?
  #endif
  // --- end IOS-9a/9e -------------------------------------------------------
  #if DEBUG
    /// `-vf-demo-account=<state>`: the corner's inputs, stamped (IOS-8e).
    @State private var demoAccount: FieldHomeModel.AccountFace?
  #endif
  @State private var settingsSheetOpen = false
  /// IOS-8g — the same sheet, presented from the session card's `···`: the
  /// root is behind the card while it is up, and a second presentation from
  /// the same presenter is a sheet that never appears.
  @State private var cardSettingsOpen = false
  @State private var discoveryPolling = false
  @State private var attachment: TerminalAttachment?
  /// Latched for the width of the directory lookup. `isAttached` hides the
  /// button, but that flip is on the far side of an `await`, and two taps
  /// inside that window would build two lifecycles — the first of which
  /// nothing would ever close (`TerminalAttachment` has no `deinit`, and it
  /// could not have a useful one: closing is `async`).
  @State private var attaching = false
  /// Two different failures, deliberately not one field: a renderer that
  /// refused a frame and a mesh that was never up are different facts, and
  /// folding them into one string made the card say the renderer refused
  /// something it had never been handed.
  @State private var renderFailure: String?
  @State private var attachRefusal: String?
  /// Which host the open attachment lives on, so discovery can tell it when
  /// that host comes back (finding 3 of the terminal leg).
  @State private var attachedDeviceID: String?
  @State private var copiedNote: String?
  @State private var appearance = TerminalAppearanceStore.load()
  // RETIRED 2026-09-14 (TM-3, TM-D3): this screen's mirror-write state — the
  // Keychain store, its mirrored host list, the sheet's subject, the store's
  // error note and the per-desktop grant notes. No attach has read a key since
  // TM-5, and there is no key: the right to type is a claim in the attach grant
  // the ticket carries. A key an older build stored is deleted at first launch
  // by `RetiredWriteKeyCleanup.runOnce()` in `onAppear`, which never reads one.
  #if DEBUG
    @State private var demoRemoteActive = false
    /// `-vf-swarm-lab[=section[:page]]`: the design lab over the field (IOS-6c, D-i15).
    @State private var swarmLabOpen = false
    @State private var swarmLabFocus: LabFocus?
  #endif
  // --- IOS-5a: the input card ---------------------------------------------
  /// The card above the keyboard: the draft, the latch, the mode. It is state
  /// of the SCREEN rather than of an attachment, because it outlives none of
  /// them — `closeCard` resets it, and a draft typed for one session must not
  /// arrive in the next.
  @State private var inputCard = InputCardModel()
  // --- IOS-5c: whether the pasteboard holds something this card has not been
  // offered yet. It reads the change count and never the contents — see
  // `PasteboardWatcher`.
  @State private var pasteboard = PasteboardWatcher()
  // --- end IOS-5c
  // --- IOS-5d: the two stores behind the `+` menu. They are the SCREEN's,
  // like the card model, because both outlive a single attachment and neither
  // belongs to one: a snippet written against one desktop is still a snippet
  // at the next.
  @State private var snippets = SnippetStore()
  @State private var clipboardHistory = ClipboardHistory()
  // --- end IOS-5d
  #if DEBUG
    /// `-vf-demo-input-card`: mount the card over the demo fixture, which has
    /// no attachment to grant anything. Pixels, never a claim.
    @State private var demoInputCard = false
    // --- IOS-5c: `-vf-demo-input-chips`. It has to be REMEMBERED rather than
    // stamped once: every path that re-derives the row would otherwise wipe
    // the fixture the moment discovery polled (a remote bubble has no agent
    // facet, so the honest derivation is `[]`).
    @State private var demoInputChips = false
    // --- end IOS-5c
  #endif
  // --- end IOS-5a ---------------------------------------------------------
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  public init() {}

  /// One stage, two sources, projected by the pure functions in FieldAgents.
  ///
  /// Since IOS-4b the agent half is the DAEMON's: `FieldLink` folds every
  /// desktop's board — from `field.agents.v1` where the floor publishes it, and
  /// over the door where it does not — into the same `AgentSnapshot` the mock
  /// used to invent. An empty field with the mesh up is now a real answer
  /// rather than a missing feature.
  private var projected: [FieldBubble] {
    liveAgents.compactMap(fieldBubble(from:)) + remoteField.snapshot.rows.map(fieldBubble(from:))
  }

  /// The agent rows, from whoever is entitled to give them.
  private var liveAgents: [AgentSnapshot] {
    #if DEBUG
      // The lab and the demo arguments own the field while they are up: what
      // they show is our own pixels, and a daemon arriving mid-screenshot
      // would be the fixture lying about what it is.
      if mockActive { return feed.agents }
    #endif
    return link?.agents ?? []
  }

  // --- IOS-6d: the field's ledgers ------------------------------------------
  /// The rows the field draws: the projection dressed by `FieldAssembly` —
  /// every project's colour, the open card's pane, the unread marks, the
  /// stale flags, the usage ledger. Folded on every projection and every
  /// change of the card's subject, never derived twice.
  @State private var bubbles: [FieldBubble] = []
  @State private var assembly = FieldAssembly(tint: .light)
  /// The project ledger's cache (D-i13): a project keeps its colour across
  /// launches on this device.
  private let projectStore = UserDefaultsProjectLedgerStore()

  private func refold() {
    assembly.tint = colorScheme == .dark ? .dark : .light
    let before = assembly.projects
    bubbles = assembly.fold(
      projected, cardSubjectID: selection?.id, nowMs: Date().timeIntervalSince1970 * 1000)
    if assembly.projects != before { projectStore.save(assembly.projects) }
  }
  // --- end IOS-6d -----------------------------------------------------------

  /// The stage, kept out of `body` on purpose: with every sheet and lifecycle
  /// hook attached, one expression grew past what the type-checker will solve
  /// in reasonable time. Splitting it is the fix SwiftUI asks for.
  private var stage: some View {
    ZStack {
      // The swarm on Metal (IOS-6c/6d): the reference's renderer over the
      // dressed rows; the chrome slot's obstacles are the field's walls.
      SwarmField(
        bubbles: bubbles,
        // IOS-9e — the field draws only while it is the page standing: the
        // other two keep it alive under them, and a hidden Metal view
        // rendering at 120 Hz is a battery spent on nobody.
        isActive: scenePhase == .active && selectedTab == .field,
        onSelect: { bubble in openCard(on: bubble) },
        onCreate: { _ in
          #if DEBUG
            if mockActive { return feed.spawn() }
          #endif
          beginCreate()
          return nil
        }
      ) {
        chrome
      }

      ScanlinesOverlay()
        .ignoresSafeArea()
      VignetteOverlay()
        .ignoresSafeArea()
    }
    // The lab covers the stage (IOS-6c); presented here rather than on the
    // body's chain, which is already at the type-checker's limit.
    .fullScreenCover(isPresented: swarmLabBinding) { SwarmLabView(focus: swarmLabFocusValue) }
    .onAppear {
      #if DEBUG
        if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("-vf-demo-workspace=") }) {
          workspaceLaunch = WorkspaceFixtureDoor.model()
          createSheetOpen = true
        }
      #endif
    }
    .sheet(isPresented: $createSheetOpen) {
      if let workspaceLaunch { CreateSessionSheet(model: workspaceLaunch) }
    }
    // --- IOS-6d: every projection and every change of the card's subject
    // folds the ledgers; the theme's tint moves the project colours with it.
    // On the stage for the same reason as the cover above.
    .onChange(of: projected) { refold() }
    .onChange(of: selection?.id) { refold() }
    .onChange(of: colorScheme) { refold() }
    // --- end IOS-6d
    // IOS-8c — every listing teaches the account's memory: which desktops it
    // has, and — from the first door that answers with a user id — its face.
    .onChange(of: linkDesktops) {
      rememberAccount()
      syncHistoryDesktops()
      workspaceLaunch?.update(workspaceDesktops)
    }
    // SP-6 — the home moved: the History groups re-order and the home's
    // reader takes the shared door
    .onChange(of: linkHome) { syncHistoryDesktops() }
    // IOS-8d — on the stage for the type-checker's sake, like the cover above.
    .confirmationDialog(
      "Sign out of \(accountLogin ?? "this account")?", isPresented: $signOutPending,
      titleVisibility: .visible
    ) {
      Button("Sign out", role: .destructive) { signOut() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "This phone forgets your Tailscale sign-in, your desktops and your face. "
          + "Appearance, snippets and clipboard history stay.")
    }
  }

  @ViewBuilder
  private var chrome: some View {
    // IOS-9a/9e — the bar's band. The field runs under the bar (its glass
    // shows the ground through), and this invisible obstacle keeps the bodies
    // out of the bar's row — the account corner, the capsule and the search
    // circle all stand in it. It is the bar's resting row, so it holds while
    // the bar folds under the account menu.
    Color.clear
      .frame(maxWidth: .infinity)
      .frame(height: AppBar.band(homeInset: homeInset))
      .swarmObstacle()
      .allowsHitTesting(false)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    // RETIRED 2026-09-23 (IOS-8g): the TERMINAL chip in the top-right. What it
    // opened is the session card's `···` now; the field's corners are the
    // account's and the tab bar's.
  }

  private var workspaceDesktops: [WorkspaceDesktop] {
    (link?.desktops ?? []).map { desktop in
      WorkspaceDesktop(id: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        online: desktop.state == .ready)
    }
  }

  private func beginCreate() {
    if workspaceLaunch == nil {
      workspaceLaunch = WorkspaceLaunch(desktops: workspaceDesktops, home: link?.home) { device, method, params in
        guard let link else {
          throw FieldProductError(kind: "UNAVAILABLE", message: "Connect a desktop", retryable: true)
        }
        return try await link.workspaceCall(on: device, method: method, params: params)
      }
    }
    workspaceLaunch?.update(workspaceDesktops)
    createSheetOpen = true
  }

  // MARK: - IOS-9e: the pages, and the bar over them

  /// Three pages under one bar. `TabView` hosted them until IOS-9e; its bar
  /// could not seat the account at the left (see `AppBar`), so the pages are
  /// stacked here and kept alive, the way a TabView keeps its tabs, and the
  /// bar is ours.
  private var tabs: some View {
    ZStack {
      fieldTab.page(visible: selectedTab == .field)
      historyTab.page(visible: selectedTab == .history)
      searchTab.page(visible: selectedTab == .search)
    }
    .overlay { bar }
    .background {
      GeometryReader { geo in
        Color.clear
          .onAppear { homeInset = geo.safeAreaInsets.bottom }
          .onChange(of: geo.safeAreaInsets.bottom) { _, inset in homeInset = inset }
      }
      .ignoresSafeArea(.keyboard)
    }
    .background {
      GeometryReader { geo in
        Color.clear
          .onAppear { keyboardInset = geo.safeAreaInsets.bottom }
          .onChange(of: geo.safeAreaInsets.bottom) { _, inset in keyboardInset = inset }
      }
    }
    .onChange(of: selectedTab) { _, tab in
      history.barMinimized = false
      if tab != .search { searchFocused = false }
    }
    // Every push and pop opens the bar again, the way the system's does.
    .onChange(of: history.path) { history.barMinimized = false }
    #if DEBUG
      .onChange(of: mockDesktopIsUp) { syncMockHistory() }
    #endif
  }

  /// The field, under the bar's glass to the screen's edge.
  private var fieldTab: some View {
    stage
      .ignoresSafeArea(.container, edges: .bottom)
  }

  private var historyTab: some View {
    HistoryLedgerView(history: historyDesktops, router: history) { need in
      historyDesktops.need(need)
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      Color.clear.frame(height: AppBar.clearance(homeInset: homeInset, stepper: history.stepperShowing))
    }
  }

  private var searchTab: some View {
    HistorySearchView(
      desktops: historyDesktops.readers, query: $searchQuery, kind: $searchKind,
      onLand: { landing, query in
        // A hit lands in History: the router pushes where it lives, and the
        // switch follows.
        searchFocused = false
        history.land(landing, query: query)
        selectedTab = .history
      },
      onSearch: { words, kind in
        // SP-6 — the words asked of every desktop that answers
        Task { await historyDesktops.search(words, kind: kind) }
      }
    )
    .safeAreaInset(edge: .bottom, spacing: 0) {
      Color.clear.frame(height: AppBar.clearance(homeInset: homeInset, stepper: false))
    }
  }

  /// The bar (IOS-9e): the account at the left, the tabs at the centre,
  /// search at the right, all 62 pt of glass on one row (`AppBar`).
  ///
  /// IOS-8b — the corner is the account (AP-D1): the face replaced the mesh
  /// chip, the line under it and the mesh sheet, and the one thing that still
  /// needs the person is a dot beside the face. While its menu stands, a tap
  /// anywhere else folds it — the clear layer below catches the tap before the
  /// field's own gesture can spend it on a hold — and the rest of the bar
  /// folds away (the page's rule: an expanded surface folds its neighbours).
  private var bar: some View {
    ZStack(alignment: .bottom) {
      if accountMenuOpen {
        Color.clear
          .contentShape(Rectangle())
          .ignoresSafeArea()
          .onTapGesture { setAccountMenu(open: false) }
      }
      barRow
        .padding(.bottom, barTyping ? AppBar.gapAboveKeyboard : AppBar.bottomGap(homeInset: homeInset))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    .ignoresSafeArea(.container, edges: .bottom)
    .animation(reduceMotion ? .easeInOut(duration: 0.2) : AppBar.motion, value: barState)
  }

  @ViewBuilder
  private var barRow: some View {
    ZStack(alignment: .bottom) {
      if selectedTab != .search && !barFolded {
        accountCorner
          .padding(.leading, AppBar.margin)
          .frame(maxWidth: .infinity, alignment: .bottomLeading)
          .transition(.opacity)
      }
      GlassGroup(spacing: AppBar.meltSpacing) {
        ZStack(alignment: .bottom) {
          if barStepper {
            stepper
          }
          if selectedTab == .search {
            SearchBarRow(query: $searchQuery, focus: $searchFocused, typing: barTyping, glass: barGlass, onClose: closeSearch)
              .padding(.horizontal, barTyping ? AppBar.marginTyping : AppBar.margin)
          } else if !accountMenuOpen {
            if barFolded {
              foldedTabs
                .padding(.leading, AppBar.margin)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
              TabCapsule(selection: $selectedTab, waiting: waitingCount, pill: tabPill)
                .liquidGlassCapsule()
                .glassID("tabs", in: barGlass)
            }
            searchCircle
              .padding(.trailing, AppBar.margin)
              .frame(maxWidth: .infinity, alignment: .trailing)
          }
        }
      }
    }
  }

  /// What the bar's animation follows. The account menu is NOT in it: that
  /// change rides the menu's own curve (`setAccountMenu`), and an implicit
  /// animation here would override it.
  private struct BarState: Equatable {
    var tab: AppTab
    var folded: Bool
    var stepper: Bool
    var typing: Bool
  }

  private var barState: BarState {
    BarState(tab: selectedTab, folded: barFolded, stepper: barStepper, typing: barTyping)
  }

  /// History's scroll has folded the bar to its glyph (the page's minimize).
  private var barFolded: Bool { selectedTab == .history && history.barMinimized && !accountMenuOpen }
  /// A landed search is on top: the stepper rides the bar.
  private var barStepper: Bool { selectedTab == .history && history.stepperShowing && !accountMenuOpen }
  /// A software keyboard stands under search: the row rides above it at the
  /// system's typing size. Focus alone is not enough — with a hardware
  /// keyboard the field is focused and no keyboard rises, and the row stays
  /// where it rests.
  private var barTyping: Bool { selectedTab == .search && keyboardInset > homeInset + 40 }

  private var accountCorner: some View {
    AccountCornerView(
      face: accountFace,
      isOpen: accountMenuOpen,
      seed: accountSeed,
      onToggle: { setAccountMenu(open: !accountMenuOpen) },
      onSettings: {
        setAccountMenu(open: false)
        settingsSheetOpen = true
      },
      onSignOut: {
        setAccountMenu(open: false)
        signOutPending = true
      },
      onConnection: { act in
        setAccountMenu(open: false)
        performConnection(act)
      }
    )
  }

  private var searchCircle: some View {
    Button(action: openSearch) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: AppBar.searchGlyph, weight: .medium))
        .foregroundStyle(ChromePalette.ink)
        .frame(width: AppBar.height, height: AppBar.height)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .liquidGlassCircle()
    .glassID("search", in: barGlass)
    .accessibilityLabel("Search")
  }

  /// The capsule, folded to the standing tab's glyph at the left — where the
  /// face was; the face folds with it (the page's reading state). A tap opens
  /// the bar again, as a scroll back up does.
  private var foldedTabs: some View {
    Button {
      history.barMinimized = false
    } label: {
      Image(systemName: "clock.arrow.circlepath")
        .font(.system(size: AppBar.symbolSize, weight: .medium))
        .foregroundStyle(ChromePalette.ink)
        .frame(width: AppBar.height, height: AppBar.height)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .liquidGlassCircle()
    .glassID("tabs", in: barGlass)
    .accessibilityLabel("History")
    .accessibilityHint("Shows the tabs")
  }

  /// The match stepper: above the bar, or inline between the folded tab and
  /// the search circle.
  private var stepper: some View {
    HistoryStepperView(router: history)
      .frame(height: barFolded ? AppBar.height : AppBar.stepperHeight)
      .liquidGlassCapsule()
      .glassID("stepper", in: barGlass)
      .padding(.horizontal, barFolded ? AppBar.margin + AppBar.height + AppBar.inlineGap : AppBar.margin)
      .padding(.bottom, barFolded ? 0 : AppBar.height + AppBar.stepperGap)
  }

  /// The search circle becomes the field (their shared `glassID`), and the
  /// keyboard comes up once the field exists to take it.
  private func openSearch() {
    if selectedTab != .search { tabBeforeSearch = selectedTab }
    selectedTab = .search
    Task {
      try? await Task.sleep(for: .milliseconds(120))
      searchFocused = true
    }
  }

  private func closeSearch() {
    searchFocused = false
    selectedTab = tabBeforeSearch == .search ? .field : tabBeforeSearch
  }

  /// One curve for the menu's grow and the bar's fold, so they move together.
  private func setAccountMenu(open: Bool) {
    withAnimation(AccountCornerView.grow) { accountMenuOpen = open }
  }

  /// The Field tab's orange count (§2.5): the agents waiting on the person.
  private var waitingCount: Int { bubbles.filter { $0.status == .blocked }.count }

  /// SP-6 — what History reads: the link's self desktops, each over its own
  /// door (the home's shared, the rest opened for the reading — SP-D2 (a)),
  /// the home first; a desktop the roster lists but whose door does not
  /// answer, and one this account remembers that the tailnet does not list,
  /// replay the cache as `asleep`. The mock and the demo arguments own the
  /// readers while they stand.
  private func syncHistoryDesktops() {
    #if DEBUG
      if mock != nil || demoHistory { return }
    #endif
    guard let link else {
      historyDesktops.allOffline()
      return
    }
    historyDesktops.setHome(link.home)
    for desktop in link.desktops {
      let isHome = desktop.deviceId == link.home
      if case .ready = desktop.state {
        if let standing = historyDesktops.reader(for: desktop.deviceId), !standing.isReplaying, standing.isHome == isHome {
          continue
        }
        if let door = link.openHistoryDoor(desktop.deviceId) {
          historyDesktops.attach(
            deviceId: desktop.deviceId, name: desktop.name, isHome: isHome, door: door.client,
            ownsDoor: door.owned)
          continue
        }
      }
      historyDesktops.markOffline(deviceId: desktop.deviceId, name: desktop.name, isHome: isHome)
    }
    if let login = accountLogin {
      for remembered in desktopMemory.remembered(for: login)
      where !link.desktops.contains(where: { $0.deviceId == remembered.deviceId }) {
        historyDesktops.markOffline(deviceId: remembered.deviceId, name: remembered.name)
      }
    }
    // PJ-7 — the one ledger of projects reads the home's door, else another
    // answering desktop's
    historyDesktops.chooseLedger(roster: historyRoster)
  }

  /// PJ-7 — the desktops as History's ledger draws them: the mark (the
  /// platform), whether this phone hears it, and the home.
  private var historyRoster: [FieldHistoryModel.RosterDesktop] {
    (link?.desktops ?? []).map { desktop in
      FieldHistoryModel.RosterDesktop(
        id: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        awake: desktop.state == .ready, isHome: desktop.deviceId == link?.home)
    }
  }

  /// The link's home, named so the modifier chain stays cheap to type-check.
  private var linkHome: String? { link?.home }

  #if DEBUG
    /// The mock's standing as History reads it (`-vf-mock`: Disconnect puts
    /// studio to sleep, Connect wakes it).
    private var mockDesktopIsUp: Bool? { mock?.desktopIsUp }

    private func syncMockHistory() {
      guard let mock else { return }
      historyDesktops.mount(
        .fixed(corpus: .mock, standing: mock.desktopIsUp ? .connected : .asleep))
    }
  #endif


  public var body: some View {
    tabs
      .background(FieldPalette.panelBackground.ignoresSafeArea())
    .onAppear {
      assembly.projects = projectStore.load()
      refold()
      #if DEBUG
        // RETIRED 2026-09-14 (TM-3): `-vf-write-key=<secret>`, which swapped
        // the Keychain for an in-memory store so a headless `-vf-auto-attach`
        // could type. There is no key to seed — whether the phone may type is
        // the desktop's grant, which a fixture cannot forge and should not.
        // Headless smoke hooks (the GhostteaApp pattern: opt-in automation,
        // Debug-only): drive flows a simulator run can't tap into.
        if ProcessInfo.processInfo.arguments.contains("-vf-auto-connect") {
          accountMenuOpen = true
          mesh.connect()
        }
        // IOS-9d — `-vf-mock`: the whole phone over invented facts and no
        // tailnet. The account is `MockAccount`'s (signed in, 🦊, studio up
        // and mini asleep; every act in the corner moves its standing), the
        // field is the scripted fleet, History is the records' corpus and
        // search runs over it. `-vf-mock-tab=history|search` opens a page,
        // `-vf-mock-open` grows the corner's menu, `-vf-mock-signed-out`
        // starts on the `Sign in` circle, `-vf-mock-search=<q>` fills the
        // search field, `-vf-mock-landed` lands the second hit of the first
        // group, and `-vf-mock-folded` folds the bar as a scroll down would.
        if ProcessInfo.processInfo.arguments.contains(MockAccount.argument), mock == nil {
          let account = MockAccount()
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-signed-out") { account.standing = .signedOut }
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-off") { account.standing = .off }
          mock = account
          mockActive = true
          feed.start()
          syncMockHistory()
          if let search = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-mock-search=") }) {
            searchQuery = String(search.dropFirst("-vf-mock-search=".count))
          }
          if let tab = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-mock-tab=") }) {
            switch tab.dropFirst("-vf-mock-tab=".count) {
            case "history": selectedTab = .history
            case "search": openSearch()
            default: selectedTab = .field
            }
          }
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-landed"), let group = HistoryCorpus.mock.hits.first,
            group.rows.count > 1
          {
            let query = searchQuery.isEmpty ? "badge" : searchQuery
            history.land(FieldHistoryModel.landing(for: group.rows[1], in: group, corpus: .mock), query: query)
            selectedTab = .history
          }
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-open") { accountMenuOpen = true }
          if let open = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-mock-project=") }) {
            let id = String(open.dropFirst("-vf-mock-project=".count))
            if HistoryCorpus.mock.project(id) != nil {
              history.path = [.project(id: id)]
              selectedTab = .history
            }
          }
          if let open = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-mock-session=") }) {
            // a document on top, for the screenshot run
            let id = String(open.dropFirst("-vf-mock-session=".count))
            if let document = HistoryCorpus.mock.document(id) {
              history.path = [
                .project(id: document.projectId),
                .session(device: HistoryCorpus.mock.deviceId, id: id),
              ]
              selectedTab = .history
            }
          }
          // After the tab's own change has opened the bar again, or it would
          // undo the fold the moment it landed.
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-folded") {
            Task {
              try? await Task.sleep(for: .milliseconds(600))
              history.barMinimized = true
            }
          }
        }
        // SP-6 — History's pictures without a desktop (`-vf-demo-history`:
        // the mock's corpus as the one group, awake or `-asleep`) and the REAL
        // reads over an in-process door answering the contracts' goldens
        // (`-vf-demo-history-door`; `-vf-demo-history-offline` reads them,
        // then takes the door away so the cache's replay can be photographed;
        // `-vf-demo-history-session=<id>` puts a document on top, the tail's
        // scripted delta arriving two seconds in for the arrival pill).
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-history"), !demoHistory {
          demoHistory = true
          let asleep = ProcessInfo.processInfo.arguments.contains("-vf-demo-history-asleep")
          historyDesktops.mount(.fixed(corpus: .mock, standing: asleep ? .asleep : .connected))
          selectedTab = .history
        }
        if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("-vf-demo-history-door") || $0.hasPrefix("-vf-demo-history-offline") }), !demoHistory {
          demoHistory = true
          let offline = ProcessInfo.processInfo.arguments.contains("-vf-demo-history-offline")
          let door = HistoryFixtureDoor()
          // PJ-7 — the goldens' own desktops: `studio` answers (its door is
          // the fixture's), `laptop` sleeps
          let studio = "01J9ZK3M5Q8XR2V7N4B6C1D0EF"
          let roster = [
            FieldHistoryModel.RosterDesktop(id: studio, name: "studio", platform: "darwin", awake: true, isHome: true),
            FieldHistoryModel.RosterDesktop(
              id: "01J9ZM0PQ7W3E6R8T2Y4U1I5O9", name: "laptop", platform: "win32", awake: false, isHome: false),
          ]
          historyDesktops.attach(deviceId: studio, name: "studio", isHome: true, door: door, ownsDoor: true)
          historyDesktops.chooseLedger(roster: roster)
          selectedTab = .history
          let open = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-demo-history-session=") })
            .map { String($0.dropFirst("-vf-demo-history-session=".count)) }
          Task { @MainActor in
            // the ledger first (the reads are one in-process answer each),
            // then the document asked for, then — offline — the door goes
            var waited = 0
            while historyDesktops.projects.corpus.projects.isEmpty, waited < 50 {
              try? await Task.sleep(for: .milliseconds(100))
              waited += 1
            }
            if let project = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-demo-history-project=") })
              .map({ String($0.dropFirst("-vf-demo-history-project=".count)) })
            {
              historyDesktops.need(.project(id: project))
              history.path = [.project(id: project)]
            }
            if let open {
              historyDesktops.need(.session(device: studio, id: open))
              waited = 0
              while historyDesktops.reader(for: studio)?.corpus.document(open) == nil, waited < 50 {
                try? await Task.sleep(for: .milliseconds(100))
                waited += 1
              }
              history.path = [.session(device: studio, id: open)]
            }
            if offline {
              historyDesktops.forget(deviceId: studio)
              historyDesktops.markOffline(deviceId: studio, name: "studio", isHome: true)
              historyDesktops.chooseLedger(roster: roster)
              if let open { historyDesktops.reader(for: studio)?.replayDocument(open) }
            }
          }
        }
        // IOS-8e — the corner's states, photographed. The decision is the
        // shipping one over invented inputs; `-vf-demo-account-open` grows the
        // menu, which a headless run could not tap.
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(AccountFixtures.argument) }) {
          let state = String(argument.dropFirst(AccountFixtures.argument.count).drop(while: { $0 == "=" }))
          demoAccount = AccountFixtures.face(named: state)
          if demoAccount == nil { print("unknown account fixture:", state) }
          if ProcessInfo.processInfo.arguments.contains(AccountFixtures.openArgument) {
            accountMenuOpen = true
          }
        }
        // `-vf-demo-remote` stands a FAKE peer up so the remote bubble's own
        // rendering — the prompt glyph, the machine in the eyebrow, no
        // context readout, the card's attach invitation — can be eyeballed
        // without a desktop serving on the tailnet. It is a fixture for
        // looking at OUR pixels, never a claim that a mesh answered: it
        // cannot run in Release, and the real source replaces it the moment
        // `mesh.state` reaches `.up`.
        // The scripted fleet, now behind its own door. Every argument that
        // shows the field's OWN pixels wants it; nothing else does.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-fleet")
          || ProcessInfo.processInfo.arguments.contains(where: {
            $0.hasPrefix("-vf-swarm-lab")
          })
        {
          mockActive = true
          feed.start()
        }
        // `-vf-demo-field-slice`: the contracts' golden MESH board through the
        // REAL home path (DS-8, 2026-10-01) — four desktops on the fixture's
        // tailnet, the phone homing to the first whose door answers and reading
        // the field through its `agent.subscribe {scope: "mesh"}`: the home's
        // board, a live laptop's, a sleeping desktop's kept board GREYED, and a
        // stale one with none. The network is an in-process door answering the
        // contracts' own bytes, so the swarm AND the corner can be photographed
        // over real-shaped rows in both themes with no desktop and no tailnet.
        // It is not a demo path: nothing downstream of the door knows the
        // difference, which is the point. (Before DS-8 this was the golden
        // `field.agents.v1` slice through the store reader, retired by DS-D14.)
        //
        // `link == nil` because this whole block runs again on every return to
        // the view: without it a disappear/reappear built a SECOND fixture
        // link and stranded the first, which is the live path's own stranding
        // bug wearing a fixture.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-field-slice"), link == nil,
          let fixture = FieldLink.goldenFixture()
        {
          fixture.start()
          link = fixture
          fixtureLink = true
        }
        // `!demoRemoteActive` for the reason the line above carries: a second
        // appearance would otherwise replace a running fixture field with a
        // fresh one and never stop the first.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-remote"), !demoRemoteActive {
          demoRemoteActive = true
          remoteField = RemoteSessionField(source: DemoRemoteSource())
          remoteField.start()
        }
        // --- IOS-5e ------------------------------------------------------
        // `-vf-demo-landscape`: turn the scene on its side.
        //
        // The card's landscape and iPad behaviour is a real question — nine
        // equal keys across a 900 pt inset are not keys any more, which is why
        // `InputCardMetrics.maximumWidth` exists — and `simctl` cannot answer
        // it: `xcrun simctl ui` offers appearance, contrast and content size,
        // and nothing that rotates a device. Rotating by hand needs
        // Simulator.app, which a headless run does not have. So the rotation
        // becomes a launch argument, for exactly the reason every other
        // argument in this block exists: it is the only way to a picture of a
        // state, and it cannot run in Release.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-landscape") {
          requestLandscape()
        }
        // --- end IOS-5e ---------------------------------------------------
        if ProcessInfo.processInfo.arguments.contains("-vf-open-settings") {
          settingsSheetOpen = true
        }
        // --- IOS-6c: the swarm design lab — the reference's fixture stages on
        // this phone's renderer, the screenshot gate for every pixel slice.
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-swarm-lab") }) {
          // `-vf-swarm-lab=states:3` opens one page so a screenshot run,
          // which cannot scroll, reaches every stage.
          swarmLabFocus = LabFocus(argument: String(argument.dropFirst("-vf-swarm-lab".count).drop(while: { $0 == "=" })))
          swarmLabOpen = true
        }
        // --- end IOS-6c
        // RETIRED 2026-09-14 (TM-3): `-vf-open-write-key`, which opened the key
        // sheet a headless run could not tap its way to. The sheet is deleted.
        // --- IOS-5a ------------------------------------------------------
        // The card needs a LIVE attachment this device may type into, and a
        // simulator has no mesh — so this forces the face and prints the acts
        // instead of sending them. It is a fixture for looking at our own
        // pixels; nothing here can run in Release.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-card") {
          demoInputCard = true
          inputCard.sink = { act in print("input act:", act) }
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-live") {
            inputCard.mode = .live
          } else {
            inputCard.fieldFocused = true
          }
          // The states a screenshot cannot tap its way into: a filled draft
          // (inverted Send, the field grown past one line) with the latch
          // held (inverted CTRL and its dot). Fixture text, plainly so.
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-draft") {
            inputCard.draft = "git status --short\ngit log --oneline -5"
            // LOCKED rather than armed: an armed latch has a 3 s window and
            // would be gone before a screenshot could be taken, which is the
            // window working rather than the fixture failing.
            inputCard.tapControl()
            inputCard.tapControl()
          }
          // --- IOS-5b: the two states a long press is the only way into ----
          // The fan is opened after the card is on screen — a popover anchored
          // to a key that does not exist yet has nothing to point at.
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-fan") {
            Task {
              try? await Task.sleep(for: .seconds(3))
              inputCard.showFan(.control)
            }
          }
          // The burst is a 3 s window BY DESIGN, and a screenshot run is
          // slower than that. So the fixture re-arms it on a loop rather than
          // pretending the window is longer than it is — the state in the
          // picture is the real one, held open by a fixture that says so.
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-meta") {
            Task {
              for _ in 0..<600 {
                inputCard.armMeta()
                try? await Task.sleep(for: .seconds(1))
              }
            }
          }
          // --- end IOS-5b --------------------------------------------------
          // --- IOS-5d mic --------------------------------------------------
          // Listening is a state a headless run cannot reach: it wants two
          // permission alerts answered by a finger and a voice to speak into a
          // simulator that has, at best, the Mac's own microphone. So this
          // forces the FACE — an inverted, breathing mic key — and seeds the
          // draft through the real `appendDictation`, so the picture shows the
          // actual rule that puts heard words in the draft rather than a mock
          // of one. Nothing here opens an audio session or asks Speech for
          // anything: our own pixels, never a claim that something was heard.
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-dictating") {
            DictationSession.demoListening = true
            inputCard.appendDictation("run the tests and show me what fails")
          }
          // --- end IOS-5d mic ----------------------------------------------
        }
        // --- end IOS-5a --------------------------------------------------
        // --- IOS-5c ------------------------------------------------------
        // The arguments are re-read rather than the `demoInputCard` flag being
        // consulted: it was assigned two lines up, and a card whose fixture
        // silently did nothing because a `@State` had not settled is exactly
        // the kind of thing a fixture must not be able to do.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-card") {
          // The fixture has no Metal surface to report a first responder, so
          // the flag the strip is derived from is stamped rather than earned.
          if inputCard.mode == .live { inputCard.terminalFocused = true }
          // The keyboard DOWN: the card collapses to the closed row — which on
          // a real card is simply how a session opens.
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-input-closed") {
            inputCard.fieldFocused = false
            inputCard.terminalFocused = false
          }
          // A pending permission that no bubble on this field can carry: a
          // remote terminal has no agent facet, which is today's reality
          // rather than a bug. The chips and the acts they emit are the
          // shipping code; the permission they answer is invented, and the
          // README says so.
          demoInputChips =
            ProcessInfo.processInfo.arguments.contains("-vf-demo-input-chips")
          // The review sheet is otherwise reachable only by tapping a SYSTEM
          // paste control with five lines on the pasteboard, and a headless
          // run can do neither — so its pixels could never be looked at. The
          // same door `-vf-open-write-key` opens, for the same reason.
          if ProcessInfo.processInfo.arguments.contains("-vf-demo-paste-review") {
            inputCard.pendingPasteReview = PendingPaste(
              text: """
                #!/bin/sh
                set -eu
                cd ~/Projects/project100/vibe-field
                pnpm install --frozen-lockfile
                pnpm verify
                """)
          }
          // --- IOS-5d ----------------------------------------------------
          // Every door IOS-5d added is opened by a finger and by nothing else:
          // the keypad replaces the system keyboard, the `+` menu is a
          // popover, and the two sheets hang off it. A headless run can reach
          // none of them, which would make the whole slice unlookable — the
          // same reason `-vf-open-write-key` and `-vf-demo-paste-review`
          // exist, and the same disclaimer: these force the FACE, and no
          // fixture here claims a terminal answered.
          //
          // They wait, because the card has to be on screen first: a keypad
          // needs a responder to rise under and a sheet needs a presented
          // card to rise from.
          let keypadArgument = ProcessInfo.processInfo.arguments.first {
            $0.hasPrefix(DemoArguments.keypad)
          }
          let showSnippets =
            ProcessInfo.processInfo.arguments.contains("-vf-demo-input-snippets")
          let showHistory =
            ProcessInfo.processInfo.arguments.contains("-vf-demo-input-history")
          let showPlus = ProcessInfo.processInfo.arguments.contains("-vf-demo-input-plus")
          let showScan = ProcessInfo.processInfo.arguments.contains("-vf-demo-input-scan")

          // A scratch defaults suite, wiped at launch: a fixture must never
          // write into the snippets or the history a real user has.
          if showSnippets {
            let suite = UserDefaults(suiteName: DemoArguments.suite)
            suite?.removePersistentDomain(forName: DemoArguments.suite)
            let store = SnippetStore(defaults: suite ?? .standard)
            store.add(
              Snippet(title: "STATUS", text: "git status --short", sendsEnter: true))
            snippets = store
          }
          if showHistory {
            let suite = UserDefaults(suiteName: DemoArguments.suite)
            suite?.removePersistentDomain(forName: DemoArguments.suite)
            let store = ClipboardHistory(defaults: suite ?? .standard)
            store.record("cd ~/Projects/project100/vibe-field && pnpm verify")
            store.record(
              "error: could not read Username for 'https://github.com'\nfatal: could not "
                + "read from remote")
            clipboardHistory = store
          }

          if keypadArgument != nil || showSnippets || showHistory || showPlus || showScan {
            Task {
              try? await Task.sleep(for: .seconds(3))
              if let keypadArgument {
                inputCard.keypadPage = DemoArguments.page(from: keypadArgument)
                inputCard.setKeypad(true)
              }
              if showPlus { inputCard.showPlusMenu() }
              if showSnippets { inputCard.surface = .snippets }
              if showHistory { inputCard.surface = .clipboardHistory }
              if showScan { inputCard.surface = .scanText }
            }
          }
          // --- end IOS-5d ------------------------------------------------
        }
        // --- end IOS-5c --------------------------------------------------
        if ProcessInfo.processInfo.arguments.contains("-vf-auto-open-card") {
          Task {
            try? await Task.sleep(for: .seconds(2))
            // A bubble with a TERMINAL first when there is one: its face is
            // the one with an act on it, so it is what a screenshot run is
            // usually after. Since TM-5 that is a fold row whose join names a
            // session — a remote row is the DEBUG fixture's, and is kept as
            // the fallback for exactly that reason.
            let wanted =
              bubbles.first(where: { $0.agent?.join?.hasTerminal == true })
              ?? bubbles.first(where: { $0.remote?.attachable == true })
              ?? bubbles.first(where: { $0.status == .working })
              ?? bubbles.first
            if let wanted { openCard(on: wanted) }
            // `-vf-auto-attach` carries the run one step further: on a phone
            // whose mesh is up against a serving desktop, this is the whole
            // path — hear the fold, choose, mint, dial — with no finger on the
            // glass. Without a mesh it proves the honest-failure path instead,
            // which is the other thing worth seeing.
            //
            // The guard is the CARD's own face, which `openCard` above has
            // just set the subject for: asking the bubble directly would have
            // to re-derive the join, and two answers to "may this attach" is
            // exactly what the face exists to prevent.
            if ProcessInfo.processInfo.arguments.contains("-vf-auto-attach"),
              let wanted, cardTerminalFace.offersAttach
            {
              try? await Task.sleep(for: .seconds(1))
              beginAttachment(to: wanted)
            }
          }
        }
      #endif
      // The counterpart of `onDisappear`'s parks, and it was missing. A
      // disappear and reappear with no scene-phase change left the link paused
      // and the poll stopped for good: only `onChange(of: mesh.state)` or
      // `onChange(of: scenePhase)` revived either, and neither fires when a
      // view merely comes back. `resume()` is idempotent (it guards on
      // `isPaused`), and `syncDiscovery` is the one decision that owns the
      // poll — with no mesh it answers `.none` rather than tearing anything
      // down, so a fixture on a phone with no tailnet survives it.
      link?.resume()
      syncDiscovery(meshIsUp: mesh.state == .up, phase: scenePhase)
      // TM-3 — a phone upgrading from a build that held mirror-write keys has
      // secrets in its Keychain that nothing can read, use or offer to remove.
      // This deletes them, once, without ever reading a value.
      RetiredWriteKeyCleanup.runOnce()
    }
    .onDisappear {
      feed.stop()
      // Parked with discovery, for the same reason: the door is still good if
      // this view comes back, and a re-dial per appearance is a hello nobody
      // asked for.
      link?.pause()
      // Parked, not closed: the door is still good if this view comes back.
      remoteField.stop()
      discoveryPolling = false
    }
    // Discovery follows the mesh AND the stage, and both are read through one
    // decision so neither can leave the flag disagreeing with the poll: a
    // directory exists only while a runtime does, and the poll belongs to the
    // stage (PF6's spirit) — no mesh, no asking, and the field says `no-door`
    // rather than inventing an empty answer.
    .onChange(of: mesh.state) { _, state in
      syncDiscovery(meshIsUp: state == .up, phase: scenePhase)
    }
    // RETIRED 2026-09-14 (TM-3): the IOS-4d trigger that asked each desktop for
    // this device's write key the moment it finished hello. There is no door to
    // ask and no key to hold.
    .onChange(of: scenePhase) { _, phase in
      // The phase is passed rather than re-read: inside this closure the
      // environment's own value is the one thing we should not have to guess
      // about, and guessing wrong is what stranded the poll before.
      syncDiscovery(meshIsUp: mesh.state == .up, phase: phase)
      // IOS-4b / §5 — the field's own background rule, and the one place it
      // lives. The door's subscription and the stores' streams go; the mesh
      // node and the WebSocket stay, because a hello per app switch is the
      // opposite of a budget.
      //
      // A DEVIATION, deliberate: the plan says "scenePhase != .active", and
      // this parks only on a real `.background`. `.inactive` is transient on
      // iOS — the app switcher's first frame, a notification shade — and
      // discovery already learned that parking there flaps
      // (`FieldHomeModel.discoveryAction`'s own comment). Tearing a
      // subscription down and rebuilding it on every shade pull would spend
      // exactly the bytes §5 is trying to save.
      switch phase {
      case .background:
        link?.pause()
        historyDesktops.pause()  // SP-6 — the tails go; the rows stay
      case .active:
        link?.resume()
        historyDesktops.resume()
      default: break
      }
      switch phase {
      case .active:
        // Routes internally: suspended-by-app becomes a real resume, a live
        // session only re-snapshots. Calling upstream's resume on a session
        // that never left would force a spurious reconnect.
        attachment?.resumeFromForeground()
        // --- IOS-5c: coming back is the other honest moment to look at the
        // pasteboard — copying happens in the app the user just left.
        pasteboard.sample()
        // --- end IOS-5c
      case .background:
        // The orderly counterpart — without it `resumeFromForeground` has
        // nothing to resume from (upstream §8.2).
        attachment?.suspendForBackground()
      default:
        break
      }
    }
    // The card's subject follows the field while the field still has one, and
    // deliberately does NOT follow it away: a row that leaves is the listing's
    // news, not the connection's, and `FieldHomeModel.cardFace` decides what
    // that means.
    .onChange(of: bubbles) { _, next in
      guard let selection, let match = next.first(where: { $0.id == selection.id }) else { return }
      cardBubble = match
      // --- IOS-5c: the row IS the feed, re-derived rather than accumulated.
      // A permission resolved anywhere takes its chips off the card here, and
      // `tapChip` refuses anything that is no longer on the row.
      inputCard.chips = replyChips(for: match)
      // --- end IOS-5c
    }
    .sheet(item: $selection, onDismiss: { closeCard() }) { selected in
      sessionCard(selected)
        // Attaching earns the room: a terminal at the 0.55 detent is a
        // letterbox, and the keyboard would take what is left.
        .presentationDetents(attachment == nil ? [.fraction(0.55), .large] : [.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .fieldGlassSheet()
    }
    .sheet(isPresented: $settingsSheetOpen) {
      settingsSheet
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .fieldGlassSheet()
    }
    // RETIRED 2026-09-14 (TM-3): the write-key sheet, which took a pasted
    // capability or asked the desktop for one. Both doors are deleted.
    // RETIRED 2026-09-23 (IOS-8b): the mesh sheet. Its status sentence, its
    // account line, its one act and its roster are the account menu's now.
    // The Tailscale login page. One presenter at root: an arriving login folds
    // the account menu first, so the page never rises under an open menu.
    .onChange(of: mesh.loginPage) {
      if mesh.loginPage != nil { setAccountMenu(open: false) }
    }
    .sheet(
      item: Binding(
        get: { mesh.loginPage },
        set: { page in if page == nil { mesh.loginSheetDismissed() } })
    ) { page in
      SafariView(url: page.url)
        .ignoresSafeArea()
    }
  }

  /// The directory is an `await` (it lives on the runtime actor), so opening
  /// the door is a task rather than a property read. `discoveryPolling` keeps a
  /// re-entrant mesh event — several `.up`s arrive as peers settle — from
  /// building a second field beside the one already polling, and every path
  /// that stops the poll goes through here so the flag can never outlive it.
  private func syncDiscovery(meshIsUp: Bool, phase: ScenePhase) {
    #if DEBUG
      // The demo fixture owns the field while it is up; a mesh that is merely
      // off must not tear down the thing we are looking at.
      if demoRemoteActive { return }
    #endif
    switch FieldHomeModel.discoveryAction(
      meshIsUp: meshIsUp, phase: phase, polling: discoveryPolling, hasDoor: remoteField.hasDoor)
    {
    case .none:
      return
    case .park:
      remoteField.stop()
      discoveryPolling = false
    case .closeDoor:
      // The runtime this field's directory belonged to is gone, and
      // `MeshModel.connect()` builds a new one — so the source is void, not
      // merely idle. A door-less field says `.noDoor`, which is the honest
      // state: nobody has been asked, rather than a mesh that answered empty.
      remoteField.stop()
      remoteField = RemoteSessionField(source: nil)
      closeLink()
      discoveryPolling = false
    case .resume:
      remoteField.start()
      discoveryPolling = true
    case .open:
      // TM-5 — there is no live REMOTE-SESSION source any more. The per-host
      // `list-sessions` poll dialed a TSP1 port no floor has served since TM-1,
      // and under T the phone's discovery is the fold: a row names its session,
      // the door mints a ticket for it. So the field keeps its door-less state
      // (`.noDoor` — nobody has been asked, which is true) and the LINK is what
      // opens here.
      discoveryPolling = true
      openLink()
    }
  }

  /// IOS-4b — the field's own door, opened beside discovery's and on the same
  /// trigger. It reads the mesh NODE rather than Ghosttea's peer directory:
  /// a synced store is truffle's own protocol, and `field.devices.v1` is where
  /// a desktop's capability URL lives.
  private func openLink() {
    var fixtureOwnsLink = false
    #if DEBUG
      // A fixture link owns the field while it is up — whichever argument
      // installed it. This used to read `mockActive || demoRemoteActive`, and
      // `-vf-demo-field-slice` (the one argument that installs a LINK) sets
      // neither: the two flags it did read own what the field DRAWS, so the
      // block's only effect was skipping a resume on paths that have no
      // fixture link at all.
      fixtureOwnsLink = fixtureLink
    #endif
    switch FieldHomeModel.linkOpenAction(
      fixtureOwnsLink: fixtureOwnsLink, hasLink: link != nil, isOpening: linkOpening)
    {
    case .none:
      return
    case .resume:
      link?.resume()
    case .open:
      // Assigned HERE, synchronously, before the task suspends: the flag is
      // the whole fix. `mesh.node` is an await, and two callers inside that
      // window — a scene-phase flap reaches this through discovery — each
      // built a link with two `FieldStore`s and its own sockets, the second
      // overwrote the first, and nothing was left holding the first to stop
      // it.
      linkOpening = true
      Task {
        defer { linkOpening = false }
        guard let node = await mesh.node else { return }
        // The transport is the MESH's session, not the system's: this phone's
        // tailnet is a userspace netstack in this process, and a plain
        // URLSession does not route over it. The suffix is this node's own
        // tailnet domain, which is what lets a peer's published door be checked
        // against an address the mesh vouches for (EL7 M1).
        let suffix = await mesh.magicDNSSuffix
        // UA-P-5 — the two account facts, asked of the runtime in the same
        // breath as the node. The GATE decides whether this link may read the
        // synced-store bus at all: a store reaches every node in the app's
        // namespace, so only a node gated on this account's login has an
        // audience the ruling allows. The LOGIN is what tells this account's
        // desktop from a stranger's before a socket is spent on either.
        let gated = await mesh.nodeIsGatedOnAccount
        let login = await mesh.nodeLoginName
        // The link may have been closed while the node and the suffix were
        // being fetched (a mesh that left runs `closeLink`), and a link built
        // on a node from before that is one nobody asked for.
        guard link == nil else { return }
        let opened = FieldLink(
          storeDoors: .live(node: node),
          transport: meshProductTransport(node: node),
          // UA-P-1a — discovery's own probe, on the mesh's network. The
          // default is the system's session, which is right for a loopback
          // door and would call every desktop on the tailnet unreachable.
          probe: meshDoorProbe(node: node),
          magicDNSSuffix: suffix,
          storeBus: FieldStoreBus.enabledByDefault && gated,
          selfLogin: login,
          // SP-2 (g) — the phone's ONE connection budget, shared with every
          // terminal attachment (`beginAttachment`).
          budget: .shared,
          // DS-8 — the desktop this login last read its field through: the
          // home it prefers when that door answers (sign out forgets it).
          homeMemory: HomeMemory())
        opened.start()
        link = opened
      }
    }
  }

  /// The runtime is gone, so the stores' streams and every door with it. A
  /// link with no node is not a paused link — it is one whose mesh no longer
  /// exists, and `MeshModel.connect()` builds a different one.
  private func closeLink() {
    link?.stop()
    link = nil
    historyDesktops.allOffline()  // SP-6 — every History group replays the cache
    #if DEBUG
      // A fixture that has been stopped no longer owns anything, and a flag
      // left standing would refuse the live path for the rest of the process.
      fixtureLink = false
    #endif
  }

  // MARK: - Sheets

  private func sessionCard(_ selected: SessionSelection) -> some View {
    // The subject is the remembered one; the field is only asked whether it
    // still LISTS it. Looking the subject up fresh here is what let a discovery
    // blip replace a live terminal with "this session left the field".
    let listed = bubbles.contains(where: { $0.id == selected.id })
    let bubble = cardBubble
    return SessionCardView(
      bubble: bubble,
      listed: listed,
      isAttached: attachment != nil,
      statusNote: attachmentNote,
      statusDetail: attachmentDetail,
      statusActions: attachmentActions,
      cooled: attachment?.banner?.coolsTerminal ?? false,
      onAttach: { if let bubble { beginAttachment(to: bubble) } },
      onSettings: { cardSettingsOpen = true },
      terminalReason: cardTerminalFace.note
    ) {
      liveTerminal(title: bubble?.project)
    }
    // IOS-8g — the appearance sheet, from the card's `···`, on the card's own
    // presenter (the root is behind this sheet).
    .sheet(isPresented: $cardSettingsOpen) {
      settingsSheet
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .fieldGlassSheet()
    }
    // --- IOS-5a: the card rides the bottom safe area, above the keyboard ---
    .safeAreaInset(edge: .bottom, spacing: 0) {
      if inputCardFace == .shown {
        // --- IOS-5c: the watcher rides in so the paste chip can appear.
        InputCard(model: inputCard, pasteboard: pasteboard)
        // --- end IOS-5c
      }
    }
    // --- end IOS-5a --------------------------------------------------------
    // --- IOS-5c: a long paste, read before it goes through.
    //
    // Presented from the session card rather than from the root, because the
    // root is behind this sheet: a second presentation from the same
    // controller is a sheet that never appears.
    .sheet(
      item: Binding(
        get: { inputCard.pendingPasteReview },
        // Every dismissal that is not SEND is a cancel — the swipe included.
        set: { if $0 == nil { inputCard.cancelPasteReview() } })
    ) { pending in
      PasteReviewSheet(
        text: pending.text,
        // --- IOS-5e: the sheet has to be TOLD what SEND will do.
        //
        // IOS-5d gave `PendingPaste` a `commit` and `PasteReviewSheet` a
        // matching parameter, and left this one call site on the default — so a
        // snippet marked "sends Enter" arriving at the review read "nothing
        // runs until you press Enter" over text that `confirmPasteReview` then
        // RAN. That is the one lie the sheet's own doc comment forbids. The
        // pending paste has always carried the answer; this hands it over.
        commit: pending.commit,
        // --- end IOS-5e
        onSend: { inputCard.confirmPasteReview() },
        onCancel: { inputCard.cancelPasteReview() }
      )
      .presentationDetents([.medium])
      .presentationDragIndicator(.visible)
      .presentationCornerRadius(40)
      .fieldGlassSheet()
    }
    // --- end IOS-5c --------------------------------------------------------
    // --- IOS-5d: the `+` menu's doors, on the same presenter and for the same
    // reason — the root is behind this sheet.
    //
    // Two presentations rather than one: Scan Text is a viewfinder, and a
    // camera behind a detent is a camera nobody can aim.
    .sheet(
      item: Binding(
        get: { inputCard.surface == .scanText ? nil : inputCard.surface },
        set: { if $0 == nil { inputCard.closeSurface() } })
    ) { surface in
      cardSurface(surface)
    }
    .fullScreenCover(
      isPresented: Binding(
        get: { inputCard.surface == .scanText },
        set: { if !$0 { inputCard.closeSurface() } })
    ) {
      ScanTextCover(
        onText: { text in
          // The cover closes on the take: the line is in the draft and there
          // is nothing left to aim at.
          inputCard.closeSurface()
          inputCard.acceptPaste(text)
        },
        onClose: { inputCard.closeSurface() })
    }
    // --- end IOS-5d --------------------------------------------------------
  }

  // --- IOS-5d ----------------------------------------------------------------
  @ViewBuilder
  private func cardSurface(_ surface: CardSurface) -> some View {
    switch surface {
    case .snippets:
      SnippetsSheet(
        store: snippets,
        onUse: { snippet in
          inputCard.closeSurface()
          inputCard.useSnippet(snippet)
        }
      )
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
      .presentationCornerRadius(40)
      .fieldGlassSheet()
    case .clipboardHistory:
      ClipboardHistorySheet(
        history: clipboardHistory,
        onUse: { text in
          inputCard.closeSurface()
          inputCard.acceptPaste(text)
        }
      )
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
      .presentationCornerRadius(40)
      .fieldGlassSheet()
    case .scanText:
      // Unreachable: the binding above sends this one to the cover. A
      // `EmptyView` rather than a `fatalError` because an exhaustive switch
      // over a surface enum should not be a crash site.
      EmptyView()
    }
  }
  // --- end IOS-5d --------------------------------------------------------------

  // --- IOS-5c --------------------------------------------------------------
  /// The card's chips, derived from the bubble it was raised on (K-D4).
  ///
  /// A remote terminal bubble has no agent facet, so it derives nothing — and
  /// that is every attachable session on the field today. The chips arrive for
  /// real when the agent feed does (IOS-4/AR); until then the only place they
  /// render is the fixture, and the record says so.
  private func replyChips(for bubble: FieldBubble?) -> [ReplyChip] {
    #if DEBUG
      // The fixture answers in place of a feed this phone does not have yet.
      // It sits INSIDE the derivation rather than beside it, so the row cannot
      // be wiped by the next honest re-derivation. It asks K-D4's own table for
      // an agent whose dialog is typed, rather than naming one here (R23b).
      if demoInputChips, let typed = FieldInput.typedDialogAgents.first {
        return FieldInput.replyChips(
          provider: typed, permissions: [AgentPermission(tool: "Bash")])
      }
    #endif
    guard let agent = bubble?.agent else { return [] }
    return FieldInput.replyChips(provider: agent.provider, permissions: agent.permissions)
  }
  // --- end IOS-5c ------------------------------------------------------------

  // --- IOS-5a --------------------------------------------------------------
  /// K-D2: the card exists only for a live attachment this device may type
  /// into. `FieldHomeModel.inputCardFace` owns the rule; this only supplies it
  /// with what the screen holds.
  private var inputCardFace: FieldHomeModel.InputCardFace {
    #if DEBUG
      if demoInputCard { return .shown }
    #endif
    guard let attachment else { return .hidden }
    return FieldHomeModel.inputCardFace(
      phase: attachment.phase, acceptsInput: attachment.acceptsInput)
  }

  /// The card emits acts; the attachment has verbs. This is the whole join,
  /// and it is the reason `FieldInput` never learns what a Ghosttea type is.
  private func installInputSink(on attachment: TerminalAttachment) {
    inputCard.sink = { act in
      switch act {
      case .keystroke(let stroke): attachment.press(stroke)
      case .sendDraft(let text): attachment.sendDraft(text)
      case .typeText(let text): attachment.typeText(text)
      // --- IOS-5c: a block, with no Enter behind it.
      case .paste(let text): attachment.pasteText(text)
      // --- end IOS-5c
      }
    }
    // --- IOS-5b: the second half of the same join --------------------------
    // In Draft the composer intercepts a latched character before it reaches
    // the draft; in Live there is no field to intercept, so the latch has to
    // meet the keyboard's own events inside the attachment. This closure is
    // the one that carries it there — consuming, called once per event.
    //
    // It holds the card while the card's sink holds the attachment, which is a
    // cycle: `closeCard` breaks it, and must.
    attachment.softwareInputLatch = { [inputCard] in inputCard.takeLatchForTerminal() }
    // --- end IOS-5b --------------------------------------------------------
  }
  // --- end IOS-5a ----------------------------------------------------------

  @ViewBuilder
  private func liveTerminal(title: String?) -> some View {
    if let attachment {
      TerminalSurface(
        frame: attachment.frame,
        visible: true,
        configuration: attachment.presentation,
        // --- IOS-5a: two modes, two first responders. The kit's own
        // fifteen-key row is off (K-D3) — the card's rail replaces it.
        // --- IOS-5c: the flag, not the mode — the keyboard can be down while
        // the terminal is still the one that would take it. `onFocusChange`
        // reports what the responder call actually achieved, and the card's
        // closed row is that answer rendered.
        wantsFocus: inputCard.mode == .live && inputCard.terminalFocused,
        focusEpoch: inputCard.keyboardRequests,
        onFocusChange: { focused in inputCard.terminalFocused = focused },
        // --- end IOS-5c
        keyboardAppearance: colorScheme == .dark ? .dark : .light,
        // --- end IOS-5a
        accessibilityTitle: title ?? "Remote terminal",
        accessibilityConnectionState: attachmentNote ?? "attached",
        onGridSize: { size in attachment.setViewport(cols: size.columns, rows: size.rows) },
        onNeedsFullRefresh: { attachment.requestFullRefresh() },
        onHardwareInput: { attachment.handleHardwareKey($0) },
        onSoftwareInput: { attachment.handleSoftwareInput($0) },
        onMouseInput: { attachment.handleMouse($0) },
        onScrollRows: { attachment.handleScroll(rows: $0) },
        onClipboardWrite: { text in
          // The pasteboard is the card's business, not the attachment's —
          // the same split the reference keeps.
          UIPasteboard.general.string = text
          noteCopied(bytes: text.utf8.count)
        },
        onRenderFailure: { renderFailure = $0 }
      )
    }
  }

  private var settingsSheet: some View {
    TerminalSettingsSheet(appearance: appearance) { next in
      // The PREFERENCE commits eagerly and is what every future attach is
      // seeded from; `TerminalAttachment.appearance` is what the terminal on
      // screen is wearing. Since TM-5 they cannot disagree — there is no
      // replica left that could decline a change.
      appearance = next
      TerminalAppearanceStore.save(next)
      // The DEVICE half goes live at once. Under T there is no replica here
      // to rebuild and nothing that can refuse the edit — the glyphs in a
      // remote frame are the cell's, and what these values still style is this
      // renderer's own ground (see `TerminalSettingsSheet`'s note).
      attachment?.apply(appearance: next)
    }
  }

  // MARK: - Attachment

  /// The attachment's own state, in words the card can render. Ordered so the
  /// most load-bearing truth wins: a failure explains itself, a live view-only
  /// session says why it cannot type, and nothing here invents a reason the
  /// terminal did not give.
  // MARK: - IOS-4d: the write key, granted rather than pasted

  /// Ask every ready desktop we hold no key for — once each.
  ///
  /// The "once" lives in `FieldLink`, which refuses a second ask on the same
  /// connection: a refusal is AUDITED on the desktop, and a phone that asked
  /// again on every reconnect would fill a person's grants ledger with its own
  /// impatience. This side only decides WHO to ask, and only ever asks for a
  /// desktop whose Keychain slot is empty — a pasted key is a key, and a phone
  /// that already has one has no business asking for another.
  /// The link's desktops, named so the modifier chain stays cheap to
  /// type-check. See the `.onChange` that reads it.
  private var linkDesktops: [FieldDesktop] { link?.desktops ?? [] }

  // RETIRED 2026-09-23 (IOS-8e): `linkFace`, the corner's token and line about
  // the doors (IOS-4e). Its facts are the account menu's rows and the dot now
  // (`FieldHomeModel.accountFace`, `AccountDisplay.desktopWord`).

  // MARK: - IOS-8b: the account corner

  /// The corner's whole answer, decided in `FieldHomeModel` where it is tested
  /// without a simulator. The face and the remembered desktops come from the
  /// account's memory (IOS-8c); a signed-in corner is the plain circle only
  /// until a door has said who you are.
  private var accountFace: FieldHomeModel.AccountFace {
    #if DEBUG
      if let demoAccount { return demoAccount }
      if let mock { return mock.face }
    #endif
    _ = identityEpoch
    let account = accountLogin
    return FieldHomeModel.accountFace(
      meshState: mesh.state,
      rememberedLogin: mesh.rememberedLogin,
      login: mesh.loginName,
      domain: mesh.tailnetDomain,
      name: nil,
      face: account.flatMap { faceStore.face(for: $0) },
      desktops: linkDesktops,
      asleep: account.map { login in
        desktopMemory.remembered(for: login).map { .init(deviceId: $0.deviceId, name: $0.name) }
      } ?? [],
      foreignDoors: link?.foreignDoors.count ?? 0,
      isHearing: link?.isHearing ?? false)
  }

  /// The account this phone is signed in as: the running node's report,
  /// else what the phone remembers.
  private var accountLogin: String? {
    if let live = mesh.loginName, !live.isEmpty { return live }
    if let kept = mesh.rememberedLogin, !kept.isEmpty { return kept }
    return nil
  }

  /// IOS-8c — record the listing, and deal the face once a door has said who
  /// this phone's person is. Every desktop the link lists is this account's
  /// by construction (a foreign one is never listed), so all of them are
  /// remembered.
  private func rememberAccount() {
    guard let login = accountLogin else { return }
    let listed = linkDesktops
    if !listed.isEmpty {
      desktopMemory.record(listed, login: login)
      identityEpoch += 1
    }
    if faceStore.face(for: login) == nil, let userId = listed.compactMap(\.userId).first {
      faceStore.dealIfNeeded(login: login, userId: userId)
      identityEpoch += 1
    }
  }

  /// The tilt's seed: the login, so the face sits at one angle on every
  /// launch of this account.
  private var accountSeed: String {
    #if DEBUG
      if demoAccount != nil || mock != nil { return AccountFixtures.login }
    #endif
    return mesh.loginName ?? mesh.rememberedLogin ?? ""
  }

  /// IOS-8d — the sign-out itself: the card and the link go first (a session
  /// card over a mesh that is leaving is a card about nothing), then the
  /// model's own sweep, then the ledger's in-memory copy, so the field draws
  /// no colour the sweep has already forgotten.
  private func signOut() {
    #if DEBUG
      // The mock forgets nothing on disk: its account is a value, and the
      // sign-out is the standing moving.
      if let mock {
        mock.signOut()
        setAccountMenu(open: false)
        return
      }
    #endif
    selection = nil
    closeCard()
    createSheetOpen = false
    workspaceLaunch = nil
    closeLink()
    mesh.signOut()
    assembly.projects = .empty
    refold()
    identityEpoch += 1
  }

  /// The connection's act, as the menu offers it — what the mesh sheet's one
  /// button did, by the same three verbs on the same model.
  private func performConnection(_ act: FieldHomeModel.AccountFace.ConnectionAct) {
    #if DEBUG
      if let mock {
        mock.perform(act)
        return
      }
    #endif
    switch act {
    case .connect: mesh.connect()
    case .signIn: mesh.requestLogin()
    case .disconnect: mesh.disconnect()
    }
  }

  // RETIRED 2026-09-14 (TM-3, TM-D3): `collectWriteGrants`,
  // `askDesktopAction` and `requestWriteGrant` — the IOS-4d ladder that asked
  // each ready desktop for this device's write key, once per connection, and
  // stored what came back. The door is deleted; the right to type is a claim
  // in the attach grant, which this phone neither asks for nor keeps.

  // MARK: - IOS-4c: the agent card's terminal

  /// G3's join for the card's subject. `.noJoin` for a remote bubble or the
  /// scripted fleet — neither has an agent row behind it.
  ///
  /// Both extra facts come from the DEVICES store rather than from a terminal
  /// listing: the desktop's name, and (TM-5a) whether it publishes its terminal
  /// doors on the tailnet. It is the same desktop either way, and the devices
  /// store is the only one of the two wires that still answers since TM-5.
  private var cardTerminalFace: AgentTerminalFace {
    guard let join = cardBubble?.agent?.join else { return .noJoin }
    let desktop = desktop(join.deviceID)
    return agentTerminalFace(
      join: join, deviceName: desktop?.name,
      publishesTerminalDoors: desktop?.publishesTerminalDoors)
  }

  /// The field's row for a desktop, when it has one. `nil` is a desktop the
  /// devices store has not named — which is not the same as one that answered.
  private func desktop(_ deviceID: String) -> FieldDesktop? {
    link?.desktops.first { $0.deviceId == deviceID }
  }

  /// The one act an ended run has: RESUME, over that desktop's door. The new
  /// run is NOT put on the field here — the board is the fold's to publish,
  /// and the next slice or delta shows it.
  private func resumeAction(_ join: AgentJoin?, runtimeRunId: String?) -> CardAction? {
    guard cardTerminalFace.offersResume, let join, let runtimeRunId, let link else { return nil }
    return CardAction(id: "resume", label: "RESUME") {
      Task {
        do {
          _ = try await link.resume(runtimeRunId: runtimeRunId, on: join.deviceID)
          attachRefusal = "resumed — the desktop's next board carries the new run"
        } catch {
          attachRefusal = "resume refused — \(MeshModel.shortReason(error))"
        }
      }
    }
  }

  private var attachmentNote: String? {
    // A copy is the most recent thing the user did, and it is transient —
    // it says so and then gets out of the way.
    if let copiedNote { return copiedNote }
    if let attachRefusal { return attachRefusal }
    if let renderFailure { return "the renderer refused this frame — \(renderFailure)" }
    // IOS-4c — what the FEED says about this run's terminal, when there is no
    // attachment to speak for itself. It ranks under the transient notes and
    // above nothing, because an unattached agent card has no other news.
    if attachment == nil, let face = cardTerminalFace.note { return face }
    guard let attachment else { return nil }
    // The banner outranks the phase words wherever it exists: it names the
    // device ("studio is not publishing its terminal doors") where a phase can
    // only name the condition. The phase reasons stay as the tier beneath —
    // they cover the states a banner deliberately stays quiet for.
    if let banner = attachment.banner { return banner.title }
    return phaseNote(attachment)
  }

  private func phaseNote(_ attachment: TerminalAttachment) -> String? {
    switch attachment.phase {
    case .idle: return nil
    case .connecting: return "connecting over the mesh…"
    case .live:
      // A transient note (a keystroke this device declined to send) outranks
      // the standing one, and the standing one is the GRANT's answer: since
      // TM-D3 the right to type is a claim the cell accepted, not a key this
      // phone holds, so there is nothing here for a person to go and fix.
      if let notice = attachment.notice { return notice }
      guard !attachment.acceptsInput else { return nil }
      return attachment.readWrite
        ? "waiting for the desktop to allow input"
        : "view only — this desktop granted read without input"
    case .suspended(let why): return why
    case .refused(let words): return words
    case .ended(let why): return "ended — \(why)"
    case .failed(let why): return "failed — \(why)"
    }
  }

  /// The banner's second line, and only ever that: our own phase words are
  /// single-line by construction, so a detail here always belongs to a banner.
  private var attachmentDetail: String? {
    guard copiedNote == nil, attachRefusal == nil, renderFailure == nil
    else { return nil }
    return attachment?.banner?.detail
  }

  /// The banner's acts, as the card can offer them. "Back to the field" is
  /// this phone's whole session chooser, so leaving the card IS the act.
  private var attachmentActions: [CardAction] {
    var actions = bannerActions
    // The attached face used to carry an ENTER KEY here, for a view-only
    // session that had refused OUR writes for want of a pasted key. TM-D3 took
    // the reason away: the right to type is a claim in the attach grant fieldd
    // mints per device per session, and a key entered on this phone changes
    // nothing about it. The store, the sheet and the door they call stay until
    // TM-3 retires the three together; the act that could not work is gone now.
    // IOS-4c — an ended run's one act.
    if let resume = resumeAction(cardBubble?.agent?.join, runtimeRunId: cardBubble?.id) {
      actions.append(resume)
    }
    return actions
  }

  private var bannerActions: [CardAction] {
    guard let attachment, let banner = attachment.banner else { return [] }
    return banner.actions.map { action in
      let label: String =
        switch action {
        case .retryNow: "RETRY"
        case .backToTheField: "BACK TO THE FIELD"
        }
      return .init(id: action.rawValue, label: label) {
        switch action {
        case .backToTheField:
          // Navigation is the card's act, not the attachment's — dismissing
          // the sheet is what detaches (onDismiss), so both paths agree.
          selection = nil
        case .retryNow:
          attachment.retryNow()
        }
      }
    }
  }

  /// Raise the card on a bubble, remembering it as the card's subject. Every
  /// path that opens a card comes through here so none of them can open one
  /// with no subject to fall back on.
  private func openCard(on bubble: FieldBubble) {
    cardBubble = bubble
    // --- IOS-5c: the card's context, gathered at the moment it is raised.
    inputCard.chips = replyChips(for: bubble)
    pasteboard.sample()
    // --- end IOS-5c
    // --- IOS-5d: the ring the card's own pastes feed. Installed here rather
    // than at attach because the card records what the USER pasted through it,
    // which is true whether or not a terminal ever answered.
    inputCard.history = clipboardHistory
    // --- end IOS-5d
    selection = SessionSelection(id: bubble.id)
  }

  private func beginAttachment(to bubble: FieldBubble) {
    // IOS-4c — an AGENT bubble attaches to its own run's PTY, found through
    // G3's join: a managed agent's terminal is one of the floor's own sessions,
    // and the only thing that made it special was not knowing which one.
    guard let address = cardTerminalFace.address, cardTerminalFace.offersAttach else { return }
    beginAttachment(
      deviceID: address.deviceID, deviceName: address.deviceName, sessionID: address.sessionID)
  }

  /// The link went away between the tap and the mint. Its own type rather than
  /// a product error so this screen never has to name the wire's vocabulary.
  private struct NoDesktopDoor: Error, CustomStringConvertible {
    var description: String { "no connection to this desktop" }
  }

  /// TM-5 — the attach, over the routed T1 client.
  ///
  /// Three things are handed over and nothing else: how to reach the tailnet
  /// (the mesh node's own `URLSession` — a plain one dials a `100.x` address
  /// nowhere), how to ASK for a ticket (one `terminal.openTicket` over this
  /// desktop's product door), and the look. The attachment owns the rest, and
  /// the closure is what keeps this screen from learning what a ticket is.
  private func beginAttachment(deviceID: String, deviceName: String, sessionID: String) {
    // One attachment at a time, latched BEFORE the await — see `attaching`.
    guard attachment == nil, !attaching else { return }
    attaching = true
    renderFailure = nil
    attachRefusal = nil
    Task {
      defer { attaching = false }
      guard let urlSession = await mesh.urlSessionProvider else {
        // Honest rather than inert: the button did something, and the reason
        // it went nowhere is the mesh, not the session and not the renderer.
        attachRefusal = "the mesh is not up on this device — connect it first"
        return
      }
      let attachment = TerminalAttachment(
        session: urlSession,
        appearance: appearance,
        door: { [link] session in
          guard let link else { throw NoDesktopDoor() }
          return try await link.openTerminalTicket(on: deviceID, sessionId: session)
        },
        // P0-C — the renewal rides the same desktop's door as the mint
        renewal: { [link] session, generation, requestId in
          guard let link else { throw NoDesktopDoor() }
          return try await link.renewTerminalGrant(
            on: deviceID, sessionId: session, expectGeneration: generation, requestId: requestId)
        },
        // SP-2 (g) — the same ledger the link's doors count against.
        budget: .shared)
      self.attachment = attachment
      attachedDeviceID = deviceID
      // --- IOS-5a ---
      installInputSink(on: attachment)
      // --- end IOS-5a ---
      // A starting grid the surface immediately corrects through onGridSize.
      // 80×24 is the one every terminal has agreed on since the VT100 — and
      // under T it shapes nothing on the desktop, because a phone is minted
      // `[input, read]` and holds no geometry lease (TM-D3). Corrected
      // 2026-09-30 (DS-4): the phone IS minted `geometry` now, and it still
      // shapes nothing because this kit speaks no lease verb until DS-4b.
      // Corrected 2026-10-01 (DS-4b): the attachment TAKES the seat on focus
      // with the grid the surface measures, so the desktop's PTY is sized to
      // this pane while it is the one focused last.
      // The device NAME rides along so a refusal can say "studio is not
      // publishing its terminal doors" rather than naming a ULID at the user.
      attachment.attach(
        sessionID: sessionID, cols: 80, rows: 24, deviceName: deviceName)
    }
  }

  /// The card going away: its subject is released and any attachment with it.
  /// Both halves unconditionally — the subject outlives the listing by design,
  /// so nothing else would ever clear it.
  private func closeCard() {
    cardBubble = nil
    attachedDeviceID = nil
    renderFailure = nil
    attachRefusal = nil
    copiedNote = nil
    // --- IOS-5a: a draft belongs to the session it was typed for ---
    inputCard.sink = nil
    inputCard.reset()
    // --- end IOS-5a ---
    // --- IOS-5b: and so does the latch the attachment was holding ---
    // Unconditionally, before the guard: the closure is half of a retain cycle
    // (card → sink → attachment → latch → card), and nothing else clears it.
    attachment?.softwareInputLatch = nil
    // --- end IOS-5b ---
    guard let attachment else { return }
    self.attachment = nil
    Task { await attachment.detach() }
  }

  // MARK: - Write keys

  // RETIRED 2026-09-14 (TM-3, TM-D3): `cardHasWriteKey`, `writeKeyEntry`,
  // `refreshWriteKeys`, `saveWriteKey` and `removeWriteKey` — the card's key
  // question and the store's four acts. Nothing holds a key to answer about.

  /// The pasteboard confirmation, in the reference's own vocabulary — and it
  /// expires, because a stale "copied" line would sit on top of a real status
  /// the terminal wanted to say.
  private func noteCopied(bytes: Int) {
    copiedNote = "copied \(bytes) bytes"
    Task {
      try? await Task.sleep(for: .seconds(2))
      copiedNote = nil
    }
  }

  private struct SessionSelection: Identifiable {
    let id: String
  }

  /// The lab's door exists only in DEBUG; in Release the binding is constant
  /// false and the cover never presents.
  private var swarmLabBinding: Binding<Bool> {
    #if DEBUG
      return $swarmLabOpen
    #else
      return .constant(false)
    #endif
  }

  private var swarmLabFocusValue: LabFocus? {
    #if DEBUG
      return swarmLabFocus
    #else
      return nil
    #endif
  }

  #if DEBUG
    // --- IOS-5d ------------------------------------------------------------
    /// The names IOS-5d's fixtures answer to, in one place.
    ///
    /// `-vf-demo-input-keypad` takes an optional page (`=symbols`, `=combos`),
    /// which is why it is a PREFIX rather than a flag: three arguments for
    /// three pages would be three ways to say the same thing.
    private enum DemoArguments {
      static let keypad = "-vf-demo-input-keypad"
      /// A scratch defaults suite for the snippet and history fixtures. It is
      /// wiped before use so a screenshot run can never write into — or read
      /// out of — what a real user saved.
      static let suite = "com.jamesyong.vibefield.ios.demo"

      static func page(from argument: String) -> KeypadPage {
        let value = argument.dropFirst(keypad.count).drop(while: { $0 == "=" })
        return KeypadPage(rawValue: String(value)) ?? .keys
      }
    }
    // --- end IOS-5d ----------------------------------------------------------

    // --- IOS-5e --------------------------------------------------------------
    /// Ask the window scene to turn on its side, for `-vf-demo-landscape`.
    ///
    /// `requestGeometryUpdate` is the only door: a scene's orientation is the
    /// system's to grant, and the app can do no more than ask. The error
    /// handler is empty on purpose — a refusal (an iPad in Stage Manager, a
    /// device held in a dock) leaves the screenshot in portrait, which is a
    /// true picture of what happened and not a failure to report.
    private func requestLandscape() {
      guard
        let scene = UIApplication.shared.connectedScenes
          .compactMap({ $0 as? UIWindowScene }).first
      else { return }
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
    }
    // --- end IOS-5e ------------------------------------------------------------
  #endif
}

#if DEBUG
  /// A stand-in peer for `-vf-demo-remote` (see the launch hook above).
  private struct DemoRemoteSource: RemoteSessionSource {
    func listAll() async throws -> (rows: [RemoteSessionRow], hosts: Int) {
      let host = RemoteHost(deviceID: "demo-device-01", deviceName: "studio")
      let sessions = [
        RemoteSessionInfo(
          sessionID: "1", title: "vibe-field", cwdLabel: "~/Projects/project100/vibe-field",
          running: true, attachable: true, readWrite: true, createdAtMs: 0,
          activityKind: "foreground-job"),
        RemoteSessionInfo(
          sessionID: "2", title: "truffle", cwdLabel: "~/Projects/project100/p008/truffle",
          running: true, attachable: true, readWrite: false, createdAtMs: 0, activityKind: nil),
        RemoteSessionInfo(
          sessionID: "3", title: "ghosttea", cwdLabel: "~/Projects/project100/electron-ghostty",
          running: true, attachable: false, readWrite: false, createdAtMs: 0, activityKind: nil),
      ]
      return (sessions.map { RemoteSessionRow(host: host, session: $0) }, 1)
    }
  }
#endif
