import FieldAgents
import FieldDesign
import SwiftUI

/// One agent, rendered as a living circle.
///
/// Status is contrast, exactly as on the desktop: idle wears quiet grey,
/// working inverts against the theme and breathes, waiting is the biggest,
/// highest-contrast object on screen with an urgent pulse. The agent's
/// identity hue appears only as a whisper — the context fill and the
/// ignition embers.
struct AgentBubbleView: View {
  let agent: AgentSnapshot
  let visual: AgentBubbleVisual
  let diameter: CGFloat

  let onDragBegan: (CGPoint) -> Void
  let onDragChanged: (CGPoint) -> Void
  /// Returns whether the interaction was a drag (suppresses the tap).
  let onDragEnded: () -> Bool
  let onTap: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var pulsing = false
  @State private var hasSpawned = false

  private var identityColor: Color {
    FieldPalette.agentColor(hue: agentIdentityHue(agent.runtimeSessionID))
  }

  private var status: AgentVisualStatus { visual.status }
  private var detail: String { agentDetail(agent.state, status: status) }

  var body: some View {
    ZStack {
      background

      contextFill

      if visual.isIgnited {
        IgnitionView(color: identityColor, diameter: diameter)
      }

      glyph

      copyStack

      contextLabel
    }
    .frame(width: diameter, height: diameter)
    .contentShape(Circle())
    .modifier(SpawnPopModifier(enabled: !reduceMotion, hasSpawned: $hasSpawned))
    .gesture(interaction)
    .onAppear { startPulse() }
    .onChange(of: visual.appearance) { startPulse() }
    .accessibilityElement(children: .ignore)
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(accessibilityText)
  }

  // MARK: - Layers

  private var background: some View {
    Circle()
      .fill(tierBackground)
      .overlay(Circle().strokeBorder(tierBorder, lineWidth: 1))
      .shadow(
        color: pulsing ? tierShadowPeak.color : tierShadowRest.color,
        radius: pulsing ? tierShadowPeak.radius : tierShadowRest.radius,
        y: pulsing ? tierShadowPeak.y : tierShadowRest.y)
  }

  private var contextFill: some View {
    // The context window rising inside the bubble, bottom-up (13% tint).
    GeometryReader { proxy in
      if let percent = agent.state?.contextUsedPercent {
        Rectangle()
          .fill(identityColor)
          .opacity(0.13)
          .frame(height: proxy.size.height * min(1, max(0, percent / 100)))
          .frame(maxHeight: .infinity, alignment: .bottom)
          .animation(FieldMotion.contextFill, value: percent)
      }
    }
    .clipShape(Circle())
    .allowsHitTesting(false)
  }

  private var glyph: some View {
    AgentGlyph(provider: agent.provider)
      .frame(width: 58, height: 58)
      .foregroundStyle(tierText)
      .opacity(glyphOpacity)
      .scaleEffect(visual.isIgnited && pulsing && !reduceMotion ? 1.08 : glyphRestScale)
      .offset(y: -diameter * 0.08)
      .allowsHitTesting(false)
  }

  private var copyStack: some View {
    VStack(spacing: 0) {
      if visual.appearance != .idle, let branch = agent.state?.branch {
        HStack(spacing: 4) {
          Circle()
            .fill(FieldPalette.branchGreen)
            .frame(width: 5, height: 5)
            .shadow(color: FieldPalette.branchGreen.opacity(0.8), radius: 2.5)
          Text(branch)
            .font(FieldType.mono(7))
            .opacity(0.67)
            .lineLimit(1)
        }
        .padding(.bottom, 4)
      }

      Text(agent.project)
        .font(projectFont)
        .tracking(FieldType.tracking(-0.035, of: projectSize))
        .lineLimit(1)

      Text(providerLine)
        .font(FieldType.mono(7, .heavy))
        .tracking(FieldType.tracking(0.1, of: 7))
        .textCase(.uppercase)
        .opacity(0.58)
        .lineLimit(1)
        .padding(.top, 3)
    }
    .foregroundStyle(tierText)
    .frame(maxWidth: diameter * 0.78)
    .allowsHitTesting(false)
  }

  private var contextLabel: some View {
    VStack {
      Spacer()
      Text(contextText)
        .font(FieldType.mono(6, .heavy))
        .tracking(FieldType.tracking(0.05, of: 6))
        .monospacedDigit()
        .foregroundStyle(tierText)
        .opacity(0.62)
        .padding(.bottom, 6)
    }
    .allowsHitTesting(false)
  }

