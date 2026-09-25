import AppKit

@MainActor
protocol OverlayViewDelegate: AnyObject {
    func overlayDidCancel()
    func overlayDidConfirm(_ view: OverlayView)
    func overlayDidRequestSave(_ view: OverlayView, image: CGImage)
}

final class OverlayView: NSView {
    weak var delegate: OverlayViewDelegate?

    let snapshot: DisplaySnapshot
    private let detector: WindowDetector
    private let nsImage: NSImage

    private var mode: Mode = .hover
    private var hoverWindow: DetectedWindow?
    private(set) var selection: CGRect?
    private var dragStart: CGPoint = .zero
    private var dragCurrent: CGPoint = .zero
    private var movingSelection = false
    private var activeHandle: Handle?
    private var lastMouse: CGPoint = .zero
    private var annotations: [Annotation] = []
    private var currentAnnotation: Annotation?
    private var tool: Tool = .none
    private var spaceHeld = false

    private let magnifier = MagnifierView(frame: .zero)
    private let toolbar = ToolbarView(frame: .zero)
    private let sizeBadge = SizeBadgeView(frame: .zero)

    private enum Mode {
        case hover
        case dragging
        case selected
        case annotating
    }

    init(snapshot: DisplaySnapshot, detector: WindowDetector) {
        self.snapshot = snapshot
        self.detector = detector
        self.nsImage = NSImage(
            cgImage: snapshot.image,
            size: snapshot.screenFrame.size
        )
        super.init(frame: NSRect(origin: .zero, size: snapshot.screenFrame.size))
        wantsLayer = true
        addSubview(magnifier)
        addSubview(toolbar)
        addSubview(sizeBadge)
        toolbar.delegate = self
        toolbar.isHidden = true
        sizeBadge.isHidden = true
        magnifier.snapshot = snapshot.image
        magnifier.viewSize = snapshot.screenFrame.size
        updateMagnifier(at: NSPoint(x: bounds.midX, y: bounds.midY))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { false }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
        window?.acceptsMouseMovedEvents = true
        resetCursorRects()
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .crosshair)
        if !toolbar.isHidden {
            addCursorRect(toolbar.frame, cursor: .arrow)
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(
            NSTrackingArea(
                rect: bounds,
                options: [.activeAlways, .mouseMoved, .mouseEnteredAndExited, .inVisibleRect],
                owner: self,
                userInfo: nil
            )
        )
    }

    override func draw(_ dirtyRect: NSRect) {
        nsImage.draw(in: bounds)

        Theme.dim.setFill()
        bounds.fill()

        if let selection {
            nsImage.draw(in: selection, from: selection, operation: .copy, fraction: 1)
            drawSelectionChrome(selection)
        } else if let hover = hoverWindow {
            let rect = Geometry.viewRect(fromCGWindowFrame: hover.frame, screenFrame: snapshot.screenFrame)
                .intersection(bounds)
            if !rect.isNull, rect.width > 2, rect.height > 2 {
                nsImage.draw(in: rect, from: rect, operation: .copy, fraction: 1)
                Theme.select.setStroke()
                let path = NSBezierPath(rect: rect.insetBy(dx: 0.5, dy: 0.5))
                path.lineWidth = Theme.ringWidth
                path.stroke()
            }
        }

        if let context = NSGraphicsContext.current {
            let imageSize = CGSize(width: snapshot.image.width, height: snapshot.image.height)
            for annotation in annotations {
                annotation.draw(in: context, image: snapshot.image, viewSize: bounds.size, imageSize: imageSize)
            }
            currentAnnotation?.draw(in: context, image: snapshot.image, viewSize: bounds.size, imageSize: imageSize)
        }
    }

    private func drawSelectionChrome(_ rect: CGRect) {
        Theme.select.setStroke()
        let border = NSBezierPath(rect: rect.insetBy(dx: 0.5, dy: 0.5))
        border.lineWidth = Theme.ringWidth
        border.stroke()

        Theme.handleFill.setFill()
        Theme.select.setStroke()
        for handle in Handle.allCases {
            let box = handle.rect(in: rect)
            let path = NSBezierPath(roundedRect: box, xRadius: 3, yRadius: 3)
            path.lineWidth = 1
            path.fill()
            path.stroke()
        }
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        lastMouse = point
        updateMagnifier(at: point)
        if mode == .hover {
            let next = detector.window(atCGPoint: cgPoint(forViewPoint: point))
            if next?.windowID != hoverWindow?.windowID {
                hoverWindow = next
                needsDisplay = true
            }
        }
        updateHandleCursor(at: point)
    }

