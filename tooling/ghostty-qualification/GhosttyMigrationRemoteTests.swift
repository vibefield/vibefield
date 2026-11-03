import FieldFreeway
import FieldProduct
import FieldRoutedTerminal
import FieldTerminal
import Foundation
import GhostteaTerminal
import GhostteaFontProof
import Truffle
import TruffleTailscale
import UIKit
import MetalKit
import SwiftUI
import XCTest

// Opt-in, generated app-host test only. No credentials are compiled into the
// app. The fixture supplies only approval; PTY, Truffle, Freeway, routed lanes
// and both Metal surfaces are the production implementations.
@MainActor
final class GhosttyMigrationRemoteTests: XCTestCase {
  struct Configuration: Decodable, Sendable {
    let appId: String
    let hostname: String
    let host: String
    let login: String
    let bootstrapPort: Int
    let sessionId: String
    let deviceId: String
    let authKey: String
    let selectionTextSupported: Bool?
  }

  enum ProbeError: Error { case failed(String) }
  struct Stream: FreewayByteStream {
    let connection: any MeshConnection
    func read(_ max: Int) async throws -> Data? { try await connection.read(max) }
    func write(_ data: Data) async throws { try await connection.write(data) }
    func close() async { await connection.close() }
  }

  @MainActor
  final class Client {
    let node: MeshNode
    let supervisor: FreewayDesktopLink
    let lanes: TerminalLanes
    let scene: TerminalScene
    let attachment: TerminalAttachment
    let view: GhostteaTerminalMetalView
    let surfaceController: UIHostingController<TerminalSurface>
    let stateDirectory: URL
    init(node: MeshNode, supervisor: FreewayDesktopLink, lanes: TerminalLanes,
         scene: TerminalScene, attachment: TerminalAttachment,
         view: GhostteaTerminalMetalView, surfaceController: UIHostingController<TerminalSurface>,
         stateDirectory: URL) {
      self.node = node; self.supervisor = supervisor; self.lanes = lanes
      self.scene = scene; self.attachment = attachment; self.view = view
      self.surfaceController = surfaceController
      self.stateDirectory = stateDirectory
    }
    func stop() async {
      attachment.release()
      lanes.closeAll()
      surfaceController.willMove(toParent: nil)
      surfaceController.view.removeFromSuperview()
      surfaceController.removeFromParent()
      view.suspendGPU()
      await supervisor.stop()
      await node.stop()
      try? FileManager.default.removeItem(at: stateDirectory)
    }
  }

