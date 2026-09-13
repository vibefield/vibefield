import FieldAgents
import Metal
import SwarmPhysics
import SwiftUI
import Testing

@testable import FieldSwarm

private let now = Date(timeIntervalSince1970: 1_788_688_800)

private func bubble(
  id: String = "a", status: AgentVisualStatus = .idle, agent: AgentFacet? = AgentFacet(provider: .claude, modelName: "Fable 5.1"),
  color: SwarmColor? = SwarmColor(hex: "#6366f1"), stale: Bool = false, active: Bool = false, pane: PaneLink? = nil
) -> FieldBubble {
  FieldBubble(
    id: id, project: "puppeteer", detail: "detail", status: status, identityKey: id, createdAt: now, agent: agent,
    remote: nil, color: color, stale: stale, active: active, pane: pane)
}

private func model(_ bubble: FieldBubble, share: Double = 0) -> SwarmBodyModel {
  bodyModel(BodyModelInput(bubble: bubble, parameters: .default, now: now, workingShare: share))
}

private func render(_ bubble: FieldBubble, focus: Bool = false) -> RenderBody {
  let body = model(bubble)
  return RenderBody(model: body, x: 100, y: 100, radius: body.radius, focus: focus, accent: body.accent ?? .transparent, link: body.linked)
}

private let lightTheme = SwarmTheme.resolve(.light)
private let darkTheme = SwarmTheme.resolve(.dark)

@Suite struct MarksAtlasTests {
  @Test func theChosenProvidersInAtlasOrder() {
    #expect(MarksAtlas.providers == ["claude", "codex", "grok", "kimi", "opencode", "hermes", "antigravity", "copilot", "pi"])
    #expect(MarksAtlas.tile(for: "claude") == MarksAtlas.Tile(x: 0, y: 0))
    #expect(MarksAtlas.tile(for: "codex") == MarksAtlas.Tile(x: 198, y: 0))
    #expect(MarksAtlas.tile(for: "pi") == MarksAtlas.Tile(x: 0, y: 198))
    #expect(MarksAtlas.tile(for: "acp") == nil)
    #expect(MarksAtlas.letter(for: "acp") == "A")
    #expect(MarksAtlas.letter(for: "zed") == "Z")
    #expect(MarksAtlas.candidates.count == 20)
  }
}

@Suite struct SwarmThemeTests {
  @Test func resolvesTheReferencesPairsForBothSchemes() {
    // The blocked pair is the inversion: card-deep on light, text-main on dark.
    #expect(lightTheme.blocked.bg == .black)
    #expect(lightTheme.blocked.text == .white)
    #expect(darkTheme.blocked.bg == .white)
    #expect(darkTheme.blocked.text == .black)
    #expect(lightTheme.idle.bg.hex == "#e5e5e5")
    #expect(darkTheme.idle.bg.hex == "#2a2a2a")
    #expect(lightTheme.working.bg.hex == "#222222")
    #expect(darkTheme.working.bg.hex == "#eeeeee")
    #expect(lightTheme.orange.hex == "#ff9f0a")
    #expect(lightTheme.blue.hex == "#4a90d9")
    #expect(lightTheme.green.hex == "#4ade80")
    #expect(lightTheme.neutral.hex == "#b8b8b8")
    #expect(darkTheme.neutral.hex == "#555555")
    // Shadows: black on a light ground, white on a dark one.
    #expect(lightTheme.shadow == SwarmColor(r: 0, g: 0, b: 0, a: 0.18))
    #expect(darkTheme.shadowPeak == SwarmColor(r: 1, g: 1, b: 1, a: 0.3))
    #expect(lightTheme.tint == .light)
    #expect(darkTheme.tint == .dark)
  }
}

@Suite struct PackingTests {
  private func flags(_ data: [Float]) -> UInt32 { data[20].bitPattern }