    override func mouseExited(with event: NSEvent) {
        toolbar.pointerExited()
        super.mouseExited(with: event)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        lastMouse = point
        window?.makeKeyAndOrderFront(nil)
        window?.makeFirstResponder(self)

        if !toolbar.isHidden, toolbar.frame.contains(point) {
            return
        }

        if event.clickCount == 2, selection != nil, tool == .none {
            confirm()
            return
        }

        if let selection, tool == .none, let handle = Handle.allCases.first(where: { $0.rect(in: selection).insetBy(dx: -3, dy: -3).contains(point) }) {
            activeHandle = handle
            dragStart = point
            return
        }

        if let selection, tool == .none, selection.contains(point) {
            movingSelection = true
            dragStart = point
            return
        }

        if let selection, tool != .none, selection.contains(point) {
            mode = .annotating
            currentAnnotation = Annotation(
                tool: tool,
                start: point,
                end: point,
                points: [point],
                color: Theme.mark,
                lineWidth: tool == .pen ? 3 : 2
            )
            return
        }

        mode = .dragging
        dragStart = point
        dragCurrent = point
        hoverWindow = nil
        annotations = []
        currentAnnotation = nil
        toolbar.setUndoEnabled(false)
        toolbar.isHidden = true
        sizeBadge.isHidden = true
        window?.invalidateCursorRects(for: self)
        selection = nil
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        lastMouse = point
        updateMagnifier(at: point)

        if let handle = activeHandle, var selection {
            handle.cursor.set()
            let delta = CGPoint(x: point.x - dragStart.x, y: point.y - dragStart.y)
            selection = handle.apply(to: selection, delta: delta, bounds: bounds)
            self.selection = selection
            dragStart = point
            layoutToolbar()
            needsDisplay = true
            return
        }

        if movingSelection, var selection {
            let delta = CGPoint(x: point.x - dragStart.x, y: point.y - dragStart.y)
            selection.origin.x += delta.x
            selection.origin.y += delta.y
            self.selection = Geometry.clamp(selection, to: bounds)
            dragStart = point
            layoutToolbar()
            needsDisplay = true
            return
        }

        if mode == .annotating, var annotation = currentAnnotation {
            annotation.end = point
            if annotation.tool == .pen {
                annotation.points.append(point)
            }
            currentAnnotation = annotation
            needsDisplay = true
            return
        }

        if mode == .dragging {
            if spaceHeld, let selection {
                let delta = CGPoint(x: point.x - dragCurrent.x, y: point.y - dragCurrent.y)
                var moved = selection
                moved.origin.x += delta.x
                moved.origin.y += delta.y
                self.selection = Geometry.clamp(moved, to: bounds)
                dragStart.x += delta.x
                dragStart.y += delta.y
            } else {
                selection = Geometry.normalizedRect(from: dragStart, to: point).intersection(bounds)
            }
            dragCurrent = point
            if let selection {
                layoutSizeBadge(for: selection)
            }
            needsDisplay = true
        }
    }

