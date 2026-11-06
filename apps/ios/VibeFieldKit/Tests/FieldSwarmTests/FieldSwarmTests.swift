import CryptoKit
import FieldAgents
import Metal
import SwarmPhysics
import SwiftUI
import Testing

@testable import FieldSwarm

private let now = Date(timeIntervalSince1970: 1_788_688_800)

private func bubble(
  id: String = "a", status: AgentVisualStatus = .idle, agent: AgentFacet? = AgentFacet(provider: .claude, modelName: "Fable 5.1"),
  color: SwarmColor? = SwarmColor(hex: "#6366f1"), stale: Bool = false, active: Bool = false, mounted: Bool = false,
  unread: Bool = false
) -> FieldBubble {
  FieldBubble(
    id: id, project: "puppeteer", detail: "detail", status: status, identityKey: id, createdAt: now, agent: agent,
    remote: nil, color: color, stale: stale, active: active, mounted: mounted, unread: unread)
}

private func model(_ bubble: FieldBubble, share: Double = 0) -> SwarmBodyModel {
  bodyModel(BodyModelInput(bubble: bubble, parameters: .default, now: now, workingShare: share))
}

private func render(_ bubble: FieldBubble, focus: Bool = false) -> RenderBody {
  let body = model(bubble)
  return RenderBody(model: body, x: 100, y: 100, radius: body.radius, focus: focus, accent: body.accent ?? .transparent, mounted: body.mounted)
}

private let lightTheme = SwarmTheme.resolve(.light)
private let darkTheme = SwarmTheme.resolve(.dark)
private let glow = SwarmGlow(reach: 34, strength: 0.8, breath: 0)

private func close(_ colour: SwarmColor, _ r: Double, _ g: Double, _ b: Double, within tolerance: Double = 0.005) -> Bool {
  abs(colour.r - r) < tolerance && abs(colour.g - g) < tolerance && abs(colour.b - b) < tolerance
}

/// One catalog row, as far as the atlas cares: the id and the mark key it names.
private struct CatalogMarkRow: Decodable {
  let id: String
  let mark: String?
  /// The key the atlas is read by — the row's `mark`, else its id.
  var key: String { mark ?? id }
}

private struct CatalogGolden: Decodable {
  let catalog: [CatalogMarkRow]
}

private struct MissingCatalogGolden: Error, CustomStringConvertible {
  var description: String { "fixture `agent-catalog.valid.json` is not in the FieldSwarmTests bundle" }
}

/// The contracts' catalog golden, mirrored into this bundle byte for byte
/// (`pnpm check:ios-fixtures` keeps it so).
private func catalogGolden() throws -> [CatalogMarkRow] {
  guard
    let url = Bundle.module.url(
      forResource: "agent-catalog.valid", withExtension: "json", subdirectory: "Fixtures")
  else { throw MissingCatalogGolden() }
  return try JSONDecoder().decode(CatalogGolden.self, from: Data(contentsOf: url)).catalog
}

@Suite struct MarksAtlasTests {
  /// The atlas's red channel exactly as `makeTexture` uploads it.
  @MainActor private func uploadedRed() throws -> [UInt8] {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let texture = try #require(MarksAtlas.makeTexture(device: device))
    var red = [UInt8](repeating: 0, count: MarksAtlas.width * MarksAtlas.height)
    red.withUnsafeMutableBytes { bytes in
      texture.getBytes(
        bytes.baseAddress!, bytesPerRow: MarksAtlas.width,
        from: MTLRegionMake2D(0, 0, MarksAtlas.width, MarksAtlas.height), mipmapLevel: 0)
    }
    return red
  }

  /// The desktop SDK 0.3.2 uploads this PNG's red channel in top-to-bottom
  /// order, without color conversion. Check the actual Metal bytes, including
  /// tile gutters: a flipped upload can leave every tile coordinate correct
  /// while showing a different agent's mark (or an empty tile).
  ///
  /// LP-4 (2026-11-05): the pin is the atlas with every unkept tile blanked in
  /// place (`apps/ios/scripts/blank-unkept-marks.mjs` prints it; the
  /// generator's full bake pinned 49b54415…). The two kept tiles are the bake's
  /// bytes and both sit in the top row, so a flipped upload still misses it.
  @Test @MainActor func uploadedMarksMatchDesktopPixels() throws {
    let red = try uploadedRed()
    let digest = SHA256.hash(data: Data(red)).map { String(format: "%02x", $0) }.joined()
    #expect(digest == "4c89a40c1c66d10382b83645eb08b2391eae29bfc7372e8ab0c73a744e867df7")
  }

