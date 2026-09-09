//! Antialiased overlay chrome (toolbar, badge, handles) via Direct2D.
//! Matches Mac ToolbarView symbols and Theme colors as closely as GDI+D2D allows.

use crate::annotate::Tool;
use crate::geometry::{Handle, Point, Rect};
use crate::sample::Sample;
use crate::toolbar::{self, Action};
use std::cell::RefCell;
use std::sync::OnceLock;
use windows::core::w;
use windows::Win32::Foundation::RECT as WinRect;
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_BEZIER_SEGMENT, D2D1_COLOR_F, D2D1_FIGURE_BEGIN_FILLED,
    D2D1_FIGURE_BEGIN_HOLLOW, D2D1_FIGURE_END_CLOSED, D2D1_FIGURE_END_OPEN, D2D1_PIXEL_FORMAT,
    D2D_RECT_F, D2D_SIZE_F,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1DCRenderTarget, ID2D1Factory, ID2D1SolidColorBrush, ID2D1StrokeStyle,
    D2D1_ANTIALIAS_MODE_PER_PRIMITIVE, D2D1_ARC_SEGMENT, D2D1_ARC_SIZE_SMALL, D2D1_CAP_STYLE_ROUND,
    D2D1_DASH_STYLE_SOLID, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_ELLIPSE,
    D2D1_FACTORY_TYPE_MULTI_THREADED, D2D1_FEATURE_LEVEL_DEFAULT, D2D1_LINE_JOIN_ROUND,
    D2D1_RENDER_TARGET_PROPERTIES, D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1_RENDER_TARGET_USAGE_NONE,
    D2D1_ROUNDED_RECT, D2D1_STROKE_STYLE_PROPERTIES, D2D1_SWEEP_DIRECTION_COUNTER_CLOCKWISE,
    D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, IDWriteTextFormat, DWRITE_FACTORY_TYPE_SHARED,
    DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_MEDIUM,
    DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_MEASURING_MODE_NATURAL, DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
    DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_TEXT_ALIGNMENT_TRAILING,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::HDC;
use windows_numerics::Vector2;

const HANDLE_SIZE: f64 = 8.0;
const RING: f32 = 1.5;
const ICON: f32 = 1.65;

pub const LOUPE_CARD_W: f64 = 167.0;
pub const LOUPE_CARD_H: f64 = 220.0;
pub const LOUPE_PAD: f64 = 10.0;
pub const LOUPE_FOOTER: f64 = 63.0;
pub const LOUPE_RADIUS: f64 = 8.0;
pub const LOUPE_SAMPLE: u32 = 21;

pub fn loupe_zoom_rect(origin: Point) -> Rect {
    Rect::from_xywh(
        origin.x + LOUPE_PAD,
        origin.y + LOUPE_PAD,
        LOUPE_CARD_W - LOUPE_PAD * 2.0,
        LOUPE_CARD_H - LOUPE_FOOTER - LOUPE_PAD,
    )
}

pub struct Scene {
    pub view: Rect,
    pub selection: Option<Rect>,
    pub hover: Option<Rect>,
    pub dragging: bool,
    pub tool: Tool,
    pub undo_enabled: bool,
    pub pointer: Point,
    pub pressed: Option<Action>,
}

pub fn paint(hdc: HDC, width: i32, height: i32, scene: &Scene) -> bool {
    match paint_d2d(hdc, width, height, scene) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("overlay chrome: {error}");
            false
        }
    }
}

struct DrawScope<'a> {
    target: &'a ID2D1DCRenderTarget,
    finished: bool,
}

impl<'a> DrawScope<'a> {
    fn begin(target: &'a ID2D1DCRenderTarget) -> Self {
        unsafe {
            target.BeginDraw();
            target.SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
            target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
        }
        Self {
            target,
            finished: false,
        }
    }

    fn finish(mut self) -> Result<(), String> {
        self.finished = true;
        unsafe {
            self.target
                .EndDraw(None, None)
                .map_err(|error| format!("EndDraw: {error}"))
        }
    }
}

impl Drop for DrawScope<'_> {
    fn drop(&mut self) {
        if !self.finished {
            let _ = unsafe { self.target.EndDraw(None, None) };
        }
    }
}

struct TargetCache {
    target: ID2D1DCRenderTarget,
    width: i32,
    height: i32,
}

thread_local! {
    static TARGET: RefCell<Option<TargetCache>> = const { RefCell::new(None) };
}

fn with_dc_target<T>(
    hdc: HDC,
    width: i32,
    height: i32,
    body: impl FnOnce(&ID2D1DCRenderTarget) -> Result<T, String>,
) -> Result<T, String> {
    let factory = d2d_factory()?;
    TARGET.with(|slot| {
        let mut slot = slot.borrow_mut();
        let reuse = slot
            .as_ref()
            .is_some_and(|cache| cache.width == width && cache.height == height);
        if !reuse {
            *slot = Some(TargetCache {
                target: create_dc_target(factory)?,
                width,
                height,
            });
        }
        let rect = WinRect {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        };
        {
            let target = &slot.as_ref().unwrap().target;
            if unsafe { target.BindDC(hdc, &rect) }.is_err() {
                *slot = Some(TargetCache {
                    target: create_dc_target(factory)?,
                    width,
                    height,
                });
                unsafe {
                    slot.as_ref()
                        .unwrap()
                        .target
                        .BindDC(hdc, &rect)
                        .map_err(|error| format!("BindDC: {error}"))?;
                }
            }
        }
        body(&slot.as_ref().unwrap().target)
    })
}

