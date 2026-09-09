import AppKit

enum MagnifierCopyField: Equatable {
    case pos
    case rgb
    case hex
}

final class MagnifierView: NSView {
    static let pad: CGFloat = 10
    static let cardRadius: CGFloat = 18
    static let loupeRadius: CGFloat = 8
    static let cardSize = NSSize(width: 167, height: 220)

    private let canvas = MagnifierCanvas()
    private let chrome: NSView

    var snapshot: CGImage? {
        get { canvas.snapshot }
        set {
            canvas.snapshot = newValue
            canvas.needsDisplay = true
        }
    }

    var viewSize: CGSize {
        get { canvas.viewSize }
        set {
            canvas.viewSize = newValue
            canvas.needsDisplay = true
        }
    }

    var focus: CGPoint {
        get { canvas.focus }
        set {
            canvas.focus = newValue
            canvas.needsDisplay = true
        }
    }

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { false }

    override init(frame frameRect: NSRect) {
        // SNAP-D8 — the glass class is resolved by name at runtime inside
        // LiquidGlass, so this file compiles against any macOS >= 14 SDK.
        if let glass = LiquidGlass.makeGlassView(
            frame: frameRect,
            cornerRadius: MagnifierView.cardRadius,
            style: .regular,
            content: canvas
        ) {
            chrome = glass
        } else {
            let effect = NSVisualEffectView(frame: frameRect)
            effect.material = .hudWindow
            effect.blendingMode = .withinWindow
            effect.state = .active
            effect.wantsLayer = true
            effect.layer?.cornerRadius = MagnifierView.cardRadius
            effect.layer?.masksToBounds = true
            effect.addSubview(canvas)
            chrome = effect
        }
        super.init(frame: frameRect)
        wantsLayer = true
        addSubview(chrome)
        layoutChrome()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        layoutChrome()
    }

    override func layout() {
        super.layout()
        layoutChrome()
    }

    func setSample(x: Int, y: Int, color: NSColor) {
        canvas.pixelX = x
        canvas.pixelY = y
        canvas.color = color
        canvas.needsDisplay = true
    }

    func copyField(_ field: MagnifierCopyField) {
        let text: String
        switch field {
        case .pos: text = canvas.posValue
        case .rgb: text = canvas.rgbValue
        case .hex: text = canvas.hexValue
        }
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        canvas.flash(field)
    }

    private func layoutChrome() {
        chrome.frame = bounds
        canvas.frame = bounds
        canvas.needsDisplay = true
    }
}

private final class MagnifierCanvas: NSView {
    var snapshot: CGImage?
    var viewSize: CGSize = .zero
    var focus: CGPoint = .zero
    var color: NSColor = .black
    var pixelX = 0
    var pixelY = 0
    private let sample = 21
    private let pad = MagnifierView.pad
    private let gap: CGFloat = 8
    private let rowHeight: CGFloat = 15
    private var footerHeight: CGFloat { pad + rowHeight * 3 + gap }
    private var copied: MagnifierCopyField?
    private var copyToken = UUID()

    var posValue: String { "\(pixelX), \(pixelY)" }
    var rgbValue: String {
        let c = sRGB
        return "\(c.r), \(c.g), \(c.b)"
    }
    var hexValue: String {
        let c = sRGB
        return String(format: "#%02X%02X%02X", c.r, c.g, c.b)
    }

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { false }

