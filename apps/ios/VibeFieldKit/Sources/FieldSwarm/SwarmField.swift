import FieldAgents
import FieldDesign
import SwarmPhysics
import SwiftUI
import UIKit

/// The full-screen field on Metal: every session a physical body — an agent's
/// or a peer's terminal, the field does not care — drawn by the reference's
/// shaders, nestling around the centre. Tap to open the session card; hold
/// empty ground to raise a new agent there.
///
/// `chrome` floats above the bodies inside the field's coordinate space (the
/// slot owns its own alignment); any chrome element marked `.swarmObstacle()`
/// becomes a physics obstacle the swarm flows around.
///
/// PJ-7 — the hold BLOOMS when `bloom` offers a real choice (two desktops or
/// more, or one with two profiles or more; DESIGN.md §8's phone paragraph):
/// the finger reaches a desktop, then a profile, and letting go hands the
/// choice to `onBloom` — the launch sheet opens on it, never a terminal (Q4).
/// No real choice: the hold creates through `onCreate`, as before.
public struct SwarmField<Chrome: View>: View {
  private let bubbles: [FieldBubble]
  private let parameters: SwarmParameters
  private let isActive: Bool
  private let onSelect: (FieldBubble) -> Void
  private let onCreate: ((SIMD2<Double>) -> String?)?
  private let bloom: BloomMenu?
  private let onBloom: ((BloomChoice) -> Void)?
  private let chrome: Chrome

  @State private var stage = SwarmStage()
  @State private var bloomHost = BloomHost()
  @State private var failure: String?
  @State private var touching = false
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  public init(
    bubbles: [FieldBubble],
    parameters: SwarmParameters = .phone,
    isActive: Bool = true,
    onSelect: @escaping (FieldBubble) -> Void,
    onCreate: ((SIMD2<Double>) -> String?)? = nil,
    bloom: BloomMenu? = nil,
    onBloom: ((BloomChoice) -> Void)? = nil,
    @ViewBuilder chrome: () -> Chrome
  ) {
    self.bubbles = bubbles
    self.parameters = parameters
    self.isActive = isActive
    self.onSelect = onSelect
    self.onCreate = onCreate
    self.bloom = bloom
    self.onBloom = onBloom
    self.chrome = chrome()
  }

  public var body: some View {
    GeometryReader { proxy in
      ZStack {
        Rectangle()
          .fill(FieldPalette.panelBackground)
          .ignoresSafeArea()

        // The state colours are resolved INTO the theme (the ground and the
        // glow are one hue at two ends of its range), so the theme follows the
        // parameters as well as the scheme.
        SwarmSurface(
          stage: stage, theme: SwarmTheme.resolve(colorScheme, parameters: parameters), motion: !reduceMotion,
          isActive: isActive, parameters: parameters, failure: $failure)

        if let failure {
          UnavailableFieldView(reason: failure)
        } else if bubbles.isEmpty {
          EmptyFieldView()
        }

        chrome

        if let open = bloomHost.bloom {
          SpawnBloomOverlay(bloom: open, size: proxy.size)
        }
      }
      .contentShape(Rectangle())
      .gesture(touches)
      .coordinateSpace(name: SwarmSpace.name)
      .onPreferenceChange(SwarmObstacleFramesKey.self) { [stage, bloomHost] frames in
        Task { @MainActor in
          stage.setObstacles(frames)
          bloomHost.chrome = frames.map {
            BloomRect(x: $0.minX, y: $0.minY, width: $0.width, height: $0.height)
          }
        }
      }
      .onAppear {
        stage.parameters = parameters
        stage.onSelect = onSelect
        stage.onCreate = holdCompleted
        stage.reducedMotion = reduceMotion
        stage.setBounds(proxy.size)
        bloomHost.field = BloomSize(w: proxy.size.width, h: proxy.size.height)
        bloomHost.menu = bloom
        stage.update(bubbles: bubbles, time: CACurrentMediaTime())
      }
      .onChange(of: proxy.size) { _, size in
        stage.setBounds(size)
        bloomHost.field = BloomSize(w: size.width, h: size.height)
      }
    }
    .onChange(of: bloom) { bloomHost.menu = bloom }
    .onChange(of: bubbles) { stage.update(bubbles: bubbles, time: CACurrentMediaTime()) }
    .onChange(of: parameters) { stage.parameters = parameters }
    .onChange(of: reduceMotion) { stage.reducedMotion = reduceMotion }
  }

  /// The hold ran its course: the bloom opens when there is a real choice,
  /// else the hold creates as before.
  private var holdCompleted: ((SIMD2<Double>) -> String?)? {
    guard let onCreate else { return nil }
    let host = bloomHost
    return { point in
      if host.hold(at: point) { return nil }
      return onCreate(point)
    }
  }

