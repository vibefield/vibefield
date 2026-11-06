import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import FieldDesign

/// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — the spark face's STILLS golden, in this bundle:
/// `spark-stills/<id>.png` is the vendored engine's own WebGL2 picture of each still case at the phone's @3x, drawn by
/// `packages/design-kit/scripts/spark-stills-golden.mjs` on the host its manifest names. `spark-stills.manifest.json`
/// names each picture's case and sha256. Both are copied in byte for byte (`pnpm check:ios-fixtures`).
///
/// `SparkStills.picture` draws the rows golden's still rows through `SparkStar.metal`, offscreen, as the engine's
/// `render(0, { frozen: true })` draws them. The rows are held exact by SparkBuddyGoldenTests, so what is measured
/// here is the shader alone. Each picture must be the engine's within the bound. The start the plan proposed (Q2) is:
/// - per channel |Δ| ≤ 6/255 on ≥ 99.5% of a still's pixels;
/// - mean |Δ| ≤ 1/255;
/// - any pixel past 32/255 named.
/// VF-PM rules the bound for good on the first report. Both pictures are compared premultiplied, in sRGB, 8 bits a
/// channel, drawn into one kind of bitmap.
///
/// The report: one line per still in the test's output (`SPARK-STILL …`). With `VF_SPARK_STILLS_REPORT` naming a
/// folder (xcodebuild passes `TEST_RUNNER_VF_SPARK_STILLS_REPORT` to the test as that), it also writes `report.json`
/// and each still's diff picture there: the largest channel's |Δ|, eight times brighter.
@Suite("the spark face's stills are the desktop engine's pixels")
struct SparkStarStillTests {
  struct Manifest: Decodable {
    struct Case: Decodable {
      let id: String
      let seed: UInt32
      let status: String
      let size: Double
      let framed: Bool
      let theme: String
      let file: String
      let width: Int
      let height: Int
      let sha256: String
    }
    let scale: Double
    let cases: [Case]
  }

  struct Rows: Decodable {
    struct Still: Decodable {
      let id: String
      /// float32s written to nine digits: read as doubles, each is its float32 exactly
      let rows: [Double]
    }
    let stills: [Still]
  }

  /// One still measured against the engine's picture.
  struct Measure: Encodable {
    let id: String
    let pixels: Int
    /// the largest channel |Δ| anywhere, of 255
    let max: Int
    /// the mean channel |Δ|, of 255
    let mean: Double
    /// the share of pixels whose every channel is within 6/255
    let within: Double
    /// how many pixels have a channel past 32/255
    let past32: Int

    var inBound: Bool { within >= 0.995 && mean <= 1 }
    var line: String {
      String(
        format: "SPARK-STILL %@ max %d mean %.3f within6 %.4f past32 %d %@", id, max, mean, within, past32,
        inBound ? "IN" : "OUT")
    }
  }

  static func fixture(_ name: String, in folder: String = "Fixtures") throws -> URL {
    try #require(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: folder), "\(name)")
  }

