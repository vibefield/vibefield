import AppKit

protocol ToolbarDelegate: AnyObject {
    func toolbarDidSelect(tool: Tool)
    func toolbarUndo()
    func toolbarSave()
    func toolbarCancel()
    func toolbarConfirm()
}

final class ToolbarView: NSView {
    weak var delegate: ToolbarDelegate?
    private(set) var selected: Tool = .none
    private let content = NSView(frame: .zero)
    private var toolButtons: [Tool: ToolbarButton] = [:]
    private var undoButton: ToolbarButton?
    private var allButtons: [ToolbarButton] = []

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.masksToBounds = false

        let items: [(Tool?, String, String, String, Selector, ToolbarButton.Kind)] = [
            (.rectangle, "rectangle", "Rectangle", "Draw a rectangle", #selector(pickRect), .tool),
            (.ellipse, "oval", "Ellipse", "Draw an ellipse", #selector(pickEllipse), .tool),
            (.arrow, "arrow.up.right", "Arrow", "Draw an arrow", #selector(pickArrow), .tool),
            (.pen, "pencil.tip", "Pen", "Draw freehand", #selector(pickPen), .tool),
            (.mosaic, "square.grid.3x3", "Mosaic", "Pixelate a region", #selector(pickMosaic), .tool),
            (nil, "arrow.uturn.backward", "Undo", "Undo last mark (⌘Z)", #selector(undo), .action),
            (nil, "square.and.arrow.down", "Save", "Save as PNG (⌘S)", #selector(save), .action),
            (nil, "xmark", "Cancel", "Cancel (Esc)", #selector(cancel), .cancel),
            (nil, "checkmark", "Done", "Copy and insert (Return)", #selector(confirm), .confirm),
        ]

        let size: CGFloat = 36
        let pad: CGFloat = 8
        let gap: CGFloat = 2
        var x: CGFloat = pad
        let height: CGFloat = 52

        func addDivider() {
            x += 8
            let divider = NSView(frame: CGRect(x: x, y: 16, width: 1, height: 20))
            divider.wantsLayer = true
            divider.layer?.backgroundColor = NSColor.separatorColor.cgColor
            content.addSubview(divider)
            x += 9
        }

        for (index, item) in items.enumerated() {
            if index == 5 || index == 7 {
                addDivider()
            }
            let button = ToolbarButton(
                kind: item.5,
                symbol: item.1,
                title: item.2,
                tip: item.3,
                frame: CGRect(x: x, y: (height - size) / 2, width: size, height: size)
            )
            button.target = self
            button.action = item.4
            if let tool = item.0 {
                toolButtons[tool] = button
            }
            if item.4 == #selector(undo) {
                undoButton = button
                button.isEnabled = false
            }
            content.addSubview(button)
            allButtons.append(button)
            x += size + gap
        }

        let width = x + pad - gap
        content.frame = NSRect(origin: .zero, size: NSSize(width: width, height: height))
        setFrameSize(NSSize(width: width, height: height))
        _ = LiquidGlass.embed(content, in: self, cornerRadius: height / 2, style: .regular)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .arrow)
    }

    override func mouseDown(with event: NSEvent) {}
    override func mouseDragged(with event: NSEvent) {}
    override func mouseUp(with event: NSEvent) {}

    func select(_ tool: Tool) {
        selected = tool
        for (candidate, button) in toolButtons {
            button.setOn(candidate == tool)
        }
    }

    func setUndoEnabled(_ enabled: Bool) {
        undoButton?.isEnabled = enabled
    }

    func pointerMoved(at pointInSuperview: CGPoint) {
        let inBar = convert(pointInSuperview, from: superview)
        let local = content.convert(inBar, from: self)
        var overControl = false
        for button in allButtons {
            let inside = button.isEnabled && button.frame.contains(local)
            button.setHovered(inside)
            if inside { overControl = true }
        }
        if bounds.contains(inBar) {
            (overControl ? NSCursor.pointingHand : NSCursor.arrow).set()
        }
    }

    func pointerExited() {
        for button in allButtons {
            button.setHovered(false)
        }
    }

    @objc private func pickRect() { pick(.rectangle) }
    @objc private func pickEllipse() { pick(.ellipse) }
    @objc private func pickArrow() { pick(.arrow) }
    @objc private func pickPen() { pick(.pen) }
    @objc private func pickMosaic() { pick(.mosaic) }
    @objc private func undo() { delegate?.toolbarUndo() }
    @objc private func save() { delegate?.toolbarSave() }
    @objc private func cancel() { delegate?.toolbarCancel() }
    @objc private func confirm() { delegate?.toolbarConfirm() }

    private func pick(_ tool: Tool) {
        select(selected == tool ? .none : tool)
        delegate?.toolbarDidSelect(tool: selected)
    }
}

final class ToolbarButton: NSButton {
    enum Kind {
        case tool
        case action
        case cancel
        case confirm
    }

    let kind: Kind
    private var isOn = false
    private var isHovered = false
    private var isPressed = false
    private let wash = CALayer()

    private enum Phase {
        case instant
        case hover
        case press
        case release
    }

    init(kind: Kind, symbol: String, title: String, tip: String, frame: CGRect) {
        self.kind = kind
        super.init(frame: frame)
        bezelStyle = .shadowlessSquare
        isBordered = false
        imagePosition = .imageOnly
        imageScaling = .scaleProportionallyDown
        focusRingType = .none
        refusesFirstResponder = true
        toolTip = tip
        setAccessibilityLabel(title)
        setAccessibilityRole(.button)
        let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
        image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)?
            .withSymbolConfiguration(config)
        wantsLayer = true
        layer?.cornerRadius = frame.height / 2
        layer?.masksToBounds = true
        wash.frame = bounds
        wash.cornerRadius = frame.height / 2
        wash.opacity = 0
        wash.backgroundColor = NSColor.labelColor.cgColor
        layer?.insertSublayer(wash, at: 0)
        applyAppearance(phase: .instant)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        wash.frame = bounds
        wash.cornerRadius = bounds.height / 2
    }

    override var isEnabled: Bool {
        didSet {
            if !isEnabled {
                isHovered = false
                isPressed = false
            }
            applyAppearance(phase: .hover)
            window?.invalidateCursorRects(for: self)
        }
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: isEnabled ? .pointingHand : .arrow)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(
            NSTrackingArea(
                rect: bounds,
                options: [.activeAlways, .mouseEnteredAndExited, .enabledDuringMouseDrag],
                owner: self,
                userInfo: nil
            )
        )
    }

    override func mouseEntered(with event: NSEvent) {
        guard isEnabled else { return }
        isHovered = true
        applyAppearance(phase: .hover)
        NSCursor.pointingHand.set()
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        isPressed = false
        applyAppearance(phase: .release)
    }

    override func mouseDown(with event: NSEvent) {
        guard isEnabled else { return }
        isPressed = true
        applyAppearance(phase: .press)
        var tracking = true
        while tracking {
            guard let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) else { break }
            let inside = bounds.contains(convert(next.locationInWindow, from: nil))
            if next.type == .leftMouseUp {
                isPressed = false
                isHovered = inside
                applyAppearance(phase: .release)
                if inside {
                    _ = sendAction(action, to: target)
                }
                tracking = false
            } else if isPressed != inside {
                isPressed = inside
                applyAppearance(phase: inside ? .press : .hover)
            }
        }
    }

    func setOn(_ on: Bool) {
        isOn = on
        applyAppearance(phase: .hover)
    }

    func setHovered(_ hovered: Bool) {
        guard isHovered != hovered else { return }
        isHovered = hovered && isEnabled
        if !isHovered { isPressed = false }
        applyAppearance(phase: hovered ? .hover : .release)
    }

    private func applyAppearance(phase: Phase) {
        let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let duration: CFTimeInterval
        if reduce || phase == .instant {
            duration = 0
        } else {
            switch phase {
            case .instant:
                duration = 0
            case .press:
                duration = 0.08
            case .hover:
                duration = 0.28
            case .release:
                duration = 0.36
            }
        }
        let curve = CAMediaTimingFunction(controlPoints: 0.33, 0.00, 0.20, 1.00)

        let ink = NSColor.labelColor
        let onInk = NSColor.windowBackgroundColor
        let red = NSColor.systemRed

        let washColor: NSColor
        let washOpacity: Float
        let tint: NSColor

        if !isEnabled {
            washColor = ink
            washOpacity = 0
            tint = .tertiaryLabelColor
        } else {
            switch kind {
            case .confirm:
                washColor = isPressed ? (ink.blended(withFraction: 0.12, of: NSColor.black) ?? ink) : ink
                washOpacity = 1
                tint = onInk
            case .cancel:
                if isPressed {
                    washColor = red
                    washOpacity = 0.16
                    tint = red
                } else if isHovered {
                    washColor = red
                    washOpacity = 0.09
                    tint = red
                } else {
                    washColor = ink
                    washOpacity = 0
                    tint = ink
                }
            case .tool, .action:
                if isOn {
                    washColor = isPressed ? (ink.blended(withFraction: 0.12, of: NSColor.black) ?? ink) : ink
                    washOpacity = 1
                    tint = onInk
                } else if isPressed {
                    washColor = ink
                    washOpacity = 0.10
                    tint = ink
                } else if isHovered {
                    washColor = ink
                    washOpacity = 0.055
                    tint = ink
                } else {
                    washColor = ink
                    washOpacity = 0
                    tint = ink
                }
            }
        }

        CATransaction.begin()
        CATransaction.setAnimationDuration(duration)
        CATransaction.setAnimationTimingFunction(curve)
        effectiveAppearance.performAsCurrentDrawingAppearance {
            wash.backgroundColor = washColor.cgColor
        }
        wash.opacity = washOpacity
        CATransaction.commit()

        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = curve
            context.allowsImplicitAnimation = true
            animator().contentTintColor = tint
            animator().alphaValue = isEnabled ? 1 : 0.36
        }
    }
}
