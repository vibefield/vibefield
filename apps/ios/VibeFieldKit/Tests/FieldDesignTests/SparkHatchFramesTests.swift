import CoreGraphics
import CryptoKit
import Foundation
import Testing

@testable import FieldDesign

/// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — the hatch's FRAMES golden, in this bundle:
/// `spark-hatch-frames/<id>.png` is the vendored star engine's own WebGL2 picture of New spark's sky at a moment of
/// one of the rows golden's falls, at the engine's own @2x cap. `packages/design-kit/scripts/
/// spark-hatch-frames-golden.mjs` drew them on the host its manifest names, and `spark-hatch-frames.manifest.json`
/// names each one's case and sha256. All are copied in byte for byte (`pnpm check:ios-fixtures`).
///
/// `HatchSkyRenderer` draws the same moment through `HatchSky.metal`, offscreen, as the engine's `render(t)` draws
/// it: the night ground, the deal's star from the rows golden's own rows, the bloom and the composite. The rows are
/// held by SparkHatchGoldenTests, so what is measured here is the shader alone. Each frame must be the engine's within
/// 12e's bound, which VF-PM rules for good on the first report (DESIGN.md §2.10):
/// - per channel |Δ| ≤ 6/255 on ≥ 99.5% of a frame's pixels;
/// - mean |Δ| ≤ 1/255;
/// - any pixel past 32/255 named.
/// The motion frames are drawn with grain 0 (an engine option), and one frame of the ground has the engine's grain.
///
/// The report: one line per frame in the test's output (`SPARK-HATCH-FRAME …`). With `VF_SPARK_HATCH_REPORT` naming a
/// folder (xcodebuild passes `TEST_RUNNER_VF_SPARK_HATCH_REPORT` to the test as that), it also writes `report.json`
/// and each frame's diff picture there: the largest channel's |Δ|, eight times brighter.
@Suite("the hatch's sky is the desktop engine's pixels")
struct SparkHatchFramesTests {
  struct Manifest: Decodable {
    struct File: Decodable {
      let file: String
      let sha256: String
    }
    struct Host: Decodable {
      let renderer: String
      let halfFloat: Bool
    }
    struct Pixels: Decodable {
      let width, height: Int
    }
    struct Case: Decodable {
      let id: String
      let deal: String?
      let moment: String
      let t: Double
      let grain: Double
      let width, height: Double
      let file: String
      let pixels: Pixels
      let bytes: Int
      let sha256: String
    }
    let engine: File
    let rows: File
    let scale: Double
    let host: Host
    let bytes: Int
    let cases: [Case]
  }

  /// Each fall's moments, in the driver's order (`momentsOf`).
  static let moments = ["deal", "falling", "landing", "flash", "burst", "debris", "glitter", "late", "ground"]

  static func manifest() throws -> Manifest {
    try JSONDecoder().decode(
      Manifest.self, from: Data(contentsOf: SparkStarStillTests.fixture("spark-hatch-frames.manifest.json")))
  }

  /// The engine's picture for a case, as drawn (design-kit's `fixtures/spark-hatch-frames/<id>.png`, copied in).
  static func png(_ entry: Manifest.Case) throws -> Data {
    let name = String(entry.file.split(separator: "/").last ?? "")
    return try Data(contentsOf: SparkStarStillTests.fixture(name, in: "Fixtures/spark-hatch-frames"))
  }

  static func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  /// A frame's line in the report.
  static func line(_ measure: SparkStarStillTests.Measure) -> String {
    String(
      format: "SPARK-HATCH-FRAME %@ max %d mean %.3f within6 %.4f past32 %d %@", measure.id, measure.max, measure.mean,
      measure.within, measure.past32, measure.inBound ? "IN" : "OUT")
  }

  @Test("the manifest names nine moments of falls a and b and the grain's frame, at @2x, each PNG the bytes it names")
  func manifestHoldsTheFrames() throws {
    let manifest = try Self.manifest()
    let golden = try SparkHatchGoldenTests.golden()
    #expect(manifest.scale == HatchSky.dprCap)
    #expect(manifest.engine.sha256 == golden.engines["star"]?.sha256)
    // the frames were drawn from this bundle's rows golden, byte for byte
    let rows = try Data(contentsOf: SparkStarStillTests.fixture("spark-hatch.golden.json"))
    #expect(manifest.rows.sha256 == Self.sha256(rows))
    let ids = ["a", "b"].flatMap { deal in Self.moments.map { "\(deal)-\($0)" } } + ["ground-grain"]
    #expect(manifest.cases.map(\.id) == ids)
    var bytes = 0
    for entry in manifest.cases {
      let png = try Self.png(entry)
      bytes += png.count
      #expect(Self.sha256(png) == entry.sha256, "\(entry.id)")
      #expect(png.count == entry.bytes, "\(entry.id)")
      #expect(entry.pixels.width == Int((entry.width * manifest.scale).rounded()), "\(entry.id)")
      #expect(entry.pixels.height == Int((entry.height * manifest.scale).rounded()), "\(entry.id)")
      if let deal = entry.deal {
        _ = try golden.deal(deal)
        #expect(entry.grain == 0, "\(entry.id)")
        #expect(entry.width == golden.sky.width && entry.height == golden.sky.height, "\(entry.id)")
      } else {
        #expect(entry.grain == HatchSky.grain, "\(entry.id)")
      }
    }
    #expect(bytes == manifest.bytes)
  }

  @Test("each frame HatchSky.metal draws is the engine's picture, within the bound")
  func framesAreTheEnginesPictures() throws {
    let manifest = try Self.manifest()
    let golden = try SparkHatchGoldenTests.golden()
    let renderer = try HatchSkyRenderer.system.get()
    let report = ProcessInfo.processInfo.environment["VF_SPARK_HATCH_REPORT"].map { URL(fileURLWithPath: $0) }
    if let report { try FileManager.default.createDirectory(at: report, withIntermediateDirectories: true) }
    var measures: [SparkStarStillTests.Measure] = []
    for entry in manifest.cases {
      // the deal's star, from the rows golden's own rows, unless the engine has collected it by this moment
      var rows: [Float] = []
      if let id = entry.deal {
        let deal = try golden.deal(id)
        if !HatchSky.collected(tDeath: deal.star.tDeath, at: entry.t) { rows = deal.rows.map(Float.init) }
      }
      let drawn = try renderer.frame(
        rows: rows, stars: rows.isEmpty ? 0 : 1, size: CGSize(width: entry.width, height: entry.height),
        scale: manifest.scale, time: entry.t, grain: entry.grain)
      #expect(drawn.width == entry.pixels.width && drawn.height == entry.pixels.height, "\(entry.id)")
      guard drawn.width == entry.pixels.width && drawn.height == entry.pixels.height else { continue }
      let (measure, diff) = SparkStarStillTests.measure(
        entry.id, try SparkStarStillTests.pixels(drawn),
        try SparkStarStillTests.pixels(SparkStarStillTests.image(Self.png(entry))))
      print(Self.line(measure))
      measures.append(measure)
      if let report {
        try SparkStarStillTests.writeDiff(
          diff, width: entry.pixels.width, height: entry.pixels.height,
          to: report.appendingPathComponent("\(entry.id).diff.png"))
      }
      #expect(measure.inBound, "\(Self.line(measure))")
    }
    if let report {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(measures).write(to: report.appendingPathComponent("report.json"))
    }
  }
}