fn paint_d2d(hdc: HDC, width: i32, height: i32, scene: &Scene) -> Result<(), String> {
    let factory = d2d_factory()?;
    let stroke = round_stroke()?;
    let text = text_format()?;
    with_dc_target(hdc, width, height, |target| {
        let scope = DrawScope::begin(target);
        if let Some(selection) = scene.selection {
            draw_ring(target, selection)?;
            if !scene.dragging {
                draw_handles(target, stroke, selection)?;
            }
            draw_badge(target, text, selection, scene.view)?;
            if !scene.dragging {
                draw_toolbar(target, factory, stroke, scene, selection)?;
            }
        } else if let Some(hover) = scene.hover {
            draw_ring(target, hover)?;
        }
        scope.finish()
    })
}

fn d2d_factory() -> Result<&'static ID2D1Factory, String> {
    static FACTORY: OnceLock<Option<ID2D1Factory>> = OnceLock::new();
    FACTORY
        .get_or_init(|| unsafe { D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, None).ok() })
        .as_ref()
        .ok_or_else(|| "D2D1CreateFactory failed".into())
}

fn dwrite_factory() -> Result<&'static IDWriteFactory, String> {
    static FACTORY: OnceLock<Option<IDWriteFactory>> = OnceLock::new();
    FACTORY
        .get_or_init(|| unsafe { DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).ok() })
        .as_ref()
        .ok_or_else(|| "DWriteCreateFactory failed".into())
}

fn text_format() -> Result<&'static IDWriteTextFormat, String> {
    static FORMAT: OnceLock<Option<IDWriteTextFormat>> = OnceLock::new();
    FORMAT
        .get_or_init(|| {
            make_text_format(
                w!("Segoe UI"),
                DWRITE_FONT_WEIGHT_MEDIUM,
                11.0,
                DWRITE_TEXT_ALIGNMENT_CENTER,
            )
            .ok()
        })
        .as_ref()
        .ok_or_else(|| "CreateTextFormat failed".into())
}

fn create_dc_target(factory: &ID2D1Factory) -> Result<ID2D1DCRenderTarget, String> {
    let props = D2D1_RENDER_TARGET_PROPERTIES {
        r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
        pixelFormat: D2D1_PIXEL_FORMAT {
            format: DXGI_FORMAT_B8G8R8A8_UNORM,
            alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
        },
        dpiX: 96.0,
        dpiY: 96.0,
        usage: D2D1_RENDER_TARGET_USAGE_NONE,
        minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
    };
    unsafe {
        factory
            .CreateDCRenderTarget(&props)
            .map_err(|error| format!("CreateDCRenderTarget: {error}"))
    }
}

fn round_stroke() -> Result<&'static ID2D1StrokeStyle, String> {
    static STROKE: OnceLock<Option<ID2D1StrokeStyle>> = OnceLock::new();
    STROKE
        .get_or_init(|| {
            let factory = d2d_factory().ok()?;
            let props = D2D1_STROKE_STYLE_PROPERTIES {
                startCap: D2D1_CAP_STYLE_ROUND,
                endCap: D2D1_CAP_STYLE_ROUND,
                dashCap: D2D1_CAP_STYLE_ROUND,
                lineJoin: D2D1_LINE_JOIN_ROUND,
                miterLimit: 10.0,
                dashStyle: D2D1_DASH_STYLE_SOLID,
                dashOffset: 0.0,
            };
            unsafe { factory.CreateStrokeStyle(&props, None).ok() }
        })
        .as_ref()
        .ok_or_else(|| "CreateStrokeStyle failed".into())
}

fn brush(
    target: &ID2D1DCRenderTarget,
    color: D2D1_COLOR_F,
) -> Result<ID2D1SolidColorBrush, String> {
    unsafe {
        target
            .CreateSolidColorBrush(&color, None)
            .map_err(|error| format!("CreateSolidColorBrush: {error}"))
    }
}

fn rgba(r: u8, g: u8, b: u8, a: f32) -> D2D1_COLOR_F {
    D2D1_COLOR_F {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        a,
    }
}

fn pt(x: f32, y: f32) -> Vector2 {
    Vector2 { X: x, Y: y }
}

fn rounded(rect: Rect, radius: f32) -> D2D1_ROUNDED_RECT {
    D2D1_ROUNDED_RECT {
        rect: d2d_rect(rect),
        radiusX: radius,
        radiusY: radius,
    }
}

