import FieldAgents
import FieldDesign
import SwarmPhysics
import SwiftUI

/// The full-screen agent field: every session a physical bubble, nestling
/// around the center, ranked by how much it needs you. Tap to open the
/// session card; hold empty ground to conjure a new agent there.
public struct SwarmFieldView: View {
  static let coordinateSpace = "swarm-field"

  private let agents: [AgentSnapshot]
  private let parameters: SwarmParameters
  private let isActive: Bool
  private let onSelect: (AgentSnapshot) -> Void
  /// Called when the user holds empty ground. Returns the new session's id
  /// so the field can place its body exactly under the finger, or nil when
  /// creation is unavailable.
  private let onCreate: ((SIMD2<Double>) -> String?)?

  @State private var model = SwarmFieldModel()
  @State private var driver = DisplayLinkDriver()
  @State private var pendingHold: PendingHold?

  public init(
    agents: [AgentSnapshot],
    parameters: SwarmParameters = .default,
    isActive: Bool = true,
    onSelect: @escaping (AgentSnapshot) -> Void,
    onCreate: ((SIMD2<Double>) -> String?)? = nil
  ) {
    self.agents = agents
    self.parameters = parameters
    self.isActive = isActive
    self.onSelect = onSelect
    self.onCreate = onCreate
  }

  public var body: some View {
    GeometryReader { proxy in
      ZStack {
        Rectangle()
          .fill(FieldPalette.panelBackground)
          .ignoresSafeArea()
          .gesture(holdToCreate)

        GridGroundView()
          .ignoresSafeArea()

        bubbles

        if let hold = pendingHold {
          HoldToCreateIndicator()
            .position(hold.start)
        }

        if agents.isEmpty {
          EmptyFieldView()
        }
      }
      .coordinateSpace(name: Self.coordinateSpace)
      .onAppear {
        model.world.parameters = parameters
        model.world.setBounds(SIMD2(Double(proxy.size.width), Double(proxy.size.height)))
        syncAgents()
        driver.onTick = { [model] timestamp in
          model.world.step(now: timestamp)
        }
        if isActive { driver.start() }
      }
      .onDisappear { driver.stop() }
      .onChange(of: proxy.size) { _, size in
        model.world.setBounds(SIMD2(Double(size.width), Double(size.height)))
      }
    }
    .onChange(of: agents) { syncAgents() }
    .onChange(of: parameters) { model.world.parameters = parameters }
    .onChange(of: isActive) {
      if isActive { driver.start() } else { driver.stop() }
    }
  }

  // MARK: - Bubbles

  private struct Ranked: Identifiable {
    let agent: AgentSnapshot
    let visual: AgentBubbleVisual
    let radius: Double
    var id: String { agent.id }
  }

  private var rankedAgents: [Ranked] {
    agents
      .compactMap { agent -> Ranked? in
        guard let status = classifyAgentStatus(agent.state) else { return nil }
        let visual = bubbleVisual(for: status)
        return Ranked(
          agent: agent,
          visual: visual,
          radius: bubbleRadius(for: visual.appearance, parameters: parameters))
      }
      // Attention rises: idle under working under waiting (desktop z 3/4/5).
      .sorted { zRank($0.visual.appearance) < zRank($1.visual.appearance) }
  }

  private func zRank(_ appearance: AgentBubbleAppearance) -> Int {
    switch appearance {
    case .idle: 0
    case .working: 1
    case .waiting: 2
    }
  }

