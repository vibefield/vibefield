import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { DEFAULT_LOGO, type LogoParameters, normalizeLogo } from "./parameters";
import { LogoRenderer } from "./renderer";
import { logoSvg } from "./svg";
import "./logo.css";

export type LogoStatus = { state: "loading" | "ready" | "unavailable"; message: string };
export interface LivingLogoHandle {
  snapshot: (size?: number, transparent?: boolean) => Promise<Blob>;
}
export interface LivingLogoProps {
  parameters?: LogoParameters;
  /** Undefined follows the OS motion preference. Explicit playback is an opt-in. */
  playing?: boolean;
  transparent?: boolean;
  className?: string;
  onStatus?: (status: LogoStatus) => void;
  ref?: Ref<LivingLogoHandle>;
}

export function LivingLogo({
  parameters = DEFAULT_LOGO,
  playing,
  transparent = false,
  className = "",
  onStatus,
  ref,
}: LivingLogoProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<LogoRenderer | null>(null);
  const elapsed = useRef(0);
  const redraw = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const values = useRef({ parameters: normalizeLogo(parameters), playing, transparent, onStatus });
  useEffect(() => {
    values.current = { parameters: normalizeLogo(parameters), playing, transparent, onStatus };
    redraw.current?.();
  }, [parameters, playing, transparent, onStatus]);

  useImperativeHandle(
    ref,
    () => ({
      snapshot: async (size, alpha) => {
        if (!renderer.current)
          throw new Error("PNG export needs WebGPU. You can still export SVG.");
        return renderer.current.snapshot(values.current.parameters, elapsed.current, size, alpha);
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const startup = new AbortController();
    let disposed = false,
      visible = true,
      failed = false,
      frame = 0,
      last = 0;
    let pointer: [number, number] = [0, 0];
    const target: [number, number] = [0, 0];
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fail = (message: string) => {
      if (disposed) return;
      failed = true;
      cancelAnimationFrame(frame);
      setReady(false);
      values.current.onStatus?.({ state: "unavailable", message });
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || failed || !renderer.current || !visible || document.hidden) {
        last = 0;
        return;
      }
      const { parameters: p, playing: requested, transparent: alpha } = values.current;
      const moving = (requested ?? !motion.matches) && p.speed > 0;
      if (moving && last) elapsed.current += Math.min((now - last) / 1000, 0.05) * p.speed;
      last = moving ? now : 0;
      pointer = moving
        ? [
            pointer[0] + (target[0] - pointer[0]) * 0.065,
            pointer[1] + (target[1] - pointer[1]) * 0.065,
          ]
        : [0, 0];
      try {
        renderer.current.draw(p, elapsed.current, pointer, alpha);
      } catch (error) {
        fail(error instanceof Error ? error.message : "The GPU frame could not render.");
        return;
      }
      if (moving) frame = requestAnimationFrame(draw);
    };
    const requestDraw = () => {
      if (!frame && !disposed && !failed) frame = requestAnimationFrame(draw);
    };
    redraw.current = requestDraw;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.current?.resize(rect.width, rect.height);
      requestDraw();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
      } else requestDraw();
    });
    intersection.observe(canvas);
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (!document.hidden) requestDraw();
    };
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target[0] = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      target[1] = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
    };
    const leave = () => {
      target[0] = 0;
      target[1] = 0;
    };
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", requestDraw);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    values.current.onStatus?.({ state: "loading", message: "Preparing the light field" });
    void LogoRenderer.create(canvas, fail, startup.signal)
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        renderer.current = created;
        resize();
        setReady(true);
        values.current.onStatus?.({ state: "ready", message: "WebGPU" });
      })
      .catch((error: unknown) =>
        fail(error instanceof Error ? error.message : "WebGPU could not start."),
      );
    return () => {
      disposed = true;
      startup.abort();
      cancelAnimationFrame(frame);
      redraw.current = null;
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", requestDraw);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  return (
    <div
      className={`vf-living-logo ${className}`}
      data-renderer={ready ? "webgpu" : "static"}
      style={
        {
          "--vf-logo-background": transparent ? "transparent" : parameters.background,
        } as CSSProperties
      }
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="VibeField infinity ribbon in a spectral light field"
      />
      {!ready && (
        <img
          className="vf-living-logo__fallback"
          alt="VibeField infinity ribbon"
          src={`data:image/svg+xml,${encodeURIComponent(logoSvg(parameters))}`}
        />
      )}
    </div>
  );
}