  @Test func aHollowTerminalPacksItsRimAndNothingElse() {
    let body = render(bubble(agent: nil, color: nil))
    let data = packedBody(body, frameGlow: SwarmGlow(reach: 34, strength: 0.8, breath: 0), sampleOffset: 0, band: (0.5, 0.7), theme: lightTheme)
    #expect(data.count == bodyFloats)
    #expect(flags(data) == BodyFlags.hollow)
    #expect(data[2] == 50)
    #expect(data[28] == 34)
  }

  @Test func aWorkingBodyPacksTheRimTheShadowTheCoreTheRingAndTheGraph() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1", contextUsedPercent: 88,
      usage: UsageHistory(total: 100, steps: (0..<usageStepCount).map(Double.init)))
    let body = render(bubble(status: .working, agent: facet))
    let data = packedBody(body, frameGlow: SwarmGlow(reach: 34, strength: 0.8, breath: 0), sampleOffset: 40, band: (0.55, 0.8), theme: lightTheme)
    let bits = flags(data)
    for expected in [BodyFlags.rim, BodyFlags.shadow, BodyFlags.core, BodyFlags.ring, BodyFlags.ringHot, BodyFlags.graph] {
      #expect(bits & expected != 0, "\(expected)")
    }
    #expect(bits & BodyFlags.hollow == 0)
    #expect(bits & BodyFlags.flood == 0)
    #expect(data[21].bitPattern == 40)
    #expect(abs(data[24] - 0.88) < 1e-6)
    #expect(data[40] == Float(0.55))
    #expect(data[41] == Float(0.8))
  }

  @Test func theLightJoinsTheBandOnlyWhileTheCardIsOpen() {
    let pane = PaneLink(color: SwarmColor(hex: "#22cc88")!)
    let mounted = render(bubble(pane: pane))
    let open = render(bubble(active: true, pane: pane))
    let glow = SwarmGlow(reach: 34, strength: 0.8, breath: 0)
    let bandOnly = flags(packedBody(mounted, frameGlow: glow, sampleOffset: 0, band: (0.5, 0.7), theme: lightTheme))
    let lit = flags(packedBody(open, frameGlow: glow, sampleOffset: 0, band: (0.5, 0.7), theme: lightTheme))
    #expect(bandOnly & BodyFlags.linked != 0)
    #expect(bandOnly & BodyFlags.glow == 0)
    #expect(lit & BodyFlags.linked != 0)
    #expect(lit & BodyFlags.glow != 0)
  }

  @Test func aBlockedBodyFloodsAndItsInkStandsFurthestFromTheFlood() {
    let facet = AgentFacet(provider: .claude, modelName: "Fable 5.1", blockerKind: .permission)
    let body = render(bubble(status: .blocked, agent: facet, color: SwarmColor(hex: "#f5f5f5")))
    let data = packedBody(body, frameGlow: SwarmGlow(reach: 34, strength: 0.8, breath: 0), sampleOffset: 0, band: (0.5, 0.7), theme: lightTheme)
    #expect(flags(data) & BodyFlags.flood != 0)
    // A near-white flood on the light theme: the ink is the dark idle ink, not the blocked white.
    #expect(bodyColours(body, theme: lightTheme).ink == lightTheme.idle.text)
    let dark = render(bubble(status: .blocked, agent: facet, color: SwarmColor(hex: "#101010")))
    #expect(bodyColours(dark, theme: lightTheme).ink == lightTheme.blocked.text)
  }

  @Test func staleAndFocusPackTheirBits() {
    let glow = SwarmGlow(reach: 34, strength: 0.8, breath: 0)
    let stale = packedBody(render(bubble(stale: true)), frameGlow: glow, sampleOffset: 0, band: (0.5, 0.7), theme: lightTheme)
    #expect(flags(stale) & BodyFlags.stale != 0)
    #expect(stale[34] == 1)
    let focused = packedBody(render(bubble(), focus: true), frameGlow: glow, sampleOffset: 0, band: (0.5, 0.7), theme: lightTheme)
    #expect(flags(focused) & BodyFlags.focus != 0)
  }

  @Test func theFramePacksTheHoldAndTheThemesGround() {
    let frame = SwarmFrame(
      time: 2, motion: true, fillOpacity: 0.72, glow: SwarmGlow(reach: 34, strength: 0.8, breath: 0),
      theme: lightTheme, bodies: [], hold: SwarmHold(x: 10, y: 20, progress: 0.5))
    let data = packedFrame(frame, width: 400, height: 800, scale: 3, time: 2)
    #expect(data.count == frameFloats)
    #expect(data[0] == 400 && data[1] == 800 && data[2] == 3 && data[3] == 2)
    #expect(data[4] == Float(0.72) && data[5] == 1 && data[6] == 24)
    #expect(data[20] == 10 && data[21] == 20 && data[22] == 0.5 && data[23] == 1)
    #expect(abs(data[35] - 0.74) < 1e-6)
    let still = packedFrame(SwarmFrame(time: 2, motion: false, fillOpacity: 0.72, glow: frame.glow, theme: lightTheme, bodies: []), width: 1, height: 1, scale: 1, time: 0)
    #expect(still[5] == 0 && still[23] == 0)
  }

  @Test func theGraphBandRunsFromUnderTheModelLineToAboveTheTotal() {
    let layout = CopyLayout(
      lines: [
        PlacedLine(line: CopyLine(key: "name", text: "p", style: SwarmCopyStyle.workingName, opacity: 1, tone: .ink), text: "p", width: 10, textWidth: 10, y: -8, height: 14.7),
        PlacedLine(line: CopyLine(key: "model", text: "m", style: SwarmCopyStyle.labelInline, opacity: 1, tone: .ink), text: "m", width: 10, textWidth: 10, y: 5, height: 7.35),
      ], top: -15, bottom: 9)
    let band = graphBand(radius: 60, layout: layout)
    // Top: 4 under the model line's bottom (5 + 3.675 + 4 = 12.675) as a fraction of the diameter.
    #expect(abs(band.top - (0.5 + 12.675 / 120)) < 1e-6)
    // Bottom: the figure's inset from the rim (60 − 7 − 10.5 − 8 = 34.5).
    #expect(abs(band.bottom - (0.5 + 34.5 / 120)) < 1e-6)
  }
}

