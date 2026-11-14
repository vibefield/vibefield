#if DEBUG || VF_WEB_RELAY
  import WebKit

  // SP-4c — the script WebKit runs at the start of every document, in every frame of an app's page and in the page's
  // own world, before the page's scripts. WebRTC is left as any website has it (James, 2026-11-14 08:16:06Z, card
  // j-made-apps-webrtc: "Allow it, like any website"). Camera, microphone and WebTransport stay closed pending his
  // answer, and `sendBeacon` stays stubbed (reach, not WebRTC). The getters below also scrub a frame on the way out
  // of `contentWindow`/`contentDocument`. Item 373: this whole file compiles only in a Debug build or with SP-4d's
  // relay.

  enum WebDocumentStart {
    /// The archive check's literal web marker: the script's own source name. Used here and nowhere else.
    static let tag = "vibefield.web-host.document-start.v1"

    /// The globals removed from every frame. WebRTC's are NOT among them (James, 2026-11-14 08:16:06Z).
    static let removed = ["WebTransport"]

    static var source: String {
      let names = removed.map { "\"\($0)\"" }.joined(separator: ", ")
      return """
        (() => {
          "use strict";
          const names = [\(names)];
          const pin = (target, name, descriptor) => {
            try { delete target[name]; } catch (_) {}
            try { Object.defineProperty(target, name, { configurable: false, ...descriptor }); } catch (_) {}
          };
          const scrub = (w) => {
            try {
              for (const name of names) pin(w, name, { value: undefined, writable: false });
              const nav = w.navigator;
              if (nav) {
                pin(nav, "mediaDevices", { get: () => undefined });
                pin(nav, "sendBeacon", { value: () => false, writable: false });
              }
            } catch (_) {}
          };
          scrub(window);
          const wrap = (proto, key, toWindow) => {
            const found = Object.getOwnPropertyDescriptor(proto, key);
            if (!found || !found.get) return;
            const get = found.get;
            Object.defineProperty(proto, key, {
              configurable: false,
              enumerable: found.enumerable,
              get() {
                const value = get.call(this);
                try { const w = toWindow(value); if (w) scrub(w); } catch (_) {}
                return value;
              },
            });
          };
          wrap(HTMLIFrameElement.prototype, "contentWindow", (value) => value);
          wrap(HTMLIFrameElement.prototype, "contentDocument", (value) => value && value.defaultView);
        })();
        //# sourceURL=\(tag)
        """
    }

    @MainActor static func script() -> WKUserScript {
      WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)
    }
  }
#endif