    override func mouseUp(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        activeHandle = nil
        movingSelection = false

        if mode == .annotating, let annotation = currentAnnotation {
            annotations.append(annotation)
            currentAnnotation = nil
            mode = .selected
            toolbar.setUndoEnabled(true)
            needsDisplay = true
            return
        }

        if mode == .dragging {
            let rect = Geometry.normalizedRect(from: dragStart, to: point).intersection(bounds)
            if rect.width < 4, rect.height < 4, let hover = hoverAtClick(point) {
                selection = Geometry.viewRect(fromCGWindowFrame: hover.frame, screenFrame: snapshot.screenFrame)
                    .intersection(bounds)
            } else if rect.width >= 4, rect.height >= 4 {
                selection = rect
            } else {
                mode = .hover
                selection = nil
                toolbar.isHidden = true
                sizeBadge.isHidden = true
                window?.invalidateCursorRects(for: self)
                needsDisplay = true
                return
            }
            finishSelection()
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        delegate?.overlayDidCancel()
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 49 {
            spaceHeld = true
            return
        }
        if !magnifier.isHidden, let key = event.charactersIgnoringModifiers {
            switch key {
            case "1":
                magnifier.copyField(.pos)
                return
            case "2":
                magnifier.copyField(.rgb)
                return
            case "3":
                magnifier.copyField(.hex)
                return
            default:
                break
            }
        }
        switch event.keyCode {
        case 53: // esc
            delegate?.overlayDidCancel()
        case 36, 76: // return
            if selection != nil { confirm() }
        case 6 where event.modifierFlags.contains(.command): // cmd+z
            undo()
        case 1 where event.modifierFlags.contains(.command): // cmd+s
            toolbarSave()
        case 126: nudge(0, 1, event)
        case 125: nudge(0, -1, event)
        case 123: nudge(-1, 0, event)
        case 124: nudge(1, 0, event)
        default:
            super.keyDown(with: event)
        }
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49 {
            spaceHeld = false
        } else {
            super.keyUp(with: event)
        }
    }

    private func nudge(_ dx: CGFloat, _ dy: CGFloat, _ event: NSEvent) {
        guard var selection else { return }
        let step: CGFloat = event.modifierFlags.contains(.shift) ? 10 : 1
        selection.origin.x += dx * step
        selection.origin.y += dy * step
        self.selection = Geometry.clamp(selection, to: bounds)
        layoutToolbar()
        needsDisplay = true
    }

    private func hoverAtClick(_ point: CGPoint) -> DetectedWindow? {
        detector.window(atCGPoint: cgPoint(forViewPoint: point))
    }

    func cgPoint(forViewPoint point: CGPoint) -> CGPoint {
        Geometry.viewPointToCG(point, screenFrame: snapshot.screenFrame)
    }

    private func finishSelection() {
        mode = .selected
        toolbar.isHidden = false
        magnifier.isHidden = true
        sizeBadge.isHidden = false
        toolbar.setUndoEnabled(!annotations.isEmpty)
        layoutToolbar()
        window?.invalidateCursorRects(for: self)
        needsDisplay = true
    }

    private func layoutToolbar() {
        guard let selection else { return }
        let size = toolbar.frame.size
        var origin = CGPoint(x: selection.minX, y: selection.minY - size.height - 8)
        if origin.y < 8 {
            origin.y = selection.maxY + 8
        }
        if origin.x + size.width > bounds.maxX - 8 {
            origin.x = bounds.maxX - size.width - 8
        }
        if origin.x < 8 { origin.x = 8 }
        toolbar.setFrameOrigin(origin)
        layoutSizeBadge(for: selection)
    }

    private func layoutSizeBadge(for rect: CGRect) {
        sizeBadge.set(size: rect.size)
        var origin = CGPoint(x: rect.minX, y: rect.maxY + 8)
        if origin.y + sizeBadge.frame.height > bounds.maxY - 8 {
            origin.y = rect.minY - sizeBadge.frame.height - 8
        }
        if origin.x + sizeBadge.frame.width > bounds.maxX - 8 {
            origin.x = bounds.maxX - sizeBadge.frame.width - 8
        }
        if origin.x < 8 { origin.x = 8 }
        sizeBadge.setFrameOrigin(origin)
    }

    private func updateMagnifier(at point: CGPoint) {
        guard mode == .hover || mode == .dragging else {
            magnifier.isHidden = true
            return
        }
        magnifier.isHidden = false
        magnifier.focus = point
        let scaleX = CGFloat(snapshot.image.width) / max(bounds.width, 1)
        let scaleY = CGFloat(snapshot.image.height) / max(bounds.height, 1)
        let px = Int((point.x * scaleX).rounded(.down))
        let py = Int(((bounds.height - point.y) * scaleY).rounded(.down))
        magnifier.setSample(
            x: px,
            y: py,
            color: ScreenCapture.pixelColor(in: snapshot.image, atPixelX: px, y: py) ?? .black
        )
        let size = MagnifierView.cardSize
        var origin = CGPoint(x: point.x + 20, y: point.y - size.height - 20)
        if origin.x + size.width > bounds.maxX { origin.x = point.x - size.width - 20 }
        if origin.y < 0 { origin.y = point.y + 20 }
        magnifier.frame = NSRect(origin: origin, size: size)
    }

    private func updateHandleCursor(at point: CGPoint) {
        if !toolbar.isHidden, toolbar.frame.contains(point) {
            toolbar.pointerMoved(at: point)
            return
        }
        toolbar.pointerExited()
        if let selection, tool == .none, let handle = Handle.allCases.first(where: { $0.rect(in: selection).insetBy(dx: -3, dy: -3).contains(point) }) {
            handle.cursor.set()
        } else if let selection, tool == .none, selection.contains(point) {
            NSCursor.openHand.set()
        } else {
            NSCursor.crosshair.set()
        }
    }

    func undo() {
        guard !annotations.isEmpty else { return }
        annotations.removeLast()
        toolbar.setUndoEnabled(!annotations.isEmpty)
        needsDisplay = true
    }

    func confirm() {
        guard selection != nil else { return }
        delegate?.overlayDidConfirm(self)
    }

    func renderedImage() -> CGImage? {
        guard let selection else { return nil }
        return ImageCompositor.composite(
            snapshot: snapshot.image,
            selection: selection,
            viewSize: bounds.size,
            annotations: annotations
        )
    }
}

extension OverlayView: ToolbarDelegate {
    func toolbarDidSelect(tool: Tool) {
        self.tool = tool
        if tool == .none {
            mode = .selected
        }
    }

    func toolbarUndo() { undo() }

    func toolbarSave() {
        guard let image = renderedImage() else { return }
        delegate?.overlayDidRequestSave(self, image: image)
    }

    func toolbarCancel() { delegate?.overlayDidCancel() }
    func toolbarConfirm() { confirm() }
}
