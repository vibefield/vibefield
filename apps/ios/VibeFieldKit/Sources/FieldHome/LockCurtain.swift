import FieldDesign
import FieldLock
import FieldSettings
import FieldSplash
import SwiftUI
import UIKit

/// WI-3 — the lock's curtain (DESIGN.md §9 "The lock", §8 "The phone's way in" as built; WI-D5, WI-D6 A, WI-L5): a
/// window of its own, over everything the phone shows. The card and every other sheet stand over the gate's splash,
/// so the gate's hold could not cover them; a window above the app's own can.
///
/// It holds the splash's own surface (`SplashField`), which draws the launch picture until its field is up, so the
/// app switcher's picture is the launch picture and a return reads as the launch. Face ID asks over it; a miss puts
/// the way in's three places on it (`FieldHomeModel.wayInScreen(.locked)`). It stands at once, so the switcher's
/// picture is taken of it, and leaves by the splash's own exit: a plain `ease` fade (half under Reduce Motion), and
/// the window and its surface go with it.
///
/// This view is only the anchor that finds the scene: it draws nothing in the home.
struct LockCurtain: UIViewRepresentable {
  let covers: Bool
  let state: FieldLock.State
  let method: LockMethod
  /// The scene's, so the surface stops drawing in the background.
  let active: Bool
  let look: PhoneAppearance
  let onUnlock: () -> Void

  /// The window's level: over the app's sheets and its alerts' own level, under the system's.
  static let level = UIWindow.Level.alert + 1
  /// The splash's exit (§8 "The phone's splash"): 240ms plain `ease`, halved under Reduce Motion.
  static let exit = 0.24

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> Anchor {
    let anchor = Anchor()
    anchor.onWindow = { [weak coordinator = context.coordinator, weak anchor] in
      guard let coordinator, let anchor else { return }
      coordinator.apply(in: anchor.window?.windowScene)
    }
    return anchor
  }

  func updateUIView(_ anchor: Anchor, context: Context) {
    context.coordinator.curtain = self
    context.coordinator.apply(in: anchor.window?.windowScene)
  }

  static func dismantleUIView(_ anchor: Anchor, coordinator: Coordinator) {
    coordinator.tearDown()
  }

  final class Anchor: UIView {
    var onWindow: (() -> Void)?

    override init(frame: CGRect) {
      super.init(frame: frame)
      isUserInteractionEnabled = false
      isAccessibilityElement = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      onWindow?()
    }
  }

  @MainActor
  final class Coordinator {
    var curtain: LockCurtain?
    private var window: UIWindow?
    private var host: UIHostingController<LockCurtainFace>?
    private var leaving: UIViewPropertyAnimator?
    /// The state the face last stood in: a miss puts the way in's places on it, and VoiceOver is told.
    private var shown: FieldLock.State?

    func apply(in scene: UIWindowScene?) {
      guard let curtain, let scene else { return }
      let face = LockCurtainFace(
        state: curtain.state, method: curtain.method, active: curtain.active, look: curtain.look,
        onUnlock: curtain.onUnlock)
      if curtain.covers {
        stand(face, in: scene)
      } else {
        leave()
      }
    }

    /// At once: the switcher takes its picture of whatever stands when the app goes to the background.
    private func stand(_ face: LockCurtainFace, in scene: UIWindowScene) {
      leaving?.stopAnimation(true)
      leaving = nil
      let missed = face.state == .missed && shown != .missed
      shown = face.state
      if let host, let window {
        host.rootView = face
        window.alpha = 1
        window.isHidden = false
        // the window was announced when it stood; a miss after iOS's ask brings the curtain its words and its
        // Unlock, and VoiceOver's focus is nowhere (iOS's sheet had it): the screen changed, so say so, once the
        // face has drawn them
        if missed {
          Task { @MainActor in UIAccessibility.post(notification: .screenChanged, argument: nil) }
        }
        return
      }
      let window = UIWindow(windowScene: scene)
      window.windowLevel = LockCurtain.level
      window.backgroundColor = .clear
      let host = UIHostingController(rootView: face)
      host.view.backgroundColor = .clear
      host.view.accessibilityViewIsModal = true
      window.rootViewController = host
      window.isHidden = false
      self.window = window
      self.host = host
      UIAccessibility.post(notification: .screenChanged, argument: host.view)
    }

    /// The splash's own exit, then the window and its surface are gone.
    private func leave() {
      guard let window, leaving == nil else { return }
      let duration = UIAccessibility.isReduceMotionEnabled ? LockCurtain.exit / 2 : LockCurtain.exit
      // plain `ease`, cubic-bezier(.25, .1, .25, 1) (§6)
      let ease = UICubicTimingParameters(
        controlPoint1: CGPoint(x: 0.25, y: 0.1), controlPoint2: CGPoint(x: 0.25, y: 1))
      let animator = UIViewPropertyAnimator(duration: duration, timingParameters: ease)
      animator.addAnimations { window.alpha = 0 }
      animator.addCompletion { [weak self] position in
        guard let self, position == .end else { return }
        self.tearDown()
      }
      leaving = animator
      animator.startAnimation()
    }

    func tearDown() {
      leaving = nil
      shown = nil
      window?.isHidden = true
      window?.rootViewController = nil
      window = nil
      host = nil
    }
  }
}

/// What the curtain shows: the splash, and over it after a miss the way in's three places with the lock's words.
struct LockCurtainFace: View {
  let state: FieldLock.State
  let method: LockMethod
  let active: Bool
  let look: PhoneAppearance
  let onUnlock: () -> Void

  var body: some View {
    ZStack {
      SplashField(active: active)
      if state == .missed {
        WayInView(
          screen: FieldHomeModel.wayInScreen(.locked(method), device: DeviceWord.current), face: nil, faceSeed: "",
          onAct: { act in if act == .unlock { onUnlock() } }
        )
        .transition(.opacity)
      }
    }
    .animation(FieldMotion.plainEase(0.24), value: state == .missed)
    .phoneAppearance(look)
  }
}