    func flash(_ field: MagnifierCopyField) {
        copied = field
        let token = UUID()
        copyToken = token
        needsDisplay = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
            guard let self, self.copyToken == token else { return }
            self.copied = nil
            self.needsDisplay = true
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let snapshot, bounds.width > 8, bounds.height > 8 else { return }

        let scaleX = CGFloat(snapshot.width) / max(viewSize.width, 1)
        let scaleY = CGFloat(snapshot.height) / max(viewSize.height, 1)
        let px = focus.x * scaleX
        let py = (viewSize.height - focus.y) * scaleY
        let half = CGFloat(sample) / 2
        let src = CGRect(
            x: px - half,
            y: py - half,
            width: CGFloat(sample),
            height: CGFloat(sample)
        )
        let loupe = NSRect(
            x: pad,
            y: footerHeight,
            width: bounds.width - pad * 2,
            height: bounds.height - footerHeight - pad
        )
        guard loupe.width > 1, loupe.height > 1 else { return }

        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(roundedRect: loupe, xRadius: MagnifierView.loupeRadius, yRadius: MagnifierView.loupeRadius).addClip()
        if let cropped = snapshot.cropping(to: src.integral) {
            NSImage(cgImage: cropped, size: NSSize(width: sample, height: sample)).draw(
                in: loupe,
                from: .zero,
                operation: .copy,
                fraction: 1
            )
        }

        let cell = loupe.width / CGFloat(sample)
        NSColor.labelColor.withAlphaComponent(0.14).setStroke()
        let grid = NSBezierPath()
        for i in 0...sample {
            let o = CGFloat(i) * cell
            grid.move(to: CGPoint(x: loupe.minX + o, y: loupe.minY))
            grid.line(to: CGPoint(x: loupe.minX + o, y: loupe.maxY))
            grid.move(to: CGPoint(x: loupe.minX, y: loupe.minY + o))
            grid.line(to: CGPoint(x: loupe.maxX, y: loupe.minY + o))
        }
        grid.lineWidth = 0.5
        grid.stroke()

        drawAxes(in: loupe)

        let center = CGRect(
            x: loupe.midX - cell / 2,
            y: loupe.midY - cell / 2,
            width: cell,
            height: cell
        )
        Theme.select.setStroke()
        let box = NSBezierPath(rect: center.insetBy(dx: 0.5, dy: 0.5))
        box.lineWidth = Theme.ringWidth
        box.stroke()
        NSGraphicsContext.restoreGraphicsState()

        drawInfo()
    }

    private func drawAxes(in loupe: NSRect) {
        let vertical = NSBezierPath()
        vertical.move(to: CGPoint(x: loupe.midX, y: loupe.minY))
        vertical.line(to: CGPoint(x: loupe.midX, y: loupe.maxY))
        let horizontal = NSBezierPath()
        horizontal.move(to: CGPoint(x: loupe.minX, y: loupe.midY))
        horizontal.line(to: CGPoint(x: loupe.maxX, y: loupe.midY))

        NSColor.black.withAlphaComponent(0.28).setStroke()
        vertical.lineWidth = 2
        horizontal.lineWidth = 2
        vertical.stroke()
        horizontal.stroke()

        NSColor.white.withAlphaComponent(0.92).setStroke()
        vertical.lineWidth = 1
        horizontal.lineWidth = 1
        vertical.stroke()
        horizontal.stroke()
    }

    private func drawInfo() {
        let rows: [(MagnifierCopyField, String, String, String)] = [
            (.pos, "POS", posValue, "1"),
            (.rgb, "RGB", rgbValue, "2"),
            (.hex, "HEX", hexValue, "3"),
        ]
        let labelFont = NSFont.systemFont(ofSize: 9, weight: .semibold)
        let valueFont = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium)
        let keyFont = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .medium)
        let valueX = pad + 34

        for (index, row) in rows.enumerated() {
            let y = footerHeight - gap - rowHeight * CGFloat(index + 1) + 2
            let flashed = copied == row.0
            let labelColor: NSColor = flashed ? .systemGreen : .tertiaryLabelColor
            let valueColor: NSColor = flashed ? .labelColor : .secondaryLabelColor
            let keyText = flashed ? "copied" : row.3
            let keyColor: NSColor = flashed ? .systemGreen : .quaternaryLabelColor

            NSAttributedString(string: row.1, attributes: [
                .font: labelFont,
                .foregroundColor: labelColor,
                .kern: 0.6,
            ]).draw(at: CGPoint(x: pad, y: y))

            NSAttributedString(string: row.2, attributes: [
                .font: valueFont,
                .foregroundColor: valueColor,
            ]).draw(at: CGPoint(x: valueX, y: y))

            let key = NSAttributedString(string: keyText, attributes: [
                .font: keyFont,
                .foregroundColor: keyColor,
            ])
            key.draw(at: CGPoint(x: bounds.width - pad - key.size().width, y: y))
        }
    }

    private var sRGB: (r: Int, g: Int, b: Int) {
        let rgb = color.usingColorSpace(.sRGB) ?? color
        return (
            Int((rgb.redComponent * 255).rounded()),
            Int((rgb.greenComponent * 255).rounded()),
            Int((rgb.blueComponent * 255).rounded())
        )
    }
}
