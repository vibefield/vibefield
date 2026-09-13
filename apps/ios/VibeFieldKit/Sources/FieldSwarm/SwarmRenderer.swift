import FieldAgents
import Foundation
import Metal
import QuartzCore

// The swarm's renderer — the reference's `gpu/swarm-renderer.ts`: one
// surface, one render pass, five pipelines in painter's order — field,
// shadows, bodies, light, type — and one upload of bodies, graph samples and
// glyph quads per frame. It draws what it is given: positions and sizes belong
// to the stage, meaning belongs to `SwarmBodyModel`, colour to the theme.
// Nothing here reads a view.

/// One body as the renderer draws it.
public struct RenderBody {
  public var model: SwarmBodyModel
  public var x: Double
  public var y: Double
  /// The eased visual radius, points.
  public var radius: Double
  /// The arrival curve's scale and opacity; 1 once landed.
  public var scale: Double
  public var opacity: Double
  public var focus: Bool
  /// A stable per-body phase so breathing bodies do not breathe in unison.
  public var seed: Double
  public var accent: SwarmColor
  public var link: SwarmColor?
  /// This body's light instead of the frame's; the lab weighs settings side by side.
  public var glow: SwarmGlow?

  public init(
    model: SwarmBodyModel, x: Double, y: Double, radius: Double, scale: Double = 1, opacity: Double = 1,
    focus: Bool = false, seed: Double = 0, accent: SwarmColor, link: SwarmColor? = nil, glow: SwarmGlow? = nil
  ) {
    self.model = model
    self.x = x
    self.y = y
    self.radius = radius
    self.scale = scale
    self.opacity = opacity
    self.focus = focus
    self.seed = seed
    self.accent = accent
    self.link = link
    self.glow = glow
  }
}

public struct SwarmGlow: Equatable, Sendable {
  public var reach: Double
  public var strength: Double
  public var breath: Double
  public init(reach: Double, strength: Double, breath: Double) {
    self.reach = reach
    self.strength = strength
    self.breath = breath
  }
}

/// A mark drawn on its own, for the lab's contact sheet.
public struct RenderMark {
  public var tile: MarksAtlas.Tile
  /// Points, centred on (x, y).
  public var size: Double
  public var x: Double
  public var y: Double
  public var colour: SwarmColor
  public var alpha: Double
  public init(tile: MarksAtlas.Tile, size: Double, x: Double, y: Double, colour: SwarmColor, alpha: Double) {
    self.tile = tile
    self.size = size
    self.x = x
    self.y = y
    self.colour = colour
    self.alpha = alpha
  }
}

public struct SwarmHold: Equatable, Sendable {
  public var x: Double
  public var y: Double
  /// 0..1 along the long press.
  public var progress: Double
  public init(x: Double, y: Double, progress: Double) {
    self.x = x
    self.y = y
    self.progress = progress
  }
}

public struct SwarmFrame {
  /// Seconds. Held still by the renderer while motion is off.
  public var time: Double
  public var motion: Bool
  public var fillOpacity: Double
  public var gridPitch: Double
  public var glow: SwarmGlow
  public var theme: SwarmTheme
  public var bodies: [RenderBody]
  public var hold: SwarmHold?
  public var marks: [RenderMark]

  public init(
    time: Double, motion: Bool, fillOpacity: Double, gridPitch: Double = 24, glow: SwarmGlow,
    theme: SwarmTheme, bodies: [RenderBody], hold: SwarmHold? = nil, marks: [RenderMark] = []
  ) {
    self.time = time
    self.motion = motion
    self.fillOpacity = fillOpacity
    self.gridPitch = gridPitch
    self.glow = glow
    self.theme = theme
    self.bodies = bodies
    self.hold = hold
    self.marks = marks
  }
}

