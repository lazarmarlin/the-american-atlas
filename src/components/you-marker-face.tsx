import { useEffect, useRef } from "react";
import { paintYouMarker } from "@/lib/you-marker";

export function YouMarkerFace({ icon, color, size = 56 }: { icon: string; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintYouMarker(g, icon, color, size);
  }, [color, icon, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