  /// One gesture for the whole field: the stage decides whether a finger is
  /// on a body (a drag, or a tap and a nudge) or on empty ground (a hold);
  /// once a hold has bloomed, the finger is the bloom's until it lets go.
  private var touches: some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(SwarmSpace.name))
      .onChanged { value in
        let point = SIMD2(Double(value.location.x), Double(value.location.y))
        if bloomHost.bloom != nil {
          bloomHost.move(to: point)
          return
        }
        if !touching {
          touching = true
          stage.pointerDown(at: SIMD2(Double(value.startLocation.x), Double(value.startLocation.y)), time: CACurrentMediaTime())
        }
        stage.pointerMoved(to: point)
      }
      .onEnded { value in
        touching = false
        if bloomHost.bloom != nil {
          stage.pointerCancelled()
          if let choice = bloomHost.release() { onBloom?(choice) }
          return
        }
        stage.pointerUp(at: SIMD2(Double(value.location.x), Double(value.location.y)))
      }
  }
}

extension SwarmField where Chrome == EmptyView {
  public init(
    bubbles: [FieldBubble],
    parameters: SwarmParameters = .phone,
    isActive: Bool = true,
    onSelect: @escaping (FieldBubble) -> Void,
    onCreate: ((SIMD2<Double>) -> String?)? = nil
  ) {
    self.init(
      bubbles: bubbles, parameters: parameters, isActive: isActive,
      onSelect: onSelect, onCreate: onCreate
    ) { EmptyView() }
  }
}

/// The Metal view, mounted; it draws the stage and mirrors every body as an
/// accessibility element.
private struct SwarmSurface: UIViewRepresentable {
  let stage: SwarmStage
  let theme: SwarmTheme
  let motion: Bool
  let isActive: Bool
  let parameters: SwarmParameters
  @Binding var failure: String?

  func makeUIView(context: Context) -> SwarmMetalView {
    let view = SwarmMetalView(theme: theme)
    let stage = stage
    view.frameSource = { time, motion, _ in
      let frame = stage.frame(time: time, motion: motion)
      return (frame.bodies, frame.hold, [])
    }
    view.onTick = { [weak view] time in
      stage.pump(time: time)
      view?.refreshAccessibility(from: stage)
    }
    view.accessibilityContainerType = .semanticGroup
    view.isAccessibilityElement = false
    DispatchQueue.main.async { failure = view.failure }
    return view
  }

  func updateUIView(_ view: SwarmMetalView, context: Context) {
    view.theme = theme
    view.motion = motion
    view.isPaused = !isActive
    var snapshot = SwarmMetalView.SwarmParametersSnapshot()
    snapshot.fillOpacity = parameters.bubbleFillOpacity
    snapshot.glow = SwarmGlow(reach: parameters.glowReach, strength: parameters.glowStrength, breath: parameters.glowBreath)
    snapshot.stateGlow = SwarmStateGlow(parameters)
    view.parameters = snapshot
  }
}

extension SwarmMetalView {
  /// Every body, reachable without a finger: one element per body in draw
  /// order, its frame the body's, its label the model's, activation the tap.
  /// Rebuilt when the roster changes and repositioned every frame; VoiceOver
  /// reads frames when it navigates, so the cost is a few rects.
  func refreshAccessibility(from stage: SwarmStage) {
    let bodies = stage.order
    var elements = (accessibilityElements as? [SwarmBodyElement]) ?? []
    if elements.map(\.bodyID) != bodies.map(\.model.id) {
      elements = bodies.map { body in
        let element = SwarmBodyElement(container: self, bodyID: body.model.id)
        let id = body.model.id
        element.onActivate = { [weak stage] in stage?.activate(id) }
        element.onFocus = { [weak stage] focused in
          if focused {
            stage?.focusedID = id
          } else if stage?.focusedID == id {
            stage?.focusedID = nil
          }
        }
        return element
      }
      accessibilityElements = elements
    }
    for (element, body) in zip(elements, bodies) {
      let radius = body.radius * body.scale
      element.accessibilityFrameInContainerSpace = CGRect(
        x: body.x - radius, y: body.y - radius, width: radius * 2, height: radius * 2)
      element.accessibilityLabel = body.model.accessibilityLabel
      element.accessibilityValue = body.model.active ? "open" : nil
    }
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

/// RFC 005's failure state: no device, no shaders — one line, and the bodies
/// stay reachable through their elements. There is no SwiftUI fallback; the
/// previous implementation is removed, not kept in parallel.
private struct UnavailableFieldView: View {
  let reason: String

  var body: some View {
    VStack(spacing: 7) {
      Text("METAL UNAVAILABLE")
        .font(FieldType.mono(11, .heavy))
        .tracking(FieldType.tracking(0.18, of: 11))
        .foregroundStyle(FieldPalette.textMuted)
      Text(reason)
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textFaint)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
    }
    .allowsHitTesting(false)
    .accessibilityElement(children: .combine)
  }
}