/// The body's flag bits, the shader's own.
public enum BodyFlags {
  public static let hollow: UInt32 = 1
  public static let running: UInt32 = 2
  public static let graph: UInt32 = 4
  public static let glow: UInt32 = 8
  public static let rim: UInt32 = 16
  public static let stale: UInt32 = 32
  public static let linked: UInt32 = 64
  public static let focus: UInt32 = 128
  public static let ringHot: UInt32 = 512
  public static let ring: UInt32 = 1024
  public static let shadow: UInt32 = 2048
  public static let core: UInt32 = 4096
  public static let flood: UInt32 = 8192
}

/// Each body's samples: the completion side, then the prompt side.
let bodySamples = burnBarCount * 2
let frameFloats = 40
let bodyFloats = 44
let glyphFloats = 16
private let initialBodies = 32
private let initialGlyphs = 2048
/// Frames the CPU may be ahead of the GPU: three sets of buffers rotate.
private let framesInFlight = 3

/// The context figure and the total: one size, the same margin in from the rim.
let figureStyle = TextStyle(size: 10.5, weight: 800, letterSpacing: 0.02)
let figureMargin = 7.0
/// The burn bars keep this much clear of the model line above and of the total below.
let bandMarginTop = 4.0
let bandMarginBottom = 8.0

/// The ink over a flooded body: whichever of the theme's inks stands furthest
/// from the accent that fills it, the blocked ink winning ties.
func floodInk(_ theme: SwarmTheme, fill: SwarmColor, accent: SwarmColor) -> SwarmColor {
  let flooded = SwarmColor(
    r: fill.r * 0.1 + accent.r * 0.9, g: fill.g * 0.1 + accent.g * 0.9, b: fill.b * 0.1 + accent.b * 0.9, a: 1)
  let target = flooded.luminance
  var best = theme.blocked.text
  var bestGap = abs(best.luminance - target)
  for ink in [theme.idle.text, theme.working.text] {
    let gap = abs(ink.luminance - target)
    if gap > bestGap + 0.05 {
      best = ink
      bestGap = gap
    }
  }
  return best
}

/// The burn bars' band: from a margin under the model line down to a margin
/// above the total figure, whatever the radius, so the bars fill that space
/// (taller on a bigger body). Fractions of the diameter.
func graphBand(radius: Double, layout: CopyLayout) -> (top: Double, bottom: Double) {
  let diameter = radius * 2
  let modelLine = layout.lines.first { $0.line.key == "model" }
  let under = modelLine.map { $0.y + $0.height / 2 } ?? layout.bottom
  let top = under + bandMarginTop
  let floor = max(top + 4, radius - figureMargin - figureStyle.size - bandMarginBottom)
  return (0.5 + top / diameter, 0.5 + floor / diameter)
}

/// The colours a body wears for its appearance, and its ink.
func bodyColours(_ body: RenderBody, theme: SwarmTheme) -> (fill: SwarmColor, ink: SwarmColor, rim: SwarmColor) {
  switch body.model.appearance {
  case .working: return (theme.working.bg, theme.working.text, theme.working.border)
  case .blocked:
    let ink = body.model.flood ? floodInk(theme, fill: theme.blocked.bg, accent: body.accent) : theme.blocked.text
    return (theme.blocked.bg, ink, theme.blocked.text)
  case .idle: return (theme.idle.bg, theme.idle.text, theme.idle.text)
  }
}