@Suite struct StageCurvesTests {
  @Test func theArrivalCurveLandsAtOneAndPeaksAtOnePointTwo() {
    #expect(arrivalCurve(elapsed: 0).scale == 0)
    #expect(arrivalCurve(elapsed: -1).opacity == 0)
    let peak = arrivalCurve(elapsed: 0.52 * spawnDuration)
    #expect(abs(peak.scale - 1.2) < 1e-9)
    #expect(peak.opacity == 1)
    #expect(abs(arrivalCurve(elapsed: 0.72 * spawnDuration).scale - 0.96) < 1e-9)
    #expect(abs(arrivalCurve(elapsed: 0.88 * spawnDuration).scale - 1.035) < 1e-9)
    #expect(arrivalCurve(elapsed: spawnDuration) == (scale: 1, opacity: 1))
    #expect(arrivalCurve(elapsed: 10) == (scale: 1, opacity: 1))
  }

  @Test func theRadiusSpringLandsWithinThreeHundredMilliseconds() {
    var radius = 50.0
    var velocity = 0.0
    for _ in 0..<36 {
      let next = springRadius(current: radius, velocity: velocity, target: 80, dt: 1.0 / 120)
      radius = next.radius
      velocity = next.velocity
    }
    #expect(radius > 77 && radius <= 80.5)
    // …and it SNAPS once both the displacement and the velocity are under the
    // threshold, so a settled body stops paying for a spring it no longer needs.
    var steps = 0
    while radius != 80 && steps < 600 {
      let next = springRadius(current: radius, velocity: velocity, target: 80, dt: 1.0 / 120)
      radius = next.radius
      velocity = next.velocity
      steps += 1
    }
    #expect(radius == 80 && velocity == 0)
    #expect(steps < 240)
  }

  @Test func drawOrderIsIdleUnderWorkingUnderBlocked() {
    #expect(statusRank(.idle) < statusRank(.working))
    #expect(statusRank(.working) < statusRank(.blocked))
  }
}