fn d2d_rect(rect: Rect) -> D2D_RECT_F {
    D2D_RECT_F {
        left: rect.min_x() as f32,
        top: rect.min_y() as f32,
        right: rect.max_x() as f32,
        bottom: rect.max_y() as f32,
    }
}

fn draw_ring(target: &ID2D1DCRenderTarget, rect: Rect) -> Result<(), String> {
    let select = brush(target, rgba(74, 144, 217, 1.0))?;
    let inset = rect.inset(0.5, 0.5);
    unsafe {
        target.DrawRectangle(&d2d_rect(inset), &select, RING, None);
    }
    Ok(())
}

fn draw_handles(
    target: &ID2D1DCRenderTarget,
    stroke: &ID2D1StrokeStyle,
    selection: Rect,
) -> Result<(), String> {
    let fill = brush(target, rgba(255, 255, 255, 1.0))?;
    let select = brush(target, rgba(74, 144, 217, 1.0))?;
    for handle in Handle::ALL {
        let box_rect = handle.rect(selection, HANDLE_SIZE);
        let rr = rounded(box_rect, 3.0);
        unsafe {
            target.FillRoundedRectangle(&rr, &fill);
            target.DrawRoundedRectangle(&rr, &select, 1.0, stroke);
        }
    }
    Ok(())
}