/// The 44 floats one body packs into (`packBody` in the reference), pure so
/// the flags and the layout are testable without a device.
func packedBody(_ body: RenderBody, frameGlow: SwarmGlow, sampleOffset: Int, band: (top: Double, bottom: Double), theme: SwarmTheme)
  -> [Float]
{
  let model = body.model
  let colours = bodyColours(body, theme: theme)
  var flags: UInt32 = 0
  if model.hollow { flags |= BodyFlags.hollow }
  if model.running { flags |= BodyFlags.running }
  if model.graph != nil { flags |= BodyFlags.graph }
  if model.flood { flags |= BodyFlags.flood }
  // The outer light: only on the body whose pane is the selected one. Every
  // other mounted body wears its colour as the band alone.
  if body.link != nil && model.active { flags |= BodyFlags.glow }
  if model.appearance == .working && !model.hollow { flags |= BodyFlags.rim | BodyFlags.shadow | BodyFlags.core }
  if model.stale { flags |= BodyFlags.stale }
  if body.link != nil { flags |= BodyFlags.linked }
  if body.focus { flags |= BodyFlags.focus }
  if model.ring != nil { flags |= BodyFlags.ring }
  if model.ring?.hot == true { flags |= BodyFlags.ringHot }

  var data = [Float](repeating: 0, count: bodyFloats)
  func rgba(_ offset: Int, _ colour: SwarmColor, _ alphaScale: Double = 1) {
    data[offset] = Float(colour.r)
    data[offset + 1] = Float(colour.g)
    data[offset + 2] = Float(colour.b)
    data[offset + 3] = Float(colour.a * alphaScale)
  }
  data[0] = Float(body.x)
  data[1] = Float(body.y)
  data[2] = Float(body.radius)
  data[3] = Float(body.scale)
  rgba(4, colours.fill, body.opacity)
  rgba(8, colours.ink)
  rgba(12, body.accent, body.opacity)
  rgba(16, colours.rim, body.opacity)
  data[20] = Float(bitPattern: flags)
  data[21] = Float(bitPattern: UInt32(sampleOffset))
  data[22] = 0
  data[23] = 0
  data[24] = Float(model.ring.map { Double($0.percent) / 100 } ?? 0)
  data[25] = 0
  data[26] = Float(0.18 * body.opacity)
  data[27] = 0
  let glow = body.glow ?? frameGlow
  data[28] = Float(glow.reach)
  data[29] = Float(glow.strength * body.opacity)
  data[30] = Float(glow.breath)
  data[31] = Float(body.seed)
  data[32] = 0
  data[33] = Float(body.seed)
  data[34] = model.stale ? 1 : 0
  data[35] = Float(body.opacity)
  rgba(36, body.link ?? .transparent, body.opacity)
  data[40] = Float(band.top)
  data[41] = Float(band.bottom)
  data[42] = 0
  data[43] = 0
  return data
}

/// One frame's uniform block, pure.
func packedFrame(_ frame: SwarmFrame, width: Double, height: Double, scale: Double, time: Double) -> [Float] {
  var data = [Float](repeating: 0, count: frameFloats)
  func rgba(_ offset: Int, _ colour: SwarmColor, _ alphaScale: Double = 1) {
    data[offset] = Float(colour.r)
    data[offset + 1] = Float(colour.g)
    data[offset + 2] = Float(colour.b)
    data[offset + 3] = Float(colour.a * alphaScale)
  }
  let theme = frame.theme
  data[0] = Float(width)
  data[1] = Float(height)
  data[2] = Float(scale)
  data[3] = Float(time)
  data[4] = Float(frame.fillOpacity)
  data[5] = frame.motion ? 1 : 0
  data[6] = Float(frame.gridPitch)
  data[7] = 0
  rgba(8, theme.grid)
  rgba(12, theme.shadow, frame.fillOpacity)
  rgba(16, theme.shadowPeak, frame.fillOpacity)
  data[20] = Float(frame.hold?.x ?? 0)
  data[21] = Float(frame.hold?.y ?? 0)
  data[22] = Float(frame.hold?.progress ?? 0)
  data[23] = frame.hold == nil ? 0 : 1
  rgba(24, theme.orange)
  rgba(28, theme.textMuted)
  rgba(32, theme.panelBg, 0.74)
  rgba(36, theme.textMain)
  return data
}

/// A renderer for one surface, drawing through the shared `SwarmGPU`.
@MainActor
public final class SwarmRenderer {
  public let gpu: SwarmGPU
  private var width = 1.0
  private var height = 1.0
  private var scale = 1.0
  private var heldTime = 0.0
  private var destroyed = false

