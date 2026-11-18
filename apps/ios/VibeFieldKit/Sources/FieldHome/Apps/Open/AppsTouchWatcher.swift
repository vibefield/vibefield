#if DEBUG || VF_WEB_RELAY
  import UIKit
  import UIKit.UIGestureRecognizerSubclass

  /// Item 523 — that the person touched the page, never where: the instant a touch begins and the instant the last
  /// finger lifts, and then it fails, so it never takes a touch from the page. It keeps no point, no view and no
  /// target: two callbacks and a count of fingers down.
  final class AppsTouchWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private var began: (() -> Void)?
    private var lifted: (() -> Void)?
    private var fingers = 0

    /// One watcher: it takes no touch, delays none, and stands beside every other recognizer.
    static func make(began: @escaping () -> Void, lifted: @escaping () -> Void) -> AppsTouchWatcher {
      let watcher = AppsTouchWatcher(target: nil, action: nil)
      watcher.began = began
      watcher.lifted = lifted
      watcher.cancelsTouchesInView = false
      watcher.delaysTouchesBegan = false
      watcher.delaysTouchesEnded = false
      watcher.delegate = watcher
      return watcher
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
      fingers += touches.count
      began?()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
      off(touches.count)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
      off(touches.count)
    }

    override func reset() {
      super.reset()
      fingers = 0
    }

    /// Never in another recognizer's way.
    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
      true
    }

    private func off(_ count: Int) {
      fingers = max(0, fingers - count)
      guard fingers == 0 else { return }
      lifted?()
      state = .failed
    }
  }
#endif
