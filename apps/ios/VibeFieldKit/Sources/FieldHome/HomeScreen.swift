import FieldAgents
import FieldDesign
import SwiftUI

/// The VibeField home: the whole screen is the agent field. Bubbles are the
/// fleet; tapping one raises its session card from the bottom; holding empty
/// ground raises a new agent.
///
/// v0 runs on the scripted mock feed — the same snapshot shape and the same
/// classifier the daemon feed will drive, so nothing here is a demo path.
public struct HomeScreen: View {
  @State private var feed = MockAgentField()
  @State private var selection: SessionSelection?
  @Environment(\.scenePhase) private var scenePhase

  public init() {}

  public var body: some View {
    ZStack {
      SwarmFieldView(
        agents: feed.agents,
        isActive: scenePhase == .active,
        onSelect: { agent in selection = SessionSelection(id: agent.id) },
        onCreate: { _ in feed.spawn() }
      )

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
  }

  private struct SessionSelection: Identifiable {
    let id: String
  }
}