  private struct Buffers {
    var frame: MTLBuffer
    var bodies: MTLBuffer
    var samples: MTLBuffer
    var glyphs: MTLBuffer
    var bodyCapacity: Int
    var glyphCapacity: Int
  }
  private var buffers: [Buffers] = []
  private var slot = 0
  private let inFlight = DispatchSemaphore(value: framesInFlight)

  private var frameData = [Float](repeating: 0, count: frameFloats)
  private var bodyData: [Float] = []
  private var sampleData: [Float] = []
  private var glyphData: [Float] = []
  private var glyphCount = 0

  public init(gpu: SwarmGPU) throws {
    self.gpu = gpu
    for _ in 0..<framesInFlight {
      buffers.append(try Self.makeBuffers(gpu.device, bodies: initialBodies, glyphs: initialGlyphs))
    }
    bodyData = [Float](repeating: 0, count: initialBodies * bodyFloats)
    sampleData = [Float](repeating: 0, count: initialBodies * bodySamples)
    glyphData = [Float](repeating: 0, count: initialGlyphs * glyphFloats)
  }

  private static func makeBuffers(_ device: MTLDevice, bodies: Int, glyphs: Int) throws -> Buffers {
    func buffer(_ length: Int, _ label: String) throws -> MTLBuffer {
      guard let buffer = device.makeBuffer(length: max(16, length), options: .storageModeShared) else {
        throw SwarmGPUError.atlas("no buffer for \(label)")
      }
      buffer.label = label
      return buffer
    }
    return Buffers(
      frame: try buffer(frameFloats * 4, "swarm frame"),
      bodies: try buffer(bodies * bodyFloats * 4, "swarm bodies"),
      samples: try buffer(bodies * bodySamples * 4, "swarm samples"),
      glyphs: try buffer(glyphs * glyphFloats * 4, "swarm glyphs"),
      bodyCapacity: bodies,
      glyphCapacity: glyphs)
  }

  public func resize(width: Double, height: Double, scale: Double) {
    self.width = max(1, width)
    self.height = max(1, height)
    self.scale = max(1, scale)
    gpu.atlas.setScale(CGFloat(self.scale))
  }

  public func measure(_ text: String, _ style: TextStyle) -> Double {
    gpu.atlas.measure(text, style)
  }

  /// The copy laid out for a body, with the atlas as the measurer.
  public func layout(of body: RenderBody) -> CopyLayout {
    let atlas = gpu.atlas
    return layoutCopy(
      body.model.copy, radius: body.radius * body.scale, measure: { atlas.measure($0, $1) },
      maxWidthRatio: body.model.copyMaxWidthRatio)
  }

  // MARK: - Glyph quads

  private func pushGlyph(
    _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ u0: Double, _ v0: Double, _ u1: Double, _ v1: Double,
    _ colour: SwarmColor, _ alpha: Double, field: Double = 0
  ) {
    if (glyphCount + 1) * glyphFloats > glyphData.count {
      glyphData.append(contentsOf: [Float](repeating: 0, count: glyphData.count))
    }
    let offset = glyphCount * glyphFloats
    glyphData[offset] = Float(x)
    glyphData[offset + 1] = Float(y)
    glyphData[offset + 2] = Float(w)
    glyphData[offset + 3] = Float(h)
    glyphData[offset + 4] = Float(u0)
    glyphData[offset + 5] = Float(v0)
    glyphData[offset + 6] = Float(u1)
    glyphData[offset + 7] = Float(v1)
    glyphData[offset + 8] = Float(colour.r)
    glyphData[offset + 9] = Float(colour.g)
    glyphData[offset + 10] = Float(colour.b)
    glyphData[offset + 11] = Float(colour.a * alpha)
    glyphData[offset + 12] = field > 0 ? 1 : 0
    glyphData[offset + 13] = Float(field)
    glyphData[offset + 14] = 0
    glyphData[offset + 15] = 0
    glyphCount += 1
  }