fn draw_badge(
    target: &ID2D1DCRenderTarget,
    format: &IDWriteTextFormat,
    selection: Rect,
    view: Rect,
) -> Result<(), String> {
    let label = format!(
        "{} × {}",
        selection.width.round() as i32,
        selection.height.round() as i32
    );
    let width = (label.len() as f32 * 7.1 + 20.0).max(60.0);
    let height = 24.0;
    let mut x = selection.min_x() as f32;
    let mut y = selection.min_y() as f32 - height - 8.0;
    if y < 8.0 {
        y = selection.max_y() as f32 + 8.0;
    }
    if x + width > view.max_x() as f32 - 8.0 {
        x = view.max_x() as f32 - width - 8.0;
    }
    x = x.max(8.0);
    if y + height > view.max_y() as f32 - 8.0 {
        y = view.max_y() as f32 - height - 8.0;
    }

    let chrome = brush(target, rgba(28, 28, 30, 0.90))?;
    let hairline = brush(target, rgba(255, 255, 255, 0.10))?;
    let ink = brush(target, rgba(255, 255, 255, 0.92))?;
    let rr = D2D1_ROUNDED_RECT {
        rect: D2D_RECT_F {
            left: x,
            top: y,
            right: x + width,
            bottom: y + height,
        },
        radiusX: 12.0,
        radiusY: 12.0,
    };
    unsafe {
        target.FillRoundedRectangle(&rr, &chrome);
        target.DrawRoundedRectangle(&rr, &hairline, 1.0, None);
        let mut wide: Vec<u16> = label.encode_utf16().collect();
        target.DrawText(
            &wide,
            format,
            &rr.rect,
            &ink,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
        wide.clear();
    }
    Ok(())
}

fn draw_toolbar(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    stroke: &ID2D1StrokeStyle,
    scene: &Scene,
    selection: Rect,
) -> Result<(), String> {
    let origin = toolbar::layout_origin(selection, scene.view);
    let frame = toolbar::frame(origin);
    let chrome = brush(target, rgba(28, 28, 30, 0.92))?;
    let hairline = brush(target, rgba(255, 255, 255, 0.12))?;
    let divider = brush(target, rgba(255, 255, 255, 0.14))?;
    let rr = rounded(frame, (toolbar::HEIGHT / 2.0) as f32);
    unsafe {
        target.FillRoundedRectangle(&rr, &chrome);
        target.DrawRoundedRectangle(&rr, &hairline, 1.0, None);
    }
    for x in toolbar::divider_xs() {
        let left = (origin.x + x) as f32 + 0.5;
        unsafe {
            target.DrawLine(
                pt(left, origin.y as f32 + 16.0),
                pt(left, origin.y as f32 + 36.0),
                &divider,
                1.0,
                None,
            );
        }
    }

    let hover = if scene.dragging {
        None
    } else {
        toolbar::hit(origin, scene.pointer)
    };

    for (index, action) in toolbar::items().iter().enumerate() {
        let x = origin.x + toolbar::button_offset(index);
        let y = origin.y + (toolbar::HEIGHT - toolbar::BUTTON) / 2.0;
        let selected = matches!(action, Action::Tool(tool) if *tool == scene.tool);
        let disabled = matches!(action, Action::Undo) && !scene.undo_enabled;
        let hovered = hover == Some(*action);
        let pressed = scene.pressed == Some(*action);
        draw_button(
            target,
            factory,
            stroke,
            *action,
            x as f32,
            y as f32,
            toolbar::BUTTON as f32,
            selected,
            disabled,
            hovered,
            pressed,
        )?;
    }
    Ok(())
}

// A Direct2D draw call: target, factory, stroke style and the geometry the
// button is drawn at. The arity is the drawing API's, not ours.
#[allow(clippy::too_many_arguments)]
fn draw_button(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    stroke: &ID2D1StrokeStyle,
    action: Action,
    x: f32,
    y: f32,
    size: f32,
    selected: bool,
    disabled: bool,
    hovered: bool,
    pressed: bool,
) -> Result<(), String> {
    let cx = x + size / 2.0;
    let cy = y + size / 2.0;
    let confirm = matches!(action, Action::Confirm);
    let on = selected || confirm;
    if on {
        let fill = brush(
            target,
            rgba(255, 255, 255, if pressed { 0.88 } else { 1.0 }),
        )?;
        fill_circle(target, cx, cy, size / 2.0, &fill);
    } else if !disabled && (pressed || hovered) {
        let alpha = if pressed { 0.12 } else { 0.07 };
        let wash = if matches!(action, Action::Cancel) {
            brush(target, rgba(255, 69, 58, if pressed { 0.18 } else { 0.10 }))?
        } else {
            brush(target, rgba(255, 255, 255, alpha))?
        };
        fill_circle(target, cx, cy, size / 2.0, &wash);
    }

    let ink = if disabled {
        rgba(255, 255, 255, 0.32)
    } else if on {
        rgba(28, 28, 30, 1.0)
    } else if matches!(action, Action::Cancel) && hovered {
        rgba(255, 69, 58, 0.95)
    } else {
        rgba(255, 255, 255, 0.90)
    };
    let brush = brush(target, ink)?;
    draw_icon(target, factory, stroke, &brush, action, x, y, size)?;
    Ok(())
}

fn fill_circle(
    target: &ID2D1DCRenderTarget,
    cx: f32,
    cy: f32,
    radius: f32,
    fill: &ID2D1SolidColorBrush,
) {
    let ellipse = D2D1_ELLIPSE {
        point: pt(cx, cy),
        radiusX: radius,
        radiusY: radius,
    };
    unsafe {
        target.FillEllipse(&ellipse, fill);
    }
}

// Same shape as draw_button, one level down: the icon's own geometry.
#[allow(clippy::too_many_arguments)]
fn draw_icon(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    stroke: &ID2D1StrokeStyle,
    ink: &ID2D1SolidColorBrush,
    action: Action,
    x: f32,
    y: f32,
    size: f32,
) -> Result<(), String> {
    let s = |nx: f32, ny: f32| pt(x + nx * size, y + ny * size);
    match action {
        Action::Tool(Tool::Rectangle) | Action::Tool(Tool::None) => {
            let rr = D2D1_ROUNDED_RECT {
                rect: D2D_RECT_F {
                    left: x + size * 0.28,
                    top: y + size * 0.30,
                    right: x + size * 0.72,
                    bottom: y + size * 0.70,
                },
                radiusX: size * 0.06,
                radiusY: size * 0.06,
            };
            unsafe {
                target.DrawRoundedRectangle(&rr, ink, ICON, stroke);
            }
        }
        Action::Tool(Tool::Ellipse) => {
            let ellipse = D2D1_ELLIPSE {
                point: pt(x + size * 0.50, y + size * 0.50),
                radiusX: size * 0.22,
                radiusY: size * 0.18,
            };
            unsafe {
                target.DrawEllipse(&ellipse, ink, ICON, stroke);
            }
        }
        Action::Tool(Tool::Arrow) => {
            unsafe {
                target.DrawLine(s(0.30, 0.70), s(0.68, 0.32), ink, ICON, stroke);
            }
            fill_poly(
                target,
                factory,
                ink,
                &[s(0.70, 0.30), s(0.52, 0.33), s(0.67, 0.48)],
            )?;
        }
        Action::Tool(Tool::Pen) => draw_pen(target, factory, stroke, ink, x, y, size)?,
        Action::Tool(Tool::Mosaic) => draw_mosaic(target, ink, x, y, size),
        Action::Undo => draw_undo(target, factory, stroke, ink, x, y, size)?,
        Action::Save => draw_save(target, factory, stroke, ink, x, y, size)?,
        Action::Cancel => unsafe {
            target.DrawLine(s(0.33, 0.33), s(0.67, 0.67), ink, ICON, stroke);
            target.DrawLine(s(0.67, 0.33), s(0.33, 0.67), ink, ICON, stroke);
        },
        Action::Confirm => unsafe {
            target.DrawLine(s(0.30, 0.52), s(0.44, 0.66), ink, ICON + 0.15, stroke);
            target.DrawLine(s(0.44, 0.66), s(0.72, 0.36), ink, ICON + 0.15, stroke);
        },
    }
    Ok(())
}

fn draw_pen(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    stroke: &ID2D1StrokeStyle,
    ink: &ID2D1SolidColorBrush,
    x: f32,
    y: f32,
    size: f32,
) -> Result<(), String> {
    let s = |nx: f32, ny: f32| pt(x + nx * size, y + ny * size);
    // pencil.tip: slender outline pointing up-right, wood cut + ferrule.
    let tip = s(0.29, 0.73);
    let left_shoulder = s(0.33, 0.63);
    let right_shoulder = s(0.39, 0.69);
    let left_ferrule = s(0.55, 0.42);
    let right_ferrule = s(0.60, 0.48);
    let left_end = s(0.63, 0.33);
    let right_end = s(0.69, 0.39);

    let geo = unsafe {
        factory
            .CreatePathGeometry()
            .map_err(|error| format!("pen path: {error}"))?
    };
    let sink = unsafe { geo.Open().map_err(|error| format!("pen open: {error}"))? };
    unsafe {
        sink.BeginFigure(tip, D2D1_FIGURE_BEGIN_HOLLOW);
        sink.AddLine(left_shoulder);
        sink.AddLine(left_ferrule);
        sink.AddLine(left_end);
        sink.AddLine(right_end);
        sink.AddLine(right_ferrule);
        sink.AddLine(right_shoulder);
        sink.EndFigure(D2D1_FIGURE_END_CLOSED);
        sink.Close()
            .map_err(|error| format!("pen close: {error}"))?;
        target.DrawGeometry(&geo, ink, ICON, stroke);
        target.DrawLine(left_shoulder, right_shoulder, ink, ICON - 0.2, stroke);
        target.DrawLine(left_ferrule, right_ferrule, ink, ICON - 0.2, stroke);
    }
    Ok(())
}

fn draw_mosaic(
    target: &ID2D1DCRenderTarget,
    ink: &ID2D1SolidColorBrush,
    x: f32,
    y: f32,
    size: f32,
) {
    // square.grid.3x3 — filled cells read as pixelate/redact at 36px.
    let n = 3;
    let cell = size * 0.118;
    let gap = size * 0.038;
    let total = n as f32 * cell + (n - 1) as f32 * gap;
    let origin_x = x + (size - total) / 2.0;
    let origin_y = y + (size - total) / 2.0;
    let radius = (cell * 0.22).max(0.7);
    for row in 0..n {
        for col in 0..n {
            let left = origin_x + col as f32 * (cell + gap);
            let top = origin_y + row as f32 * (cell + gap);
            let rr = D2D1_ROUNDED_RECT {
                rect: D2D_RECT_F {
                    left,
                    top,
                    right: left + cell,
                    bottom: top + cell,
                },
                radiusX: radius,
                radiusY: radius,
            };
            unsafe {
                target.FillRoundedRectangle(&rr, ink);
            }
        }
    }
}

fn draw_undo(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    stroke: &ID2D1StrokeStyle,
    ink: &ID2D1SolidColorBrush,
    x: f32,
    y: f32,
    size: f32,
) -> Result<(), String> {
    let s = |nx: f32, ny: f32| pt(x + nx * size, y + ny * size);
    // Counterclockwise 3/4-circle + stroke chevron. Reads as undo, not ↵.
    let cx = 0.50;
    let cy = 0.52;
    let r = 0.20;
    let k = 0.552_284_8 * r;
    let geo = unsafe {
        factory
            .CreatePathGeometry()
            .map_err(|error| format!("undo path: {error}"))?
    };
    let sink = unsafe { geo.Open().map_err(|error| format!("undo open: {error}"))? };
    let bez = |p1: Vector2, p2: Vector2, p3: Vector2| D2D1_BEZIER_SEGMENT {
        point1: p1,
        point2: p2,
        point3: p3,
    };
    unsafe {
        sink.BeginFigure(s(cx - r, cy), D2D1_FIGURE_BEGIN_HOLLOW);
        sink.AddBezier(&bez(s(cx - r, cy + k), s(cx - k, cy + r), s(cx, cy + r)));
        sink.AddBezier(&bez(s(cx + k, cy + r), s(cx + r, cy + k), s(cx + r, cy)));
        sink.AddBezier(&bez(s(cx + r, cy - k), s(cx + k, cy - r), s(cx, cy - r)));
        sink.EndFigure(D2D1_FIGURE_END_OPEN);
        sink.Close()
            .map_err(|error| format!("undo close: {error}"))?;
        target.DrawGeometry(&geo, ink, ICON, stroke);
        target.DrawLine(
            s(cx, cy - r - 0.09),
            s(cx - 0.14, cy - r),
            ink,
            ICON,
            stroke,
        );
        target.DrawLine(
            s(cx - 0.14, cy - r),
            s(cx, cy - r + 0.09),
            ink,
            ICON,
            stroke,
        );
    }
    Ok(())
}

fn draw_save(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    stroke: &ID2D1StrokeStyle,
    ink: &ID2D1SolidColorBrush,
    x: f32,
    y: f32,
    size: f32,
) -> Result<(), String> {
    let s = |nx: f32, ny: f32| pt(x + nx * size, y + ny * size);
    // square.and.arrow.down: open-top rounded square, arrow dropping through the gap.
    let geo = unsafe {
        factory
            .CreatePathGeometry()
            .map_err(|error| format!("save path: {error}"))?
    };
    let sink = unsafe { geo.Open().map_err(|error| format!("save open: {error}"))? };
    let corner = size * 0.055;
    let arc = |end: Vector2| D2D1_ARC_SEGMENT {
        point: end,
        size: D2D_SIZE_F {
            width: corner,
            height: corner,
        },
        rotationAngle: 0.0,
        sweepDirection: D2D1_SWEEP_DIRECTION_COUNTER_CLOCKWISE,
        arcSize: D2D1_ARC_SIZE_SMALL,
    };
    unsafe {
        sink.BeginFigure(s(0.41, 0.44), D2D1_FIGURE_BEGIN_HOLLOW);
        sink.AddLine(s(0.33, 0.44));
        sink.AddArc(&arc(s(0.28, 0.49)));
        sink.AddLine(s(0.28, 0.67));
        sink.AddArc(&arc(s(0.33, 0.72)));
        sink.AddLine(s(0.67, 0.72));
        sink.AddArc(&arc(s(0.72, 0.67)));
        sink.AddLine(s(0.72, 0.49));
        sink.AddArc(&arc(s(0.67, 0.44)));
        sink.AddLine(s(0.59, 0.44));
        sink.EndFigure(D2D1_FIGURE_END_OPEN);
        sink.Close()
            .map_err(|error| format!("save close: {error}"))?;
        target.DrawGeometry(&geo, ink, ICON, stroke);
        target.DrawLine(s(0.50, 0.26), s(0.50, 0.56), ink, ICON, stroke);
    }
    fill_poly(
        target,
        factory,
        ink,
        &[s(0.50, 0.64), s(0.39, 0.50), s(0.61, 0.50)],
    )
}

fn fill_poly(
    target: &ID2D1DCRenderTarget,
    factory: &ID2D1Factory,
    ink: &ID2D1SolidColorBrush,
    points: &[Vector2],
) -> Result<(), String> {
    if points.len() < 3 {
        return Ok(());
    }
    let geo = unsafe {
        factory
            .CreatePathGeometry()
            .map_err(|error| format!("poly: {error}"))?
    };
    let sink = unsafe { geo.Open().map_err(|error| format!("poly open: {error}"))? };
    unsafe {
        sink.BeginFigure(points[0], D2D1_FIGURE_BEGIN_FILLED);
        for point in &points[1..] {
            sink.AddLine(*point);
        }
        sink.EndFigure(D2D1_FIGURE_END_CLOSED);
        sink.Close()
            .map_err(|error| format!("poly close: {error}"))?;
        target.FillGeometry(&geo, ink, None);
    }
    Ok(())
}

pub fn paint_loupe_card(hdc: HDC, width: i32, height: i32, origin: Point) -> bool {
    paint_loupe_pass(hdc, width, height, origin, None, true).is_ok()
}

pub fn paint_loupe_chrome(
    hdc: HDC,
    width: i32,
    height: i32,
    origin: Point,
    sample: Option<&Sample>,
) -> bool {
    paint_loupe_pass(hdc, width, height, origin, sample, false).is_ok()
}

fn paint_loupe_pass(
    hdc: HDC,
    width: i32,
    height: i32,
    origin: Point,
    sample: Option<&Sample>,
    card_only: bool,
) -> Result<(), String> {
    with_dc_target(hdc, width, height, |target| {
        let scope = DrawScope::begin(target);
        if card_only {
            draw_loupe_card(target, origin)?;
        } else {
            draw_loupe_zoom_chrome(target, origin)?;
            draw_loupe_info(target, origin, sample)?;
        }
        scope.finish()
    })
}

fn draw_loupe_card(target: &ID2D1DCRenderTarget, origin: Point) -> Result<(), String> {
    let chrome = brush(target, rgba(28, 28, 30, 0.92))?;
    let hairline = brush(target, rgba(255, 255, 255, 0.12))?;
    let rr = D2D1_ROUNDED_RECT {
        rect: D2D_RECT_F {
            left: origin.x as f32,
            top: origin.y as f32,
            right: (origin.x + LOUPE_CARD_W) as f32,
            bottom: (origin.y + LOUPE_CARD_H) as f32,
        },
        radiusX: 18.0,
        radiusY: 18.0,
    };
    unsafe {
        target.FillRoundedRectangle(&rr, &chrome);
        target.DrawRoundedRectangle(&rr, &hairline, 1.0, None);
    }
    Ok(())
}

fn draw_loupe_zoom_chrome(target: &ID2D1DCRenderTarget, origin: Point) -> Result<(), String> {
    let zoom = loupe_zoom_rect(origin);
    let clip = d2d_rect(zoom);
    unsafe {
        target.PushAxisAlignedClip(&clip, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    }

    let grid = brush(target, rgba(255, 255, 255, 0.14))?;
    let cell = zoom.width as f32 / LOUPE_SAMPLE as f32;
    let left = zoom.min_x() as f32;
    let top = zoom.min_y() as f32;
    let right = zoom.max_x() as f32;
    let bottom = zoom.max_y() as f32;
    for i in 0..=LOUPE_SAMPLE {
        let o = i as f32 * cell;
        unsafe {
            target.DrawLine(pt(left + o, top), pt(left + o, bottom), &grid, 0.5, None);
            target.DrawLine(pt(left, top + o), pt(right, top + o), &grid, 0.5, None);
        }
    }

    let mid_x = (zoom.min_x() + zoom.max_x()) as f32 / 2.0;
    let mid_y = (zoom.min_y() + zoom.max_y()) as f32 / 2.0;
    let axis_shadow = brush(target, rgba(0, 0, 0, 0.28))?;
    let axis = brush(target, rgba(255, 255, 255, 0.92))?;
    unsafe {
        target.DrawLine(pt(mid_x, top), pt(mid_x, bottom), &axis_shadow, 2.0, None);
        target.DrawLine(pt(left, mid_y), pt(right, mid_y), &axis_shadow, 2.0, None);
        target.DrawLine(pt(mid_x, top), pt(mid_x, bottom), &axis, 1.0, None);
        target.DrawLine(pt(left, mid_y), pt(right, mid_y), &axis, 1.0, None);
    }

    let select = brush(target, rgba(74, 144, 217, 1.0))?;
    let box_rect = D2D_RECT_F {
        left: mid_x - cell / 2.0 + 0.5,
        top: mid_y - cell / 2.0 + 0.5,
        right: mid_x + cell / 2.0 - 0.5,
        bottom: mid_y + cell / 2.0 - 0.5,
    };
    unsafe {
        target.DrawRectangle(&box_rect, &select, RING, None);
        target.PopAxisAlignedClip();
    }
    Ok(())
}

fn draw_loupe_info(
    target: &ID2D1DCRenderTarget,
    origin: Point,
    sample: Option<&Sample>,
) -> Result<(), String> {
    let label_fmt = cached_format(
        0,
        w!("Segoe UI"),
        DWRITE_FONT_WEIGHT_SEMI_BOLD,
        9.0,
        DWRITE_TEXT_ALIGNMENT_LEADING,
    )?;
    let value_fmt = cached_format(
        1,
        w!("Consolas"),
        DWRITE_FONT_WEIGHT_MEDIUM,
        10.0,
        DWRITE_TEXT_ALIGNMENT_LEADING,
    )?;
    let key_fmt = cached_format(
        2,
        w!("Consolas"),
        DWRITE_FONT_WEIGHT_MEDIUM,
        9.0,
        DWRITE_TEXT_ALIGNMENT_TRAILING,
    )?;
    let label_ink = brush(target, rgba(255, 255, 255, 0.40))?;
    let value_ink = brush(target, rgba(255, 255, 255, 0.90))?;
    let key_ink = brush(target, rgba(255, 255, 255, 0.28))?;

    let pos = sample
        .map(crate::sample::pos_text)
        .unwrap_or_else(|| "—".into());
    let rgb = sample
        .map(crate::sample::rgb_text)
        .unwrap_or_else(|| "—".into());
    let hex = sample
        .map(crate::sample::hex_text)
        .unwrap_or_else(|| "—".into());
    let rows = [("POS", pos, "1"), ("RGB", rgb, "2"), ("HEX", hex, "3")];

    let x = origin.x as f32;
    let y0 = (origin.y + LOUPE_PAD + (LOUPE_CARD_H - LOUPE_FOOTER - LOUPE_PAD) + 8.0) as f32;
    for (index, (label, value, key)) in rows.iter().enumerate() {
        let top = y0 + index as f32 * 15.0;
        let bottom = top + 15.0;
        draw_run(
            target,
            label_fmt,
            label,
            D2D_RECT_F {
                left: x + 10.0,
                top,
                right: x + 42.0,
                bottom,
            },
            &label_ink,
        );
        draw_run(
            target,
            value_fmt,
            value,
            D2D_RECT_F {
                left: x + 44.0,
                top,
                right: x + LOUPE_CARD_W as f32 - 26.0,
                bottom,
            },
            &value_ink,
        );
        draw_run(
            target,
            key_fmt,
            key,
            D2D_RECT_F {
                left: x + LOUPE_CARD_W as f32 - 28.0,
                top,
                right: x + LOUPE_CARD_W as f32 - 10.0,
                bottom,
            },
            &key_ink,
        );
    }
    Ok(())
}

fn cached_format(
    slot: usize,
    family: windows::core::PCWSTR,
    weight: windows::Win32::Graphics::DirectWrite::DWRITE_FONT_WEIGHT,
    size: f32,
    align: windows::Win32::Graphics::DirectWrite::DWRITE_TEXT_ALIGNMENT,
) -> Result<&'static IDWriteTextFormat, String> {
    static SLOTS: [OnceLock<Option<IDWriteTextFormat>>; 3] =
        [OnceLock::new(), OnceLock::new(), OnceLock::new()];
    SLOTS
        .get(slot)
        .ok_or_else(|| "text format slot".to_string())?
        .get_or_init(|| make_text_format(family, weight, size, align).ok())
        .as_ref()
        .ok_or_else(|| "CreateTextFormat failed".into())
}

fn make_text_format(
    family: windows::core::PCWSTR,
    weight: windows::Win32::Graphics::DirectWrite::DWRITE_FONT_WEIGHT,
    size: f32,
    align: windows::Win32::Graphics::DirectWrite::DWRITE_TEXT_ALIGNMENT,
) -> Result<IDWriteTextFormat, String> {
    let factory = dwrite_factory()?;
    let format = unsafe {
        factory
            .CreateTextFormat(
                family,
                None,
                weight,
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                size,
                w!("en-us"),
            )
            .map_err(|error| format!("CreateTextFormat: {error}"))?
    };
    let _ = unsafe { format.SetTextAlignment(align) };
    let _ = unsafe { format.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER) };
    Ok(format)
}

