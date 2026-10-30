import AuthenticationServices
import UIKit

/// TS-7 (TS-D11 A) — Tailscale's sign-in page, in the system's own web
/// authentication sheet.
///
/// It replaced `SafariView` (a plain `SFSafariViewController`) for the two
/// reasons the thinking doc's gap 9 names: this sheet shares Safari's cookies
/// (`prefersEphemeralWebBrowserSession` false), so a person already signed in
/// to Tailscale in Safari is one tap from done; and iOS asks first, in its own
/// words, whether VibeField may "use tailscale.com to sign in" — which the
/// welcome's last line prepares the person for.
///
/// **There is no callback.** Tailscale's page never redirects to the app: the
/// node learns the outcome from the control server, not from the browser. So
/// the session starts with no callback scheme and never completes by itself,
/// and the APP closes it when the node stops asking (`SignInSheet.step`). Only
/// a `canceledLogin` the app did not cause is the person's Cancel; anything
/// else that ends a sheet is a failure, said as one.
///
/// It is the `callbackURLScheme: nil` initializer on purpose. Its successor
/// (iOS 17.4's `callback:`) takes a callback that must be a scheme or an https
/// host the page redirects to, and this page redirects nowhere; the old one is
/// marked to-be-deprecated, not deprecated.
@MainActor
public final class TailscaleSignInSession: NSObject, ASWebAuthenticationPresentationContextProviding {
  /// How a presented sheet ended. Told once per sheet.
  public enum Ending: Equatable, Sendable {
    case personCancelled
    case closedByApp
    case failed(String)
  }

  /// The page on screen, or nil.
  public private(set) var presented: URL?
  public var onEnded: (Ending) -> Void = { _ in }

  /// The shipping sheet shares Safari's cookies. Only the spike's fixture
  /// (`-vf-demo-signin=ephemeral`) asks for a private one, to reach the page
  /// without iOS's consent alert in front of it.
  private let ephemeral: Bool
  private var session: ASWebAuthenticationSession?
  /// Which sheet is the current one. A sheet's completion can arrive after
  /// the app has closed it and opened the next, and a stale one must not end
  /// the sheet now on screen.
  private var generation = 0

  public init(ephemeral: Bool = false) {
    self.ephemeral = ephemeral
    super.init()
  }

  /// Put `url` in front of the person. A session cannot be started twice, so
  /// every page is a fresh one, and a page already up is closed first.
  public func present(_ url: URL) {
    if session != nil { close() }
    generation += 1
    let sheet = generation
    // `@Sendable`, so the closure is not inferred onto the main actor: the
    // handler type carries no isolation, and Swift 6 traps a main-actor
    // closure that the framework calls from another queue.
    let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { @Sendable [weak self] _, error in
      let ending = Self.ending(for: error)
      #if DEBUG
        print("[signin] sheet \(sheet) completed: \(error.map { String(describing: $0) } ?? "no error")")
      #endif
      Task { @MainActor in self?.ended(sheet, ending) }
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = ephemeral
    self.session = session
    presented = url
    if !session.start() {
      self.session = nil
      presented = nil
      onEnded(.failed("iOS did not open the sign-in sheet"))
    }
  }

  /// The app's own close: the node stopped asking. Said at once, so the
  /// completion the cancel may or may not bring is a stale sheet's.
  public func close() {
    guard let session else { return }
    generation += 1
    self.session = nil
    presented = nil
    session.cancel()
    onEnded(.closedByApp)
  }

  private func ended(_ sheet: Int, _ ending: Ending) {
    guard sheet == generation, session != nil else { return }
    session = nil
    presented = nil
    onEnded(ending)
  }

  /// A completion's error, read. With no callback scheme the sheet cannot
  /// complete with a URL, so "no error" is not a success either.
  nonisolated static func ending(for error: Error?) -> Ending {
    guard let error else { return .failed("the sign-in sheet ended on its own") }
    if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
      return .personCancelled
    }
    return .failed(MeshModel.shortReason(error))
  }

  public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    // With no scene there is nothing to anchor to; the session then ends with
    // `presentationContextInvalid`, which `ending(for:)` reports as a failure.
    return scene?.keyWindow ?? scene?.windows.first ?? ASPresentationAnchor()
  }
}

/// What the sign-in sheet does next, pure (pinned by `SignInSheetTests`).
///
/// It keys on the page's TRANSITIONS rather than on the phase alone: a page
/// with none up is presented; a page withdrawn while one is up closes it; a
/// different page while one is up replaces it (the ruled page's "the sheet
/// reopens with a new link", because a session cannot change its URL). And the
/// node no longer asking — approval or up — closes it whatever the page says.
public enum SignInSheet {
  public enum Step: Equatable, Sendable {
    case present(URL)
    case replace(URL)
    case close
    case keep
  }

  public static func step(page: URL?, presented: URL?, state: MeshModel.State) -> Step {
    switch state {
    case .needsMachineAuth, .up: return presented == nil ? .keep : .close
    case .off, .starting, .needsLogin, .stopping, .failed, .reconnecting: break
    }
    switch (page, presented) {
    case (nil, nil): return .keep
    case (nil, .some): return .close
    case (.some(let page), nil): return .present(page)
    case (.some(let page), .some(let presented)): return page == presented ? .keep : .replace(page)
    }
  }
}