  static func manifest() throws -> Manifest {
    try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: fixture("spark-stills.manifest.json")))
  }

  static func rows() throws -> [String: [Float]] {
    let rows = try JSONDecoder().decode(Rows.self, from: Data(contentsOf: fixture("spark-rows.golden.json")))
    return Dictionary(uniqueKeysWithValues: rows.stills.map { ($0.id, $0.rows.map(Float.init)) })
  }

  /// The engine's picture for a case, as drawn (design-kit's `fixtures/spark-stills/<id>.png`, copied in).
  static func png(_ entry: Manifest.Case) throws -> Data {
    let name = String(entry.file.split(separator: "/").last ?? "")
    return try Data(contentsOf: fixture(name, in: "Fixtures/spark-stills"))
  }

  /// A picture as premultiplied RGBA, 8 bits a channel, in sRGB: both sides are drawn into this one kind of bitmap.
  static func pixels(_ image: CGImage) throws -> [UInt8] {
    let width = image.width
    let height = image.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let space = try #require(CGColorSpace(name: CGColorSpace.sRGB))
    try bytes.withUnsafeMutableBytes { buffer in
      let context = try #require(
        CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
          space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return bytes
  }

  static func image(_ data: Data) throws -> CGImage {
    let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
    return try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
  }

  /// The two pictures' channel differences, and the diff picture: each pixel's largest |Δ|, eight times brighter.
  static func measure(_ id: String, _ got: [UInt8], _ want: [UInt8]) -> (Measure, [UInt8]) {
    let pixels = want.count / 4
    var largest = 0
    var total = 0
    var within = 0
    var past32 = 0
    var diff = [UInt8](repeating: 255, count: want.count)
    for pixel in 0..<pixels {
      var most = 0
      for channel in 0..<4 {
        let delta = abs(Int(got[pixel * 4 + channel]) - Int(want[pixel * 4 + channel]))
        total += delta
        most = Swift.max(most, delta)
      }
      largest = Swift.max(largest, most)
      if most <= 6 { within += 1 }
      if most > 32 { past32 += 1 }
      let shade = UInt8(Swift.min(255, most * 8))
      diff[pixel * 4] = shade
      diff[pixel * 4 + 1] = shade
      diff[pixel * 4 + 2] = shade
    }
    let measure = Measure(
      id: id, pixels: pixels, max: largest, mean: Double(total) / Double(want.count),
      within: Double(within) / Double(Swift.max(1, pixels)), past32: past32)
    return (measure, diff)
  }

  /// The diff picture as a PNG at `url`.
  static func writeDiff(_ diff: [UInt8], width: Int, height: Int, to url: URL) throws {
    let space = try #require(CGColorSpace(name: CGColorSpace.sRGB))
    let provider = try #require(CGDataProvider(data: Data(diff) as CFData))
    let image = try #require(
      CGImage(
        width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: space,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
        decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    let destination = try #require(
      CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    #expect(CGImageDestinationFinalize(destination))
  }

  @Test("the manifest names the rows golden's stills at @3x, and each PNG is the bytes it names")
  func manifestHoldsTheStills() throws {
    let manifest = try Self.manifest()
    let rows = try Self.rows()
    #expect(manifest.scale == 3)
    #expect(manifest.cases.count == 58)
    #expect(Set(manifest.cases.map(\.id)) == Set(rows.keys))
    for entry in manifest.cases {
      let digest = SHA256.hash(data: try Self.png(entry)).map { String(format: "%02x", $0) }.joined()
      #expect(digest == entry.sha256, "\(entry.id)")
      let side = Int((SparkStills.box(size: entry.size, framed: entry.framed) * manifest.scale).rounded())
      #expect(entry.width == side && entry.height == side, "\(entry.id)")
    }
  }

  @Test("each still SparkStar.metal draws is the engine's picture, within the bound")
  func stillsAreTheEnginesPictures() throws {
    let manifest = try Self.manifest()
    let rows = try Self.rows()
    let report = ProcessInfo.processInfo.environment["VF_SPARK_STILLS_REPORT"].map { URL(fileURLWithPath: $0) }
    if let report { try FileManager.default.createDirectory(at: report, withIntermediateDirectories: true) }
    var measures: [Measure] = []
    for entry in manifest.cases {
      let still = try #require(rows[entry.id], "\(entry.id) has no rows")
      let box = SparkStills.box(size: entry.size, framed: entry.framed)
      let drawn = try SparkStills.picture(rows: still, box: box, scale: manifest.scale)
      #expect(drawn.width == entry.width && drawn.height == entry.height, "\(entry.id)")
      guard drawn.width == entry.width && drawn.height == entry.height else { continue }
      let (measure, diff) = Self.measure(
        entry.id, try Self.pixels(drawn), try Self.pixels(Self.image(Self.png(entry))))
      print(measure.line)
      measures.append(measure)
      if let report {
        try Self.writeDiff(
          diff, width: entry.width, height: entry.height,
          to: report.appendingPathComponent("\(entry.id).diff.png"))
      }
      #expect(measure.inBound, "\(measure.line)")
    }
    if let report {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(measures).write(to: report.appendingPathComponent("report.json"))
    }
  }
}