fn draw_run(
    target: &ID2D1DCRenderTarget,
    format: &IDWriteTextFormat,
    text: &str,
    rect: D2D_RECT_F,
    ink: &ID2D1SolidColorBrush,
) {
    let wide: Vec<u16> = text.encode_utf16().collect();
    unsafe {
        target.DrawText(
            &wide,
            format,
            &rect,
            ink,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Rect;
    use std::ptr::null_mut;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, GetDC, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    #[test]
    fn preview_toolbar_looks_like_mac_bar() {
        let width = 420u32;
        let height = 100u32;
        unsafe {
            let screen = GetDC(None);
            assert!(!screen.is_invalid());
            let mem = CreateCompatibleDC(Some(screen));
            let mut bits = null_mut();
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let dib = CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0)
                .expect("dib");
            ReleaseDC(None, screen);
            assert!(!bits.is_null());
            let pixels =
                std::slice::from_raw_parts_mut(bits as *mut u8, (width * height * 4) as usize);
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[0] = 42;
                pixel[1] = 42;
                pixel[2] = 48;
                pixel[3] = 255;
            }
            let old = SelectObject(mem, dib.into());
            let scene = Scene {
                view: Rect::from_xywh(0.0, 0.0, width as f64, height as f64),
                selection: Some(Rect::from_xywh(16.0, 6.0, 220.0, 18.0)),
                hover: None,
                dragging: false,
                tool: Tool::Rectangle,
                undo_enabled: true,
                pointer: Point { x: -1.0, y: -1.0 },
                pressed: None,
            };
            assert!(paint(mem, width as i32, height as i32, &scene));
            SelectObject(mem, old);
            let _ = DeleteDC(mem);
            let path = std::env::temp_dir().join("vibefield-chrome-preview.png");
            crate::png::write_bgra(&path, width, height, pixels).expect("png");
            assert!(path.exists());
        }
    }

    #[test]
    fn preview_loupe_matches_mac_layout() {
        let width = 220u32;
        let height = 260u32;
        unsafe {
            let screen = GetDC(None);
            assert!(!screen.is_invalid());
            let mem = CreateCompatibleDC(Some(screen));
            let mut bits = null_mut();
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let dib = CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0)
                .expect("dib");
            ReleaseDC(None, screen);
            let pixels =
                std::slice::from_raw_parts_mut(bits as *mut u8, (width * height * 4) as usize);
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[0] = 230;
                pixel[1] = 230;
                pixel[2] = 230;
                pixel[3] = 255;
            }
            let old = SelectObject(mem, dib.into());
            let origin = Point { x: 20.0, y: 20.0 };
            assert!(paint_loupe_card(mem, width as i32, height as i32, origin));
            let zoom = loupe_zoom_rect(origin);
            let (zx, zy, zw, zh) = zoom.to_i32();
            for y in zy..(zy + zh) {
                for x in zx..(zx + zw) {
                    if x < 0 || y < 0 {
                        continue;
                    }
                    let i = ((y as u32 * width + x as u32) * 4) as usize;
                    if i + 3 >= pixels.len() {
                        continue;
                    }
                    let cell_x = ((x - zx) as f32 / zw as f32 * 21.0) as i32;
                    let cell_y = ((y - zy) as f32 / zh as f32 * 21.0) as i32;
                    let lite = (cell_x + cell_y) % 2 == 0;
                    let v = if lite { 255u8 } else { 210 };
                    pixels[i] = v;
                    pixels[i + 1] = v;
                    pixels[i + 2] = v;
                    pixels[i + 3] = 255;
                }
            }
            let sample = crate::sample::Sample {
                x: 2017,
                y: 720,
                r: 255,
                g: 255,
                b: 255,
            };
            assert!(paint_loupe_chrome(
                mem,
                width as i32,
                height as i32,
                origin,
                Some(&sample)
            ));
            SelectObject(mem, old);
            let _ = DeleteDC(mem);
            let path = std::env::temp_dir().join("vibefield-loupe-preview.png");
            crate::png::write_bgra(&path, width, height, pixels).expect("png");
            assert!(path.exists());
        }
    }
}