  /// A tile from the signed-distance atlas, `size` points, centred on (cx, cy).
  private func pushTile(_ tile: MarksAtlas.Tile, size: Double, cx: Double, cy: Double, colour: SwarmColor, alpha: Double) {
    let texels = Double(MarksAtlas.tile)
    let screenPxRange = MarksAtlas.pxRange * size * scale / texels
    pushGlyph(
      cx - size / 2, cy - size / 2, size, size,
      Double(tile.x) / Double(MarksAtlas.width), Double(tile.y) / Double(MarksAtlas.height),
      (Double(tile.x) + texels) / Double(MarksAtlas.width), (Double(tile.y) + texels) / Double(MarksAtlas.height),
      colour, alpha, field: screenPxRange)
  }

  /// A provider's mark, or false when it has only a letter.
  private func pushMark(_ providerID: String, size: Double, cx: Double, cy: Double, colour: SwarmColor, alpha: Double) -> Bool {
    guard let tile = MarksAtlas.tile(for: providerID) else { return false }
    pushTile(tile, size: size, cx: cx, cy: cy, colour: colour, alpha: alpha)
    return true
  }

  private func pushSprite(_ region: AtlasRegion?, cx: Double, cy: Double, colour: SwarmColor, alpha: Double) {
    guard let region else { return }
    pushGlyph(
      cx - region.width / 2, cy - region.height / 2, region.width, region.height,
      region.u0, region.v0, region.u1, region.v1, colour, alpha)
  }

  private func pushText(_ text: String, _ style: TextStyle, x: Double, baseline: Double, colour: SwarmColor, alpha: Double) {
    let atlas = gpu.atlas
    let spacing = style.letterSpacing * style.size
    var pen = x
    for character in text {
      guard let region = atlas.glyph(character, style) else { return }
      if character != " " {
        pushGlyph(
          pen + region.left, baseline + region.top, region.width, region.height,
          region.u0, region.v0, region.u1, region.v1, colour, alpha)
      }
      pen += region.advance + spacing
    }
  }

  private func toneColour(_ tone: CopyTone, body: RenderBody, ink: SwarmColor, theme: SwarmTheme) -> SwarmColor {
    switch tone {
    case .orange: theme.orange
    case .green: theme.green
    case .blue: theme.blue
    case .accent: body.accent
    case .ink: ink
    }
  }