  /// LP-4 — the bundle carries no vendor mark the app does not draw: every
  /// tile that is not `drawn` uploads as an empty field (red 0, outside every
  /// edge), and each drawn tile still carries its mark.
  @Test @MainActor func onlyTheDrawnTilesCarryAMark() throws {
    let red = try uploadedRed()
    for candidate in MarksAtlas.candidates {
      var inked = 0
      for y in candidate.tile.y..<(candidate.tile.y + MarksAtlas.tile) {
        for x in candidate.tile.x..<(candidate.tile.x + MarksAtlas.tile) where red[y * MarksAtlas.width + x] != 0 {
          inked += 1
        }
      }
      if candidate.drawn {
        #expect(inked > 0, "\(candidate.id) is drawn but its tile is empty")
      } else {
        #expect(inked == 0, "\(candidate.id) is not drawn but its tile carries \(inked) inked texels")
      }
    }
  }

  /// AC-5 — the atlas keeps NO ROSTER OF ITS OWN. Until this lane it pinned its
  /// nine providers here, so a new upstream agent drifted past it silently (the
  /// catalog design's §1.3, gap 4). It is held to the CATALOG now: every mark
  /// it tiles must be for an agent the catalog decided on — a tile for anything
  /// else is a red — and a catalogued agent with no tile is PRINTED as a
  /// candidate, never failed: it wears its letter until a mark is baked.
  @Test func everyTileIsForAnAgentTheCatalogDecidedOn() throws {
    let rows = try catalogGolden()
    let keys = Set(rows.map(\.key))
    let strays = MarksAtlas.providers.filter { !keys.contains($0) }
    #expect(strays.isEmpty, "tiles for agents the catalog never decided on: \(strays)")
    // One chosen tile per key, or `tile(for:)` would answer whichever came first.
    #expect(Set(MarksAtlas.providers).count == MarksAtlas.providers.count)
    let lettered = rows.map(\.key).filter { MarksAtlas.tile(for: $0) == nil }
    print("MarksAtlas candidates — catalogued, no tile, drawn as a letter: \(lettered)")
  }

  /// The tiles and the letter fallback, by the keys the atlas is read by.
  @Test func theTilesAndTheLetterFallback() {
    #expect(MarksAtlas.tile(for: "claude") == MarksAtlas.Tile(x: 0, y: 0))
    #expect(MarksAtlas.tile(for: "codex") == MarksAtlas.Tile(x: 198, y: 0))
    #expect(MarksAtlas.tile(for: "pi") == nil)
    #expect(MarksAtlas.letter(for: "pi") == "P")
    #expect(MarksAtlas.tile(for: "acp") == nil)
    #expect(MarksAtlas.letter(for: "acp") == "A")
    #expect(MarksAtlas.letter(for: "zed") == "Z")
    #expect(MarksAtlas.candidates.count == 20)
  }

  /// LP-4 (2026-11-05) — James kept Claude's and Codex's logos for v1 and no
  /// other: every other vendor's pick stays recorded (`chosen`, the lab's ✓)
  /// but is not drawn, so that agent wears its letter, the swarm's own path for
  /// an agent with no tile.
  @Test func onlyClaudeAndCodexMarksAreDrawn() {
    #expect(MarksAtlas.providers == ["claude", "codex"])
    #expect(MarksAtlas.candidates.filter(\.drawn).map(\.id) == ["claudecode", "codex"])
    for mark in ["grok", "kimi", "opencode", "hermes", "antigravity", "copilot", "pi"] {
      #expect(MarksAtlas.tile(for: mark) == nil, "\(mark)")
      #expect(MarksAtlas.letter(for: mark) == String(mark.prefix(1)).uppercased(), "\(mark)")
    }
    // The design's picks are still on record for the lab.
    #expect(MarksAtlas.candidates.filter(\.chosen).count == 9)
  }
}

