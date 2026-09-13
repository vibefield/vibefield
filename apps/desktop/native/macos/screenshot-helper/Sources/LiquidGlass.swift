import AppKit

/// AppKit Liquid Glass (macOS 26's glass effect view), with a within-window
/// visual-effect fallback so the chrome still samples the freeze on older OS.
///
/// SNAP-D8 — the glass class is resolved by NAME at runtime and driven by
/// key-value coding, never named at compile time: the helper has to build
/// against any macOS ≥ 14 SDK (CI runners sit on 15, this machine on 26), and a
/// compile-time reference would pin it to the newest SDK for a chrome nicety.
enum LiquidGlass {
    enum Style: Int {
        case regular = 0
        case clear = 1
    }

    /// The runtime class, or nil when this system has no glass.
    private static func glassViewClass() -> NSView.Type? {
        NSClassFromString("NSGlassEffectView") as? NSView.Type
    }

    /// A configured glass view wrapping `content`, or nil on a system without
    /// the class. Callers own layout; this only sets the glass properties.
    static func makeGlassView(
        frame: NSRect,
        cornerRadius: CGFloat,
        style: Style,
        content: NSView
    ) -> NSView? {
        guard #available(macOS 26.0, *), let glassClass = glassViewClass() else { return nil }
        let glass = glassClass.init(frame: frame)
        glass.setValue(cornerRadius, forKey: "cornerRadius")
        glass.setValue(style.rawValue, forKey: "style")
        glass.setValue(content, forKey: "contentView")
        return glass
    }

    @discardableResult
    static func embed(
        _ content: NSView,
        in host: NSView,
        cornerRadius: CGFloat,
        style: Style = .regular
    ) -> NSView {
        content.translatesAutoresizingMaskIntoConstraints = true
        content.frame = host.bounds
        content.autoresizingMask = [.width, .height]
        if let glass = makeGlassView(
            frame: host.bounds,
            cornerRadius: cornerRadius,
            style: style,
            content: content
        ) {
            glass.autoresizingMask = [.width, .height]
            host.addSubview(glass)
            return glass
        }

        content.translatesAutoresizingMaskIntoConstraints = false
        let effect = NSVisualEffectView(frame: .zero)
        effect.material = .hudWindow
        effect.blendingMode = .withinWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = cornerRadius
        effect.layer?.masksToBounds = true
        effect.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(effect)
        effect.addSubview(content)
        NSLayoutConstraint.activate([
            effect.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            effect.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            effect.topAnchor.constraint(equalTo: host.topAnchor),
            effect.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            content.topAnchor.constraint(equalTo: effect.topAnchor),
            content.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])
        return effect
    }
}
