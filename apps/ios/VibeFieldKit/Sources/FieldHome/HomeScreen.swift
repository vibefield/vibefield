import FieldAgents
import FieldDesign
import FieldMesh
import SwiftUI

/// The VibeField home: the whole screen is the agent field. Bubbles are the
/// fleet; tapping one raises its session card from the bottom; holding empty
/// ground raises a new agent. The mesh chip floats top-leading — a physical
/// obstacle the swarm flows around — and carries the tailnet's honest state.
///
/// v0 runs on the scripted mock feed — the same snapshot shape and the same
/// classifier the daemon feed will drive, so nothing here is a demo path.
public struct HomeScreen: View {
  @State private var feed = MockAgentField()
  @State private var mesh = MeshModel()
  @State private var selection: SessionSelection?
  @State private var meshSheetOpen = false
  @Environment(\.scenePhase) private var scenePhase

  public init() {}

  public var body: some View {
    ZStack {
      SwarmFieldView(
        agents: feed.agents,
        isActive: scenePhase == .active,
        onSelect: { agent in selection = SessionSelection(id: agent.id) },
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
    .onAppear { feed.start() }
    .onDisappear { feed.stop() }
    .sheet(item: $selection) { selected in
      // Live lookup so the open card tracks the fleet; a vanished id renders
      // the honest ended face.
      SessionCardView(agent: feed.agents.first(where: { $0.id == selected.id }))
        .presentationDetents([.fraction(0.55), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .presentationBackground(FieldPalette.panelBackground)
    }
    .sheet(isPresented: $meshSheetOpen) {
      MeshSheet(model: mesh)
        .presentationDetents([.fraction(0.45), .medium])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(40)
        .presentationBackground(FieldPalette.panelBackground)
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

  private struct SessionSelection: Identifiable {
    let id: String
  }
}