@Suite struct SwarmThemeTests {
  @Test func resolvesOneSurfaceAndOneInkForBothSchemes() {
    // No state inverts the theme: the instrument's resting body and its text.
    #expect(lightTheme.surface.hex == "#e5e5e5")
    #expect(lightTheme.ink.hex == "#111111")
    #expect(darkTheme.surface.hex == "#2a2a2a")
    #expect(darkTheme.ink.hex == "#ffffff")
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

  @Test func aLightThemeDarkensTheStateInksTowardItsOwnAndADarkThemeLeavesThem() {
    // 45% of the way to the ink on light: the words carry; the dark theme's hues already do.
    #expect(close(lightTheme.stateInk.orange, 0.55 + 0.45 * 0x11 / 255, 0.55 * 0x9f / 255 + 0.45 * 0x11 / 255, 0.55 * 0x0a / 255 + 0.45 * 0x11 / 255))
    #expect(lightTheme.stateInk.orange.luminance < lightTheme.orange.luminance)
    #expect(darkTheme.stateInk.orange == darkTheme.orange)
    #expect(darkTheme.stateInk.blue == darkTheme.blue)
    #expect(darkTheme.stateInk.green == darkTheme.green)
  }

  @Test func theLightIsTheHueAtTheHotEndAndTheGroundTheSameHueAtTheCalmEnd() {
    // vivid(orange, 1.22): the peak channel stays, the others fall away from it.
    let hue = vivid(SwarmColor(hex: "#ff9f0a")!, chroma: 1.22)
    #expect(close(hue, 1, 1 - (1 - Double(0x9f) / 255) * 1.22, 0))
    // Dark: the glow is lifted 55% toward white; the ground is the hue at half brightness.
    #expect(close(darkTheme.stateGlow.orange, 1, hue.g + (1 - hue.g) * 0.55, 0.55))
    #expect(close(darkTheme.stateGround.orange, 0.5, hue.g * 0.5, 0))
    // Light: the glow is the hue itself; the ground is carried 45% toward white.
    #expect(darkTheme.stateGlow.orange != lightTheme.stateGlow.orange)
    #expect(close(lightTheme.stateGlow.orange, hue.r, hue.g, hue.b))
    #expect(close(lightTheme.stateGround.orange, 1, hue.g + (1 - hue.g) * 0.45, 0.45))
    // The blue gains real chroma, and stays a blue: its peak channel is still the blue one.
    let blue = darkTheme.stateGlow.blue
    #expect(blue.b > blue.r && blue.b > blue.g)
    // The parameters move it: a steadier chroma leaves the token nearer itself.
    let tame = SwarmTheme.resolve(.light, parameters: SwarmParameters(stateChroma: 1))
    #expect(close(tame.stateGlow.orange, 1, Double(0x9f) / 255, Double(0x0a) / 255))
  }
}

@Suite struct PackingTests {
  private func flags(_ data: [Float]) -> UInt32 { data[20].bitPattern }

  @Test func aHollowTerminalPacksItsRimAtTheRimsWeightAndNothingElse() {
    let body = render(bubble(agent: nil, color: nil))
    let data = packedBody(body, frameGlow: glow, theme: lightTheme)
    #expect(data.count == bodyFloats)
    #expect(flags(data) == BodyFlags.hollow)
    #expect(data[2] == 50)
    #expect(data[28] == 34)
    // The rim is the ink at the dashed rim's weight; no light at all.
    #expect(abs(Double(data[19]) - SwarmWeight.rim) < 1e-6)
    #expect(data[15] == 0)
  }