@Suite @MainActor struct StageTests {
  private func stage() -> SwarmStage {
    let stage = SwarmStage(rng: SplitMix64(seed: 3))
    stage.now = { now }
    stage.setBounds(CGSize(width: 400, height: 800))
    return stage
  }

  @Test func bodiesArriveOrderedAndTheTopmostIsHit() {
    let stage = stage()
    stage.update(
      bubbles: [
        bubble(id: "i", status: .idle), bubble(id: "b", status: .blocked, agent: AgentFacet(provider: .claude, blockerKind: .failure)),
        bubble(id: "w", status: .working),
      ], time: 0)
    stage.pump(time: 0)
    let frame = stage.frame(time: 0.01, motion: false)
    #expect(frame.bodies.map(\.model.id) == ["i", "w", "b"])
    #expect(frame.bodies.map(\.radius) == [50, 60, 50])
    let blocked = frame.bodies[2]
    #expect(stage.hitTest(SIMD2(blocked.x, blocked.y))?.model.id == "b")
    #expect(stage.hitTest(SIMD2(-100, -100)) == nil)
  }

  @Test func aTapSelectsAndADragDoesNot() {
    let stage = stage()
    var selected: [String] = []
    stage.onSelect = { selected.append($0.id) }
    stage.update(bubbles: [bubble(id: "a")], time: 0)
    stage.pump(time: 0)
    let body = stage.frame(time: 0.01, motion: false).bodies[0]
    let point = SIMD2(body.x, body.y)
    stage.pointerDown(at: point, time: 0.02)
    stage.pointerMoved(to: point + SIMD2(2, 0))
    stage.pointerUp(at: point + SIMD2(2, 0))
    #expect(selected == ["a"])
    stage.pointerDown(at: point, time: 0.03)
    stage.pointerMoved(to: point + SIMD2(40, 0))
    stage.pointerUp(at: point + SIMD2(40, 0))
    #expect(selected == ["a"])
  }

  @Test func aHoldOnEmptyGroundCreatesAfterTheLongPressAndAMoveCancelsIt() {
    let stage = stage()
    var created: [SIMD2<Double>] = []
    stage.onCreate = { point in
      created.append(point)
      return "new"
    }
    stage.update(bubbles: [], time: 0)
    stage.pointerDown(at: SIMD2(300, 700), time: 1)
    stage.pump(time: 1.3)
    #expect(created.isEmpty)
    stage.pump(time: 1.6)
    #expect(created == [SIMD2(300, 700)])
    // The new body lands under the finger.
    stage.update(bubbles: [bubble(id: "new")], time: 1.6)
    stage.pump(time: 1.6)
    let body = stage.frame(time: 1.61, motion: false).bodies[0]
    #expect(abs(body.x - 300) < 1e-6 && abs(body.y - 700) < 1e-6)
    stage.pointerDown(at: SIMD2(100, 100), time: 2)
    stage.pointerMoved(to: SIMD2(120, 100))
    stage.pump(time: 2.6)
    #expect(created.count == 1)
  }
}

@Suite @MainActor struct ShaderCompileTests {
  /// The five shaders compile and link on this device — the port's first
  /// gate, and the reason D-i14 keeps the compile cost.
  @Test func everyShaderCompilesOnTheSimulatorsDevice() throws {
    guard let device = MTLCreateSystemDefaultDevice() else { return }
    let gpu = try SwarmGPU(device: device, scale: 3)
    #expect(gpu.compileMs > 0)
    #expect(gpu.marks.width == MarksAtlas.width)
    let renderer = try SwarmRenderer(gpu: gpu)
    renderer.resize(width: 400, height: 800, scale: 3)
    // The atlas rasterises and measures the copy the bodies use.
    let width = renderer.measure("puppeteer", SwarmCopyStyle.workingName)
    #expect(width > 40 && width < 120)
    #expect(gpu.atlas.fontMetrics(SwarmCopyStyle.workingName).ascent > 8)
    let layout = renderer.layout(of: render(bubble(status: .working)))
    #expect(layout.lines.map(\.line.key) == ["name", "model"])
  }
}
