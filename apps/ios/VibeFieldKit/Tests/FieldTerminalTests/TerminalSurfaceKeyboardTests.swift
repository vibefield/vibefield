import GhostteaTerminal
import SwiftUI
import Testing
import UIKit

@testable import FieldTerminal

/// Exercise the mounted product wrapper and Ghosttea's actual pan handler.
/// The input model alone cannot catch a renderer taking first responder
/// behind the card's back when its keyboard owner is still `.none`.
@Suite(.serialized) @MainActor
struct TerminalSurfaceKeyboardTests {
  @Test func scrollingKeepsTheKeyboardDownAndExplicitFocusStillWorks() async throws {
    let scene = TerminalScene()
    var scrolled: [Int] = []
    var failures: [String] = []
    func surface(focus: ResponderRole, epoch: Int) -> some View {
      TerminalSurface(
        scene: scene,
        visible: true,
        configuration: presentationConfig(for: .default),
        focus: focus,
        focusEpoch: epoch,
        onScrollRows: { scrolled.append($0) },
        onRenderFailure: { failures.append($0) }
      )
      .frame(width: 360, height: 500)
    }

    let host = UIHostingController(rootView: surface(focus: .release, epoch: 0))
    let windowScene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
    let previousKeyWindow = windowScene.windows.first(where: \.isKeyWindow)
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer {
      _ = scene.view?.resignFirstResponder()
      window.isHidden = true
      window.rootViewController = nil
      scene.view?.suspendGPU()
      previousKeyWindow?.makeKey()
    }
    window.layoutIfNeeded()
    host.view.layoutIfNeeded()
    try await AttachmentOverTheDoorTests.until("the terminal surface is mounted") {
      await MainActor.run { scene.view?.window === window }
    }
    let view = try #require(scene.view)
    #expect(failures.isEmpty)
    #expect(!view.isFirstResponder)

    // UIKit delivers a pan's recognized state to this Objective-C action.
    // Drive that production action with a controlled translation: a working
    // scroll must emit rows, and must not raise the software keyboard.
    let action = NSSelectorFromString("handleDirectScrollPan:")
    try #require(view.responds(to: action))
    let pan = SurfaceScrollPan()
    _ = view.perform(action, with: pan)
    #expect(!scrolled.isEmpty, "disabling scrolling is not a keyboard fix")
    #expect(!view.isFirstResponder, "a swipe must not take keyboard focus")
    pan.phase = .ended
    _ = view.perform(action, with: pan)

    // The host's explicit request (the tap/input-card path) still raises the
    // keyboard. This also proves the window can grant focus in this test.
    host.rootView = surface(focus: .take, epoch: 1)
    host.view.layoutIfNeeded()
    try await AttachmentOverTheDoorTests.until("the explicit keyboard request") {
      await MainActor.run { view.isFirstResponder }
    }
    host.rootView = surface(focus: .release, epoch: 2)
    host.view.layoutIfNeeded()
    try await AttachmentOverTheDoorTests.until("the keyboard has been dismissed") {
      await MainActor.run { !view.isFirstResponder }
    }

    let beforeSecondScroll = scrolled.count
    pan.phase = .began
    _ = view.perform(action, with: pan)
    #expect(scrolled.count > beforeSecondScroll)
    #expect(!view.isFirstResponder, "a later swipe must keep the keyboard dismissed")
    pan.phase = .ended
    _ = view.perform(action, with: pan)
    #expect(scene.view === view)
    #expect(failures.isEmpty)
  }
}

@MainActor
private final class SurfaceScrollPan: UIPanGestureRecognizer {
  var phase: UIGestureRecognizer.State = .began
  override var state: UIGestureRecognizer.State {
    get { phase }
    set { phase = newValue }
  }
  override func translation(in view: UIView?) -> CGPoint { CGPoint(x: 0, y: -80) }
  override func location(in view: UIView?) -> CGPoint { CGPoint(x: 120, y: 180) }
  override func velocity(in view: UIView?) -> CGPoint { .zero }
}