  @Test func aWorkingBodyPacksTheRimTheShadowTheInkLightTheRingAndItsClimb() {
    let facet = AgentFacet(
      provider: .claude, modelName: "Fable 5.1", contextUsedPercent: 88,
      cost: AgentCost(usd: 1, coverage: "complete"))
    let body = render(bubble(status: .working, agent: facet))
    let data = packedBody(body, frameGlow: glow, theme: lightTheme)
    let bits = flags(data)
    for expected in [BodyFlags.rim, BodyFlags.shadow, BodyFlags.core, BodyFlags.ring, BodyFlags.ringHot] {
      #expect(bits & expected != 0, "\(expected)")
    }
    #expect(bits & BodyFlags.hollow == 0)
    // A working body breathes; only a state light comes in waves.
    #expect(bits & BodyFlags.waves == 0)
    // One surface, one ink: the fill is the theme's surface, the light the ink held back.
    #expect(data[4] == Float(lightTheme.surface.r) && data[8] == Float(lightTheme.ink.r))
    #expect(abs(Double(data[15]) - workingCoreStrength) < 1e-6)
    #expect(abs(Double(data[19]) - SwarmWeight.edge) < 1e-6)
    #expect(abs(data[24] - 0.88) < 1e-6)
    // The gauge climbs from the track's weight to the title's; the track is the faintest rung.
    #expect(abs(Double(data[25]) - climb(0)) < 1e-6)
    #expect(abs(Double(data[26]) - SwarmWeight.hairline) < 1e-6)
    #expect(data[27] == 1)
  }

  @Test func aBlockedBodyWearsTheOrangeGroundAndGlowsInWaves() {
    let facet = AgentFacet(provider: .claude, modelName: "Fable 5.1", blocker: AgentBlocker(kind: .permission, tool: "Bash"))
    let body = render(bubble(status: .blocked, agent: facet, color: SwarmColor(hex: "#f5f5f5")))
    let data = packedBody(body, frameGlow: glow, theme: darkTheme)
    #expect(flags(data) & (BodyFlags.core | BodyFlags.waves) == (BodyFlags.core | BodyFlags.waves))
    #expect(flags(data) & BodyFlags.rim == 0)
    let ground = darkTheme.stateGround.orange
    let light = darkTheme.stateGlow.orange
    #expect(data[4] == Float(ground.r) && data[5] == Float(ground.g) && data[6] == Float(ground.b))
    #expect(data[12] == Float(light.r) && data[13] == Float(light.g) && data[14] == Float(light.b))
    // The words stay the theme's ink; the project's colour is nowhere in the body's floats.
    #expect(data[8] == Float(darkTheme.ink.r))
    #expect(abs(Double(data[19]) - SwarmWeight.hairline) < 1e-6)
  }

  @Test func anUnreadIdleBodyWearsTheBlueGroundAndAReadOneNoLight() {
    let unread = packedBody(render(bubble(unread: true)), frameGlow: glow, theme: lightTheme)
    #expect(flags(unread) & (BodyFlags.core | BodyFlags.waves) == (BodyFlags.core | BodyFlags.waves))
    #expect(unread[4] == Float(lightTheme.stateGround.blue.r) && unread[6] == Float(lightTheme.stateGround.blue.b))
    let read = packedBody(render(bubble()), frameGlow: glow, theme: lightTheme)
    #expect(flags(read) & BodyFlags.core == 0)
    #expect(read[4] == Float(lightTheme.surface.r))
  }

  @Test func theLightJoinsTheBandOnlyWhileTheCardIsOpen() {
    let mounted = render(bubble(mounted: true))
    let open = render(bubble(active: true, mounted: true))
    let bandOnly = flags(packedBody(mounted, frameGlow: glow, theme: lightTheme))
    let lit = flags(packedBody(open, frameGlow: glow, theme: lightTheme))
    #expect(bandOnly & BodyFlags.linked != 0)
    #expect(bandOnly & BodyFlags.glow == 0)
    #expect(lit & BodyFlags.linked != 0)
    #expect(lit & BodyFlags.glow != 0)
  }

  @Test func theOnePanesBandAndLightAreTheThemesInkNeverAPaneColour() {
    // James 2026-10-18: the phone has one pane, so its light is black by day
    // and white by night (text main), whatever the project's colour.
    for theme in [lightTheme, darkTheme] {
      let lit = packedBody(render(bubble(active: true, mounted: true)), frameGlow: glow, theme: theme)
      #expect(Array(lit[36...39]) == [Float(theme.ink.r), Float(theme.ink.g), Float(theme.ink.b), Float(theme.ink.a)])
    }
    #expect(lightTheme.ink.hex == "#111111")
    #expect(darkTheme.ink.hex == "#ffffff")
    let bare = packedBody(render(bubble()), frameGlow: glow, theme: darkTheme)
    #expect(Array(bare[36...39]) == [0, 0, 0, 0])
    #expect(flags(bare) & (BodyFlags.linked | BodyFlags.glow) == 0)
  }