  private func emitBodyText(_ body: RenderBody, ink: SwarmColor, theme: SwarmTheme, time: Double, motion: Bool, layout: CopyLayout) {
    let atlas = gpu.atlas
    let model = body.model
    let radius = body.radius * body.scale
    let dim = body.opacity * (model.stale ? 0.58 : 1)
    if radius < 12 { return }
    if let watermark = model.watermark {
      // The ignition's breath, kept from the DOM: a working mark swells from
      // 0.92 to 1.08 and brightens from 8% to 24% every 1.5s.
      let breathing = motion && model.appearance == .working
      let k = breathing ? 0.5 - 0.5 * cos(time * 2 * .pi / 1.5 + body.seed) : 0.5
      let size = (radius <= 40 ? 46.0 : 58.0) * (breathing ? 0.92 + 0.16 * k : 1)
      let opacity = (breathing ? 0.08 + 0.16 * k : watermark.opacity) * dim
      let cx = body.x
      // Lifted above the copy's centre so the branch line clears its densest part.
      let cy = body.y - 0.27 * radius
      if !pushMark(watermark.sprite, size: size, cx: cx, cy: cy, colour: ink, alpha: opacity) {
        // A provider with no tile wears its letter, set heavy in the mono face
        // at the mark's own scale (the reference's SVG letter, 21 of 24).
        let style = TextStyle(size: (size * 21 / 24).rounded(), weight: 800)
        let letter = MarksAtlas.letter(for: watermark.sprite)
        let textWidth = atlas.measure(letter, style)
        let metrics = atlas.fontMetrics(style)
        pushText(
          letter, style, x: cx - textWidth / 2, baseline: cy + (metrics.ascent - metrics.descent) / 2,
          colour: ink, alpha: opacity)
      }
    }
    for line in layout.lines {
      let colour = toneColour(line.line.tone, body: body, ink: ink, theme: theme)
      let alpha = line.line.opacity * dim
      let lineY = body.y + line.y
      var pen = body.x - line.width / 2
      func mark(_ lead: CopyLead) {
        let leadColour = toneColour(lead.tone ?? line.line.tone, body: body, ink: ink, theme: theme)
        let leadAlpha = (lead.opacity ?? line.line.opacity) * dim
        let centreX = pen + lead.advance / 2
        switch lead.kind {
        case .dot:
          pushSprite(atlas.sprite("dot", size: lead.size, draw: SwarmSprites.dot), cx: centreX, cy: lineY - 0.5, colour: leadColour, alpha: leadAlpha)
        case .bar:
          pushSprite(atlas.sprite("bar", size: lead.size, draw: SwarmSprites.bar), cx: centreX, cy: lineY, colour: leadColour, alpha: leadAlpha)
        case .icon(let name):
          if name == "folder" {
            pushSprite(atlas.sprite("icon:folder", size: lead.size, draw: SwarmSprites.folder), cx: centreX, cy: lineY, colour: leadColour, alpha: leadAlpha)
          }
        }
        pen += lead.advance + lead.gap
      }
      if let tag = line.line.tag { mark(tag) }
      if let lead = line.line.lead { mark(lead) }
      if line.text.isEmpty { continue }
      let metrics = atlas.fontMetrics(line.line.style)
      let baseline = lineY + (metrics.ascent - metrics.descent) / 2
      pushText(line.text, line.line.style, x: pen, baseline: baseline, colour: colour, alpha: alpha)
    }
    func figure(_ item: SwarmFigure, centreY: Double) {
      let colour = item.hot ? theme.orange : ink
      let alpha = (item.none ? 0.4 : item.hot ? 1 : 0.9) * dim
      let textWidth = atlas.measure(item.text, figureStyle)
      let metrics = atlas.fontMetrics(figureStyle)
      pushText(
        item.text, figureStyle, x: body.x - textWidth / 2,
        baseline: centreY + (metrics.ascent - metrics.descent) / 2, colour: colour, alpha: alpha)
    }
    // The context figure on the top chord and the total on the bottom one,
    // under the bars' floor, each the same distance in from the rim.
    let figureInset = figureMargin + figureStyle.size / 2
    if let top = model.figures?.top { figure(top, centreY: body.y - radius + figureInset) }
    if let bottom = model.figures?.bottom { figure(bottom, centreY: body.y + radius - figureInset) }
  }

  // MARK: - The frame

