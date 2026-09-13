import CoreGraphics
import Foundation
import Metal
import UIKit

// The provider marks as signed-distance tiles for the swarm's text pass —
// the reference's `icons/AgentIcon.tsx` table over its `marks.png`, which
// ships here byte for byte (baked from @lobehub/icons-static-svg@1.94.0 by
// research/svg-sdf's generator: 64-texel tiles, spread 8, pxRange 16, 0.5 at
// the edge, the field in the red channel). The atlas carries each agent's own
// mark plus the neighbours it could be confused with, so the lab can show the
// choice; the app draws only the chosen ones.

public enum MarksAtlas {
  public static let width = 396
  public static let height = 264
  public static let tile = 64
  public static let pxRange = 16.0
  private static let pitch = 66

  public struct Tile: Equatable, Sendable {
    public var x: Int
    public var y: Int
  }

  public struct Candidate: Equatable, Sendable {
    /// The LobeHub id.
    public var id: String
    public var title: String
    public var tile: Tile
    /// The provider this mark belongs with, when it is a candidate for one.
    public var provider: String?
    /// The mark the app draws for that provider.
    public var chosen: Bool
  }

  private static func at(_ index: Int) -> Tile {
    Tile(x: (index % 6) * pitch, y: (index / 6) * pitch)
  }

  /// Atlas order is the bake order; index → tile.
  public static let candidates: [Candidate] = [
    Candidate(id: "claudecode", title: "Claude Code", tile: at(0), provider: "claude", chosen: true),
    Candidate(id: "claude", title: "Claude", tile: at(1), provider: "claude", chosen: false),
    Candidate(id: "anthropic", title: "Anthropic", tile: at(2), provider: "claude", chosen: false),
    Candidate(id: "codex", title: "Codex", tile: at(3), provider: "codex", chosen: true),
    Candidate(id: "openai", title: "OpenAI", tile: at(4), provider: "codex", chosen: false),
    Candidate(id: "grok", title: "Grok", tile: at(5), provider: "grok", chosen: true),
    Candidate(id: "xai", title: "xAI", tile: at(6), provider: "grok", chosen: false),
    Candidate(id: "kimi", title: "Kimi", tile: at(7), provider: "kimi", chosen: true),
    Candidate(id: "moonshot", title: "Moonshot AI", tile: at(8), provider: "kimi", chosen: false),
    Candidate(id: "opencode", title: "opencode", tile: at(9), provider: "opencode", chosen: true),
    Candidate(id: "hermesagent", title: "Hermes Agent", tile: at(10), provider: "hermes", chosen: true),
    Candidate(id: "nousresearch", title: "Nous Research", tile: at(11), provider: "hermes", chosen: false),
    Candidate(id: "antigravity", title: "Antigravity", tile: at(12), provider: "antigravity", chosen: true),
    Candidate(id: "geminicli", title: "Gemini CLI", tile: at(13), provider: "antigravity", chosen: false),
    Candidate(id: "gemini", title: "Gemini", tile: at(14), provider: "antigravity", chosen: false),
    Candidate(id: "githubcopilot", title: "GitHub Copilot", tile: at(15), provider: "copilot", chosen: true),
    Candidate(id: "copilot", title: "Copilot", tile: at(16), provider: "copilot", chosen: false),
    Candidate(id: "github", title: "GitHub", tile: at(17), provider: "copilot", chosen: false),
    Candidate(id: "pi", title: "Pi", tile: at(18), provider: "pi", chosen: true),
    Candidate(id: "inflection", title: "Inflection", tile: at(19), provider: "pi", chosen: false),
  ]

  /// The providers with a chosen tile, in atlas order.
  public static let providers: [String] = candidates.filter(\.chosen).compactMap(\.provider)

  /// The provider's tile, or nil for a provider with only a letter.
  public static func tile(for providerID: String) -> Tile? {
    candidates.first { $0.chosen && $0.provider == providerID }?.tile
  }

  /// The letter a provider without a tile wears (the reference's `LETTER_MARKS`).
  public static func letter(for providerID: String) -> String {
    if providerID == "acp" { return "A" }
    return providerID.first.map { String($0).uppercased() } ?? "?"
  }

  /// The png's red channel as an `r8Unorm` texture. An undecodable atlas
  /// leaves an empty field: every mark falls back to nothing rather than to
  /// garbage, and the letter marks still come from the glyph atlas.
  @MainActor
  public static func makeTexture(device: MTLDevice) -> MTLTexture? {
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r8Unorm, width: width, height: height, mipmapped: false)
    descriptor.usage = [.shaderRead]
    descriptor.storageMode = .shared
    guard let texture = device.makeTexture(descriptor: descriptor) else { return nil }
    texture.label = "swarm marks"
    guard let url = Bundle.module.url(forResource: "marks", withExtension: "png"),
      let data = try? Data(contentsOf: url),
      let image = UIImage(data: data)?.cgImage
    else {
      return texture
    }
    var rgba = [UInt8](repeating: 0, count: width * height * 4)
    let drew = rgba.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
      else { return false }
      // Row 0 at the top, like the texture.
      context.translateBy(x: 0, y: CGFloat(height))
      context.scaleBy(x: 1, y: -1)
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drew else { return texture }
    var red = [UInt8](repeating: 0, count: width * height)
    for index in 0..<(width * height) { red[index] = rgba[index * 4] }
    red.withUnsafeBytes { buffer in
      texture.replace(
        region: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0,
        withBytes: buffer.baseAddress!, bytesPerRow: width)
    }
    return texture
  }
}
