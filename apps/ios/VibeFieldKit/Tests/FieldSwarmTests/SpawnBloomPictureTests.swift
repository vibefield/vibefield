import Foundation
import SwiftUI
import Testing
import UIKit

@testable import FieldSwarm

/// PJ-7 — the bloom's own pixels, for a reviewer's eye: the shipping overlay
/// over the shipping state, rendered at the phone's 402 × 874 pt in both
/// themes. Written only when the run names a directory
/// (`TEST_RUNNER_VF_SHOTS_DIR` on the xcodebuild line); otherwise the row
/// still renders and checks the picture is not empty.
@MainActor
@Suite struct SpawnBloomPictureTests {
  private let size = CGSize(width: 402, height: 874)

  private func bloom(reachStudio: Bool) throws -> SpawnBloom {
    let profiles = [
      BloomProfile(id: "native", label: "Default", isDefault: false),
      BloomProfile(id: "work", label: "Work", isDefault: true, glyph: "briefcase"),
    ]
    var bloom = try #require(
      SpawnBloom(
        at: BloomPoint(x: 201, y: 520),
        desktops: [
          BloomDesktop(id: "studio", name: "studio", platform: "darwin", asleep: false, sub: "2 RUNNING", profiles: profiles),
          BloomDesktop(id: "laptop", name: "laptop", platform: "win32", asleep: false, sub: "IDLE", profiles: []),
          BloomDesktop(id: "box", name: "box", platform: "linux", asleep: true, sub: "ASLEEP", profiles: []),
        ], home: "studio", field: BloomSize(w: 402, h: 874), chrome: [BloomRect(x: 0, y: 781, width: 402, height: 93)],
        measure: BloomHost.measure))
    let studio = bloom.one.items[0]
    _ = bloom.point(BloomPoint(x: studio.x, y: studio.y), now: 0)
    if reachStudio, let two = bloom.two {
      let work = BloomGeometry.polar(studio.x, studio.y, BloomConstants.r2, two.items[1].a)
      _ = bloom.point(work, now: 500)
    } else {
      _ = bloom.point(BloomGeometry.polar(201, 520, BloomConstants.r1, bloom.one.items[1].a), now: 500)
    }
    return bloom
  }

  @Test func theBloomDrawsInBothThemes() throws {
    let directory = ProcessInfo.processInfo.environment["VF_SHOTS_DIR"]
    for (name, reach) in [("desktops", false), ("profiles", true)] {
      for scheme in [ColorScheme.light, .dark] {
        let view = SpawnBloomOverlay(bloom: try bloom(reachStudio: reach), size: size)
          .environment(\.colorScheme, scheme)
          .background(scheme == .dark ? Color.black : Color.white)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try #require(renderer.uiImage)
        #expect(image.size == size)
        let png = try #require(image.pngData())
        #expect(png.count > 10_000)
        if let directory {
          let url = URL(fileURLWithPath: directory).appendingPathComponent("bloom-\(name)-\(scheme == .dark ? "dark" : "light").png")
          try png.write(to: url)
          print("PJ7_SHOT \(url.path)")
        }
      }
    }
  }
}
