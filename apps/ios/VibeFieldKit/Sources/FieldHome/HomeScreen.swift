import FieldAgents
import FieldDesign
import FieldMesh
import FieldTerminal
import SwiftUI

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
  @State private var meshSheetOpen = false
  @State private var discoveryLive = false
  @State private var attachment: TerminalAttachment?
  /// Two different failures, deliberately not one field: a renderer that
  /// refused a frame and a mesh that was never up are different facts, and
  /// folding them into one string made the card say the renderer refused
  /// something it had never been handed.
  @State private var renderFailure: String?
  @State private var attachRefusal: String?
  @State private var appearance = TerminalAppearanceStore.load()
  /// The host's mirror-write secret, when this phone has been told it. Absent
  /// is the honest default: a viewer, not a typist (GT-4a's asymmetry from the
  /// client side). Its home is the Keychain and its UI is IOS-3d's settings.
  @State private var mirrorWriteCapability: String?
  #if DEBUG
    @State private var demoRemoteActive = false
  #endif
  @Environment(\.scenePhase) private var scenePhase

  public init() {}

  /// One stage, two sources, projected by the pure functions in FieldAgents.
  private var bubbles: [FieldBubble] {
    feed.agents.compactMap(fieldBubble(from:)) + remoteField.snapshot.rows.map(fieldBubble(from:))
  }

  public var body: some View {
    ZStack {
      SwarmFieldView(
        bubbles: bubbles,
        isActive: scenePhase == .active,
        onSelect: { bubble in selection = SessionSelection(id: bubble.id) },
        onCreate: { _ in feed.spawn() }
      ) {
        MeshChip(state: mesh.state, peerCount: mesh.peers.count) {
          meshSheetOpen = true
        }
        .swarmObstacle()
        .padding(.leading, 14)
        .padding(.top, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }

      ScanlinesOverlay()
        .ignoresSafeArea()
      VignetteOverlay()
        .ignoresSafeArea()
    }
    .background(FieldPalette.panelBackground.ignoresSafeArea())
    .onAppear {
      feed.start()
      #if DEBUG
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
            if let wanted { selection = SessionSelection(id: wanted.id) }
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
    }
    .onDisappear {
      feed.stop()
      remoteField.stop()
    }
    // Discovery follows the mesh: a directory exists only while a runtime
    // does, and the poll belongs to the stage (PF6's spirit) — no mesh, no
    // asking, and the field says `no-door` rather than inventing an empty
    // answer.
    .onChange(of: mesh.state) { _, state in
      syncDiscovery(for: state)
    }
    .onChange(of: scenePhase) { _, phase in
      phase == .active ? syncDiscovery(for: mesh.state) : remoteField.stop()
    }
    .sheet(item: $selection, onDismiss: { endAttachment() }) { selected in
      let bubble = bubbles.first(where: { $0.id == selected.id })
      SessionCardView(
        bubble: bubble,
        isAttached: attachment != nil,
        statusNote: attachmentNote,
        onAttach: { if let bubble { beginAttachment(to: bubble) } }
      ) {
        if let attachment {
          TerminalSurface(
            frame: attachment.frame,
            visible: true,
            configuration: attachment.presentation,
            accessibilityTitle: bubble?.project ?? "Remote terminal",
            accessibilityConnectionState: attachmentNote ?? "attached",
            onGridSize: { size in
              attachment.setViewport(cols: size.columns, rows: size.rows)
            },
            onNeedsFullRefresh: { attachment.requestFullRefresh() },
            onHardwareInput: { attachment.handleHardwareKey($0) },
            onSoftwareInput: { attachment.handleSoftwareInput($0) },
            onMouseInput: { attachment.handleMouse($0) },
            onScrollRows: { attachment.handleScroll(rows: $0) },
            onRenderFailure: { renderFailure = $0 }
          )
        }
      }
      // Attaching earns the room: a terminal at the 0.55 detent is a
      // letterbox, and the keyboard would take what is left.
      .presentationDetents(attachment == nil ? [.fraction(0.55), .large] : [.large])
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
  /// the door is a task rather than a property read. `discoveryLive` keeps a
  /// re-entrant mesh event — several `.up`s arrive as peers settle — from
  /// building a second field beside the one already polling.
  private func syncDiscovery(for state: MeshModel.State) {
    #if DEBUG
      // The demo fixture owns the field while it is up; a mesh that is merely
      // off must not tear down the thing we are looking at.
      if demoRemoteActive { return }
    #endif
    guard scenePhase == .active, state == .up else {
      remoteField.stop()
      discoveryLive = false
      return
    }
    guard !discoveryLive else { return }
    discoveryLive = true
    Task {
      guard let directory = await mesh.directory else {
        discoveryLive = false
        return
      }
      remoteField = RemoteSessionField(source: TruffleSessionSource(directory: directory))
      remoteField.start()
    }
  }

  // MARK: - Attachment

  /// The attachment's own state, in words the card can render. Ordered so the
  /// most load-bearing truth wins: a failure explains itself, a live view-only
  /// session says why it cannot type, and nothing here invents a reason the
  /// terminal did not give.
  private var attachmentNote: String? {
    if let attachRefusal { return attachRefusal }
    if let renderFailure { return "the renderer refused this frame — \(renderFailure)" }
    guard let attachment else { return nil }
    switch attachment.phase {
    case .idle: return nil
    case .connecting: return "connecting over the mesh…"
    case .live:
      if attachment.acceptsInput { return attachment.notice }
      return attachment.readWrite
        ? (attachment.notice ?? "taking control…")
        : "view only — this host is not sharing writes"
    case .suspended(let why): return "suspended — \(why)"
    case .ended(let why): return "ended — \(why)"
    case .failed(let why): return "failed — \(why)"
    }
  }

  private func beginAttachment(to bubble: FieldBubble) {
    guard let remote = bubble.remote, remote.attachable else { return }
    renderFailure = nil
    attachRefusal = nil
    Task {
      guard let directory = await mesh.directory else {
        // Honest rather than inert: the button did something, and the reason
        // it went nowhere is the mesh, not the session and not the renderer.
        attachRefusal = "the mesh is not up on this device — connect it first"
        return
      }
      let attachment = TerminalAttachment(
        directory: directory,
        appearance: appearance,
        accessToken: mirrorWriteCapability)
      self.attachment = attachment
      // A starting grid the surface immediately corrects through onGridSize —
      // the host needs SOME viewport to open with, and 80×24 is the one every
      // terminal has agreed on since the VT100.
      attachment.attach(
        deviceID: remote.deviceID, sessionID: remote.sessionID, cols: 80, rows: 24)
    }
  }

  private func endAttachment() {
    guard let attachment else { return }
    self.attachment = nil
    renderFailure = nil
    attachRefusal = nil
    Task { await attachment.detach() }
  }

  private struct SessionSelection: Identifiable {
    let id: String
  }
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