  /// Encode one frame into `drawable` through `pass`. The caller (the view)
  /// owns the drawable and presents it.
  public func render(_ frame: SwarmFrame, pass: MTLRenderPassDescriptor, drawable: MTLDrawable) {
    if destroyed { return }
    let bodies = frame.bodies
    let bodyCapacity = max(initialBodies, bodies.count)
    if bodyCapacity * bodyFloats > bodyData.count {
      bodyData = [Float](repeating: 0, count: bodyCapacity * 2 * bodyFloats)
      sampleData = [Float](repeating: 0, count: bodyCapacity * 2 * bodySamples)
    }
    if frame.motion { heldTime = frame.time }
    let time = heldTime
    let theme = frame.theme

    glyphCount = 0
    for (index, body) in bodies.enumerated() {
      let layout = layout(of: body)
      let band = graphBand(radius: body.radius * body.scale, layout: layout)
      let packed = packedBody(body, frameGlow: frame.glow, sampleOffset: index * bodySamples, band: band, theme: theme)
      bodyData.replaceSubrange(index * bodyFloats..<(index + 1) * bodyFloats, with: packed)
      if let graph = body.model.graph {
        for (column, value) in graph.up.enumerated() { sampleData[index * bodySamples + column] = Float(value) }
        for (column, value) in graph.down.enumerated() { sampleData[index * bodySamples + burnBarCount + column] = Float(value) }
      }
      emitBodyText(body, ink: bodyColours(body, theme: theme).ink, theme: theme, time: time, motion: frame.motion, layout: layout)
    }
    for mark in frame.marks {
      pushTile(mark.tile, size: mark.size, cx: mark.x, cy: mark.y, colour: mark.colour, alpha: mark.alpha)
    }
    gpu.atlas.flush()
    frameData = packedFrame(frame, width: width, height: height, scale: scale, time: time)

    // The buffers rotate three deep; a frame waits for the one it reuses.
    inFlight.wait()
    slot = (slot + 1) % framesInFlight
    var set = buffers[slot]
    if bodies.count > set.bodyCapacity || glyphCount > set.glyphCapacity {
      if let grown = try? Self.makeBuffers(
        gpu.device, bodies: max(set.bodyCapacity, bodies.count * 2), glyphs: max(set.glyphCapacity, glyphCount * 2))
      {
        set = grown
        buffers[slot] = grown
      }
    }
    frameData.withUnsafeBytes { set.frame.contents().copyMemory(from: $0.baseAddress!, byteCount: frameFloats * 4) }
    if !bodies.isEmpty {
      bodyData.withUnsafeBytes { set.bodies.contents().copyMemory(from: $0.baseAddress!, byteCount: bodies.count * bodyFloats * 4) }
      sampleData.withUnsafeBytes { set.samples.contents().copyMemory(from: $0.baseAddress!, byteCount: bodies.count * bodySamples * 4) }
    }
    if glyphCount > 0 {
      glyphData.withUnsafeBytes { set.glyphs.contents().copyMemory(from: $0.baseAddress!, byteCount: glyphCount * glyphFloats * 4) }
    }

    guard let commands = gpu.queue.makeCommandBuffer() else {
      inFlight.signal()
      return
    }
    commands.label = "swarm frame"
    let semaphore = inFlight
    commands.addCompletedHandler { _ in semaphore.signal() }
    guard let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else {
      commands.commit()
      return
    }
    encoder.label = "swarm"
    encoder.setVertexBuffer(set.frame, offset: 0, index: 0)
    encoder.setVertexBuffer(set.bodies, offset: 0, index: 1)
    encoder.setVertexBuffer(set.samples, offset: 0, index: 2)
    encoder.setFragmentBuffer(set.frame, offset: 0, index: 0)
    encoder.setFragmentBuffer(set.bodies, offset: 0, index: 1)
    encoder.setFragmentBuffer(set.samples, offset: 0, index: 2)
    encoder.setRenderPipelineState(gpu.fieldPipeline)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    if !bodies.isEmpty {
      encoder.setRenderPipelineState(gpu.shadowPipeline)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: bodies.count)
      encoder.setRenderPipelineState(gpu.bodyPipeline)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: bodies.count)
      encoder.setRenderPipelineState(gpu.glowPipeline)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: bodies.count)
    }
    if glyphCount > 0 {
      encoder.setRenderPipelineState(gpu.textPipeline)
      encoder.setVertexBuffer(set.glyphs, offset: 0, index: 3)
      encoder.setFragmentBuffer(set.glyphs, offset: 0, index: 3)
      encoder.setFragmentTexture(gpu.atlas.texture, index: 0)
      encoder.setFragmentTexture(gpu.marks, index: 1)
      encoder.setFragmentSamplerState(gpu.sampler, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: glyphCount)
    }
    encoder.endEncoding()
    commands.present(drawable)
    commands.commit()
  }

  public func destroy() {
    destroyed = true
  }
}
