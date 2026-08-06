import FieldAgents
import FieldDesign
import FieldMesh
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
    .sheet(item: $selection) { selected in
      SessionCardView(
        bubble: bubbles.first(where: { $0.id == selected.id }),
        onAttach: {}
      )
      .presentationDetents([.fraction(0.55), .large])
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
