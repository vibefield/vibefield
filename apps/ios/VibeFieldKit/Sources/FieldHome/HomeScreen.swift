import FieldAgents
import FieldDesign
import FieldFreeway
import FieldHistory
import FieldInput
import FieldLock
import FieldMesh
import FieldProduct
import FieldRoutedTerminal
import FieldSettings
import FieldSplash
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
  /// fix7 — the launch sheet's item: the model it draws, never a flag beside
  /// it (the first launch from the field opened an empty sheet: the flag and
  /// the model were set in one update and the sheet drew the model as nil)
  @State private var createSheet: WorkspaceLaunch?
  @State private var workspaceLaunch: WorkspaceLaunch?
  /// PJ-7 — the last Resume's words in the stepper's slot.
  @State private var resumeWords: String?
  /// PJ-7 — each answering desktop's Agent Profiles, read ahead so a hold can
  /// bloom them at once (a desktop not read yet is a leaf: its default).
  @State private var bloomProfiles: [String: [AgentProfileSet]] = [:]
  /// PJ-7 — each answering desktop's catalog for the phone, read ahead with
  /// its profiles: whether History's Resume is offered for an agent there.
  @State private var fieldCatalogs: [String: [AgentCatalogRow]] = [:]
  @State private var mesh = MeshModel()
  /// TS-7 — the system's sign-in sheet; `syncSignInSheet` opens and closes it.
  @State private var signInSheet = TailscaleSignInSession()
  /// WI-2 — the way in's own end: the found beat, after a page that stood for signing in yields to signed in.
  @State private var wayInEnding: FieldHomeModel.WayInStep?
  /// WI-2 — How it works, from the welcome: the page standing (0…3), or nil.
  @State private var tourPage: Int?
  /// TS-7b — the account a Mac's code said to expect, and its reader.
  private let expectationMemory = ExpectationMemory()
  @State private var macCodeReaderOpen = false
  @State private var remoteField = RemoteSessionField(source: nil)
  /// IOS-4b — the live field: the devices store, the doors it names, and the
  /// boards behind them. Built when the mesh comes up and void when it goes,
  /// exactly like discovery's own door; nil means nobody has been asked, which
  /// is not the same as a mesh that answered with no agents.
  @State private var link: FieldLink?
  /// PG-4s — the Godview view the Field page stands on, and the clock a still is taken at (nil: the live clock).
  /// PG-4t — the person's pick, kept on this phone across launches and a sign-out (`SignOutSweep.kept`); a stored id
  /// the phone has no view for reads as the swarm. A DEBUG launch's `-vf-godview-view=` stands for its run alone and
  /// never writes the store; a tap clears it. *(Corrected 2026-11-04, PG-4t: this said "only the DEBUG launch block
  /// writes them … until the selector lands (its lander writes `godviewView`)". The selector is the Stories row: a
  /// tap writes the pick, and `godviewView` is the override, else the pick.)*
  @AppStorage(GodviewViewChoice.storageKey) private var godviewStored: GodviewViewChoice = .swarm
  @State private var godviewLaunch: GodviewViewChoice?
  private var godviewView: GodviewViewChoice { godviewLaunch ?? godviewStored }
  @State private var godviewNow: Date?
  /// PG-4t — the name the Stories row says (1.4 s from a tap; held, for a still, by `-vf-godview-say=`).
  @State private var godviewSaying = GodviewStorySaying()
  /// PG-4t — a still (`-vf-godview-still`): written only by the same DEBUG launch latch, so Release never draws one.
  @State private var godviewStill = false
  /// PG-4t — the dissolve under the Stories row; only the DEBUG latch turns it off (`-vf-godview-dissolve=off`), for
  /// a frame meter's run, so Release always dissolves.
  @State private var godviewDissolves = true
  /// The launch flags are read once (the design check's N10): the DEBUG block runs again on every return to the
  /// view, and a second read would undo the selector's pick in a DEBUG run launched with the flag.
  @State private var godviewLaunchRead = false
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
    /// WI-1's OWED witness — `-vf-demo-field-slice-signed-out`: false while the welcome stands over the slice, true
    /// once the phone has signed in by itself, nil when the launch does not stamp it. Read here, before the first
    /// frame, so the way in stands from the first frame and the tabs never mount before the sign-in.
    @State private var fieldSliceSignedIn: Bool? =
      FieldSliceSignIn.launch(ProcessInfo.processInfo.arguments) == nil ? nil : false
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
  /// Which page stands: the field, History or Chat (IOS-12b). Search stands over it (SE-2).
  @State private var selectedTab: AppTab = .field
  /// IOS-12b — Chat's feed, through the home (its one door), and the threads'
  /// marks (SP-1d): both for the app's life, written nowhere.
  @State private var chat = ChatFeed()
  /// UM-4 — the meters, through the home (its one door, UM-D8 A), and the Agent Profiles page's sheet. The one lens
  /// on the home's profiles stands with search's state (SE-2): the page, the hold and the token set that one value.
  @State private var meters = MetersFeed()
  @State private var agentProfilesOpen = false
  /// UM-4 (UM-D24 A) — the held face's standing (a let-go or a hold taken away closes it), and where the corner's
  /// face stands in the window.
  @State private var faceHold = FaceHold.Stand()
  @State private var faceCentre: CGPoint = .zero
  @State private var chatLedger = ThreadLedger()
  /// IOS-12c — the spark whose thread stands on Chat (pushed in Chat's own stack), or none: the bar steps aside for
  /// it, and the ledger reads it while Chat is the page.
  @State private var chatThread: String?
  /// The note over the bar (S-4): which needs are new, and the spark it says.
  @State private var chatNotes = ChatNotes()
  @State private var chatNote: SparkSummary?
  @State private var chatNoteSaid = 0
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
  /// SE-2 (SE-D3 A) — search, a glass sheet over the page that stands: whether it is open, its words (the bar's
  /// field writes them), its own state (the scope, Everything's kind and project) and the field's focus.
  @State private var searchOpen = false
  @State private var searchQuery = ""
  @State private var search = SearchState()
  /// SE-2i — the newest words are out: from a word typed until its ask comes back (the pause in typing included).
  @State private var searchAsking = false
  @FocusState private var searchFocused: Bool
  /// SE-2 (SE-D2 on the phone, UM-D27 A) — the phone's ONE lens (UM-4's seam): the profile the field shows and
  /// search's profile token, and the desktop search keeps to; and whether the token's menu is open.
  @State private var lens = ProfileLens()
  @State private var lensMenuOpen = false
  /// The profile token's glass as it measured itself: the swarm's obstacle in `chrome` stands at this width.
  @State private var lensTokenWidth: CGFloat = 0
  /// The screen's full height, read beside `homeInset`: where the search field's top stands (`searchFieldTop`).
  @State private var screenHeight: CGFloat = 874
  #if DEBUG
    /// `-vf-mock`: Live now's rows and the home's profiles (`MockAccount.searchRows`, `searchProfiles`), read once.
    @State private var mockSearchRows: [RemoteFieldRow] = []
    @State private var mockProfiles: [AgentProfileSet] = []
    /// `-vf-mock-lens=<profile>`: the lens the mock's door asks for, held until the home's profiles name it.
    @State private var mockLens: String?
  #endif
  /// The home indicator's inset, read with the keyboard ignored: the bar
  /// rests where iOS 26 rests its own (`AppBar.bottomGap`), and rides the
  /// keyboard only while search is typing.
  @State private var homeInset: CGFloat = 34
  /// PG-4t — the safe area's top line, read beside `homeInset`: where the Stories row stands and how deep the stage's
  /// reserve is (`GodviewStories`). 62 is the iPhone 17's, the bar's measured phone, until the first read.
  @State private var safeTop: CGFloat = 62
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
    /// `-vf-demo-account=<state>`: the corner's inputs, stamped (IOS-8e), and
    /// the Field page's door with them (TS-7).
    @State private var demoAccount: AccountFixtures.Demo?
    /// `-vf-demo-signin=<shared|ephemeral>`: the sign-in sheet, presented and
    /// closed by the app (TS-7's spike).
    @State private var demoSignIn: TailscaleSignInSession?
  #endif
  @State private var settingsSheetOpen = false
  /// IOS-10a — where Settings opens from the corner: its root, Account (your
  /// name), or, in a photograph run (`-vf-open-settings=<page>`), any page.
  @State private var settingsOpening: SettingsOpening = .root
  /// IOS-10a — the phone's look (Settings › Appearance), worn by the window.
  @AppStorage(PhoneAppearance.storageKey) private var phoneLook: PhoneAppearance = .auto
  @State private var discoveryPolling = false
  @State private var attachment: TerminalAttachment?
  /// The freeway's kit half (FW-D1/D2, 2026-10-16): each desktop's terminal
  /// LANES — one connection set per cell, kept across cards — and the sessions
  /// a closed card left LIVE on them, newest last. Opening one of those again
  /// shows its current screen at once; a fourth pushes the oldest out
  /// (`TerminalAttachment.release`).
  @State private var terminalLanes: [String: TerminalLanes] = [:]
  @State private var keptAttachments: [KeptTerminal] = []
  /// F1 — each desktop's freeway once its terminals ride it (opt-in: `freewayLanes`).
  @State private var freeways: [String: Freeway] = [:]
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
  @Environment(\.openURL) private var openURL
  /// WI-1 (the review's M1) — whether the splash stands whole over the home: the tabs stay under a sign-out's
  /// splash until it does.
  @Environment(\.splashCovers) private var splashCovers
  /// WI-3 — the lock (FieldLock, held by `HomeRoot`, which stands its curtain): the way in offers it last, the
  /// corner's Lock now and Settings › Lock change it, and locking folds the card's keyboard.
  private let lock: FieldLock

  public init(lock: FieldLock) {
    self.lock = lock
  }

  /// One stage, two sources, projected by the pure functions in FieldAgents.
  ///
  /// Since PG-3e the agent half is the HOME'S WINDOW: `FieldLink` holds the
  /// home's remote board and maps its drawn rows straight to bubbles
  /// (`FieldLink.bubbles`), body for body as the desktop draws them. The
  /// scripted fleet keeps its own snapshots, behind the lab and the demo
  /// arguments only. An empty field with the mesh up is a real answer rather
  /// than a missing feature.
  ///
  /// `mockActive` is DEBUG-only, so its branch is too: the Release build reads
  /// the link alone (the v2 check's M1).
  private var projected: [FieldBubble] {
    let sessions = remoteField.snapshot.rows.map(fieldBubble(from:))
    #if DEBUG
      if mockActive { return liveAgents.compactMap(fieldBubble(from:)) + sessions }
    #endif
    return (link?.bubbles ?? []) + sessions
  }

  /// The scripted fleet's rows, while it owns the field. Outside the mock this
  /// is empty: the live field is `FieldLink.bubbles`.
  private var liveAgents: [AgentSnapshot] {
    #if DEBUG
      // The lab and the demo arguments own the field while they are up: what
      // they show is our own pixels, and a daemon arriving mid-screenshot
      // would be the fixture lying about what it is.
      if mockActive {
        // TS-7 — the mock's fleet is the field only while no door stands.
        if let mock, !mock.fieldIsLive { return [] }
        return feed.agents
      }
    #endif
    return []
  }

  // --- IOS-6d: the field's ledgers ------------------------------------------
  /// The rows the field draws: the projection dressed by `FieldAssembly` —
  /// every project's colour, the open card's pane (PG-3e: the usage ledger
  /// retired; the owner's cost rides the row). Folded on every projection and
  /// every change of the card's subject, never derived twice. (Corrected
  /// 2026-11-02, PG-3e, the review's [2]: it listed the unread marks and the
  /// stale flags among the fold's dress; they are the owner's, on the row.)
  @State private var bubbles: [FieldBubble] = []
  @State private var assembly = FieldAssembly(tint: .light)
  /// The project ledger's cache (D-i13): a project keeps its colour across
  /// launches on this device.
  private let projectStore = UserDefaultsProjectLedgerStore()

  private func refold() {
    assembly.tint = colorScheme == .dark ? .dark : .light
    let before = assembly.projects
    bubbles = assembly.fold(projected, cardSubjectID: selection?.id)
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
      // IOS-9e — the field draws only while it is the page standing: the
      // other two keep it alive under them, and a hidden Metal view
      // rendering at 120 Hz is a battery spent on nobody.
      let active = scenePhase == .active && selectedTab == .field
      // PG-4s — the Godview view the page stands on: the swarm, until PG-5…8
      // add theirs. It stands where SwarmField stood. (Corrected 2026-11-04,
      // PG-4t: this said "so the overlays below stay above every view". J-S3
      // (drop) puts them over the swarm only: the gate below is the one place.)
      // PG-4t — the stage runs under the Stories row and dissolves under it
      // (GodviewStage's mask), whatever the view.
      GodviewStage(choice: godviewView, input: godviewInput(active: active)) {
        swarmField(active: active)
      }
      // A pick changes the stage in place: §6's view switch, a 180 ms `ease` fade (90 under reduced motion); a
      // still changes nothing.
      .animation(
        godviewStill
          ? nil
          : FieldMotion.plainEase(reduceMotion ? GodviewStories.stageFadeReduced : GodviewStories.stageFade),
        value: godviewView)

      if godviewView.wearsAtmosphere {
        ScanlinesOverlay()
          .ignoresSafeArea()
        VignetteOverlay()
          .ignoresSafeArea()
      }

      // PG-4t — the Stories row: last, so it stands above the overlays and wears neither, outside the swarm.
      storiesRow
      // SE-2 — the profile token, beside the row and outside the swarm: the lens filters whichever view stands, so
      // the token that says so stands over every view (its frame is the swarm's obstacle in `chrome`).
      lensToken
    }
    // The lab covers the stage (IOS-6c); presented here rather than on the
    // body's chain, which is already at the type-checker's limit.
    .fullScreenCover(isPresented: swarmLabBinding) { SwarmLabView(focus: swarmLabFocusValue) }
    .onAppear {
      #if DEBUG
        // fix8 — a main thread that stops answering for 2 s is said on the
        // console, beside the attach's last phase; a second start is nothing
        MainThreadWitness.shared.start()
        if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("-vf-demo-workspace=") }) {
          workspaceLaunch = WorkspaceFixtureDoor.model()
          createSheet = workspaceLaunch
        }
      #endif
    }
    .sheet(item: $createSheet) { launch in CreateSessionSheet(model: launch) }
    // --- IOS-6d: every projection and every change of the card's subject
    // folds the ledgers; the theme's tint moves the project colours with it.
    // On the stage for the same reason as the cover above.
    .onChange(of: projected) { refold() }
    .onChange(of: selection?.id) { refold() }
    .onChange(of: colorScheme) { refold() }
    // --- end IOS-6d
    // IOS-8d — on the stage for the type-checker's sake, like the cover above.
    .confirmationDialog(
      SettingsWords.signOutTitle(login: accountLogin), isPresented: $signOutPending,
      titleVisibility: .visible
    ) {
      Button("Sign out", role: .destructive) { confirmSignOut() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(SettingsWords.signOutMessage(DeviceWord.current))
    }
  }

  /// PG-4t — the Stories row (DESIGN.md §8 "The phone's Stories row"), 8 under the island on the full-bleed
  /// stage, its own property so the stage's builder stays small. The space between its circles has no fill, so a
  /// touch there reaches the swarm. Its name goes at its deadline, and at once when the page leaves or the scene
  /// does.
  private var storiesRow: some View {
    GodviewStoriesRow(
      views: GodviewViewChoice.shown, current: godviewView, saying: godviewSaying, isStill: godviewStill,
      onPick: pickView
    )
    .padding(.top, GodviewStories.top(safeTop: safeTop))
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .task(id: godviewSaying.until) {
      guard let until = godviewSaying.until else { return }
      let wait = until.timeIntervalSinceNow
      if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
      guard !Task.isCancelled else { return }
      godviewSaying.expire(at: Date())
    }
    .onChange(of: selectedTab) { _, tab in
      if tab != .field { godviewSaying.drop() }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active { godviewSaying.drop() }
    }
  }

  /// PG-4t — a circle tapped: the stage stands on its view, kept on this phone (a DEBUG launch's override cleared),
  /// and its name is said for 1.4 s. A tap on the current circle says its name and changes nothing else. No haptic:
  /// the bar's own tabs are silent.
  private func pickView(_ view: GodviewViewChoice) {
    godviewLaunch = nil
    if godviewStored != view { godviewStored = view }
    godviewSaying.say(view, at: Date())
  }

  /// The swarm's arm of the stage, its own function so the stage's builder stays inside what the type-checker
  /// solves in reasonable time (the design check's S6). The stage's former SwarmField call, unchanged but for
  /// `isActive`, which the stage computes once, and the lens's recede (SE-2n), as the other views take it.
  private func swarmField(active: Bool) -> some View {
    // WI-1 — the field stands only signed in, so no page stands on it: the
    // way in has the splash's field to itself (TS-7c and TS-D22 retired).
    SwarmField(
      bubbles: bubbles,
      isActive: active,
      onSelect: { bubble in openCard(on: bubble) },
      onCreate: fieldHold,
      bloom: bloomMenu,
      onBloom: { choice in
        // Q4 (a): the bloom opens the launch sheet on that desktop and profile
        beginCreate(fieldContext(desktop: choice.desktop, profileSet: choice.profile))
      },
      recede: GodviewRecede.swarm(bubbles, lens: lens.chosen?.id)
    ) {
      chrome
    }
  }

  /// PG-4s — everything a Godview view takes from the home screen: the link's drawn rows, the swarm's own unread
  /// (its bubbles', S2) and colours, the open card's row, the clock and the bar's band. Under the mock fleet no link
  /// stands, so a view draws empty (said; only the swarm draws the mock).
  private func godviewInput(active: Bool) -> GodviewStageInput {
    let rows = link?.rows ?? []
    let projects = assembly.projects
    let tint = assembly.tint
    let frozen = godviewNow
    return GodviewStageInput(
      isActive: active,
      rows: rows,
      fieldIsLive: link?.fieldIsLive ?? false,
      unreadIds: GodviewStageInput.unreadIds(bubbles: link?.bubbles ?? []),
      activeId: GodviewStageInput.activeId(rows: rows, cardSubject: selection?.id),
      colour: { GodviewStageInput.colour(of: $0, projects: projects, tint: tint) },
      now: { frozen ?? Date() },
      bandHeight: AppBar.band(homeInset: homeInset),
      topInset: GodviewStories.reserve(safeTop: safeTop),
      skin: GodviewSkin(scheme: colorScheme),
      isStill: godviewStill,
      dissolves: godviewDissolves,
      lens: lens.chosen?.id,
      onOpen: { row in
        if let bubble = bubbles.first(where: { $0.id == row.visualId }) { openCard(on: bubble) }
      })
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
    // PG-4t — the Stories row's reserve, the bar band's twin across the
    // stage's top: the swarm steers by it and reads no inset (DESIGN.md §8
    // "The phone's Stories row"). The stage runs to the screen's top, so the
    // band runs from 0 to the reserve.
    Color.clear
      .frame(maxWidth: .infinity)
      .frame(height: GodviewStories.reserve(safeTop: safeTop))
      .swarmObstacle()
      .allowsHitTesting(false)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    // SE-2 (PLAN §4 S2) — the profile token's frame while it stands, so the swarm keeps out of it: an obstacle at
    // the width the token measured, where `lensToken` stands it. The token itself is the stage's, over every view;
    // this slot is the swarm's alone.
    Color.clear
      .overlay(alignment: .bottomTrailing) {
        if lensTokenShows {
          Color.clear
            .frame(width: lensTokenWidth, height: LensToken.height)
            .swarmObstacle()
        }
      }
      .allowsHitTesting(false)
      .padding(.trailing, LensToken.right)
      .padding(.bottom, LensToken.bottom(homeInset: homeInset))
    // RETIRED 2026-09-23 (IOS-8g): the TERMINAL chip in the top-right. What it
    // opened is the session card's `···` now; the field's corners are the
    // account's and the tab bar's.
  }

  /// SE-2 (UM-D27 A; DESIGN.md §8 "The phone's profile token") — the chosen profile above the search circle, its right
  /// edge on the circle's and its foot at the bar's band, growing out of the circle. It stands on Field at rest
  /// (`lensTokenShows`) whichever view the stage stands on: the lens recedes the swarm's bodies (`GodviewRecede.swarm`)
  /// and the other views' rows (`GodviewStageInput.lens`), so a filtered field shows what filters it, and its ×, on
  /// every one. *(Corrected 2026-11-06, SE-2n: this said the lens recedes the rows of the views that are not the
  /// swarm.)*
  private var lensToken: some View {
    Color.clear
      .overlay(alignment: .bottomTrailing) {
        if let profile = lens.chosen, lensTokenShows {
          ProfileLensToken(
            profile: profile, menuOpen: lensMenuOpen,
            onMenu: {
              // SE-P5b — the menu's Agent Profiles… circle is a meter view: opening it reads the home's profiles again
              if !lensMenuOpen { meters.open() }
              lensMenuOpen.toggle()
            },
            onClear: { lens.show(nil) }, onWidth: { width in lensTokenWidth = width }
          )
          .transition(LensToken.grow(reduceMotion: reduceMotion))
        }
      }
      .padding(.trailing, LensToken.right)
      .padding(.bottom, LensToken.bottom(homeInset: homeInset))
  }

  private var workspaceDesktops: [WorkspaceDesktop] {
    (link?.desktops ?? []).map { desktop in
      WorkspaceDesktop(id: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        online: desktop.state == .ready)
    }
  }

  /// A launch begins (PJ-7): from the field's hold or bloom, or from a
  /// project's New agent — the sheet comes filled with the usual place.
  private func beginCreate(_ context: LaunchContext) {
    if workspaceLaunch == nil {
      workspaceLaunch = WorkspaceLaunch(desktops: workspaceDesktops, home: link?.home) { device, method, params in
        guard let link else {
          throw FieldProductError(kind: "UNAVAILABLE", message: "Connect a desktop", retryable: true)
        }
        return try await link.workspaceCall(on: device, method: method, params: params)
      }
    }
    workspaceLaunch?.update(workspaceDesktops)
    workspaceLaunch?.prepare(context)
    createSheet = workspaceLaunch
  }

  /// PJ-7 — a project's places as a launch names them: by ref, by their
  /// folder's name, with why one cannot take a launch.
  private func launchPlaces(_ places: [ProjectPlace]) -> [LaunchPlace] {
    let now = Date()
    return places.map { place in
      let drawn = FieldHistoryModel.place(place, now: now)
      return LaunchPlace(
        ref: place.ref, name: drawn.name, branch: drawn.branch, desktop: place.ref.device, reason: drawn.reason,
        lastAt: place.lastAt, last: drawn.last)
    }
  }

  /// From a project (its New agent): its places first in the folder sheet,
  /// its recipe filling the rows.
  private func projectContext(_ key: String) -> LaunchContext {
    let projects = historyDesktops.projects
    guard let summary = projects.summaries[projects.moved(key) ?? key] else { return LaunchContext() }
    return LaunchContext(projectName: summary.name, places: launchPlaces(summary.places), recipe: summary.recipe)
  }

  /// From the field (the hold, or the bloom's desktop and profile): FS-2's
  /// sheet as it is, filled with the newest place known on that desktop.
  private func fieldContext(desktop: String? = nil, profileSet: String? = nil) -> LaunchContext {
    let summaries = historyDesktops.projects.summaries.values.filter(FieldHistoryModel.listed)
    return LaunchContext(
      usual: summaries.flatMap { launchPlaces($0.places) }, desktop: desktop, profileSet: profileSet)
  }

  /// PJ-7 — what a hold on the field can bloom (DESIGN.md §8's phone
  /// paragraph): every desktop, its OS mark, its state line, its profiles.
  private var bloomMenu: BloomMenu? {
    guard let link else { return nil }
    let desktops = link.desktops.map { desktop in
      let asleep = desktop.state != .ready
      // bare terminals carry no join, so they are not counted, as before
      let running = projected.filter { $0.agent?.join?.deviceID == desktop.deviceId }.count
      let profiles = (bloomProfiles[desktop.deviceId] ?? []).map { set in
        BloomProfile(
          id: set.id, label: set.kind == "native" ? LaunchModel.nativeLabel : set.label, isDefault: set.isDefault,
          glyph: set.glyph)
      }
      return BloomDesktop(
        id: desktop.deviceId, name: desktop.name, platform: desktop.platform, asleep: asleep,
        sub: asleep ? "ASLEEP" : running > 0 ? "\(running) RUNNING" : "IDLE", profiles: profiles)
    }
    return BloomMenu(desktops: desktops, home: link.home)
  }

  /// Each answering desktop's profiles (the bloom's) and catalog (History's
  /// Resume) not read yet, asked of its own door.
  private func readBloomProfiles() {
    guard let link else { return }
    for desktop in link.desktops where desktop.state == .ready {
      let id = desktop.deviceId
      if bloomProfiles[id] == nil {
        Task {
          guard let answer = try? await link.workspaceCall(on: id, method: "agents.profileSets.list"),
            let sets = try? AgentProfileSetsResult(json: answer)
          else { return }
          bloomProfiles[id] = sets.sets
        }
      }
      if fieldCatalogs[id] == nil {
        Task {
          guard let answer = try? await link.workspaceCall(on: id, method: "agent.catalog", params: AgentCatalogParams.phone.json),
            let catalog = try? AgentCatalogResult(json: answer)
          else { return }
          fieldCatalogs[id] = catalog.catalog
        }
      }
    }
  }

  /// The desktop a project's New agent would start on (its usual place's).
  private func usualDesktop(_ key: String) -> WorkspaceDesktop? {
    let context = projectContext(key)
    let online = Set(workspaceDesktops.filter(\.online).map(\.id))
    guard
      let place = LaunchModel.usualPlace(
        recipe: context.recipe, places: context.usual, desktop: link?.home ?? "", online: online)
    else { return nil }
    return workspaceDesktops.first { $0.id == place.desktop }
  }

  // MARK: - WI-1: the two states

  /// WI-1 (DESIGN.md §9 "The way in"; WI-L1) — the phone's two states. Signed in, the tabs. Signed out, nothing
  /// here: the way in stands on the splash's own field, which this holds up (`.splashHolds`), and is drawn over
  /// it (`.splashOverlay`). A sign-out keeps the tabs under the splash until it stands whole over them
  /// (`FieldHomeModel.tabsStand`), so the splash fades in over the tabs, not over the panel. The hooks that teach
  /// the account's memory live here, never on the tabs, so a first sign-in's listing is remembered while the way
  /// in still stands.
  private var standing: some View {
    ZStack {
      if FieldHomeModel.tabsStand(signedIn: wayInStep == nil, splashCovers: splashCovers) {
        tabs
          .allowsHitTesting(wayInStep == nil)
          .accessibilityHidden(wayInStep != nil)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .splashHolds(wayInStep != nil)
    .splashOverlay { wayIn }
    .onChange(of: doorPage) { previous, next in
      // How it works stands only over the welcome: another page ends it (L3)
      tourPage = FieldHomeModel.tourPage(tourPage, after: next)
      // WI-2 — the found beat: a page that stood for a first sign-in yields to signed in
      guard FieldHomeModel.wayInEnds(previous: previous, next: next) else { return }
      let found = FieldHomeModel.foundDesktop(home: link?.home, desktops: linkDesktops)
      let ending = FieldHomeModel.WayInStep.found(name: accountLogin.flatMap { faceStore.name(for: $0) }, desktop: found?.name)
      wayInEnding = ending
      Task {
        try? await Task.sleep(for: FieldHomeModel.foundBeatHold)
        // WI-3 — then the lock, offered last while the phone can lock and it is off (WI-D3 A); then the hand-over
        if wayInEnding == ending { wayInEnding = FieldHomeModel.afterFoundBeat(offer: lockOffered) }
      }
    }
    // WI-3 — locking folds the card's keyboard by its own fold, as another device taking the seat does: the
    // keyboard stands in a window of the system's, over the curtain
    .onChange(of: lock.state) { _, state in
      if state != .open { inputCard.dismissKeyboard() }
    }
    // IOS-8c — every listing teaches the account's memory: which desktops it
    // has, and — from the first door that answers with a user id — its face.
    .onChange(of: linkDesktops) {
      rememberAccount()
      syncHistoryDesktops()
      workspaceLaunch?.update(workspaceDesktops)
      readBloomProfiles()
    }
    // SP-6 — the home moved: the History groups re-order and the home's
    // reader takes the shared door
    .onChange(of: linkHome) { syncHistoryDesktops() }
    // The tabs mount at sign-in and unmount under the way in, and their hooks go
    // with them. So the field folds what arrived while the way in stood (the
    // stage's own refold hooks were not there to hear it), and the way in
    // standing again (a sign-out, Tailscale asking again) takes the screen whole:
    // nothing the tabs had open stays over it or comes back with them.
    .onChange(of: wayInStep == nil) { _, signedIn in
      if signedIn { refold() } else { closeWhatTheTabsOpened() }
    }
    #if DEBUG
      // WI-1's OWED witness — signed out, the slice's link waits for the tabs to be down: a launch signed out stands
      // them until the splash covers them, and the stage's hooks would fold a board that came before then.
      .onChange(of: tabsStanding) { _, standing in
        if !standing, fieldSliceSignedIn == false { installFieldSlice() }
      }
      // The mock's account moves while the way in stands too, so its hooks stand
      // here rather than on the tabs.
      .onChange(of: mockDesktopIsUp) { syncMockHistory() }
      .onChange(of: mockFieldIsLive) { _, live in
        if live == true { feed.start() } else { feed.stop() }
      }
    #endif
  }

  /// Whether the tabs stand: signed in, or signed out until the splash covers them (`FieldHomeModel.tabsStand`).
  private var tabsStanding: Bool {
    FieldHomeModel.tabsStand(signedIn: wayInStep == nil, splashCovers: splashCovers)
  }

  #if DEBUG
    /// `-vf-demo-field-slice`: PG-3a's WITNESS remote board through the real home path (the comment where the launch
    /// reads it). Once (`link == nil`). Under WI-1's OWED witness's stamp, the self sign-in follows, and then the
    /// witness's own reading of the field (`FieldSliceSignIn.reading`).
    private func installFieldSlice() {
      guard link == nil, let fixture = FieldLink.goldenFixture() else { return }
      fixture.start()
      link = fixture
      fixtureLink = true
      reportCard()
      guard let delay = FieldSliceSignIn.launch(ProcessInfo.processInfo.arguments), fieldSliceSignedIn == false
      else { return }
      Task {
        try? await Task.sleep(for: delay)
        print("[field-slice] signing in by itself after \(delay)")
        fieldSliceSignedIn = true
        // the found beat, then the hand-over, then the tabs' mount and its refold
        try? await Task.sleep(for: FieldHomeModel.foundBeatHold + .seconds(2))
        print(FieldSliceSignIn.reading(bubbles.map(\.id)))
      }
    }
  #endif

  /// The way in's screen standing, or nil for signed in: How it works over the welcome, the way in's own end,
  /// else the page the decision stands.
  private var wayInStep: FieldHomeModel.WayInStep? {
    #if DEBUG
      if let stamped = demoAccount?.wayIn { return stamped }
    #endif
    if let wayInEnding { return wayInEnding }
    guard let door = doorPage else { return nil }
    if let tourPage, case .welcome = door { return .tour(tourPage) }
    return .page(door)
  }

  @ViewBuilder
  private var wayIn: some View {
    if let step = wayInStep {
      WayInView(
        screen: FieldHomeModel.wayInScreen(step, lock: lockOffered, device: DeviceWord.current),
        face: wayInFace,
        faceSeed: accountSeed,
        onAct: wayInAct)
      .phoneAppearance(phoneLook)
      // On the way in rather than the tabs: the reader is how a signed-out phone takes a desktop's code.
      .fullScreenCover(isPresented: $macCodeReaderOpen) {
        MacCodeReader(
          onCode: { code in
            macCodeReaderOpen = false
            receive(code, arrival: .scanned)
          },
          onClose: { macCodeReaderOpen = false })
      }
    }
  }

  /// WI-3 — the method the way in will offer the lock in, while it will (the lock off and a passcode set): the
  /// steps' third bar is named for it, and the found beat goes on to it.
  private var lockOffered: LockMethod? {
    lock.canOffer ? lock.method : nil
  }

  /// The face that takes the mark's place: the account's, once a desktop has said who you are.
  private var wayInFace: UserFace? {
    if case .face(let face) = accountFace.control { return face }
    return nil
  }

  /// WI-1 — what the tabs had open closes under the way in: the card (and what it presented), Settings, the
  /// launch sheet and the corner's menu. They are presented over the window, so they would stand over the way in.
  private func closeWhatTheTabsOpened() {
    selection = nil
    closeCard()
    closeSettings()
    createSheet = nil
    if accountMenuOpen { setAccountMenu(open: false) }
  }

  /// WI-1 — the way in's acts, each the home's own: the sign-in, the reader, the tour, and TS-7b's two.
  private func wayInAct(_ act: FieldHomeModel.WayInAct) {
    switch act {
    case .continueWithTailscale, .signInAgain:
      performSignIn()
    case .scanCode:
      macCodeReaderOpen = true
    case .seeHowItWorks:
      tourPage = 0
    case .tour(let page):
      tourPage = min(max(page, 0), 3)
    case .welcome:
      tourPage = nil
    case .useAnotherAccount:
      // Tailscale asking again, answered with another account: the full sign-out, then the welcome
      signOut()
    case .switchAccount:
      switchAccount()
    case .keepAccount, .startOver:
      // the desktop's code is set aside: the welcome, or the account kept
      keepAccount()
    case .openAdminConsole(let url):
      openURL(url)
    case .lockOn:
      // Lock with Face ID: iOS asks (its first time is its own question), then the hand-over; a miss stays here
      Task {
        if await lock.setOn(true) { wayInEnding = nil }
      }
    case .notNow:
      wayInEnding = nil
    case .unlock:
      // the curtain's own act; the way in never shows it
      Task { await lock.unlock() }
    }
  }

  // MARK: - IOS-9e: the pages, and the bar over them

  /// Three pages under one bar. `TabView` hosted them until IOS-9e; its bar
  /// could not seat the account at the left (see `AppBar`), so the pages are
  /// stacked here and kept alive, the way a TabView keeps its tabs, and the
  /// bar is ours. Search stands over whichever page stands (SE-2: the scrim
  /// and the sheet are the bar's).
  private var tabs: some View {
    ZStack {
      fieldTab.page(visible: selectedTab == .field)
      historyTab.page(visible: selectedTab == .history)
      chatTab.page(visible: selectedTab == .chat)
    }
    .background { chatHooks }
    .background { metersHooks }
    .overlay { bar }
    .overlay { faceHoldOverlay }
    .overlay(alignment: .bottom) { chatNoteOverlay }
    .background {
      GeometryReader { geo in
        Color.clear
          .onAppear {
            homeInset = geo.safeAreaInsets.bottom
            safeTop = geo.safeAreaInsets.top
            screenHeight = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
          }
          .onChange(of: geo.safeAreaInsets.bottom) { _, inset in homeInset = inset }
          .onChange(of: geo.safeAreaInsets.top) { _, inset in safeTop = inset }
          .onChange(of: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom) { _, height in
            screenHeight = height
          }
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
    .onChange(of: selectedTab) { history.barMinimized = false }
    // SE-2 — the lens keys on the home's profiles: read again whenever the home's answer moves
    .onChange(of: homeProfiles, initial: true) { _, sets in
      lens.adopt(sets)
      #if DEBUG
        // the mock's lens door stands once its profiles do: the first call can carry the profiles read before the
        // mock set its own, and adopting those lets a lens chosen at launch go (M-phone's pre-light stills)
        if let id = mockLens, sets.contains(where: { $0.id == id }) {
          lens.show(id)
          mockLens = nil
        }
      #endif
    }
    // SE-2 — the token's menu goes with the token: a lens let go, a page or the Me menu opened, the face held
    .onChange(of: lensTokenShows) { _, shows in
      if !shows { lensMenuOpen = false }
    }
    // Every push and pop opens the bar again, the way the system's does.
    .onChange(of: history.path) { history.barMinimized = false }
  }

  /// The field, under the bar's glass to the screen's edge. PG-4t — and under
  /// the Stories row to the screen's top: the stage is full-bleed, so its
  /// space is the screen's and its top inset is the row's reserve.
  private var fieldTab: some View {
    stage
      .ignoresSafeArea(.container, edges: [.top, .bottom])
  }

  private var historyTab: some View {
    HistoryLedgerView(history: historyDesktops, router: history) { need in
      historyDesktops.need(need)
    }
    .environment(\.historyActs, historyActs)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      Color.clear.frame(height: AppBar.clearance(homeInset: homeInset, stepper: history.stepperShowing || slotProject != nil || slotSession != nil))
    }
  }

  /// IOS-12b (PC-D1 A) — Chat's page: its sparks, SP-1b's reading over the
  /// home's rows, newest activity first.
  private var chatTab: some View {
    let entries = chatEntries
    return ChatPage(
      entries: entries, ledger: chatLedger, desktops: chatDesktopNames(entries), away: chatAway,
      heard: chat.reading.heard, homeName: chatName(nil), sessions: chatSessions,
      onWake: { spark in Task { try? await chat.wake(spark) } },
      feed: chat, thread: $chatThread, onOpenPane: openSparkPane,
      // IOS-12d (Q5) — Answer in its pane opens only a run with a session card on the field, else the card says so
      paneOpens: { key in bubbles.contains { $0.runKey == key } }
    )
    .safeAreaInset(edge: .bottom, spacing: 0) {
      // a thread's composer takes the bar's place: no clearance under it
      Color.clear.frame(height: chatThread == nil ? AppBar.clearance(homeInset: homeInset, stepper: false) : 0)
    }
  }

  /// IOS-12c (PC-D2 A) — Open its pane: the spark's own run's session card on the Field, which IS the attach (FW-D2),
  /// found by the run's board key (`runtimeRunId`, a bubble's `runKey`). A run the board no longer shows opens nothing.
  private func openSparkPane(_ run: AgentRemoteRow) {
    guard let bubble = bubbles.first(where: { $0.runKey == run.runtimeRunId }) else { return }
    selectedTab = .field
    openCard(on: bubble)
  }

  /// IOS-12b — Chat's list: every spark the home lists, read by SP-1b's rule
  /// over the home's rows and the needs-you queue.
  private var chatEntries: [SparkEntry] {
    SparkEntries.entries(
      sparks: chat.reading.sparks, rows: (link?.rows ?? []).map(\.board), items: chat.reading.items)
  }

  /// IOS-12f (VF-PM 2026-11-07 13:37:20Z, ruled (a)) — the person's live sessions on the home, for New spark's reach:
  /// nil until a live home answers for the board.
  private var chatSessions: [RunProfileFacts]? {
    guard let link, link.fieldIsLive else { return nil }
    return NewSpark.sessions(link.rows.map(\.board), home: linkHome)
  }

  /// Chat's mark on the bar (PC-D5 A): the sparks that need you, else the
  /// cyan dot while a thread is unread.
  private var chatMark: TabMark {
    TabMark.chat(needing: SparkEntries.needing(chatEntries), unread: !chatLedger.unread.isEmpty)
  }

  /// Chat's hooks, on an invisible view of their own so the screen's chain
  /// stays inside what the type-checker solves: the door follows the home,
  /// the list follows the board's live sparks, the ledger reads each reading,
  /// and the way back from the background asks again.
  private var chatHooks: some View {
    Color.clear
      .onChange(of: linkHome, initial: true) { syncChatDoor() }
      .onChange(of: link?.fieldIsLive) { _, live in
        syncChatDoor()
        chat.board((link?.rows ?? []).map(\.board), live: live == true)
      }
      #if DEBUG
        .onChange(of: mockActive) { syncChatDoor() }
      #endif
      .onChange(of: link?.rows) { _, rows in chat.board((rows ?? []).map(\.board), live: link?.fieldIsLive == true) }
      .onChange(of: chatEntries) { _, entries in
        chatLedger.read(entries)
        noteIfNew(entries)
      }
      .onChange(of: selectedTab) { _, tab in
        if tab == .chat { chatNote = nil }
        chatLedger.show(ChatThreads.onScreen(tab: tab, thread: chatThread), chatEntries)
        chat.show(page: tab == .chat, thread: chatThread)
      }
      .onChange(of: chatThread) { _, thread in
        chatLedger.show(ChatThreads.onScreen(tab: selectedTab, thread: thread), chatEntries)
        chat.show(page: selectedTab == .chat, thread: thread)
      }
      // IOS-12d — where Chat's cards stand: an answer that returns while its card is off screen goes to the note
      .onAppear { chat.show(page: selectedTab == .chat, thread: chatThread) }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { chat.refresh() }
      }
  }

  /// S-4 — a spark that starts to need you while another page stands says so
  /// over the bar for 2.4 s; the first whole reading is no news.
  private func noteIfNew(_ entries: [SparkEntry]) {
    let whole = chat.reading.heard && chat.reading.needsHeard
    guard let entry = chatNotes.read(entries, elsewhere: selectedTab != .chat, whole: whole) else { return }
    chatNoteSaid += 1
    let said = chatNoteSaid
    withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : FieldMotion.island(0.42)) { chatNote = entry.spark }
    Task {
      try? await Task.sleep(for: ChatNoteView.lasts)
      guard said == chatNoteSaid else { return }
      withAnimation(.easeInOut(duration: 0.2)) { chatNote = nil }
    }
  }

  /// The note, 12 above the bar's row, while another page stands and search is closed (it keeps the bar's place);
  /// above the profile token while the token stands (§8 "The phone's profile token": Chat's note stacks above it).
  /// IOS-12d (Q4) — an answer given in Chat that came back while its card was off screen, and did not go as asked,
  /// says its line here first, in the card's words, for the note's time; a press opens its spark's thread.
  @ViewBuilder
  private var chatNoteOverlay: some View {
    ZStack(alignment: .bottom) {
      if selectedTab != .chat, !searchOpen, !accountMenuOpen, faceHold.held == nil {
        if let said = chatSaid {
          chatNoteFrame(
            ChatNoteView(spark: said.spark, text: said.note.text) {
              chat.heard(said.note)
              chatThread = said.spark.id
              selectedTab = .chat
            }
          )
          .task(id: said.note.id) {
            try? await Task.sleep(for: chatSaidLasts)
            if !Task.isCancelled { chat.heard(said.note) }
          }
        } else if let spark = chatNote {
          chatNoteFrame(
            ChatNoteView(spark: spark) {
              chatNote = nil
              selectedTab = .chat
            })
        }
      }
    }
    .animation(reduceMotion ? .easeInOut(duration: 0.2) : FieldMotion.island(0.42), value: chatSaid?.note.id)
  }

  /// The note's place: 12 above the bar's row, or above the profile token while it stands.
  private func chatNoteFrame(_ note: some View) -> some View {
    note
      .padding(
        .bottom,
        (lensTokenShows
          ? LensToken.bottom(homeInset: homeInset) + LensToken.height
          : AppBar.bottomGap(homeInset: homeInset) + AppBar.height) + ChatNoteView.gap)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
      .ignoresSafeArea(.container, edges: .bottom)
      .transition(.move(edge: .bottom).combined(with: .opacity))
  }

  /// IOS-12d (Q4) — the oldest answer that came back off screen and did not go as asked, with its spark's face.
  private var chatSaid: (note: ChatOffScreen, spark: SparkSummary)? {
    for note in chat.offScreen {
      if let spark = chat.reading.sparks.first(where: { $0.id == note.spark }) { return (note, spark) }
    }
    return nil
  }

  /// The answer's note stands for the note's time; the stills hold it under `-vf-chat-note-holds` (DEBUG, still 8).
  private var chatSaidLasts: Duration {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-vf-chat-note-holds") { return .seconds(3600) }
    #endif
    return ChatNoteView.lasts
  }

  /// Chat's door: the home's own client while the home answers; none while
  /// it does not, and the list stands as the home last said (PC-L4).
  private func syncChatDoor() {
    #if DEBUG
      if mockActive {
        chat.attach(ChatFixtureDoor.shared, home: ChatFixtureDoor.home)
        chat.stagedAtBoard = ChatFixtureDoor.stagedAtBoard()
        // `-vf-mock-chat-away`: the home answers once and then sleeps, so the page stands as it last said
        if ProcessInfo.processInfo.arguments.contains("-vf-mock-chat-away") {
          Task {
            try? await Task.sleep(for: .seconds(1))
            chat.attach(nil, home: nil)
          }
        }
        return
      }
    #endif
    guard let link, let home = link.home, link.fieldIsLive, let client = link.client(for: home) else {
      chat.attach(nil, home: nil)
      return
    }
    chat.attach(client, home: home)
  }

  // MARK: - UM-4: the meters

  /// The meters' hooks, on an invisible view of their own as Chat's are: the door follows the home, the field, the
  /// foreground and the mock's standing; and a hold standing as the app leaves the foreground is taken away. The lens
  /// follows the meters' profiles through `homeProfiles`, its one list (SE-P5b).
  private var metersHooks: some View {
    Color.clear
      .onChange(of: linkHome, initial: true) { syncMetersDoor() }
      .onChange(of: link?.fieldIsLive) { syncMetersDoor() }
      .onChange(of: scenePhase) { _, phase in
        syncMetersDoor()
        if phase != .active { cancelHold() }
      }
      #if DEBUG
        .onChange(of: mockActive) { syncMetersDoor() }
        .onChange(of: mockDesktopIsUp) { syncMetersDoor() }
      #endif
  }

  /// The meters' door (UM-D8 A): the home's own client while the app is in the foreground and the home answers — the
  /// phone runs no poll, and a phone in the background watches nothing; none otherwise, and the meters keep the
  /// home's last word. Under `-vf-mock` it is the fixture door, read at the fixtures' own stamp.
  private func syncMetersDoor() {
    #if DEBUG
      if let mock {
        meters.clock = { MetersFixtureDoor.now }
        meters.attach(scenePhase == .active ? mock.metersDoor : nil, home: mock.home)
        return
      }
    #endif
    guard scenePhase == .active, let link, let home = link.home, link.fieldIsLive, let client = link.client(for: home)
    else {
      meters.attach(nil, home: linkHome)
      return
    }
    meters.attach(client, home: home)
  }

  /// The home's name in the meters' words (§9: "Read a minute ago, from studio").
  private var metersHomeName: String {
    #if DEBUG
      if let mock { return mock.homeName }
    #endif
    return linkDesktops.first { $0.deviceId == linkHome }?.name ?? "your home"
  }

  /// The Agent Profiles page (UM-D26 A), in Settings' sheet: paper, corners 40, the system's rise.
  private var agentProfilesSheet: some View {
    AgentProfilesPage(feed: meters, lens: $lens, home: metersHomeName)
      .presentationDetents([.large])
      .presentationDragIndicator(.hidden)
      .presentationCornerRadius(40)
      .presentationBackground(ChromePalette.paper)
  }

  /// A desktop's name for Chat's words: the field's, else the demo's; the
  /// home's when nothing names one.
  private func chatName(_ device: String?) -> String {
    #if DEBUG
      if mockActive, let name = ChatFixtureDoor.names[device ?? ChatFixtureDoor.home] { return name }
    #endif
    let id = device ?? linkHome
    return linkDesktops.first { $0.deviceId == id }?.name ?? "your home"
  }

  /// The desktops the sparks live on, by name, in the list's order.
  private func chatDesktopNames(_ entries: [SparkEntry]) -> [String] {
    var names: [String] = []
    for entry in entries {
      let name = chatName(entry.spark.device)
      if !names.contains(name) { names.append(name) }
    }
    return names
  }

  /// The desktops that did not answer (PC-L4), each its last word or never
  /// heard (`ChatAway.lines`): every one the merge says did not answer, or
  /// the home itself while no door answers — asleep when the tailnet no
  /// longer lists it, else not answering.
  private var chatAway: [ChatAway] {
    ChatAway.lines(
      chat.reading, home: linkHome, homeListed: linkDesktops.contains { $0.deviceId == linkHome }, name: chatName)
  }

  // MARK: - SE-2: search, a glass sheet over the page that stands

  /// The home's profiles that stand on a circle — the lens's ONE list (UM-4's seam keys on the home's; ruling 7: a
  /// draft no agent signed in to has no circle, so it is never a lens): the meters' read of the home
  /// (`MetersReading.profiles`, through `MeterModel.hasCircle`), which the hold's buds, the page's rows and the token's
  /// menu read too; under `-vf-mock`, the same read of the meters' fixture, taken at launch so the lens door stands
  /// before the feed answers. *(Until SE-P5b, 2026-11-06, this was the bloom's read of the home, a draft included,
  /// adopted beside the meters'.)*
  private var homeProfiles: [AgentProfileSet] {
    #if DEBUG
      if mock != nil { return mockProfiles }
    #endif
    return meters.reading.profiles
  }

  /// Live now's world: the window's drawn rows (the mock's witness under `-vf-mock`), the desktops, the lens's
  /// profiles and the live ask's lines.
  private var searchLive: PhoneSearch.Live {
    #if DEBUG
      if mock != nil {
        return PhoneSearchWorld.live(
          rows: mockSearchRows, desks: PhoneSearchWorld.desks(rows: mockSearchRows), lens: lens,
          lines: historyDesktops.liveLines(searchQuery))
      }
    #endif
    return PhoneSearchWorld.live(
      rows: link?.rows ?? [], desks: PhoneSearchWorld.desks(linkDesktops, home: linkHome), lens: lens,
      lines: historyDesktops.liveLines(searchQuery))
  }

  /// What the sheet draws, from the lens, search's state, Live now's world, each desktop's answer and the ledger, and
  /// how far each is answered (SE-2i). Everything's rows name each agent by the link's catalog (SE-2l).
  private var searchContent: SearchSheetContent {
    let live = searchLive
    return PhoneSearchWorld.content(
      search, query: searchQuery, lens: lens, live: live,
      answers: historyDesktops.readers.map { reader in
        let groups = FieldHistoryModel.visibleHits(query: searchQuery, kind: .any, in: reader.corpus)
        return (corpus: reader.corpus, groups: groups)
      },
      latest: historyDesktops.projects.corpus, agentLabel: PhoneSearchWorld.agentLabel(link?.catalog ?? .empty),
      feed: searchFeed, asked: searchAsked(live))
  }

  /// SE-2i — Live now's world as it stands: the home's live board, or why none answers yet. The mock's rows are its
  /// world, so they are live.
  private var searchFeed: PhoneSearch.Feed {
    #if DEBUG
      if mock != nil { return .live }
    #endif
    return PhoneSearchWorld.feed(
      isLive: link?.fieldIsLive ?? false, home: linkDesktops.first { $0.deviceId == linkHome })
  }

  /// SE-2i — how far the words are answered, for the scope that stands: Live now by the desktops that own its runs,
  /// Everything by every desktop's index.
  private func searchAsked(_ live: PhoneSearch.Live) -> PhoneSearch.Asked {
    switch search.scope {
    case .live:
      PhoneSearchWorld.liveAsked(
        PhoneSearchWorld.liveAnswerers(historyDesktops.readers, runs: PhoneSearchWorld.runs(live)),
        query: searchQuery, asking: searchAsking)
    case .everything:
      PhoneSearchWorld.pastAsked(
        PhoneSearchWorld.pastAnswerers(historyDesktops.readers, kind: search.kind), query: searchQuery,
        asking: searchAsking)
    }
  }

  /// Where the search field's top stands from the screen's top: at rest on the bar's row, typing above the keys.
  private var searchFieldTop: CGFloat {
    barTyping
      ? screenHeight - keyboardInset - AppBar.gapAboveKeyboard - AppBar.fieldHeightTyping
      : screenHeight - AppBar.bottomGap(homeInset: homeInset) - AppBar.height
  }

  /// The sheet over the bar's row, 10 from the sides, its foot 10 above the field: `content` is the render's one
  /// composition (`barRow`'s), which the field's tokens and Return read too.
  private func searchSheet(_ content: SearchSheetContent) -> some View {
    PhoneSearchSheet(
      content: content, maxHeight: SearchSheet.maxHeight(fieldTop: searchFieldTop),
      onScope: { scope in search.scope = scope },
      onChip: { filter in applySearchFilter(filter, in: content) },
      onOffer: { filter in
        // a tap applies it, drops the word it was typed as and keeps the keyboard
        applySearchFilter(filter, in: content)
        searchQuery = PhoneSearch.droppingLastWord(searchQuery)
      },
      onLive: openLiveRow, onPast: openPastRow,
      onAct: { act in PhoneSearchWorld.act(act, state: &search, lens: &lens) },
      // MA-6's seams (MA-D7): the Apps strip and Everything's Apps group, empty until MA-6 fills them
      appsStrip: { EmptyView() }, appsGroup: { EmptyView() }
    )
    .padding(.horizontal, SearchSheet.side)
    .padding(.bottom, (barTyping ? AppBar.fieldHeightTyping : AppBar.height) + SearchSheet.gapAboveField)
    // SE-2j — the kind is part of the question: Prompts' answer is no answer for every kind, so a kind changed asks
    // again (and cancels the ask it replaces, which then lands nothing)
    .task(id: "\(searchQuery)|\(search.scope.rawValue)|\(search.kind.rawValue)") { await askSearch() }
  }

  /// The words, asked after a pause in typing (the record's own debounce for a question that crosses a radio): Live
  /// now's of each desktop over its own live runs, Everything's of every desktop's index. The words are out (SE-2i,
  /// `searchAsking`) from the moment they are typed until this ask comes back; a newer ask that cancels it says when
  /// it is done itself.
  private func askSearch() async {
    let words = searchQuery.trimmingCharacters(in: .whitespaces)
    searchAsking = !words.isEmpty
    guard !words.isEmpty else { return }
    try? await Task.sleep(for: SearchSheet.askAfter)
    guard !Task.isCancelled else { return }
    switch search.scope {
    case .live: await historyDesktops.searchLive(words, runs: PhoneSearchWorld.runs(searchLive))
    case .everything: await historyDesktops.search(words, kind: search.kind)
    }
    guard !Task.isCancelled else { return }
    searchAsking = false
  }

  /// A chip's or an offer's filter, named as the chip names it (a project's token keeps the name).
  private func applySearchFilter(_ filter: PhoneSearch.Filter, in content: SearchSheetContent) {
    let label = content.chips.joined().first { $0.filter == filter }?.label ?? ""
    PhoneSearchWorld.apply(filter, label: label, state: &search, lens: &lens)
  }

  /// The search circle becomes the field (their shared `glassID`), the sheet rises over the page that stands, on
  /// Live now every time, and the keyboard comes up once the field exists to take it.
  private func openSearch() {
    search = SearchState()
    lensMenuOpen = false
    searchOpen = true
    Task {
      try? await Task.sleep(for: .milliseconds(120))
      searchFocused = true
    }
  }

  /// Search closes: only the profile outlives it (the lead's ruling 21) — the desktop's token, the kind and the
  /// project clear. Its ask goes with the sheet (the sheet's task is cancelled), so nothing is out.
  private func closeSearch() {
    searchFocused = false
    searchOpen = false
    searchAsking = false
    search = SearchState()
    lens.searchClosed()
  }

  /// A live row: search closes and its body's card opens on Field.
  private func openLiveRow(_ row: PhoneSearch.LiveRow) {
    closeSearch()
    selectedTab = .field
    if let bubble = bubbles.first(where: { $0.id == row.id }) { openCard(on: bubble) }
  }

  /// A past row: History at its first matched line (the stepper holding the words), or the session itself.
  private func openPastRow(_ row: PhoneSearch.PastRow) {
    let corpus =
      historyDesktops.readers.first { $0.deviceId == row.device }?.corpus ?? historyDesktops.projects.corpus
    let target = PhoneSearch.target(row, corpus: corpus, query: searchQuery)
    closeSearch()
    switch target {
    case .landing(let landing, let query):
      history.land(landing, query: query)
    case .session(let device, let projectId, let id):
      let project = projectId.map { [HistoryRouter.Route.project(id: $0)] } ?? []
      history.path = project + [.session(device: device, id: id)]
    case .card:
      return
    }
    selectedTab = .history
  }

  /// Return: the first row of what the sheet shows opens.
  private func submitSearch(_ content: SearchSheetContent) {
    switch content.rows {
    case .live(let rows): if let first = rows.first { openLiveRow(first) }
    case .past(let rows): if let first = rows.first { openPastRow(first) }
    }
  }

  /// SE-2 — the profile token stands on Field at rest only (`LensToken.shows`): never while the face is held (UM-4's
  /// PH-5), the Me menu is open, or a page stands — a card, Settings, or the Agent Profiles page (SE-P5b).
  private var lensTokenShows: Bool {
    LensToken.shows(
      lens, onField: selectedTab == .field, searchOpen: searchOpen, faceHeld: faceHold.held != nil,
      menuOpen: accountMenuOpen, pageOpen: selection != nil || settingsSheetOpen || agentProfilesOpen)
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
      // SE-2 — the page under search wears the search scrim (§5: its dim alone, no blur); a tap on it closes search
      if searchOpen {
        SearchScrim(onClose: closeSearch)
          .transition(SearchSheet.scrimTransition)
      }
      // SE-2 — the profile token's menu, over a clear scrim that closes it, its foot 8 above the token; the scrim
      // stands only while the menu does, so no scrim is left to eat a tap once the token has gone
      if lensMenuOpen, lensTokenShows {
        Color.clear
          .contentShape(Rectangle())
          .ignoresSafeArea()
          .onTapGesture { lensMenuOpen = false }
      }
      Color.clear
        .overlay(alignment: .bottomTrailing) {
          if lensMenuOpen, lensTokenShows {
            ProfileLensMenu(
              items: LensToken.items(lens, live: searchLive),
              onPick: { id in
                lens.show(id)
                lensMenuOpen = false
              },
              // SE-P5b — Agent Profiles…: the Me menu's own row (its circle of every plan at 26); its act folds this
              // menu and opens the page. Read only while the menu stands, as the Me menu's is.
              page: AgentProfilesMenuRow(
                reading: meters.reading, now: meters.clock(),
                open: {
                  lensMenuOpen = false
                  agentProfilesOpen = true
                })
            )
            .transition(LensToken.pop(reduceMotion: reduceMotion))
          }
        }
        .padding(.trailing, LensToken.right)
        .padding(.bottom, LensToken.menuBottom(homeInset: homeInset))
      if !barAside {
        barRow
          .padding(.bottom, barTyping ? AppBar.gapAboveKeyboard : AppBar.bottomGap(homeInset: homeInset))
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    // IOS-12c (§8): in a thread the bar steps aside and the composer takes its place, as Messages does (380ms)
    .animation(reduceMotion ? .easeInOut(duration: 0.2) : .easeInOut(duration: 0.38), value: barAside)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    .ignoresSafeArea(.container, edges: .bottom)
    .animation(reduceMotion ? .easeInOut(duration: 0.2) : AppBar.motion, value: barState)
  }

  @ViewBuilder
  private var barRow: some View {
    // SE-2 — search's content, composed once a render (it walks every session the phone holds): the sheet, the
    // field's tokens and Return all read this one
    let content = searchOpen ? searchContent : nil
    ZStack(alignment: .bottom) {
      if !searchOpen && !barFolded {
        accountCorner
          .padding(.leading, AppBar.margin)
          .frame(maxWidth: .infinity, alignment: .bottomLeading)
          .transition(.opacity)
      }
      // SE-2k — the sheet in a glass container of its own: its foot 10 above the field is inside the bar's melt (12),
      // so in the bar's container iOS 26 would bridge it and the field into one shape (the profile token's reason).
      // Its rise is its own transition, so it needs no morph.
      if let content {
        GlassGroup { searchSheet(content) }
          .transition(SearchSheet.transition(reduceMotion: reduceMotion))
      }
      GlassGroup(spacing: AppBar.meltSpacing) {
        ZStack(alignment: .bottom) {
          if barStepper {
            stepper
          } else if let key = slotProject {
            newAgentSlot(key)
          } else if let session = slotSession {
            sessionSlot(session)
          }
          if let content {
            SearchBarRow(
              query: $searchQuery, focus: $searchFocused, typing: barTyping, glass: barGlass,
              tokens: content.tokens,
              onRemove: { filter in PhoneSearchWorld.remove(filter, state: &search, lens: &lens) },
              onSubmit: { submitSearch(content) }, onClose: closeSearch
            )
            .padding(.horizontal, barTyping ? AppBar.marginTyping : AppBar.margin)
          } else if !accountMenuOpen {
            if barFolded {
              foldedTabs
                .padding(.leading, AppBar.margin)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
              TabCapsule(
                selection: $selectedTab, field: .field(waiting: waitingCount), chat: chatMark, pill: tabPill)
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
    // SE-2l — while search stands, its sheet and its field are all VoiceOver reaches: the page under the scrim is
    // out of reach, as it is out of touch (the field's close circle leaves)
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(searchOpen ? .isModal : [])
  }

  /// What the bar's animation follows. The account menu is NOT in it: that
  /// change rides the menu's own curve (`setAccountMenu`), and an implicit
  /// animation here would override it.
  private struct BarState: Equatable {
    var tab: AppTab
    var search: Bool
    var folded: Bool
    var stepper: Bool
    var typing: Bool
    /// IOS-12c — a thread stands on Chat: the bar steps aside.
    var aside: Bool
  }

  private var barState: BarState {
    BarState(
      tab: selectedTab, search: searchOpen, folded: barFolded,
      stepper: barStepper || slotProject != nil || slotSession != nil, typing: barTyping, aside: barAside)
  }

  /// IOS-12c — a thread stands on Chat, and its composer is in the bar's place.
  private var barAside: Bool { selectedTab == .chat && chatThread != nil }

  /// History's scroll has folded the bar to its glyph (the page's minimize); search open over it unfolds it.
  private var barFolded: Bool {
    selectedTab == .history && history.barMinimized && !accountMenuOpen && !searchOpen
  }
  /// A landed search is on top: the stepper rides the bar (not while search stands over the page).
  private var barStepper: Bool {
    selectedTab == .history && history.stepperShowing && !accountMenuOpen && !searchOpen
  }
  /// PJ-7 — a project on top of History's stack, no landed search holding the
  /// slot: New agent stands there (TP §6.3).
  private var slotProject: String? {
    guard selectedTab == .history, !history.stepperShowing, !accountMenuOpen, !searchOpen,
      case .project(let key)? = history.path.last
    else { return nil }
    return key
  }
  /// A software keyboard stands under search: the row rides above it at the
  /// system's typing size. Focus alone is not enough — with a hardware
  /// keyboard the field is focused and no keyboard rises, and the row stays
  /// where it rests.
  private var barTyping: Bool { searchOpen && keyboardInset > homeInset + 40 }

  private var accountCorner: some View {
    // WI-3 — Lock now, only while the lock is on
    let onLockNow: (() -> Void)? = lock.isOn ? { lockNow() } : nil
    return AccountCornerView(
      face: accountFace,
      isOpen: accountMenuOpen,
      seed: accountSeed,
      onToggle: {
        // UM-4 — a meter view opening reads the home's profiles again
        if !accountMenuOpen { meters.open() }
        setAccountMenu(open: !accountMenuOpen)
      },
      onAccount: {
        setAccountMenu(open: false)
        settingsOpening = .account
        settingsSheetOpen = true
      },
      onSettings: {
        setAccountMenu(open: false)
        settingsOpening = .root
        settingsSheetOpen = true
      },
      onSignOut: {
        setAccountMenu(open: false)
        signOutPending = true
      },
      onSignIn: {
        setAccountMenu(open: false)
        performSignIn()
      },
      onLockNow: onLockNow,
      // the row's meters are read only while the menu stands: its rows leave with their last drawing as it folds
      agentProfiles: accountMenuOpen
        ? AgentProfilesMenuRow(
          reading: meters.reading, now: meters.clock(),
          open: {
            setAccountMenu(open: false)
            agentProfilesOpen = true
          }) : nil,
      hold: FaceHoldActs(
        place: { faceCentre = $0 },
        begin: { beginHold() },
        move: { moveHold(to: $0) },
        end: { endHold() },
        cancel: { cancelHold() },
        actions: FaceHold.actions(meters.reading.profiles),
        perform: { performHoldAct($0) })
    )
  }

  // MARK: - UM-4: the held face

  /// The held face over the whole screen, above the tabs, while a hold stands.
  @ViewBuilder
  private var faceHoldOverlay: some View {
    if let held = faceHold.held {
      FaceHoldOverlay(
        held: held, reading: meters.reading, now: meters.clock(), home: metersHomeName, face: accountFace,
        seed: accountSeed)
        .transition(.opacity)
    }
  }

  /// The hold completed: the held face opens on the hub, and the home's profiles are read again.
  private func beginHold() {
    meters.open()
    faceHold.open(face: faceCentre)
  }

  /// The finger moved: what it reaches now, the buds standing in the home's order.
  private func moveHold(to finger: CGPoint) {
    faceHold.move(finger, profiles: meters.reading.profiles.map(\.id))
  }

  /// Let go: the lens takes the reach (a bud, every profile, or as it was), and the held face fades.
  private func endHold() {
    var after = faceHold
    guard let release = after.letGo() else { return }
    lens.letGo(release)
    withAnimation(FieldMotion.plainEase(reduceMotion ? 0.09 : 0.18)) { faceHold = after }
  }

  /// The hold was taken away (a call, Control Center, the face replaced, the app leaving): the held face fades, and
  /// the field stays as it was.
  private func cancelHold() {
    guard faceHold.held != nil else { return }
    withAnimation(FieldMotion.plainEase(reduceMotion ? 0.09 : 0.18)) { faceHold.cancel() }
  }

  /// VoiceOver's acts in place of the hold.
  private func performHoldAct(_ act: FaceHold.Act) {
    switch act {
    case .page: agentProfilesOpen = true
    case .show(let id): lens.show(id)
    case .showAll: lens.show(nil)
    }
  }

  /// WI-3 — the corner's Lock now: the menu folds, the curtain stands at once, and Face ID asks over it.
  private func lockNow() {
    setAccountMenu(open: false)
    lock.lockNow()
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

  /// PJ-7 — a session on top of History's stack, no landed search holding the
  /// slot: its act (Resume, Jump to, or why not) stands there (TP §6.3).
  private var slotSession: HistorySession? {
    guard selectedTab == .history, !history.stepperShowing, !accountMenuOpen, !searchOpen,
      case .session(let device, let id)? = history.path.last
    else { return nil }
    return historyDesktops.projects.corpus.sessions.values.lazy.flatMap { $0 }
      .first { $0.id == id && ($0.device ?? device) == device }
  }

  /// The session's act in the stepper's slot, with where it runs.
  @ViewBuilder
  private func sessionSlot(_ session: HistorySession) -> some View {
    if let act = historyActs.act(for: session) {
      Button {
        switch act {
        case .jump: if let native = session.nativeSessionId { jumpToRun(native) }
        case .resume: Task { resumeWords = await resumeSession(session) }
        case .why: break
        }
      } label: {
        HStack(spacing: 8) {
          switch act {
          case .jump: FieldGlyph(.jump, size: FieldGlyph.box(for: 15))
          case .resume, .why: FieldGlyph(.resume, size: FieldGlyph.box(for: 15))
          }
          Text(act == .jump ? "Jump to" : "Resume").font(ChromeType.sans(15, .semibold))
          Spacer(minLength: 6)
          if case .why(let reason) = act {
            Text(reason).font(ChromeType.sans(13))
          } else if let words = resumeWords {
            Text(words).font(ChromeType.sans(13)).lineLimit(1)
          } else if let device = session.device {
            DeviceMark(platform: link?.desktops.first { $0.deviceId == device }?.platform, size: 12)
            Text([session.deviceName, session.folder].compactMap { $0 }.joined(separator: " · "))
              .font(ChromeType.sans(13)).lineLimit(1)
          }
        }
        .foregroundStyle(act == .why("asleep") ? ChromePalette.inkSecondary : ChromePalette.ink)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .disabled({ if case .why = act { true } else { false } }())
      .frame(height: barFolded ? AppBar.height : AppBar.stepperHeight)
      .liquidGlassCapsule()
      .glassID("stepper", in: barGlass)
      .padding(.horizontal, barFolded ? AppBar.margin + AppBar.height + AppBar.inlineGap : AppBar.margin)
      .padding(.bottom, barFolded ? 0 : AppBar.height + AppBar.stepperGap)
      .onChange(of: session.id) { resumeWords = nil }
    }
  }

  // MARK: - PJ-7: History's acts (Q3 (a))

  /// What History's rows may offer, and how they are done.
  private var historyActs: HistoryActs {
    HistoryActs(
      inField: { native in projected.contains { $0.agent?.join?.nativeSessionID == native } },
      desktopAwake: { device in link?.desktops.first { $0.deviceId == device }?.state == .ready },
      canResume: { device, provider in
        fieldCatalogs[device].map { rows in rows.contains { $0.id == provider && $0.canResume } }
      },
      resume: { session in await resumeSession(session) },
      jump: { native in jumpToRun(native) })
  }

  /// Resume on the session's OWN desktop's door, by its native id and no path
  /// (that desktop fills the folder); a refusal is said in words.
  private func resumeSession(_ session: HistorySession) async -> String {
    guard let link, let device = session.device, let provider = session.provider,
      let native = session.nativeSessionId
    else { return "This session cannot be resumed from here" }
    let desktop = link.desktops.first { $0.deviceId == device }?.name ?? session.deviceName ?? "its desktop"
    let agent = fieldCatalogs[device]?.first { $0.id == provider }?.label ?? provider
    do {
      _ = try await link.workspaceCall(
        on: device, method: "agent.resume",
        params: AgentResumeNativeParams(provider: provider, nativeSessionId: native).json)
      UINotificationFeedbackGenerator().notificationOccurred(.success)
      return "Resuming on \(desktop)"
    } catch {
      UINotificationFeedbackGenerator().notificationOccurred(.warning)
      let refusal = (error as? FieldProductError) ?? FieldProductError(kind: "UNAVAILABLE", message: "\(error)")
      return FieldHistoryModel.resumeRefusal(
        kind: refusal.kind, reason: refusal.details?["reason"]?.stringValue,
        state: refusal.details?["state"]?.stringValue, message: refusal.message, desktop: desktop, agent: agent)
    }
  }

  /// Jump to: the Field tab opens the card of the run that continues this
  /// conversation (joined by the field row's native id).
  ///
  /// PG-3e: found by the join's native id itself — a bubble's id is its BODY's
  /// (the visual id), which a promoted row does not share with its run.
  private func jumpToRun(_ native: String) {
    guard let bubble = bubbles.first(where: { $0.agent?.join?.nativeSessionID == native }) else { return }
    selectedTab = .field
    openCard(on: bubble)
  }

  /// PJ-7 — New agent in the stepper's slot (DESIGN.md §8's FS-2 entry): the
  /// Start glyph and its words, then the usual place's desktop.
  private func newAgentSlot(_ key: String) -> some View {
    let desktop = usualDesktop(key)
    return Button {
      beginCreate(projectContext(key))
    } label: {
      HStack(spacing: 8) {
        FieldGlyph(.start, size: FieldGlyph.box(for: 15))
        Text("New agent").font(ChromeType.sans(15, .semibold))
        Spacer(minLength: 6)
        if let desktop {
          DeviceMark(platform: desktop.platform, size: 12)
          Text(desktop.name).font(ChromeType.sans(13)).lineLimit(1)
        }
      }
      .foregroundStyle(ChromePalette.ink)
      .padding(.horizontal, 18)
      .frame(maxWidth: .infinity, minHeight: 44)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .frame(height: barFolded ? AppBar.height : AppBar.stepperHeight)
    .liquidGlassCapsule()
    .glassID("stepper", in: barGlass)
    .padding(.horizontal, barFolded ? AppBar.margin + AppBar.height + AppBar.inlineGap : AppBar.margin)
    .padding(.bottom, barFolded ? 0 : AppBar.height + AppBar.stepperGap)
    .accessibilityLabel(desktop.map { "New agent, on \($0.name)" } ?? "New agent")
  }

  /// One curve for the menu's grow and the bar's fold, so they move together.
  private func setAccountMenu(open: Bool) {
    withAnimation(AccountCornerView.grow) { accountMenuOpen = open }
  }

  /// The Field tab's orange count (§2.5): your own agents waiting on you. A
  /// spark's runs are counted on Chat, once (PC-D5 A, one need, one count).
  private var waitingCount: Int { TabMark.fieldWaiting(bubbles) }

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
    /// TS-7 — the mock's fleet ticks only while its field is live: the mock's
    /// own Sign in starts it, its Sign out stops it.
    private var mockFieldIsLive: Bool? { mock?.fieldIsLive }

    private func syncMockHistory() {
      guard let mock else { return }
      historyDesktops.mount(
        .fixed(corpus: .mock, standing: mock.desktopIsUp ? .connected : .asleep))
    }
  #endif


  public var body: some View {
    standing
      .background(FieldPalette.panelBackground.ignoresSafeArea())
      .phoneAppearance(phoneLook)
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
        // TS-7 — the welcome's Continue with Tailscale, as a finger would
        // tap it: the corner's menu is not the way in while the welcome stands.
        if ProcessInfo.processInfo.arguments.contains("-vf-auto-connect") {
          performSignIn()
        }
        // IOS-9d — `-vf-mock`: the whole phone over invented facts and no
        // tailnet. The account is `MockAccount`'s (signed in, 🦊, studio up
        // and mini asleep; every act in the corner moves its standing), the
        // field is the scripted fleet, History is the records' corpus, and
        // search's Live now reads the witness's rows (SE-2) and Everything the
        // corpus. `-vf-mock-tab=history|chat` opens a page and `=search` opens
        // search over Field, `-vf-mock-open` grows the corner's menu, `-vf-mock-signed-out`
        // starts on the `Sign in` circle, `-vf-mock-search=<q>` fills the
        // search field, `-vf-mock-landed` lands the second hit of the first
        // group, and `-vf-mock-folded` folds the bar as a scroll down would.
        if ProcessInfo.processInfo.arguments.contains(MockAccount.argument), mock == nil {
          let account = MockAccount()
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-signed-out") { account.standing = .signedOut }
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-reconnecting") { account.standing = .reconnecting }
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-approval") { account.standing = .approval }
          mock = account
          mockActive = true
          if account.fieldIsLive { feed.start() }
          syncMockHistory()
          // SE-2 — Live now's rows (the witness's), the home's profiles (the meters' fixture's, on a circle: SE-P5b)
          // and search's doors: `-vf-mock-lens=<profile>`, `-vf-mock-search-scope=everything`,
          // `-vf-mock-search-filter=desk:<device>`
          mockSearchRows = MockAccount.searchRows()
          mockProfiles = MockAccount.searchProfiles()
          lens.adopt(mockProfiles)
          let doors = PhoneSearchWorld.Doors.read(ProcessInfo.processInfo.arguments)
          lens.show(doors.lens)
          // held too: the profiles' onChange shows it again once they stand, whichever call lands last
          mockLens = doors.lens
          if let words = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-mock-search=") }) {
            searchQuery = String(words.dropFirst("-vf-mock-search=".count))
          }
          if let tab = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-mock-tab=") }) {
            switch tab.dropFirst("-vf-mock-tab=".count) {
            case "history": selectedTab = .history
            case "chat": selectedTab = .chat
            // search opens over Field, on Live now unless a door says Everything, kept to a desktop if one says so
            case "search":
              openSearch()
              if let scope = doors.scope { search.scope = scope }
              lens.keep(desk: doors.desk)
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
          // UM-4 — the Agent Profiles page over the fixture door's home (`-vf-mock-usage=` picks its usage state)
          if ProcessInfo.processInfo.arguments.contains("-vf-mock-agent-profiles") { agentProfilesOpen = true }
          // UM-4 — the face held for a photograph, once the corner has placed it and the home's profiles are read
          if let reach = FaceHold.mockReach(ProcessInfo.processInfo.arguments) {
            Task {
              try? await Task.sleep(for: .milliseconds(800))
              faceHold.held = FaceHold.Held(face: faceCentre, reach: reach)
            }
          }
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
          demoAccount = AccountFixtures.demo(named: state)
          if demoAccount == nil { print("unknown account fixture:", state) }
          if ProcessInfo.processInfo.arguments.contains(AccountFixtures.openArgument) {
            accountMenuOpen = true
          }
        }
        // TS-7 — the spike TS-D11 A asked for first: can the app close the
        // system's sign-in sheet in code, with no callback to end it? The sheet
        // goes up at Tailscale's page and the app closes it 4 s later, saying
        // each step on the console. `shared` meets iOS's consent alert first,
        // `ephemeral` the page itself. No tailnet is involved: the close is the
        // app's own.
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-demo-signin=") }),
          let page = URL(string: "https://login.tailscale.com/start")
        {
          let mode = String(argument.dropFirst("-vf-demo-signin=".count))
          let sheet = TailscaleSignInSession(ephemeral: mode == "ephemeral")
          sheet.onEnded = { ending in print("[signin] ended: \(ending)") }
          demoSignIn = sheet
          Task {
            try? await Task.sleep(for: .seconds(1))
            print("[signin] presenting (\(mode))")
            sheet.present(page)
            try? await Task.sleep(for: .seconds(4))
            print("[signin] closing by the app; presented: \(sheet.presented != nil)")
            sheet.close()
            try? await Task.sleep(for: .seconds(1))
            print("[signin] after the close; presented: \(sheet.presented != nil)")
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
        // `-vf-demo-field-slice`: PG-3a's WITNESS remote board through the
        // REAL home path (PG-3e) — three desktops on the fixture's tailnet
        // (Studio, the home; Loft, online, its rows arriving through the home;
        // Attic, offline), the phone homing to Studio and reading the field
        // through its `agent.subscribe {projection: "remote", scope: "mesh"}`:
        // the home's window row for row, Loft's rows with their host, Attic's
        // kept rows GREYED. The network is an in-process door answering the
        // witness's own bytes, so the swarm AND the corner can be photographed
        // over real-shaped rows in both themes with no desktop and no tailnet.
        // It is not a demo path: nothing downstream of the door knows the
        // difference, which is the point. (Corrected 2026-11-02, PG-3e: from
        // DS-8 it served the contracts' golden FIELD mesh board, four desktops
        // — studio, laptop, air asleep, mini stale; before DS-8 the golden
        // `field.agents.v1` slice through the store reader, retired by DS-D14.)
        //
        // `link == nil` because this whole block runs again on every return to
        // the view: without it a disappear/reappear built a SECOND fixture
        // link and stranded the first, which is the live path's own stranding
        // bug wearing a fixture.
        //
        // WI-1's OWED witness — signed out (`-vf-demo-field-slice-signed-out`), the slice waits until the tabs are
        // down (`installFieldSlice`, from `standing`), so its board can only arrive under the way in.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-field-slice"), link == nil,
          fieldSliceSignedIn != false || !tabsStanding
        {
          installFieldSlice()
        }
        // PG-4s — a still's view and clock (`-vf-godview-view=<id>`, `-vf-godview-now=<epoch ms>`). Neither is a
        // fixture argument: alone they keep the live path, and they compose with `-vf-demo-field-slice`. Read once.
        // PG-4t — and the still itself (`-vf-godview-still`): every view draws one frame. The view flag is the
        // run's override and never writes the person's pick; `-vf-godview-say=<id>` holds that view's name, with no
        // deadline (a still cannot tap); `-vf-godview-dissolve=off` draws the stage unmasked, for a frame meter.
        if !godviewLaunchRead {
          godviewLaunchRead = true
          let arguments = ProcessInfo.processInfo.arguments
          if let view = GodviewViewChoice.launch(arguments) { godviewLaunch = view }
          godviewNow = GodviewViewChoice.frozenNow(arguments)
          godviewStill = GodviewViewChoice.still(arguments)
          godviewDissolves = GodviewViewChoice.dissolves(arguments)
          if let said = GodviewViewChoice.said(arguments) { godviewSaying = .held(said) }
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
        // IOS-10a — `-vf-open-settings[=<page>]`: Settings, at its root or
        // at one page (`account`, `desktop:<id>`, `appearance`, `terminal`,
        // `about`, `acknowledgements`, `lock`), for a photograph run.
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("-vf-open-settings") }) {
          settingsOpening = FieldHomeModel.settingsOpening(argument: argument)
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
          inputCard.sink = { act in
            print("input act:", act)
            return true
          }
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
        let autoOpen = ProcessInfo.processInfo.arguments.first {
          $0 == "-vf-auto-open-card" || $0.hasPrefix("-vf-auto-open-card=")
        }
        if let autoOpen {
          Task {
            try? await Task.sleep(for: .seconds(2))
            // Item 154 (DEBUG) — `-vf-auto-open-card=<visual id>` opens THAT body's card, once the field draws it
            // (ten seconds at most). A name the field never holds opens nothing, and says so: no silent fallback.
            if autoOpen.hasPrefix("-vf-auto-open-card=") {
              let named = String(autoOpen.dropFirst("-vf-auto-open-card=".count))
              for _ in 0..<20 where !bubbles.contains(where: { $0.id == named }) {
                try? await Task.sleep(for: .milliseconds(500))
              }
              guard let bubble = bubbles.first(where: { $0.id == named }) else {
                print("[auto-open] no body \(named) on the field: no card opened")
                return
              }
              print("[auto-open] opening \(named)")
              openCard(on: bubble)
              return
            }
            // A bubble with a TERMINAL first when there is one: its face is
            // the one with an act on it, so it is what a screenshot run is
            // usually after. Since TM-5 that is a fold row whose join names a
            // session — a remote row is the DEBUG fixture's, and is kept as
            // the fallback for exactly that reason.
            let wanted =
              bubbles.first(where: { $0.join?.hasTerminal == true })
              ?? bubbles.first(where: { $0.remote?.attachable == true })
              ?? bubbles.first(where: { $0.status == .working })
              ?? bubbles.first
            // RETIRED 2026-10-17 (FW-D2): `-vf-auto-attach`, which carried
            // the run on through ATTACH a second after the card rose. Opening
            // a card IS the attach now, so this open already mints and dials.
            if let wanted { openCard(on: wanted) }
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
      // Signed in is connected (2026-10-18): the mesh keeps itself up.
      if meshKeepsItselfUp { mesh.keepUp() }
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
      if state == .up { wakeFreewayLinks() }
      syncSignInSheet()
    }
    // RETIRED 2026-09-14 (TM-3): the IOS-4d trigger that asked each desktop for
    // this device's write key the moment it finished hello. There is no door to
    // ask and no key to hold.
    .onChange(of: scenePhase) { _, phase in
      // The phase is passed rather than re-read: inside this closure the
      // environment's own value is the one thing we should not have to guess
      // about, and guessing wrong is what stranded the poll before.
      syncDiscovery(meshIsUp: mesh.state == .up, phase: phase)
      // Coming to the front is the moment to look at the mesh again; the
      // background pauses a waiting re-dial (the node itself stays).
      if meshKeepsItselfUp {
        if phase == .active { mesh.keepUp() } else if phase == .background { mesh.sceneDidEnterBackground() }
      }
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
        // Routes internally: suspended-by-app becomes a real resume, and a
        // session that only went inactive has nothing to do. Calling
        // upstream's resume on a session that never left would force a
        // spurious reconnect.
        attachment?.resumeFromForeground()
        wakeFreewayLinks()
        // --- IOS-5c: coming back is the other honest moment to look at the
        // pasteboard — copying happens in the app the user just left.
        pasteboard.sample()
        // --- end IOS-5c
      case .background:
        // The orderly counterpart — without it `resumeFromForeground` has
        // nothing to resume from (upstream §8.2).
        attachment?.suspendForBackground()
        // and every desktop's lanes with it: iOS keeps no socket behind a
        // suspended app, and a kept session re-attaches when it is opened
        for lanes in terminalLanes.values { lanes.closeAll() }
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
    // F1 — each desktop's keyring holds tickets for the sessions the field shows on it.
    .onChange(of: bubbles) { _, next in
      for (deviceID, freeway) in freeways {
        freeway.keyring.want(Self.listedSessions(next, on: deviceID))
      }
    }
    // fix8 — the row says the run EXITED while the card is still attaching:
    // the card says so and stops dialing a terminal the desktop let go of.
    .onChange(of: cardTerminalFace) { _, face in
      if FieldHomeModel.runHasExited(face) { attachment?.runEnded() }
      // FW-D2 — a card raised before its run's terminal was offered (the
      // board's join, or the desktop's doors, still on their way) attaches the
      // moment the face offers it, as the open would have.
      if selection != nil, face.offersAttach, let cardBubble { beginAttachment(to: cardBubble) }
    }
    .sheet(item: $selection, onDismiss: { closeCard() }) { selected in
      sessionCard(selected)
        // A terminal earns the room from the card's first frame: at the 0.55
        // detent it is a letterbox, the keyboard would take what is left, and
        // a card that opened small and grew as its attach began moved twice.
        .presentationDetents(
          attachment == nil && !cardTerminalFace.offersAttach ? [.fraction(0.55), .large] : [.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .fieldGlassSheet()
    }
    .sheet(isPresented: $settingsSheetOpen) {
      settingsSheet(at: settingsOpening)
    }
    .sheet(isPresented: $agentProfilesOpen) {
      agentProfilesSheet
    }
    // RETIRED 2026-09-14 (TM-3): the write-key sheet, which took a pasted
    // capability or asked the desktop for one. Both doors are deleted.
    // RETIRED 2026-09-23 (IOS-8b): the mesh sheet. Its status sentence, its
    // account line, its one act and its roster are the account menu's now.
    // TS-7 — the Tailscale login page, in the system's sign-in sheet, which
    // the app opens and closes itself: it follows the page and the phase
    // (`SignInSheet.step`). RETIRED here (TS-D11 A): the `.sheet(item:)` that
    // held a `SafariView`, which shared no cookies and was never closed when
    // the node came up.
    .onChange(of: mesh.loginPage) { syncSignInSheet() }
    // TS-7b — the expected login arriving settles the Mac's code; a link to
    // the scheme is a code too, from wherever it came (EL7: drawn as such).
    .onChange(of: mesh.loginName) { settleExpectation() }
    .onOpenURL { url in
      guard case .success(let code) = PhoneCode.parse(url.absoluteString) else { return }
      receive(code, arrival: .link)
    }
  }

  /// One presenter, at root: an arriving page folds the account menu first,
  /// so the sheet never rises under an open menu.
  private func syncSignInSheet() {
    switch SignInSheet.step(page: mesh.loginPage?.url, presented: signInSheet.presented, state: mesh.state) {
    case .present(let page), .replace(let page):
      setAccountMenu(open: false)
      signInSheet.onEnded = { ending in
        switch ending {
        case .personCancelled: mesh.loginCancelled()
        case .failed(let reason): mesh.loginSheetFailed(reason)
        case .closedByApp: break
        }
      }
      signInSheet.present(page)
    case .close:
      signInSheet.close()
    case .keep:
      break
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
      // a new start builds a new one — so the source is void, not
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
        // PG-3f — a `.closeDoor` closes the link but leaves the card open: the new link hears it
        reportCard()
      }
    }
  }

  /// The runtime is gone, so the stores' streams and every door with it. A
  /// link with no node is not a paused link — it is one whose mesh no longer
  /// exists, and a new start builds a different one.
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
      terminalReason: cardTerminalFace.note,
      agentAttachable: cardTerminalFace.offersAttach,
      // Item 41: the live card's badge wears the OS of the desktop it runs on.
      sessionOS: cardSessionOS,
      // Item 41: the live card is its terminal, on the terminal's own ground.
      // Before the attachment exists the ground is the appearance it will be
      // seeded from, so the card never changes its layout as it rises.
      liveGround: cardGround,
      // Item 42: who drives the session from another device, while one does —
      // the live card's readout, centered over its held veil.
      seatReadout: cardSeatReadout,
      inputIsOpen: inputCardFace == .shown && inputCard.keyboardOwner != .none,
      onOtherDriverAppeared: { inputCard.dismissKeyboard() }
    ) {
      liveTerminal(title: bubble?.project)
    }
    // Paste, replies, and the show/fold key float over the grid in both input
    // states. The open card below alone reserves terminal space.
    .overlay(alignment: .bottom) {
      if inputCardFace == .shown {
        let ground = cardGround
        InputOverlay(model: inputCard, pasteboard: pasteboard)
          .environment(\.colorScheme, ground.inkScheme)
      }
    }
    // A keyboard coming up — any owner, either mode — is the person engaging
    // this pane: it takes the seat (DS-D5), and puts the view back on the
    // bottom first, so the prompt is on screen to type into.
    .onChange(of: inputCard.keyboardOwner) { old, new in
      guard old == .none, new != .none else { return }
      attachment?.engage()
      attachment?.followBottom()
    }
    // Item 42 — the holder let go while this card is on the screen: the card
    // takes the empty seat itself (Q1's ruling on the phone, DESIGN.md §8). On
    // the screen is the scene active and this card the one presented — the
    // attachment is only ever the presented card's, and a closed card's is
    // parked in `keptAttachments`, where nothing takes. When, and the once, are
    // `FieldHomeModel.takesEmptySeat`'s.
    .onChange(of: attachment?.seat?.driver) { old, new in
      guard
        FieldHomeModel.takesEmptySeat(
          from: old, to: new, phase: scenePhase, presented: selection != nil)
      else { return }
      attachment?.takeEmptySeat()
    }
    // --- IOS-5a: the card rides the bottom safe area, above the keyboard ---
    .safeAreaInset(edge: .bottom, spacing: 0) {
      if inputCardFace == .shown {
        InputCard(model: inputCard)
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
    return FieldHomeModel.inputCardFace(phase: attachment.phase, mayType: attachment.mayType)
  }

  /// The card emits acts; the attachment has verbs. This is the whole join,
  /// and it is the reason `FieldInput` never learns what a Ghosttea type is.
  private func installInputSink(on attachment: TerminalAttachment) {
    inputCard.sink = { act in
      // Taken exactly when the terminal accepts input now — the gate every
      // verb below forwards through, read before the act is spent. A declined
      // act is said on the card (the attachment's notice), and the card keeps
      // what was typed.
      //
      // Text is taken only when the terminal took it: a draft or a paste too
      // large for the link's control message is refused and said, and the card
      // keeps it (the History lead's D6, 2026-10-17) — the gate read before the
      // act would have cleared a draft that was never sent.
      switch act {
      case .keystroke(let stroke):
        let taken = attachment.acceptsInput
        attachment.press(stroke)
        return taken
      case .sendDraft(let text): return attachment.sendDraft(text)
      case .typeText(let text): return attachment.typeText(text)
      // --- IOS-5c: a block, with no Enter behind it.
      case .paste(let text): return attachment.pasteText(text)
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

  /// Item 41 — the OS mark the live card's badge wears: the desktop the card's
  /// session runs on, as the link lists it (§13), and a plain screen while its
  /// platform is not said.
  private var cardSessionOS: DeviceMark.OS {
    let device = cardBubble?.join?.deviceID ?? cardBubble?.remote?.deviceID
    return DeviceMark.OS(platform: link?.desktops.first { $0.deviceId == device }?.platform)
  }

  /// The terminal's own ground, for the live card (item 41).
  private var cardGround: CardGround {
    let ground = TerminalGround(attachment?.presentation ?? presentationConfig(for: appearance))
    return CardGround(color: ground.color, solid: ground.solidColor, inkScheme: ground.inkScheme)
  }

  /// Item 42 — who drives the card's session from another device, for the live
  /// card's readout and its held veil: a live terminal's, and only while the
  /// attachment has no words of its own (`FieldHomeModel.showsSeatReadout`).
  /// The held screen's rows are counted in the renderer's own line height.
  private var cardSeatReadout: FieldHomeModel.SeatReadout? {
    guard let attachment,
      FieldHomeModel.showsSeatReadout(
        live: attachment.phase == .live, cooled: attachment.banner?.coolsTerminal ?? false,
        hasWords: attachmentNote != nil || !attachmentActions.isEmpty)
    else { return nil }
    return FieldHomeModel.seatReadout(attachment.seat, lineHeight: attachment.scene.lineHeight)
  }

  @ViewBuilder
  private func liveTerminal(title: String?) -> some View {
    if let attachment {
      TerminalSurface(
        scene: attachment.scene,
        visible: true,
        configuration: attachment.presentation,
        // --- IOS-5a: two modes, two first responders. The kit's own
        // fifteen-key row is off (K-D3) — the card's rail replaces it.
        // --- IOS-5c: the flag, not the mode — the keyboard can be down while
        // the terminal is still the one that would take it. `onFocusChange`
        // reports what the responder call actually achieved, and the card's
        // closed row is that answer rendered.
        // The input audit's F: the card names the keyboard's ONE owner, and a
        // hand-off is that owner's take alone (`ResponderRole`).
        focus: inputCard.responderRole(for: .terminal),
        focusEpoch: inputCard.keyboardRequests,
        onFocusChange: { focused in inputCard.terminalFocused = focused },
        // --- end IOS-5c
        keyboardAppearance: colorScheme == .dark ? .dark : .light,
        // --- end IOS-5a
        accessibilityTitle: title ?? "Remote terminal",
        accessibilityConnectionState: attachmentNote ?? "attached",
        onGridSize: { size in attachment.setViewport(cols: size.columns, rows: size.rows) },
        onGridHeld: { size, reason in attachment.noteHeldGrid(size, because: reason) },
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
        onSelectionCommit: { selection in
          Task {
            do {
              let text = try await attachment.selectionText(selection)
              guard self.attachment === attachment, !text.isEmpty else { return }
              UIPasteboard.general.string = text
              noteCopied(bytes: text.utf8.count)
            } catch is CancellationError {
              // The card or activation changed while its copy was in flight.
            } catch {
              guard self.attachment === attachment else { return }
              noteCopyResult("copy unavailable — \(error.localizedDescription)")
            }
          }
        },
        onRenderFailure: { renderFailure = $0 },
        // The tap raises the card's own input, never a bare keyboard — and
        // only where this device may type (K-D2): a view-only terminal's tap
        // raises nothing.
        onTap: { if inputCardFace == .shown { inputCard.tapTerminal() } },
        // Any touch of the terminal takes the size (DS-D5, James 2026-10-17:
        // "any touch takes"): the device the person touched last has it.
        onTouch: { attachment.engage() }
      )
    }
  }

  // MARK: - IOS-10a: Settings

  /// The phone's Settings, on paper (the History tab's ground, opaque: a page
  /// to read, not a pane of glass), opened where `opening` says.
  private func settingsSheet(at opening: SettingsOpening) -> some View {
    SettingsView(
      account: settingsAccount,
      terminal: terminalAppearance,
      opening: opening,
      lock: lock,
      actions: SettingsActions(
        // Both acts leave Settings first: the sign-in is the system's own
        // sheet, and a signed-out phone is the way in (WI-1).
        signIn: {
          closeSettings()
          performSignIn()
        },
        signOut: {
          closeSettings()
          confirmSignOut()
        })
    )
    .presentationDetents([.large])
    .presentationDragIndicator(.hidden)
    .presentationCornerRadius(40)
    .presentationBackground(ChromePalette.paper)
  }

  private func closeSettings() {
    settingsSheetOpen = false
  }

  /// A confirmed Sign out, from the corner's menu or from Settings › Account.
  private func confirmSignOut() {
    // TS-7b — the person's own Sign out settles a Mac's code too; the sweep
    // alone keeps it, for "Another account?"'s Sign in again.
    expectationMemory.forget()
    signOut()
  }

  /// The terminal's look, as Settings › Terminal edits it.
  private var terminalAppearance: Binding<TerminalAppearance> {
    Binding(
      get: { appearance },
      set: { next in
        // The PREFERENCE commits eagerly and is what every future attach is
        // seeded from; `TerminalAttachment.appearance` is what the terminal on
        // screen is wearing. Since TM-5 they cannot disagree — there is no
        // replica left that could decline a change.
        appearance = next
        TerminalAppearanceStore.save(next)
        // The DEVICE half goes live at once. Under T there is no replica here
        // to rebuild and nothing that can refuse the edit — the glyphs in a
        // remote frame are the cell's, and what these values still style is
        // this renderer's own ground (see `TerminalSettingsPage`'s note).
        attachment?.apply(appearance: next)
      })
  }

  /// Settings' account, decided in `FieldHomeModel.settingsAccount` from the
  /// corner's own inputs, where it is tested without a simulator.
  private var settingsAccount: SettingsAccount {
    #if DEBUG
      if let demoAccount { return demoAccount.settings }
      if let mock { return mock.settings }
    #endif
    _ = identityEpoch
    let account = accountLogin
    let home = linkHome ?? account.flatMap { HomeMemory().lastHome(for: $0) }
    // A home has said who you are: on this connection, or before (its name is
    // kept only from a home's answer).
    let homeAnswered =
      linkDesktops.first { $0.deviceId == linkHome }?.person != nil
      || account.flatMap { faceStore.name(for: $0) } != nil
    return FieldHomeModel.settingsAccount(
      meshState: mesh.state,
      rememberedLogin: mesh.rememberedLogin,
      login: mesh.loginName,
      domain: mesh.tailnetDomain,
      name: account.flatMap { faceStore.name(for: $0) },
      face: account.flatMap { faceStore.face(for: $0) },
      seed: accountSeed,
      home: home,
      homeAnswered: homeAnswered,
      desktops: linkDesktops,
      asleep: account.map { login in
        desktopMemory.remembered(for: login).map {
          .init(deviceId: $0.deviceId, name: $0.name, platform: $0.platform, lastSeen: $0.lastSeen)
        }
      } ?? [],
      isHearing: link?.isHearing ?? false,
      machineName: mesh.machineName,
      adminConsole: mesh.adminConsoleURL)
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
      if let demoAccount { return demoAccount.face }
      if let mock { return mock.face }
    #endif
    _ = identityEpoch
    let account = accountLogin
    return FieldHomeModel.accountFace(
      meshState: mesh.state,
      rememberedLogin: mesh.rememberedLogin,
      login: mesh.loginName,
      domain: mesh.tailnetDomain,
      name: account.flatMap { faceStore.name(for: $0) },
      face: account.flatMap { faceStore.face(for: $0) },
      desktops: linkDesktops,
      asleep: account.map { login in
        desktopMemory.remembered(for: login).map { .init(deviceId: $0.deviceId, name: $0.name, platform: $0.platform) }
      } ?? [],
      foreignDoors: link?.foreignDoors.count ?? 0,
      isHearing: link?.isHearing ?? false)
  }

  // MARK: - WI-1: the way in (TS-7's door, off the Field tab)

  /// The way in's page while signed out, or nil for signed in — decided in
  /// `FieldHomeModel.doorPage`, where it is tested without a simulator.
  private var doorPage: FieldHomeModel.DoorPage? {
    var fixtureOwnsTheField = false
    #if DEBUG
      if let demoAccount { return demoAccount.door }
      if let mock { return mock.door }
      if let signedIn = fieldSliceSignedIn { return FieldSliceSignIn.door(signedIn: signedIn) }
      fixtureOwnsTheField = Self.fixtureArguments || mockActive || fixtureLink || demoRemoteActive
    #endif
    _ = identityEpoch
    return FieldHomeModel.doorPage(
      fixtureOwnsTheField: fixtureOwnsTheField,
      meshState: mesh.state,
      rememberedLogin: mesh.rememberedLogin,
      login: mesh.loginName,
      isGated: mesh.isGatedOnAccount,
      hasListed: link?.hasListed ?? false,
      listed: linkDesktops.count,
      remembered: accountLogin.map { desktopMemory.remembered(for: $0).count } ?? 0,
      machineName: mesh.machineName,
      adminConsole: mesh.adminConsoleURL,
      signInNote: mesh.signInNote,
      expected: expectationMemory.expected())
  }

  /// TS-7b — a Mac's code arrived: remember the account it names. Scanned in
  /// the app on a phone with no account, it goes on to the sign-in — the code
  /// was the step before it; by a link it does not (any page can open the
  /// scheme, so the person's own Continue starts it).
  private func receive(_ code: PhoneCode, arrival: PhoneCodeExpectation.Arrival) {
    #if DEBUG
      if demoAccount != nil || mock != nil { return }
    #endif
    expectationMemory.record(code, arrival: arrival)
    identityEpoch += 1
    settleExpectation()
    if arrival == .scanned, accountLogin == nil { performSignIn() }
  }

  private func settleExpectation() {
    guard FieldHomeModel.expectationSettles(expectationMemory.expected(), login: mesh.loginName) else { return }
    expectationMemory.forget()
    identityEpoch += 1
  }

  /// "Another account?"'s Sign in again: the full sign-out (its sweep keeps
  /// the expectation), then a fresh sign-in, which waits for the sweep.
  private func switchAccount() {
    #if DEBUG
      // A stamped page is a photograph: its acts reach no mesh and no memory.
      if demoAccount != nil || mock != nil { return }
    #endif
    signOut()
    performSignIn()
  }

  /// "Another account?"'s Keep this account: the code is set aside.
  private func keepAccount() {
    #if DEBUG
      if demoAccount != nil || mock != nil { return }
    #endif
    expectationMemory.forget()
    identityEpoch += 1
  }

  #if DEBUG
    /// A launch argument that stages this phone's own pixels owns the field
    /// from the first frame: a door page over its photograph would be the
    /// simulator's mesh (`.off`, nothing remembered) speaking over the
    /// fixture. `-vf-demo-signin` is the real welcome under the real sheet.
    private static let fixtureArguments = ProcessInfo.processInfo.arguments.contains { argument in
      (argument.hasPrefix("-vf-demo-") && !argument.hasPrefix("-vf-demo-signin"))
        || argument.hasPrefix("-vf-mock") || argument.hasPrefix("-vf-swarm-lab")
    }
  #endif

  /// The field's hold, when no door page stands: the launch sheet on the
  /// usual place, or the scripted fleet's spawn under the mock.
  private var fieldHold: (SIMD2<Double>) -> String? {
    { _ in
      #if DEBUG
        if mockActive { return feed.spawn() }
      #endif
      beginCreate(fieldContext())
      return nil
    }
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
    // IOS-8f — the home's own word on its person (`user.me`) replaces the deal
    // and an earlier home's word; until a home answers, the deal below stands.
    if let person = listed.first(where: { $0.deviceId == link?.home })?.person,
      faceStore.adopt(person, login: login)
    {
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
      // TS-7 — a stamped corner is a photograph: its Sign out sweeps nothing,
      // as its Sign in starts no node (`performSignIn`).
      if demoAccount != nil { return }
    #endif
    selection = nil
    closeCard()
    createSheet = nil
    workspaceLaunch = nil
    closeLink()
    // AP-D4 (ITEM 130): History's readers, its ledger and its cache on disk go
    // with the account, beside the mesh's own sweep — the one place every
    // sign-out passes, the welcome's "Another account?" included.
    historyDesktops.signedOut()
    mesh.signOut()
    assembly.projects = .empty
    refold()
    identityEpoch += 1
  }

  /// SIGN IN, as the corner offers it: the first sign-in, or the tailnet
  /// asking again. Everything else about the connection is the mesh's own.
  private func performSignIn() {
    #if DEBUG
      if let mock {
        mock.signIn()
        return
      }
      // TS-7 — a stamped corner is a photograph: its acts start no node.
      if demoAccount != nil { return }
    #endif
    mesh.signIn()
  }

  /// The real mesh keeps itself up, unless the mock or a stamped demo owns the
  /// corner: no node may start under invented facts.
  private var meshKeepsItselfUp: Bool {
    #if DEBUG
      if mockActive || demoAccount != nil { return false }
    #endif
    return true
  }

  // RETIRED 2026-09-14 (TM-3, TM-D3): `collectWriteGrants`,
  // `askDesktopAction` and `requestWriteGrant` — the IOS-4d ladder that asked
  // each ready desktop for this device's write key, once per connection, and
  // stored what came back. The door is deleted; the right to type is a claim
  // in the attach grant, which this phone neither asks for nor keeps.

  // MARK: - IOS-4c: the agent card's terminal

  /// G3's join for the card's subject. `.noJoin` for a remote bubble or the
  /// scripted fleet — neither has an agent row behind it. (Item 154: a bare
  /// terminal's pane join counts too, read through `FieldBubble.join`.)
  ///
  /// Both extra facts come from the DEVICES store rather than from a terminal
  /// listing: the desktop's name, and (TM-5a) whether it publishes its terminal
  /// doors on the tailnet. It is the same desktop either way, and the devices
  /// store is the only one of the two wires that still answers since TM-5.
  private var cardTerminalFace: AgentTerminalFace {
    FieldHomeModel.cardTerminalFace(cardBubble, desktops: link?.desktops ?? [])
  }

  /// The one act an ended run has: RESUME, over that desktop's door. The new
  /// run is NOT put on the field here — the board is the fold's to publish,
  /// and the next slice or delta shows it.
  private func resumeAction(_ join: AgentJoin?, runtimeRunId: String?) -> CardAction? {
    guard FieldHomeModel.offersResume(cardTerminalFace, for: cardBubble), let join, let runtimeRunId, let link
    else { return nil }
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
    // C5 — a transient note outranks "connecting" as it outranks the live line:
    // the cell's refusal for an overload stop lands AFTER the lease that took
    // the card out of live (one ordered leg), so a note said only in `.live`
    // would never be seen.
    case .connecting: return attachment.notice ?? "connecting over the mesh…"
    case .live:
      // A transient note (a keystroke this device declined to send) outranks
      // the standing one, and the standing one is the GRANT's answer: since
      // TM-D3 the right to type is a claim the cell accepted, not a key this
      // phone holds, so there is nothing here for a person to go and fix.
      // The standing line is the grant's (`readWrite`), never the keystroke
      // gate's: `acceptsInput` drops on every reseed, and a line that came and
      // went with it moved the pane each time. A keystroke in that moment is
      // declined in its own words, as the notice above.
      if let notice = attachment.notice { return notice }
      return attachment.readWrite ? nil : "view only — this desktop granted read without input"
    case .suspended(let why): return why
    case .refused(let words): return words
    case .ended(let why): return "ended — \(why)"
    case .failed(let why): return "failed — \(why)"
    case .stalled(let detail): return detail
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
    // PG-3e — a resume names the run's board KEY; a bubble's id is its body's. The mock has no key and keys by id.
    if let resume = resumeAction(cardBubble?.join, runtimeRunId: cardBubble?.runKey ?? cardBubble?.id) {
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

  /// PG-3f (design v2 §4.1) — the phone is a screen: the link hears what the open card shows, by the body it follows
  /// (`selection.id`, the VISUAL id), and reports the row under it to its owner. Called where the card opens and
  /// closes, and at every link install.
  private func reportCard() {
    link?.show(visualId: selection?.id)
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
    reportCard()
    // FW-D2 (James, 2026-10-17: "the terminal should already connect and show
    // the terminal content, no more attach button") — opening the card IS the
    // attach. A kept session comes back painted from its lane; any other mints
    // and dials now. The card's own face is the guard (`beginAttachment`), so
    // a run with no terminal to offer opens on its reason, as before.
    beginAttachment(to: bubble)
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
    // The card this attach is for. Every open attaches since FW-D2, so a card
    // closed while the mesh is asked is an ordinary path: its attachment must
    // not be installed under whichever card opens next.
    let card = selection?.id
    Task {
      defer { attaching = false }
      let urlSession = await mesh.urlSessionProvider
      guard selection?.id == card else { return }
      guard let urlSession else {
        // Honest rather than inert: the card asked for something, and the
        // reason it went nowhere is the mesh, not the session or the renderer.
        attachRefusal = "the mesh is not up on this device — connect it first"
        return
      }
      let freeway =
        terminalLanes[deviceID] == nil
        ? await freewayLanes(deviceID: deviceID, urlSession: urlSession) : nil
      guard selection?.id == card else { return }
      let lanes =
        terminalLanes[deviceID]
        ?? freeway
        ?? TerminalLanes(
          session: urlSession,
          door: { [link] session in
            guard let link else { throw NoDesktopDoor() }
            return try await link.openTerminalTicket(on: deviceID, sessionId: session)
          },
          // P0-C — the renewal rides the same door as the mint (7c-2, 2026-11-06: the home's,
          // `{device}` added for another desktop's session)
          renewal: { [link] session, generation, requestId in
            guard let link else { throw NoDesktopDoor() }
            return try await link.renewTerminalGrant(
              on: deviceID, sessionId: session, expectGeneration: generation, requestId: requestId)
          },
          // SP-2 (g) — the same ledger the link's doors count against.
          budget: .shared)
      terminalLanes[deviceID] = lanes
      // A session a closed card left live comes back as it is — its scene holds
      // the current screen, so the card paints at once — and otherwise a new
      // attachment rides the desktop's lanes.
      let kept = keptAttachments.firstIndex { $0.deviceID == deviceID && $0.sessionID == sessionID }
      let attachment =
        kept.map { keptAttachments.remove(at: $0).attachment }
        ?? TerminalAttachment(lanes: lanes, appearance: appearance)
      attachment.apply(appearance: appearance)
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

  /// F1 — the desktop's terminals on ONE link to it, opt-in (`-vf-freeway`, DEBUG): legs as
  /// streams, tickets and renewals from its host's keyring, instead of a ticket over the product
  /// door and two fresh sockets per cell. Opt-in until James's device round witnesses it (F1's
  /// exit); without the flag nothing here runs and the lanes are today's. No connection budget:
  /// a leg on the link is a stream, not a socket.
  private func freewayLanes(
    deviceID: String, urlSession: @escaping TerminalAttachment.SessionProvider
  ) async -> TerminalLanes? {
    #if DEBUG
      guard ProcessInfo.processInfo.arguments.contains("-vf-freeway"), let link else { return nil }
      let freeway: Freeway
      if let kept = freeways[deviceID] {
        freeway = kept
      } else {
        guard
          let dialing = await mesh.freewayDialing(
            to: deviceID, deviceName: UIDevice.current.name,
            // A refusal names the desktop as the field does (F1b: the approval rides the home).
            desktopName: link.desktops.first { $0.deviceId == deviceID }?.name,
            approve: { [link] in try await link.approveFreeway(on: deviceID) })
        else { return nil }
        let desktop = FreewayDesktopLink(dialing)
        freeway = Freeway(
          link: desktop, keyring: FreewayKeyring(link: { await desktop.standing }),
          focus: FreewayFocus())
        freeways[deviceID] = freeway
        freeway.keyring.start()
      }
      freeway.keyring.want(Self.listedSessions(bubbles, on: deviceID))
      let (desktop, keyring, focus) = (freeway.link, freeway.keyring, freeway.focus)
      return TerminalLanes(
        transport: FreewayRoutedTransport(
          freeway: FreewayLegTransport(focus: focus) { try await desktop.link() },
          fallback: URLSessionRoutedTransport(session: urlSession, log: .device)),
        door: { session in try await FreewayTerminalDoors.ticket(session, on: desktop.link()) },
        renewal: { session, generation, requestId in
          try await FreewayTerminalDoors.renew(
            session, expectGeneration: generation, requestId: requestId, on: desktop.link())
        },
        keyring: TerminalLanes.Keyring(
          take: { await keyring.take($0) }, release: { keyring.release($0) }),
        focused: { cell in Task { await focus.focus(cell) } })
    #else
      return nil
    #endif
  }

  /// The terminal sessions the field shows on one desktop: each run whose join names a PTY there, a bare terminal's
  /// included (item 154), so its ticket is held before the tap as an agent's is.
  static func listedSessions(_ bubbles: [FieldBubble], on deviceID: String) -> Set<String> {
    Set(
      bubbles.compactMap { bubble -> String? in
        guard let join = bubble.join, join.deviceID == deviceID, join.hosted != "none"
        else { return nil }
        return join.runtimeSessionID
      })
  }

  /// F1 (§3's reconnect) — a freeway link that ended dials again now, not on its backoff: the phone
  /// came to the foreground, or its mesh came up.
  private func wakeFreewayLinks() {
    for freeway in freeways.values {
      let desktop = freeway.link
      Task { await desktop.wake() }
    }
  }

  /// One desktop's freeway: its link, kept warm once dialed; the tickets held before the tap; and
  /// which cell's frames ride `live`.
  private struct Freeway {
    let link: FreewayDesktopLink
    let keyring: FreewayKeyring
    let focus: FreewayFocus
  }

  /// The card going away: its subject is released and any attachment with it.
  /// Both halves unconditionally — the subject outlives the listing by design,
  /// so nothing else would ever clear it.
  private func closeCard() {
    let deviceID = attachedDeviceID
    cardBubble = nil
    reportCard()
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
    // FW-D2 — the session stays on its lane with its picture, so opening it
    // again paints at once and needs no mint and no dial; past the three
    // newest it is let go. It is PARKED (demand none), not left live: a view
    // the cell still presents keeps the geometry seat, and a closed card held
    // the desktop's PTY at phone size until the app went to the background
    // (the seat audit, 2026-10-17). Parking detaches the view, which releases
    // the seat cell-side; a live kept session needs a release the protocol can
    // answer (the seat announcement), which is TM's to add. Parked at once, so
    // a reopen can never be parked by a park still on its way.
    guard let sessionID = attachment.attachedSessionID, let deviceID, attachment.park() else {
      Task { await attachment.detach() }
      return
    }
    keptAttachments.removeAll { $0.deviceID == deviceID && $0.sessionID == sessionID }
    keptAttachments.append(KeptTerminal(deviceID: deviceID, sessionID: sessionID, attachment: attachment))
    while keptAttachments.count > Self.keptTerminals {
      keptAttachments.removeFirst().attachment.release()
    }
  }

  /// How many closed cards' sessions stay live (FW-D2's "recent ones hot").
  static let keptTerminals = 3

  /// A closed card's session, kept live on its desktop's lanes.
  struct KeptTerminal {
    let deviceID: String
    let sessionID: String
    let attachment: TerminalAttachment
  }

  // MARK: - Write keys

  // RETIRED 2026-09-14 (TM-3, TM-D3): `cardHasWriteKey`, `writeKeyEntry`,
  // `refreshWriteKeys`, `saveWriteKey` and `removeWriteKey` — the card's key
  // question and the store's four acts. Nothing holds a key to answer about.

  /// The pasteboard confirmation, in the reference's own vocabulary — and it
  /// expires, because a stale "copied" line would sit on top of a real status
  /// the terminal wanted to say.
  private func noteCopied(bytes: Int) {
    noteCopyResult("copied \(bytes) bytes")
  }

  private func noteCopyResult(_ text: String) {
    copiedNote = text
    Task {
      try? await Task.sleep(for: .seconds(2))
      if copiedNote == text { copiedNote = nil }
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
    /// `-vf-demo-input-keypad` takes an optional page (`=combos`, `=functions`),
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
