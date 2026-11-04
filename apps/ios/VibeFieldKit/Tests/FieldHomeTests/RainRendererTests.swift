import FieldProduct
import Foundation
import Metal
import Testing

@testable import FieldHome

// PG-8 — THE RAIN'S RENDERER on this machine's GPU (read-pg8 §7 host rows): the shader compiles and links, the atlas
// resolves Courier New Bold and rasterises the closed set, and the golden's still frame becomes its quads. The pixels
// are the kit's and the eye's (§5's cost of the lean).

extension RainViewTests {
  @Suite("the renderer on this device")
  @MainActor
  struct Renderer {
    static func device() throws -> MTLDevice {
      try #require(MTLCreateSystemDefaultDevice(), "a Metal device")
    }

    /// The shader compiles from its Swift string and the pipeline links, on this device.
    @Test func theShaderCompilesOnThisDevice() throws {
      let device = try Self.device()
      let renderer = try? RainRenderer(device: device)
      #expect(renderer != nil, "the shader compiles from its string and the pipeline links")
      #expect(renderer?.pipeline.label == "rain")
    }

    /// Courier New Bold resolves by name, every letter, digit, `%` and `.` has ink, and so does every katakana the
    /// scramble rolls (CoreText's cascade); whitespace has none.
    @Test func theAtlasResolvesCourierNewAndRasterisesTheSet() throws {
      let atlas = try RainAtlas(device: Self.device(), scale: 3, fontSize: 12)
      #expect(atlas.resolvedFontName == RainAtlas.fontName)
      let missing = RainAtlas.units.filter { atlas.glyph($0) == nil }.map { String($0, radix: 16) }
      #expect(missing.isEmpty || missing == ["3100"], "units with no ink: \(missing)")
      let blank = [0x20, 0x09, 0x0A, 0xA0, 0x3000].map { atlas.glyph(UInt16($0)) }
      #expect(blank.allSatisfy { $0 == nil }, "whitespace draws nothing")
      let zero = try #require(atlas.glyph(0x30), "0 has ink")
      #expect(abs(zero.advance - 7.2) < 0.01, "Courier New advances 0.6 em")
      let glow = try #require(atlas.glow(0x30, blur: 10), "a glow for 0")
      #expect(glow.width > zero.width, "a glow is padded past its glyph")
    }

    /// The golden's still, painted: the stage clears to its fill, each inked glyph is one quad, each head with a blur
    /// one more (its glow, first), and a glyph's advance is centred on its cell.
    @Test func theStillFrameBecomesItsQuads() throws {
      let steps = try HomeFixture.witnessSteps()
      let rows = try #require(steps.first?.rows, "the open's rows")
      let agents = rows.map { RainAgent(row: $0) }
      var random = Mulberry32(seed: 1)
      var frame = RainFrame()
      frame.sync(width: 402, height: 781, fontSize: 12, order: agents.map { $0.id }, random: &random)
      let ops = frame.plan(agents: agents, parameters: .defaults, palette: .rain, elapsed: nil, random: &random)
      let atlas = try RainAtlas(device: Self.device(), scale: 3, fontSize: 12)
      let painted = RainRenderer.instances(ops, atlas: atlas)
      #expect(painted.clear == SIMD4<Float>(0, 0, 0, 1), "the stage, #000000")
      var inked = 0
      var glows = 0
      for op in ops {
        guard case .glyph(let glyph) = op, atlas.glyph(glyph.unit) != nil else { continue }
        inked += 1
        if glyph.blur > 0 { glows += 1 }
      }
      #expect(glows > 0)
      #expect(painted.quads.count == inked + glows)
      // the first inked op is a tail (no glow before it), so it is the first quad
      let inkedOps = ops.compactMap { op -> RainGlyph? in
        if case .glyph(let glyph) = op, atlas.glyph(glyph.unit) != nil { return glyph }
        return nil
      }
      let glyph = try #require(inkedOps.first)
      #expect(glyph.blur == 0)
      let region = try #require(atlas.glyph(glyph.unit))
      let quad = try #require(painted.quads.first)
      let left = Float(glyph.x - region.advance / 2 + region.left)
      let top = Float(glyph.y + region.top)
      #expect(quad.rect.x == left, "the advance centred on the cell")
      #expect(quad.rect.y == top, "the baseline on the row")
    }

    /// The canvas's colours, read as the canvas reads them.
    @Test func theColoursAreReadAsTheCanvasReadsThem() {
      #expect(RainRenderer.colour("#fef08a", opacity: 1) == SIMD4<Float>(254 / 255, 240 / 255, 138 / 255, 1))
      #expect(RainRenderer.channels("234, 179, 8", opacity: 0.5) == SIMD4<Float>(234 / 255, 179 / 255, 8 / 255, 0.5))
      #expect(RainRenderer.colour("rgba(255,255,255,1)", opacity: 1) == .zero, "only hex is a head's colour")
    }
  }
}