  static func get(_ route: String, configuration: Configuration, node: MeshNode) async throws -> FieldProduct.JSONValue {
    let url = URL(string: "http://\(configuration.host):\(configuration.bootstrapPort)/\(route)")!
    let (data, response) = try await node.httpGet(url)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw ProbeError.failed("qualification service refused \(route)")
    }
    return try JSONDecoder().decode(FieldProduct.JSONValue.self, from: data)
  }

  func until(_ message: String, seconds: Double = 25,
             _ check: @MainActor () async throws -> Bool) async throws {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      if try await check() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    throw ProbeError.failed("timed out: \(message)")
  }

  static func surface(scene: TerminalScene, attachment: TerminalAttachment) -> TerminalSurface {
    TerminalSurface(
        scene: scene, visible: true, configuration: attachment.presentation,
        onGridSize: { [weak attachment] in
          attachment?.setViewport(cols: $0.columns, rows: $0.rows)
        },
        onNeedsFullRefresh: { [weak attachment] in attachment?.requestFullRefresh() },
        onHardwareInput: { [weak attachment] in attachment?.handleHardwareKey($0) ?? false },
        onSoftwareInput: { [weak attachment] in attachment?.handleSoftwareInput($0) },
        onTouch: { [weak attachment] in attachment?.engage() })
  }

  func capture(_ parent: UIView, named name: String) {
    let image = UIGraphicsImageRenderer(bounds: parent.bounds).image { _ in
      parent.drawHierarchy(in: parent.bounds, afterScreenUpdates: false)
    }
    let screenshot = XCTAttachment(image: image)
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func makeClient(_ config: Configuration, label: String, frame: CGRect, parent: UIViewController) async throws -> Client {
    let state = FileManager.default.temporaryDirectory.appendingPathComponent("ghostty-qualification-\(UUID())")
    let node = try await MeshNode.startTailscale(.init(
      appId: config.appId, deviceName: label + "-" + UUID().uuidString.prefix(8),
      stateDirectory: state, ephemeral: true, auth: .authKey(config.authKey), loginAllow: [config.login]))
    let events = await node.events
    let monitor = Task { @MainActor in
      for await event in events {
        switch event {
        case .phase(let phase): print("GHOSTTY_REMOTE mesh phase: \(phase)")
        case .health(let message):
          let safe = message.replacingOccurrences(of: config.authKey, with: "[test credential]")
            .replacingOccurrences(of: "https?://[^\\s]+", with: "[URL]", options: .regularExpression)
          print("GHOSTTY_REMOTE mesh health: \(safe)")
        default: break
        }
      }
    }
    defer { monitor.cancel() }
    do {
      try await node.waitUntilRunning(timeout: .seconds(60))
      guard try await node.peer(config.hostname, waitMs: 60_000) != nil else {
        throw ProbeError.failed("host peer did not appear")
      }
      try await until("authenticated approval endpoint", seconds: 60) {
        (try? await Self.get("ready", configuration: config, node: node)) != nil
      }
      let supervisor = FreewayDesktopLink(.init(dial: {
        guard let peer = try await node.peer(config.hostname, waitMs: 10_000) else {
          throw ProbeError.failed("host peer disappeared")
        }
        return Stream(connection: try await node.dial(to: peer, port: UInt16(FreewayContract.servePort)))
      }, host: config.host, deviceId: config.deviceId, approve: {
        try await Self.get("ready", configuration: config, node: node)
      }, deviceName: label))
      let lanes = TerminalLanes(transport: FreewayLegTransport { try await supervisor.link() }, door: { sid in
        try await FreewayTerminalDoors.ticket(sid, on: supervisor.link())
      }, renewal: { sid, generation, request in
        try await FreewayTerminalDoors.renew(sid, expectGeneration: generation, requestId: request, on: supervisor.link())
      })
      let scene = TerminalScene()
      let attachment = TerminalAttachment(lanes: lanes, appearance: .default, scene: scene)
      let view = try XCTUnwrap(scene.hostedView(), scene.failure ?? "Metal unavailable")
      let surface = UIHostingController(rootView: Self.surface(scene: scene, attachment: attachment))
      attachment.attach(sessionID: config.sessionId, cols: 80, rows: 24, deviceName: "qualification host")
      parent.addChild(surface)
      surface.view.frame = frame
      surface.view.backgroundColor = .clear
      parent.view.addSubview(surface.view)
      surface.didMove(toParent: parent)
      surface.view.setNeedsLayout()
      surface.view.layoutIfNeeded()
      let client = Client(node: node, supervisor: supervisor, lanes: lanes, scene: scene,
                          attachment: attachment, view: view, surfaceController: surface, stateDirectory: state)
      do {
        try await until("\(label) live Metal terminal (\(String(describing: attachment.phase)))", seconds: 45) {
          attachment.phase == .live && attachment.acceptsInput && view.diagnostics.renderedFrames > 0
        }
        print("GHOSTTY_REMOTE \(label): live; accepted=\(view.diagnostics.acceptedFrames), rendered=\(view.diagnostics.renderedFrames)")
        return client
      } catch { await client.stop(); throw error }
    } catch { await node.stop(); try? FileManager.default.removeItem(at: state); throw error }
  }

  func send(_ marker: String, through client: Client, configuration: Configuration) async throws {
    try await until("input enabled for \(marker)") { client.attachment.acceptsInput }
    client.attachment.send(text: marker + "\r")
    try await until("PTY received \(marker)") {
      try await Self.get("status", configuration: configuration, node: client.node)["input"]?.stringValue?.contains(marker) == true
    }
  }

  func testBundledFontsMatchReviewedGolden() throws {
    let result = try GhostteaFontProof.run()
    let proof = XCTAttachment(string: result.actualJSON)
    proof.name = "Native device font parity"
    proof.lifetime = .keepAlways
    add(proof)
    XCTAssertTrue(result.passed, "Native device glyphs must match the reviewed bundled-font golden")
  }

  func testRealTruffleMetalMirrorResizeAndReconnect() async throws {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let configURL = ProcessInfo.processInfo.environment["VF_GHOSTTY_PROBE_CONFIG"].map { URL(fileURLWithPath: $0) }
      ?? documents.appendingPathComponent("ghostty-qualification.json")
    guard FileManager.default.fileExists(atPath: configURL.path) else {
      throw XCTSkip("opt-in real Truffle qualification fixture not configured")
    }
    let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: configURL))
    // Erase the short-lived test credential from this app's Documents immediately.
    try FileManager.default.removeItem(at: configURL)
    var request = URLRequest(url: URL(string: "https://login.tailscale.com")!)
    request.httpMethod = "HEAD"
    request.timeoutInterval = 10
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      print("GHOSTTY_REMOTE Internet: HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
    } catch {
      print("GHOSTTY_REMOTE Internet: \((error as NSError).domain) \((error as NSError).code)")
    }
    let window = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows).first(where: \.isKeyWindow))
    // The app host starts on HomeScreen. Covering its live Swarm CAMetalLayer
    // with an ad-hoc window subview can starve that hidden layer's drawables.
    // Give the qualification screen a normal controller lifecycle and pause
    // the displaced host's Metal views, keep the QA host paused through XCTest teardown.
    let originalRoot = try XCTUnwrap(window.rootViewController)
    @MainActor func metalViews(_ view: UIView) -> [MTKView] {
      let own = (view as? MTKView).map { [$0] } ?? []
      return own + view.subviews.flatMap { metalViews($0) }
    }
    let displaced = metalViews(originalRoot.view)
    for view in displaced { view.isPaused = true }
    let controller = UIViewController()
    controller.view.backgroundColor = .black
    window.rootViewController = controller
    window.layoutIfNeeded()
    let parent = try XCTUnwrap(controller.view)
    defer {
      window.rootViewController = originalRoot
      // This isolated test process exits after the suite. Resuming the
      // displaced Swarm during XCTest's nested teardown run loop can block
      // nextDrawable again, so keep it paused until process exit.
      for view in displaced { view.isPaused = true }
    }
    let width = parent.bounds.width
    let height = max(220, (parent.bounds.height - 120) / 2)
    let first = try await makeClient(config, label: "phone", frame: CGRect(x: 0, y: 60, width: width, height: height), parent: controller)
    var mirror: Client?
    do {
      let initial = first.view.diagnostics.acceptedFrames
      let token = "G14-" + UUID().uuidString.prefix(8)
      try await send(token + "-initial", through: first, configuration: config)
      try await until("initial input rendered") { first.view.diagnostics.acceptedFrames > initial }
      let second = try await makeClient(config, label: "mirror", frame: CGRect(x: 0, y: 60 + height, width: width, height: height), parent: controller)
      mirror = second
      try await until("mirror owns geometry and phone observes the handoff") {
        guard case .mine = second.attachment.seat?.driver,
              case .another = first.attachment.seat?.driver else { return false }
        return first.attachment.seat?.revision == second.attachment.seat?.revision
      }
      try await send("G14-DRAW-LOGO", through: second, configuration: config)
      try await Task.sleep(for: .milliseconds(300))
      print("GHOSTTY_REMOTE capture: begin")
      let image = UIGraphicsImageRenderer(bounds: parent.bounds).image { _ in
        parent.drawHierarchy(in: parent.bounds, afterScreenUpdates: false)
      }
      print("GHOSTTY_REMOTE capture: end")
      let screenshot = XCTAttachment(image: image)
      screenshot.name = "Two real Truffle clients with production Metal surfaces"
      screenshot.lifetime = .keepAlways
      add(screenshot)
      let firstFrames = first.view.diagnostics.acceptedFrames
      let mirrorFrames = second.view.diagnostics.acceptedFrames
      let firstRendered = first.view.diagnostics.renderedFrames
      let mirrorRendered = second.view.diagnostics.renderedFrames
      try await send(token + "-mirrored", through: second, configuration: config)
      try await until("both independent Metal clients advanced") {
        first.view.diagnostics.acceptedFrames > firstFrames && second.view.diagnostics.acceptedFrames > mirrorFrames
          && first.view.diagnostics.renderedFrames > firstRendered && second.view.diagnostics.renderedFrames > mirrorRendered
      }
      print("GHOSTTY_REMOTE mirror: both independent clients rendered the same PTY output")
      #if GHOSTTY_ROUTED_COPY
      for client in [first, second] {
        client.view.selectAllTerminal()
        let selection = try XCTUnwrap(client.view.selection)
        if config.selectionTextSupported == true {
          let text = try await client.attachment.selectionText(selection)
          XCTAssertTrue(text.contains(token + "-mirrored"), "copy must read the live host PTY")
          XCTAssertTrue(text.contains("中") && text.contains("é"), "Unicode copy must survive Truffle")
        } else {
          do {
            _ = try await client.attachment.selectionText(selection)
            XCTFail("an older host must report copy unavailable")
          } catch RoutedSelectionError.unsupported { }
        }
      }
      print("GHOSTTY_REMOTE copy: two production attachments passed; supported=\(config.selectionTextSupported == true)")
      // Selection colors must not obscure the later theme/opacity evidence.
      first.view.clearSelection()
      second.view.clearSelection()
      #endif

      let beforeResize = second.view.diagnostics.acceptedFrames
      second.surfaceController.view.frame.size.width = max(180, width - 75)
      second.surfaceController.view.setNeedsLayout(); second.surfaceController.view.layoutIfNeeded()
      second.attachment.engage()
      try await until("resize reseed") { second.view.diagnostics.acceptedFrames > beforeResize && second.attachment.acceptsInput }
      let measured = try XCTUnwrap(second.view.currentGridSize)
      try await until("both clients observe committed PTY geometry") {
        first.attachment.seat?.cols == Int(measured.columns)
          && second.attachment.seat?.cols == Int(measured.columns)
          && first.attachment.seat?.rows == Int(measured.rows)
          && second.attachment.seat?.rows == Int(measured.rows)
      }
      try await send(token + "-resized", through: second, configuration: config)
      print("GHOSTTY_REMOTE resize: production layout committed and input reached PTY")
      await first.attachment.detach()
      first.attachment.attach(sessionID: config.sessionId, cols: 80, rows: 24, deviceName: "qualification host")
      try await until("parked phone resumed") { first.attachment.phase == .live && first.attachment.acceptsInput }
      try await send(token + "-resumed", through: first, configuration: config)
      let oldLink = try await first.supervisor.link()
      let beforeReconnect = first.view.diagnostics.acceptedFrames
      await oldLink.close()
      await first.supervisor.wake()
      first.attachment.resumeFromForeground()
      try await until("fresh frames after connection loss", seconds: 45) {
        first.attachment.phase == .live && first.attachment.acceptsInput && first.view.diagnostics.acceptedFrames > beforeReconnect
      }
      try await send(token + "-reconnected", through: first, configuration: config)
      print("GHOSTTY_REMOTE reconnect: park/resume and a closed Freeway link recovered")
      // An idle PTY must repair without another character of output, without
      // giving up its geometry seat, and without a demand none/live workaround.
      try await Task.sleep(for: .milliseconds(300))
      let beforeRepair = first.view.diagnostics.acceptedFrames
      let seatBeforeRepair = first.attachment.seat
      first.attachment.requestFullRefresh()
      try await until("idle renderer refresh without dropping geometry", seconds: 8) {
        first.attachment.acceptsInput && first.view.diagnostics.acceptedFrames > beforeRepair
      }
      XCTAssertEqual(first.attachment.seat?.revision, seatBeforeRepair?.revision)
      print("GHOSTTY_REMOTE repair: idle scene refreshed without a geometry revision change")
      // Use the same appearance projection and SwiftUI update path as the
      // settings sheet. Capture real remote glyphs at both font sizes; the
      // offscreen bundled-font fixture is not a substitute for this path.
      for (name, theme, opacity, fontSize) in [
        ("dark-13", "Matte Black", 1.0, 13.0),
        ("light-13", "Catppuccin Latte", 1.0, 13.0),
        ("transparent-13", "Vesper", 0.4, 13.0),
        ("dark-18", "Matte Black", 1.0, 18.0),
      ] {
        var appearance = TerminalAppearance.default
        appearance.themeName = theme
        appearance.backgroundOpacity = opacity
        appearance.fontSize = fontSize
        first.attachment.apply(appearance: appearance)
        // A visible backing color makes real layer transparency observable.
        controller.view.backgroundColor = opacity < 1 ? .systemPink : .black
        first.surfaceController.rootView = Self.surface(scene: first.scene, attachment: first.attachment)
        first.surfaceController.view.setNeedsLayout()
        first.surfaceController.view.layoutIfNeeded()
        first.attachment.engage()
        try await until("appearance grid committed") {
          guard let grid = first.view.currentGridSize else { return false }
          return first.view.terminalTextMetrics.fontSizePixels == Float(fontSize)
            && first.attachment.seat?.cols == Int(grid.columns)
            && first.attachment.seat?.rows == Int(grid.rows) && first.attachment.acceptsInput
        }
        try await send("G14-DRAW-LOGO", through: first, configuration: config)
        try await Task.sleep(for: .milliseconds(300))
        capture(parent, named: "Remote appearance " + name)
        print("GHOSTTY_REMOTE appearance: \(name), metrics=\(first.view.terminalTextMetrics), grid=\(String(describing: first.view.currentGridSize))")
      }
      for client in [first, second] {
        XCTAssertGreaterThan(client.view.diagnostics.commandBufferCommits, 0)
        XCTAssertGreaterThan(client.view.diagnostics.renderedFrames, 0)
        XCTAssertNil(client.view.diagnostics.lastError)
      }
      print("GHOSTTY_REMOTE PASS: shipping surface, PTY input, two-node mirroring, resize, park/resume, redial, idle repair, Metal commands")
      await second.stop(); mirror = nil
      await first.stop()
    } catch {
      print("GHOSTTY_REMOTE original error: \(error)")
      print("GHOSTTY_REMOTE FAIL: phase=\(first.attachment.phase), accepted=\(first.view.diagnostics.acceptedFrames), rendered=\(first.view.diagnostics.renderedFrames)")
      if let mirror { await mirror.stop() }
      await first.stop()
      throw error
    }
  }
}
