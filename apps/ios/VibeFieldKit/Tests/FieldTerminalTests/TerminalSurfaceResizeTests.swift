import GhostteaCore
import GhostteaTerminal
import SwiftUI
import Testing
import UIKit

@testable import FieldTerminal

/// Mount the shipping SwiftUI/Metal surface, rather than testing only the
/// settled-grid reducer. A broken callback or configuration update here leaves
/// the remote PTY at its old size even when the geometry protocol works.
@Suite(.serialized) @MainActor
struct TerminalSurfaceResizeTests {
  @Test func mountedSurfaceReportsResizeAndFontChangesAfterTheKeyboardSettles() async throws {
    let scene = TerminalScene()
    var sent: [GhostteaTerminalGridSize] = []
    var failures: [String] = []
    func surface(height: CGFloat, fontSize: Double = 13) -> some View {
      var appearance = TerminalAppearance.default
      appearance.fontSize = fontSize
      return TerminalSurface(
        scene: scene,
        visible: true,
        configuration: presentationConfig(for: appearance),
        onGridSize: { sent.append($0) },
        onRenderFailure: { failures.append($0) }
      )
      .frame(width: 360, height: height)
    }
    let host = UIHostingController(rootView: surface(height: 600))
    // A hardware app-hosted test needs a scene-connected window for SwiftUI
    // invalidations to receive display turns. A detached UIWindow happened
    // to update in the simulator but retained its first size on the phone.
    let window: UIWindow
    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
      window = UIWindow(windowScene: windowScene)
    } else {
      window = UIWindow(frame: CGRect(x: 0, y: 0, width: 360, height: 600))
    }
    window.rootViewController = host
    window.makeKeyAndVisible()
    window.layoutIfNeeded()
    host.view.layoutIfNeeded()
    defer {
      window.isHidden = true
      window.rootViewController = nil
      scene.view?.suspendGPU()
    }
    for _ in 0..<100 where sent.isEmpty && failures.isEmpty {
      try await Task.sleep(for: .milliseconds(20))
      host.view.layoutIfNeeded()
    }
    #expect(failures.isEmpty)
    let original = try #require(sent.last)
    let view = try #require(scene.view)
    #expect(original.columns > 0 && original.rows > 0)

    // Keyboard animation may measure several grids. The shipping surface must
    // withhold them until did-change, then deliver the final one to the seat.
    NotificationCenter.default.post(name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    let beforeKeyboard = sent.count
    host.rootView = surface(height: 300)
    host.view.layoutIfNeeded()
    try await Task.sleep(for: .milliseconds(100))
    host.view.layoutIfNeeded()
    #expect(try #require(view.currentGridSize).rows < original.rows)
    #expect(sent.count == beforeKeyboard)
    NotificationCenter.default.post(name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
    for _ in 0..<100 where sent.count == beforeKeyboard {
      try await Task.sleep(for: .milliseconds(20))
    }
    let keyboard = try #require(sent.last)
    #expect(keyboard.rows < original.rows)
    #expect(keyboard.columns == original.columns)

    host.rootView = surface(height: 600)
    host.view.layoutIfNeeded()
    for _ in 0..<100 where sent.last != original {
      try await Task.sleep(for: .milliseconds(20))
      host.view.layoutIfNeeded()
    }
    #expect(sent.last == original)

    host.rootView = surface(height: 600, fontSize: 18)
    host.view.layoutIfNeeded()
    for _ in 0..<100 where sent.last == original {
      try await Task.sleep(for: .milliseconds(20))
      host.view.layoutIfNeeded()
    }
    let enlarged = try #require(sent.last)
    #expect(enlarged.columns < original.columns)
    #expect(enlarged.rows < original.rows)
    #expect(scene.view === view, "configuration changes must preserve the terminal scene")
    #expect(failures.isEmpty)
  }
}