  @ViewBuilder
  private var bubbles: some View {
    // One observed value per frame; positions are read fresh each pass.
    let _ = driver.frame
    ForEach(rankedAgents) { ranked in
      if let state = model.world.state(of: SwarmBodyID(ranked.agent.id)) {
        AgentBubbleView(
          agent: ranked.agent,
          visual: ranked.visual,
          diameter: state.visualRadius * 2,
          onDragBegan: { point in
            model.world.beginDrag(
              id: SwarmBodyID(ranked.agent.id), at: SIMD2(Double(point.x), Double(point.y)))
          },
          onDragChanged: { point in
            model.world.updateDrag(
              id: SwarmBodyID(ranked.agent.id), to: SIMD2(Double(point.x), Double(point.y)))
          },
          onDragEnded: {
            model.world.endDrag(id: SwarmBodyID(ranked.agent.id))
          },
          onTap: {
            model.world.nudge(id: SwarmBodyID(ranked.agent.id))
            onSelect(ranked.agent)
          }
        )
        .animation(FieldMotion.bubbleResize, value: state.visualRadius)
        .position(x: state.position.x, y: state.position.y)
      }
    }
  }

  private func syncAgents() {
    var present = Set<SwarmBodyID>()
    for ranked in rankedAgents {
      let id = SwarmBodyID(ranked.agent.id)
      present.insert(id)
      model.world.upsert(
        id: id,
        visualRadius: ranked.radius,
        spawnPosition: model.pendingSpawnPositions.removeValue(forKey: ranked.agent.id))
    }
    for state in model.world.states where !present.contains(state.id) {
      model.world.remove(id: state.id)
    }
  }

  // MARK: - Hold to create (desktop long-press, 520 ms / 8 pt tolerance)

  private struct PendingHold {
    let start: CGPoint
    let task: Task<Void, Never>
  }

  private var holdToCreate: some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.coordinateSpace))
      .onChanged { value in
        guard onCreate != nil else { return }
        if let hold = pendingHold {
          let dx = value.location.x - hold.start.x
          let dy = value.location.y - hold.start.y
          if (dx * dx + dy * dy).squareRoot() > FieldMotion.longPressMoveTolerance {
            cancelHold()
          }
        } else {
          beginHold(at: value.startLocation)
        }
      }
      .onEnded { _ in cancelHold() }
  }

  private func beginHold(at point: CGPoint) {
    let task = Task {
      try? await Task.sleep(for: .milliseconds(Int(FieldMotion.longPressDuration * 1000)))
      guard !Task.isCancelled else { return }
      fireHold(at: point)
    }
    pendingHold = PendingHold(start: point, task: task)
  }

  private func cancelHold() {
    pendingHold?.task.cancel()
    pendingHold = nil
  }

  private func fireHold(at point: CGPoint) {
    pendingHold = nil
    let position = SIMD2(Double(point.x), Double(point.y))
    if let id = onCreate?(position) {
      model.pendingSpawnPositions[id] = position
    }
  }
}

/// Non-observed simulation state that must survive view updates.
@MainActor
final class SwarmFieldModel {
  let world = SwarmWorld(bounds: .zero)
  var pendingSpawnPositions: [String: SIMD2<Double>] = [:]
}

/// The hold-to-create ring: grows under the finger for the full hold.
private struct HoldToCreateIndicator: View {
  @State private var grown = false

  var body: some View {
    ZStack {
      Circle()
        .fill(FieldPalette.panelBackground.opacity(0.74))
      Circle()
        .strokeBorder(grown ? FieldPalette.textMain : FieldPalette.textMuted, lineWidth: 1)
      Circle()
        .fill(FieldPalette.textMain)
        .frame(width: 4, height: 4)
    }
    .frame(width: 32, height: 32)
    .scaleEffect(grown ? 1 : 0.55)
    .opacity(grown ? 1 : 0)
    .onAppear {
      withAnimation(FieldMotion.ease(FieldMotion.longPressDuration)) {
        grown = true
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// The desktop empty state, with phone-honest copy.
private struct EmptyFieldView: View {
  var body: some View {
    VStack(spacing: 7) {
      Text("NO ACTIVE AGENTS")
        .font(FieldType.mono(11, .heavy))
        .tracking(FieldType.tracking(0.18, of: 11))
        .foregroundStyle(FieldPalette.textMuted)
      Text("hold anywhere to raise one")
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textFaint)
    }
    .allowsHitTesting(false)
    .accessibilityElement(children: .combine)
  }
}