  @Test func staleAndFocusPackTheirBits() {
    let stale = packedBody(render(bubble(stale: true)), frameGlow: glow, theme: lightTheme)
    #expect(flags(stale) & BodyFlags.stale != 0)
    // slot 34 is the dim `body.metal` multiplies a stale body by (`RenderBody.staleDim`, SE-2q): shown, the stale
    // weight; a body that is not stale packs 1
    #expect(stale[34] == Float(SwarmWeight.stale))
    let focused = packedBody(render(bubble(), focus: true), frameGlow: glow, theme: lightTheme)
    #expect(flags(focused) & BodyFlags.focus != 0)
    #expect(focused[34] == 1)
  }

  @Test func theFramePacksTheHoldTheThemesGroundAndTheStateGlow() {
    let frame = SwarmFrame(
      time: 2, motion: true, fillOpacity: 0.72, glow: glow, theme: lightTheme, bodies: [],
      hold: SwarmHold(x: 10, y: 20, progress: 0.5))
    let data = packedFrame(frame, width: 400, height: 800, scale: 3, time: 2)
    #expect(data.count == frameFloats)
    #expect(data[0] == 400 && data[1] == 800 && data[2] == 3 && data[3] == 2)
    #expect(data[4] == Float(0.72) && data[5] == 1 && data[6] == 24)
    #expect(data[20] == 10 && data[21] == 20 && data[22] == 0.5 && data[23] == 1)
    // The hold's ink is the theme's, its fill the surface at 74%, its rim the ink at the supporting weight.
    #expect(abs(Double(data[31]) - SwarmWeight.supporting) < 1e-6)
    #expect(abs(data[35] - 0.74) < 1e-6)
    #expect(data[36] == Float(lightTheme.ink.r))
    // The state glow's shape and motion, from the parameters' defaults.
    #expect(abs(data[40] - 0.11) < 1e-6 && abs(data[41] - 0.9) < 1e-6 && abs(data[42] - 0.2) < 1e-6)
    #expect(abs(data[44] - 1.7) < 1e-6 && abs(data[45] - 1.75) < 1e-6 && abs(data[46] - 0.72) < 1e-6)
    let still = packedFrame(SwarmFrame(time: 2, motion: false, fillOpacity: 0.72, glow: glow, theme: lightTheme, bodies: []), width: 1, height: 1, scale: 1, time: 0)
    #expect(still[5] == 0 && still[23] == 0)
  }

