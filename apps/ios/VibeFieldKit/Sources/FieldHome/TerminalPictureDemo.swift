#if DEBUG
  import FieldTerminal
  import Foundation

  /// `-vf-demo-terminal-picture=<path>` (PF-4, 2026-11-21; apps/ios/README.md): a terminal's PICTURE on the open
  /// card with no desktop, so the band over a painted surface, and the card's glass under one, can be photographed
  /// on a simulator, where no attach is ever made. The path names a recorded lane (a seed frame and a delta, the
  /// kit's own test fixture `trf1-frames.lane.json`); its two frames are applied to a scene of this fixture's own.
  /// Nothing is attached, nothing is typed and no door is called: the card shows the recording and its attach stays
  /// refused. It reads a file only where the argument names one, which a build that reads no launch arguments never
  /// does.
  @MainActor
  enum TerminalPictureDemo {
    static let argument = "-vf-demo-terminal-picture"

    private struct Lane: Decodable {
      let seedFrameBase64: String
      let deltaFrameBase64: String
    }

    private static var held: TerminalScene?

    /// The recording's scene, made once; nil without the argument, or where the file or a frame would not be read.
    static func scene(_ arguments: [String]) -> TerminalScene? {
      if let held { return held }
      guard let named = arguments.first(where: { $0.hasPrefix(argument + "=") }) else { return nil }
      let path = String(named.dropFirst(argument.count + 1))
      guard let recorded = FileManager.default.contents(atPath: path),
        let lane = try? JSONDecoder().decode(Lane.self, from: recorded),
        let seed = Data(base64Encoded: lane.seedFrameBase64),
        let delta = Data(base64Encoded: lane.deltaFrameBase64)
      else { return nil }
      let scene = TerminalScene()
      guard scene.render(seed) else { return nil }
      _ = scene.render(delta)
      held = scene
      return scene
    }
  }
#endif
