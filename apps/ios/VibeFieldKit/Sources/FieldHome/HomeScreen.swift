import FieldAgents
import FieldDesign
import FieldInput
import FieldMesh
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
  @State private var mesh = MeshModel()
  @State private var remoteField = RemoteSessionField(source: nil)
  @State private var selection: SessionSelection?
  /// The card's SUBJECT, remembered rather than looked up fresh every frame.
  /// A card is about the session it opened on, and the field's listing is only
  /// the field's current view of it — one that a four-second discovery hiccup
  /// can withdraw while the terminal below is still rendering frames.
  @State private var cardBubble: FieldBubble?
  @State private var meshSheetOpen = false
  @State private var settingsSheetOpen = false
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
  /// Where this phone's mirror-write secrets live (IOS-3c). One per host: a
  /// key is a grant from ONE desktop, and the absent default is the honest
  /// one — a viewer, not a typist (GT-4a's asymmetry from the client side).
  /// The secret leaves here exactly once, into `TerminalAttachment`'s
  /// `accessToken`; nothing on this screen ever renders it.
  @State private var writeKeys: any MirrorWriteStoring = KeychainMirrorWriteStore()
  /// The store's host list, mirrored into state because a store is not
  /// observable: SwiftUI has no way to learn that a keychain changed, so every
  /// save and every removal refreshes this and the views read it.
  @State private var writeKeyHosts: [MirrorWriteHost] = []
  /// The host whose key sheet is open, or none.
  @State private var writeKeySheetHost: MirrorWriteHost?
  /// What the store said when it could not do as it was asked — and the one
  /// non-failure it also carries: a key saved while an attach was already in
  /// flight, which cannot be re-presented until the next one.
  @State private var writeKeyNote: String?
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

  public init() {}

  /// One stage, two sources, projected by the pure functions in FieldAgents.
  private var projected: [FieldBubble] {
    feed.agents.compactMap(fieldBubble(from:)) + remoteField.snapshot.rows.map(fieldBubble(from:))
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
        isActive: scenePhase == .active,
        onSelect: { bubble in openCard(on: bubble) },
        onCreate: { _ in feed.spawn() }
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
    // --- IOS-6d: every projection and every change of the card's subject
    // folds the ledgers; the theme's tint moves the project colours with it.
    // On the stage for the same reason as the cover above.
    .onChange(of: projected) { refold() }
    .onChange(of: selection?.id) { refold() }
    .onChange(of: colorScheme) { refold() }
    // --- end IOS-6d
  }

  @ViewBuilder
  private var chrome: some View {
    MeshChip(state: mesh.state, peerCount: mesh.peers.count) {
      meshSheetOpen = true
    }
    .swarmObstacle()
    .padding(.leading, 14)
    .padding(.top, 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

    // The second chrome corner, mirroring the mesh chip: both are physics
    // obstacles, so the swarm flows around the whole top edge rather than
    // hiding under one side of it.
    FieldChip(label: "TERMINAL") { settingsSheetOpen = true }
      .swarmObstacle()
      .padding(.trailing, 14)
      .padding(.top, 6)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
  }

  public var body: some View {
    stage
      .background(FieldPalette.panelBackground.ignoresSafeArea())
    .onAppear {
      assembly.projects = projectStore.load()
      refold()
      feed.start()
      #if DEBUG
        // `-vf-write-key=<secret>` swaps the keychain for an in-memory store
        // whose WILDCARD answers for any host, so `-vf-auto-attach` can type
        // against a serving desktop with no finger on the glass. It runs
        // before anything reads a key, and it cannot exist in Release. A
        // launch argument is visible to `ps`: this is a smoke aid, never a way
        // to carry a real secret onto a phone.
        if let seeded = ProcessInfo.processInfo.arguments
          .first(where: { $0.hasPrefix(Self.writeKeyArgument) })?
          .dropFirst(Self.writeKeyArgument.count), !seeded.isEmpty
        {
          let store = InMemoryMirrorWriteStore(wildcard: String(seeded))
          // One EXPLICIT host beside the wildcard, so the settings sheet's
          // WRITE KEYS section has a row to render headless. It names the
          // `-vf-demo-remote` fixture's peer, and it is the same kind of
          // object that fixture is: our own pixels, never a claim that a
          // desktop granted anything.
          try? store.set(
            String(seeded),
            for: MirrorWriteHost(deviceID: "demo-device-01", deviceName: "studio"))
          writeKeys = store
        }
        // Headless smoke hooks (the GhostteaApp pattern: opt-in automation,
        // Debug-only): drive flows a simulator run can't tap into.
        if ProcessInfo.processInfo.arguments.contains("-vf-auto-connect") {
          meshSheetOpen = true
          mesh.connect()
        }
        // `-vf-demo-remote` stands a FAKE peer up so the remote bubble's own
        // rendering — the prompt glyph, the machine in the eyebrow, no
        // context readout, the card's attach invitation — can be eyeballed
        // without a desktop serving on the tailnet. It is a fixture for
        // looking at OUR pixels, never a claim that a mesh answered: it
        // cannot run in Release, and the real source replaces it the moment
        // `mesh.state` reaches `.up`.
        if ProcessInfo.processInfo.arguments.contains("-vf-demo-remote") {
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
        // The key sheet is otherwise reachable only by a finger on ENTER KEY,
        // and a headless run has none — so its pixels could never be looked
        // at. Same fixture host as `-vf-demo-remote`, and the same disclaimer:
        // our own pixels, never a claim that a desktop granted anything.
        if ProcessInfo.processInfo.arguments.contains("-vf-open-write-key") {
          writeKeySheetHost = MirrorWriteHost(
            deviceID: "demo-device-01", deviceName: "studio")
        }
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
            // A peer's session first when there is one: the remote face is
            // the one with an act on it, so it is what a screenshot run is
            // usually after.
            let wanted =
              bubbles.first(where: { $0.remote?.attachable == true })
              ?? bubbles.first(where: { $0.status == .working })
              ?? bubbles.first
            if let wanted { openCard(on: wanted) }
            // `-vf-auto-attach` carries the run one step further: on a phone
            // whose mesh is up against a serving desktop, this is the whole
            // IOS-3 path — discover, choose, attach — with no finger on the
            // glass. Without a mesh it proves the honest-failure path instead,
            // which is the other thing worth seeing.
            if ProcessInfo.processInfo.arguments.contains("-vf-auto-attach"),
              let wanted, wanted.remote?.attachable == true
            {
              try? await Task.sleep(for: .seconds(1))
              beginAttachment(to: wanted)
            }
          }
        }
      #endif
      refreshWriteKeys()
    }
    .onDisappear {
      feed.stop()
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
    .onChange(of: scenePhase) { _, phase in
      // The phase is passed rather than re-read: inside this closure the
      // environment's own value is the one thing we should not have to guess
      // about, and guessing wrong is what stranded the poll before.
      syncDiscovery(meshIsUp: mesh.state == .up, phase: phase)
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
    // A `suspended(host absent)` attachment NEVER ends on its own — upstream's
    // engine stops dialing and waits to be told, and its own comment says
    // "nothing else in the app tells it". Discovery is the only thing here
    // that learns a peer came back, so it is what tells the attachment.
    .onChange(of: remoteField.snapshot.rows) { _, rows in
      guard let attachedDeviceID,
        rows.contains(where: { $0.host.deviceID == attachedDeviceID })
      else { return }
      attachment?.noteHostReachable()
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
    // Entering a key, from either face of the card. `item:` rather than a
    // flag: the sheet is ABOUT a host, and a sheet that outlived its subject
    // would write a secret against the wrong device.
    .sheet(item: $writeKeySheetHost) { host in
      WriteKeySheet(
        host: host,
        hasKey: writeKeyHosts.contains { $0.deviceID == host.deviceID },
        onSave: { secret in saveWriteKey(secret, for: host) },
        onRemove: { removeWriteKey(host) }
      )
      .presentationDetents([.fraction(0.42), .medium])
      .presentationDragIndicator(.visible)
      .presentationCornerRadius(40)
      .fieldGlassSheet()
    }
    .sheet(isPresented: $meshSheetOpen) {
      MeshSheet(model: mesh)
        .presentationDetents([.fraction(0.45), .medium])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .fieldGlassSheet()
    }
    // The Tailscale login page. One presenter at root: an arriving login
    // closes the mesh sheet first, so the sheets never contend.
    .onChange(of: mesh.loginPage) {
      if mesh.loginPage != nil { meshSheetOpen = false }
    }
    .sheet(
      item: Binding(
        get: { meshSheetOpen ? nil : mesh.loginPage },
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
      discoveryPolling = false
    case .resume:
      remoteField.start()
      discoveryPolling = true
    case .open:
      discoveryPolling = true
      Task {
        guard let directory = await mesh.directory else {
          discoveryPolling = false
          return
        }
        remoteField = RemoteSessionField(source: TruffleSessionSource(directory: directory))
        remoteField.start()
      }
    }
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
      hasWriteKey: cardHasWriteKey,
      statusNote: attachmentNote,
      statusDetail: attachmentDetail,
      statusActions: attachmentActions,
      cooled: attachment?.banner?.coolsTerminal ?? false,
      onAttach: { if let bubble { beginAttachment(to: bubble) } },
      onEnterKey: writeKeyEntry(for: bubble)
    ) {
      liveTerminal(title: bubble?.project)
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
      // be wiped by the next honest re-derivation.
      if demoInputChips {
        return FieldInput.replyChips(
          provider: .claude, permissions: [AgentPermission(tool: "Bash")])
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
    TerminalSettingsSheet(
      appearance: appearance,
      writeKeyHosts: writeKeyHosts,
      onRemoveWriteKey: { host in removeWriteKey(host) }
    ) { next in
      // The PREFERENCE commits eagerly and is what every future attach is
      // seeded from. Whether the terminal currently on screen took it is a
      // different fact, and `TerminalAttachment.appearance` is the one that
      // answers it — they disagree exactly when a reconfiguration failed, and
      // `appearanceFailure` is that disagreement said out loud.
      appearance = next
      TerminalAppearanceStore.save(next)
      // Live where it can be: the attachment splits the work itself —
      // colors/opacity/shaders reconfigure on the running sink, and only a
      // font-size move rebuilds the text runtime (the session stays attached
      // either way).
      if let attachment {
        Task { await attachment.apply(appearance: next) }
      }
    }
  }

  // MARK: - Attachment

  /// The attachment's own state, in words the card can render. Ordered so the
  /// most load-bearing truth wins: a failure explains itself, a live view-only
  /// session says why it cannot type, and nothing here invents a reason the
  /// terminal did not give.
  private var attachmentNote: String? {
    // A copy is the most recent thing the user did, and it is transient —
    // it says so and then gets out of the way.
    if let copiedNote { return copiedNote }
    // A store that refused is about this phone, and it outranks the mesh's
    // news: nothing the terminal says next explains why the key did not land.
    if let writeKeyNote { return writeKeyNote }
    if let attachRefusal { return attachRefusal }
    if let renderFailure { return "the renderer refused this frame — \(renderFailure)" }
    guard let attachment else { return nil }
    // Upstream's banner outranks our phase words wherever it exists: it names
    // the device ("studio is offline") where the phase can only name the
    // condition, and it carries upstream's own timing for when to say it. The
    // phase reasons stay as the tier beneath — the machine-readable one that
    // covers the states a banner deliberately stays quiet for.
    if let banner = attachment.banner { return banner.title }
    // A look the renderer would not take is real and durable, but it is the
    // least of these: it ranks last, so it surfaces exactly when the terminal
    // has nothing more load-bearing to say, and waits when it does.
    return phaseNote(attachment) ?? attachment.appearanceFailure
  }

  private func phaseNote(_ attachment: TerminalAttachment) -> String? {
    switch attachment.phase {
    case .idle: return nil
    case .connecting: return "connecting over the mesh…"
    case .live:
      if attachment.acceptsInput { return attachment.inputCue?.text }
      if attachment.readWrite { return attachment.inputCue?.text ?? "taking control…" }
      // NOT `remote.readWrite`: that one says the SESSION is shared for
      // writing, and this one is the host's answer to this device. Which of
      // the two failed decides who to name.
      return FieldHomeModel.viewOnlyReason(
        sessionSharesWrites: cardBubble?.remote?.readWrite ?? false,
        hasWriteKey: cardHasWriteKey)
    case .suspended(let why): return "suspended — \(why)"
    case .ended(let why): return "ended — \(why)"
    case .failed(let why): return "failed — \(why)"
    }
  }

  /// The banner's second line, and only ever that: our own phase words are
  /// single-line by construction, so a detail here always belongs to a banner.
  private var attachmentDetail: String? {
    guard copiedNote == nil, writeKeyNote == nil, attachRefusal == nil, renderFailure == nil
    else { return nil }
    return attachment?.banner?.detail
  }

  /// Ghosttea's action vocabulary translated into acts this card can offer.
  /// `browseSessions` becomes "back to the field": upstream means "go choose
  /// another session", and on this phone the chooser IS the field.
  private var attachmentActions: [CardAction] {
    var actions = bannerActions
    // The invitation's ENTER KEY, in the shape the attached face has room for:
    // once a terminal is live there is no invitation left to hang it on, and a
    // session that refused our writes for want of a key is exactly when the
    // act is worth offering. The card still knows nothing about a store.
    if attachedViewOnlyForWantOfKey, let enter = writeKeyEntry(for: cardBubble) {
      actions.append(CardAction(id: "enter-key", label: "ENTER KEY", run: enter))
    }
    return actions
  }

  /// A live attachment that cannot type, where the reason is ours: no key was
  /// presented. A host that refused a key we DID present is a different fact
  /// and offers nothing to enter.
  private var attachedViewOnlyForWantOfKey: Bool {
    guard let attachment, attachment.phase == .live, !attachment.acceptsInput else { return false }
    return FieldHomeModel.keyEntryOffered(
      sessionSharesWrites: cardBubble?.remote?.readWrite ?? false, hasWriteKey: cardHasWriteKey)
  }

  private var bannerActions: [CardAction] {
    guard let attachment, let banner = attachment.banner else { return [] }
    return banner.actions.map { action in
      let label: String =
        switch action {
        case .retryNow: "RETRY"
        case .resume: "RESUME"
        case .browseSessions: "BACK TO THE FIELD"
        case .close: "CLOSE"
        }
      return .init(id: String(describing: action), label: label) {
        switch action {
        case .browseSessions, .close:
          // Navigation is the card's act, not the attachment's — dismissing
          // the sheet is what detaches (onDismiss), so both paths agree.
          selection = nil
        default:
          attachment.perform(action)
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
    // A key note belongs to the card it was raised on. Removing a key from the
    // settings sheet can leave one standing with no card open, and it must not
    // greet the next session as if it were about that one.
    writeKeyNote = nil
    selection = SessionSelection(id: bubble.id)
  }

  private func beginAttachment(to bubble: FieldBubble) {
    guard let remote = bubble.remote, remote.attachable else { return }
    // One attachment at a time, latched BEFORE the await — see `attaching`.
    guard attachment == nil, !attaching else { return }
    attaching = true
    renderFailure = nil
    attachRefusal = nil
    Task {
      defer { attaching = false }
      guard let directory = await mesh.directory else {
        // Honest rather than inert: the button did something, and the reason
        // it went nowhere is the mesh, not the session and not the renderer.
        attachRefusal = "the mesh is not up on this device — connect it first"
        return
      }
      // The one place a secret leaves the store: the host's own key, read at
      // attach and re-presented by the lifecycle on every re-dial. `nil` is
      // the honest default and the card has already said so.
      let attachment = TerminalAttachment(
        directory: directory,
        appearance: appearance,
        accessToken: writeKeys.capability(for: remote.deviceID))
      self.attachment = attachment
      attachedDeviceID = remote.deviceID
      // --- IOS-5a ---
      installInputSink(on: attachment)
      // --- end IOS-5a ---
      // A starting grid the surface immediately corrects through onGridSize —
      // the host needs SOME viewport to open with, and 80×24 is the one every
      // terminal has agreed on since the VT100.
      // The device NAME rides along so the banner can say "studio is offline"
      // rather than naming a ULID at the user.
      attachment.attach(
        deviceID: remote.deviceID, sessionID: remote.sessionID, cols: 80, rows: 24,
        deviceName: remote.deviceName)
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
    writeKeyNote = nil
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

  /// Whether THIS phone holds a key for the card's host — the per-host fact
  /// the copy needs, not the process-wide one the old flag carried.
  ///
  /// Both halves are deliberate. `writeKeyHosts` is the reactive mirror, and
  /// reading it here is what makes the card re-render after a save; the store
  /// is then asked directly because it is the authority the attach will use —
  /// a DEBUG wildcard answers for hosts it never listed, and the card must not
  /// promise less than the next attach is about to present.
  private var cardHasWriteKey: Bool {
    guard let deviceID = cardBubble?.remote?.deviceID else { return false }
    return writeKeyHosts.contains { $0.deviceID == deviceID }
      || writeKeys.capability(for: deviceID) != nil
  }

  /// `nil` when there is no host to enter a key FOR (an agent bubble, or no
  /// subject at all). Whether to DRAW it is the card's own rule.
  private func writeKeyEntry(for bubble: FieldBubble?) -> (() -> Void)? {
    guard let remote = bubble?.remote else { return nil }
    return {
      writeKeySheetHost = MirrorWriteHost(
        deviceID: remote.deviceID, deviceName: remote.deviceName)
    }
  }

  private func refreshWriteKeys() {
    writeKeyHosts = writeKeys.hosts()
  }

  private func saveWriteKey(_ secret: String, for host: MirrorWriteHost) {
    writeKeySheetHost = nil
    do {
      try writeKeys.set(secret, for: host)
    } catch {
      // Surfaced on the card, never as a crash and never with the secret in
      // it: the reason a keychain refused is the store's, and the value is
      // nobody's.
      writeKeyNote = "could not save the key — \(error)"
      return
    }
    writeKeyNote = nil
    refreshWriteKeys()
    reattachWithNewKey(to: host)
  }

  private func removeWriteKey(_ host: MirrorWriteHost) {
    writeKeySheetHost = nil
    do {
      try writeKeys.remove(for: host.deviceID)
      writeKeyNote = nil
    } catch {
      writeKeyNote = "could not remove the key — \(error)"
    }
    refreshWriteKeys()
  }

  /// A key saved under an open, view-only attachment is re-presented at once:
  /// the token rides `TerminalAttachment.init` and the lifecycle re-presents
  /// only what it was built with, so the sole way a live session learns of a
  /// new key is a fresh attach. Doing it here is why the user does not have to
  /// close the card to start typing in it.
  ///
  /// The detach is awaited before the new attach begins — two lifecycles
  /// against one session is exactly what `attaching` exists to prevent — and
  /// an attach already in flight is left alone: it would swallow this one
  /// silently, so the card says the true thing instead.
  private func reattachWithNewKey(to host: MirrorWriteHost) {
    guard let attachment, attachedDeviceID == host.deviceID,
      let bubble = cardBubble, bubble.remote?.deviceID == host.deviceID
    else { return }
    guard !attaching else {
      writeKeyNote = "key saved — reattach to type"
      return
    }
    self.attachment = nil
    attachedDeviceID = nil
    renderFailure = nil
    attachRefusal = nil
    Task {
      await attachment.detach()
      beginAttachment(to: bubble)
    }
  }

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
    private static let writeKeyArgument = "-vf-write-key="

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