  // MARK: - Interaction

  private var interaction: some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(SwarmSpace.name))
      .onChanged { value in
        if !isDragging {
          isDragging = true
          onDragBegan(value.startLocation)
        }
        onDragChanged(value.location)
      }
      .onEnded { _ in
        isDragging = false
        let dragged = onDragEnded()
        if !dragged { onTap() }
      }
  }

  @State private var isDragging = false

  // MARK: - Tier styling

  private var tierBackground: Color {
    switch visual.appearance {
    case .idle: FieldPalette.idleBackground
    case .working: FieldPalette.workingBackground
    case .waiting: FieldPalette.waitingBackground
    }
  }

  private var tierText: Color {
    switch visual.appearance {
    case .idle: FieldPalette.idleText
    case .working: FieldPalette.workingText
    case .waiting: FieldPalette.waitingText
    }
  }

  private var tierBorder: Color {
    switch visual.appearance {
    case .idle: .clear
    case .working: FieldPalette.workingBorder
    case .waiting: FieldPalette.waitingBorder
    }
  }

  private var tierShadowRest: FieldShadow {
    visual.appearance == .waiting ? .waitingRest : .workingRest
  }

  private var tierShadowPeak: FieldShadow {
    visual.appearance == .waiting ? .waitingPeak : .workingPeak
  }

  private var glyphOpacity: Double {
    switch visual.appearance {
    case .idle: 0.055
    case .working, .waiting: 0.12
    }
  }

  private var glyphRestScale: CGFloat { visual.isIgnited ? 0.92 : 1 }

  private var projectSize: CGFloat {
    switch visual.appearance {
    case .idle: 11
    case .working: 14
    case .waiting: 18
    }
  }

  private var projectFont: Font { FieldType.mono(projectSize, .heavy) }

  private var providerLine: String {
    agent.state?.modelName ?? agent.provider.displayName
  }

  private var contextText: String {
    guard let percent = agent.state?.contextUsedPercent else { return "CTX:--%" }
    let whole = Int(percent.rounded(.down))
    return String(format: "CTX:%02d%%", whole)
  }

  private var accessibilityText: String {
    "\(agent.project), \(providerLine), \(status.rawValue): \(detail), \(contextText)"
  }

  // MARK: - Pulse

  /// The tier shadow pulse: working breathes over 3 s, waiting pulses over
  /// 1.5 s. Idle bubbles rest flat.
  private func startPulse() {
    pulsing = false
    guard !reduceMotion, visual.appearance != .idle else { return }
    let period = visual.appearance == .waiting
      ? FieldMotion.waitingPeriod : FieldMotion.breathePeriod
    withAnimation(.easeInOut(duration: period / 2).repeatForever(autoreverses: true)) {
      pulsing = true
    }
  }
}

/// The desktop spawn pop (720 ms: 0 → 1.2 → 0.96 → 1.035 → 1), played once
/// on first appearance. Reduced motion skips it entirely.
private struct SpawnPopModifier: ViewModifier {
  let enabled: Bool
  @Binding var hasSpawned: Bool

  @ViewBuilder
  func body(content: Content) -> some View {
    if !enabled {
      content
    } else {
      content
        .keyframeAnimator(
          initialValue: SpawnPose(scale: 0, opacity: 0),
          trigger: hasSpawned
        ) { view, pose in
          view
            .scaleEffect(pose.scale)
            .opacity(pose.opacity)
        } keyframes: { _ in
          KeyframeTrack(\.scale) {
            CubicKeyframe(1.2, duration: FieldMotion.spawnDuration * 0.52)
            CubicKeyframe(0.96, duration: FieldMotion.spawnDuration * 0.20)
            CubicKeyframe(1.035, duration: FieldMotion.spawnDuration * 0.16)
            CubicKeyframe(1.0, duration: FieldMotion.spawnDuration * 0.12)
          }
          KeyframeTrack(\.opacity) {
            LinearKeyframe(1.0, duration: FieldMotion.spawnDuration * 0.3)
            LinearKeyframe(1.0, duration: FieldMotion.spawnDuration * 0.7)
          }
        }
        .onAppear { hasSpawned = true }
    }
  }

  private struct SpawnPose {
    var scale: CGFloat
    var opacity: CGFloat
  }
}