  @Test func theBurnRowStandsMidwayBetweenTheModelLineAndTheTotal() {
    let layout = CopyLayout(
      lines: [
        PlacedLine(line: CopyLine(key: "name", text: "p", style: SwarmCopyStyle.workingName, opacity: 1, tone: .ink), text: "p", width: 10, textWidth: 10, y: -8, height: 14.7),
        PlacedLine(line: CopyLine(key: "model", text: "m", style: SwarmCopyStyle.labelInline, opacity: 1, tone: .ink), text: "m", width: 10, textWidth: 10, y: 5, height: 7.35),
      ], top: -15, bottom: 9)
    // Top: 4 under the model line's bottom (5 + 3.675 + 4 = 12.675); floor: the
    // figure's inset from the rim (60 − 7 − 10.5 − 8 = 34.5); the row is their midpoint.
    #expect(abs(burnRow(radius: 60, layout: layout) - (12.675 + 34.5) / 2) < 1e-6)
    #expect(flameSize == 13 && flameGap == 3)
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
        bubble(id: "i", status: .idle),
        bubble(id: "b", status: .blocked, agent: AgentFacet(provider: .claude, blocker: AgentBlocker(kind: .failure))),
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

  /// 2026-10-18 — the field never stalls one frame and catches up the next.
  /// With 60 Hz paint over 30 Hz physics and a jittery draw clock, the
  /// frame-age blend this replaced drew some frames with no movement at all.
  @Test func aDriftingBodyMovesEveryFrameWhateverThePaintsJitter() {
    let stage = stage()
    stage.parameters.physicsHz = 30
    stage.update(bubbles: [bubble(id: "a"), bubble(id: "b")], time: 0)
    let jitter: [Double] = [0, 1.5, -1.2, 0.8, -0.4, 1.9, -1.7, 0.3]
    var points: [SIMD2<Double>] = []
    for frame in 0...30 {
      let time = (Double(frame) * 1000 / 60 + jitter[frame % jitter.count]) / 1000
      stage.pump(time: time)
      let body = stage.frame(time: time, motion: false).bodies.first { $0.model.id == "b" }!
      points.append(SIMD2(body.x, body.y))
    }
    let moves = zip(points.dropFirst(), points).map { pair -> Double in
      let delta = pair.0 - pair.1
      return (delta.x * delta.x + delta.y * delta.y).squareRoot()
    }
    // The first frames start from rest; judge the drift once it is under way.
    let drifting = Array(moves.dropFirst(4))
    let median = drifting.sorted()[drifting.count / 2]
    #expect(median > 0.05, "the body should drift: a median of \(median) pt a frame")
    for (index, move) in drifting.enumerated() {
      #expect(move > median * 0.3, "frame \(index + 5) stalled: \(move) pt against a median of \(median)")
    }
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

  /// SE-2n (DESIGN.md §8 "The phone's profile token": the lens on Field) — a body the host recedes is drawn at its
  /// weight from its first frame; a weight then steps toward a new target at the host's pace each frame, and with no
  /// recede every body stands at 1. The pace here is the row's own (a hundredth a millisecond), so a step is counted.
  @Test func aRecededBodyDrawsAtTheHostsWeightAndStepsBackAtItsPace() {
    let stage = stage()
    stage.update(bubbles: [bubble(id: "a"), bubble(id: "b")], time: 0)
    stage.pump(time: 0)
    let pace: (Double, Double, Double) -> Double = { current, target, deltaMs in
      let rate = deltaMs / 100
      if abs(target - current) <= rate { return target }
      return current + (target > current ? rate : -rate)
    }
    stage.recede = SwarmRecede(targets: ["b": 0.22], approach: pace)
    let first = stage.frame(time: 0.01, motion: false).bodies
    let a = first.first { $0.model.id == "a" }?.opacity
    let b = first.first { $0.model.id == "b" }?.opacity
    #expect(a == 1)
    #expect(b == 0.22)
    // the lens let go: the body steps back, the frame's 10 ms at a hundredth a millisecond
    stage.recede = SwarmRecede(targets: [:], approach: pace)
    let next = stage.frame(time: 0.02, motion: false).bodies
    let stepped = next.first { $0.model.id == "b" }?.opacity ?? 0
    #expect(abs(stepped - 0.32) < 1e-9)
    // no recede at all: every body stands at 1
    stage.recede = nil
    let plain = stage.frame(time: 0.03, motion: false).bodies.map(\.opacity)
    #expect(plain == [1, 1])
  }

  /// One recede rule across Field's views (the UM lead's ruling for M-phone, 2026-11-06): a stale body under the
  /// lens weighs the recede's weight, as a stale row does in the list (`ListPaint.weight`: the recede's rule comes
  /// after the stale one's, so a row both stale and receded weighs the recede's) — never the stale weight times it.
  /// Shown, a stale body keeps the stale weight; stepping back, its weight follows the recede's until that passes the
  /// stale weight, so it never jumps. The pace is the row above's (a hundredth a millisecond).
  @Test func aStaleBodyUnderTheLensWeighsTheRecedesWeightNotBothMultiplied() {
    let stage = stage()
    stage.update(bubbles: [bubble(id: "a", stale: true), bubble(id: "b", stale: true), bubble(id: "c")], time: 0)
    stage.pump(time: 0)
    let pace: (Double, Double, Double) -> Double = { current, target, deltaMs in
      let rate = deltaMs / 100
      if abs(target - current) <= rate { return target }
      return current + (target > current ? rate : -rate)
    }
    stage.recede = SwarmRecede(targets: ["b": 0.22, "c": 0.22], approach: pace)
    let first = stage.frame(time: 0.01, motion: false).bodies
    let shown = first.first { $0.model.id == "a" }?.paintWeight ?? 0
    let staleReceded = first.first { $0.model.id == "b" }?.paintWeight ?? 0
    let receded = first.first { $0.model.id == "c" }?.paintWeight ?? 0
    #expect(abs(shown - SwarmWeight.stale) < 1e-9)
    #expect(abs(staleReceded - 0.22) < 1e-9)
    #expect(abs(receded - 0.22) < 1e-9)
    // the lens let go: the stale body steps back at the pace, the frame's 10 ms from 0.22 to 0.32, below the stale
    // weight, so it stands there
    stage.recede = SwarmRecede(targets: [:], approach: pace)
    let next = stage.frame(time: 0.02, motion: false).bodies
    let stepped = next.first { $0.model.id == "b" }?.paintWeight ?? 0
    #expect(abs(stepped - 0.32) < 1e-9)
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
    // Every sprite the copy can lead with has a picture, at the sizes the model asks for.
    for name in ["folder", "folder-solid", "message", "permission", "question", "failure"] {
      let draw = try #require(SwarmSprites.icon(name))
      #expect(gpu.atlas.sprite("icon:\(name)", size: 11, draw: draw) != nil, "\(name)")
    }
    #expect(gpu.atlas.sprite("flame", size: flameSize, draw: SwarmSprites.flame) != nil)
    #expect(gpu.atlas.sprite("flame-hollow", size: flameSize, draw: SwarmSprites.flameHollow) != nil)
    #expect(SwarmSprites.icon("tool") == nil)
  }

  /// LP-4 — a view not yet in a window cannot know its screen, so it asks for
  /// the shared context without a scale, and that leaves the scale a window
  /// already said (the field's) where it was: a second surface (the lab) must
  /// not blur the first one's glyphs until its next layout.
  @Test func askingWithoutAScaleLeavesTheWindowsScale() throws {
    guard MTLCreateSystemDefaultDevice() != nil else { return }
    let first = try SwarmGPU.shared(scale: 3)
    #expect(first.atlas.scale == 3)
    let second = try SwarmGPU.shared()
    #expect(second === first)
    #expect(second.atlas.scale == 3)
    _ = try SwarmGPU.shared(scale: 2)
    #expect(first.atlas.scale == 2)
  }
}

/// LP-4 (review) — the surface's loop asks the rate of the screen its window
/// stands on, under a host's cap, and reads it again at every frame: a scene
/// that moves to another screen keeping its window and its scale (Stage
/// Manager) takes that screen's rate at its next frame.
@Suite @MainActor struct SwarmSurfaceRateTests {
  /// A window for the surface: the app's scene when the run has one, a
  /// detached window otherwise (the package-hosted kit has no scene).
  private func hostWindow() -> UIWindow {
    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
      return UIWindow(windowScene: scene)
    }
    return UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 781))
  }

  @Test func aStaleRateIsPutBackToTheScreensUnderTheCap() {
    let view = SwarmMetalView(theme: lightTheme)
    let window = hostWindow()
    defer {
      view.removeFromSuperview()
      window.isHidden = true
    }
    view.frame = CGRect(x: 0, y: 0, width: 402, height: 781)
    window.addSubview(view)
    let rate = SwarmMetalView.screen(of: window).maximumFramesPerSecond
    #expect(view.preferredFramesPerSecond == rate, "in a window, the screen's own rate")
    view.preferredFramesPerSecond = 1
    view.followScreenRate()
    #expect(view.preferredFramesPerSecond == rate, "a stale rate is put back")
    view.frameRateCap = 10
    #expect(view.preferredFramesPerSecond == min(rate, 10), "a host's cap holds")
    view.preferredFramesPerSecond = 1
    view.followScreenRate()
    #expect(view.preferredFramesPerSecond == min(rate, 10), "and is put back under the cap")
  }
}
