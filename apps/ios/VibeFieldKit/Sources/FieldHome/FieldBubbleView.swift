import FieldAgents
import FieldDesign
import SwiftUI

/// One session — an agent's or a peer's terminal — rendered as a living
/// circle.
///
/// Status is contrast, exactly as on the desktop: idle wears quiet grey,
/// working inverts against the theme and breathes, waiting is the biggest,
/// highest-contrast object on screen with an urgent pulse. The identity hue
/// appears only as a whisper — the context fill and the ignition embers.
///
/// The view reads a `FieldBubble` and never asks where it came from: an agent
/// and a peer's shell differ only in which facet is present, which is the
/// whole point of the union (IOS-3a). Facet-shaped chrome — the branch dot,
/// the context readout — is drawn only when its facet has something true to
/// say.
struct FieldBubbleView: View {
  let bubble: FieldBubble
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
    FieldPalette.agentColor(hue: agentIdentityHue(bubble.identityKey))
  }

  private var status: AgentVisualStatus { visual.status }
  /// Already folded by the projection — the view never re-derives a truth the
  /// pure function owns.
  private var detail: String { bubble.detail }

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
      if let percent = bubble.agent?.contextUsedPercent {
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
    BubbleGlyph(bubble: bubble)
      .frame(width: 58, height: 58)
      .foregroundStyle(tierText)
      .opacity(glyphOpacity)
      .scaleEffect(visual.isIgnited && pulsing && !reduceMotion ? 1.08 : glyphRestScale)
      .offset(y: -diameter * 0.08)
      .allowsHitTesting(false)
  }

  private var copyStack: some View {
    VStack(spacing: 0) {
      if visual.appearance != .idle, let branch = bubble.agent?.branch {
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

      Text(bubble.project)
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

  @ViewBuilder
  private var contextLabel: some View {
    if let contextText {
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

  /// The eyebrow under the name. An agent says what is thinking; a peer's
  /// session says which machine it lives on — the same reason the desktop puts
  /// the host in the detail rather than leaving a path with no machine
  /// attached to it.
  private var providerLine: String {
    if let remote = bubble.remote { return remote.deviceName }
    guard let agent = bubble.agent else { return "" }
    return agent.modelName ?? agent.provider.displayName
  }

  /// nil for a terminal: a shell has no context window, and "CTX:--%" would be
  /// a readout of a number that does not exist.
  private var contextText: String? {
    guard bubble.agent != nil else { return nil }
    guard let percent = bubble.agent?.contextUsedPercent else { return "CTX:--%" }
    return String(format: "CTX:%02d%%", Int(percent.rounded(.down)))
  }

  private var accessibilityText: String {
    let tail = contextText.map { ", \($0)" } ?? ""
    return "\(bubble.project), \(providerLine), \(status.rawValue): \(detail)\(tail)"
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
