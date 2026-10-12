'use client';
import { useEffect, useRef } from 'react';

/**
 * Slow-spinning dot-matrix globe on a 2D canvas (no 3D library, well under 60 KB).
 * Paused when the user prefers reduced motion or the tab is hidden.
 */
export function Globe({ size = 360 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const points: [number, number, number][] = [];
    const N = 900;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = Math.PI * (3 - Math.sqrt(5)) * i;
      points.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let angle = 0;
    let raf = 0;
    const R = size * 0.42;
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      const c = Math.cos(angle),
        s = Math.sin(angle);
      for (const [x, y, z] of points) {
        const rx = x * c + z * s;
        const rz = -x * s + z * c;
        if (rz < -0.1) continue;
        const alpha = 0.15 + 0.6 * ((rz + 1) / 2);
        ctx.fillStyle = `rgba(20,184,166,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(size / 2 + rx * R, size / 2 - y * R, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const loop = () => {
      angle += 0.0025;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches || document.hidden) draw();
      else loop();
    };
    start();
    reduce.addEventListener('change', start);
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelAnimationFrame(raf);
      reduce.removeEventListener('change', start);
      document.removeEventListener('visibilitychange', start);
    };
  }, [size]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size, opacity: 0.55 }} />;
}
