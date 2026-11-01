"use client";

import { useEffect, useRef } from "react";

/**
 * "Living portrait": the legator's photo animated in the browser (no vendor, nothing leaves
 * the device). A jaw band below the marked mouth point opens with the speech loudness, plus a
 * gentle breathing motion. With prefers-reduced-motion only the mouth moves (subtly).
 * Behind this component, a realistic vendor avatar can replace the canvas later.
 */
export function AvatarCanvas({
  imageUrl,
  mouth,
  eyes,
  level,
  label,
  initials,
}: {
  imageUrl: string | null;
  mouth: { x: number; y: number } | null;
  /** Eye line (per-mille of height) and half-distance (per-mille of width) around mouth.x. */
  eyes?: { y: number; spread: number } | null;
  level: () => number;
  label: string;
  initials: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("a11y-no-motion");
    const img = new Image();
    let ready = false;
    /** Skin tone just above each eye, sampled once: used to paint the eyelids when blinking. */
    let lidColors: string[] = [];
    if (imageUrl) {
      img.onload = () => {
        ready = true;
        if (eyes && mouth) {
          try {
            const off = document.createElement("canvas");
            off.width = img.width;
            off.height = img.height;
            const o = off.getContext("2d");
            o?.drawImage(img, 0, 0);
            lidColors = [-1, 1].map((side) => {
              const x = Math.round(((mouth.x + side * eyes.spread) / 1000) * img.width);
              const y = Math.round(((eyes.y - 45) / 1000) * img.height);
              const d = o?.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
              return d ? `rgb(${d[0]}, ${d[1]}, ${d[2]})` : "rgb(200,170,150)";
            });
          } catch {
            lidColors = [];
          }
        }
      };
      img.src = imageUrl;
    }
    // Natural blinking: every 2.5-6s, ~150ms (not with reduced motion).
    let nextBlink = performance.now() + 2500 + Math.random() * 3500;
    let smooth = 0;
    let frame = 0;
    const W = canvas.width;
    const H = canvas.height;

    const draw = (t: number) => {
      smooth = smooth * 0.6 + level() * 0.4;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#1d2125";
      ctx.fillRect(0, 0, W, H);

      if (ready) {
        // cover-fit the portrait
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        const breathe = reduceMotion ? 1 : 1 + Math.sin(t / 1400) * 0.006;
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(breathe, breathe);
        ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(img, dx, dy, dw, dh);

        if (eyes && mouth && lidColors.length === 2 && !reduceMotion) {
          const since = t - nextBlink;
          if (since > 0) {
            const p = since < 75 ? since / 75 : since < 150 ? 1 - (since - 75) / 75 : 0;
            if (since >= 150) nextBlink = t + 2500 + Math.random() * 3500;
            if (p > 0) {
              [-1, 1].forEach((side, i) => {
                const ex = dx + ((mouth.x + side * eyes.spread) / 1000) * dw;
                const ey = dy + (eyes.y / 1000) * dh;
                ctx.fillStyle = lidColors[i] ?? "rgb(200,170,150)";
                ctx.beginPath();
                ctx.ellipse(ex, ey - dh * 0.012 * (1 - p), dw * 0.055, dh * 0.026 * p + 0.5, 0, 0, Math.PI * 2);
                ctx.fill();
              });
            }
          }
        }

        if (mouth) {
          const mx = dx + (mouth.x / 1000) * dw;
          const my = dy + (mouth.y / 1000) * dh;
          const open = smooth * dh * (reduceMotion ? 0.012 : 0.03);
          if (open > 0.3) {
            const bandW = dw * 0.26;
            const bandH = dh * 0.16;
            const sx = (mx - dx - bandW / 2) / scale;
            const sy = (my - dy) / scale;
            // inner mouth (dark), then the jaw band drawn lower by `open` px
            ctx.fillStyle = "rgba(40, 18, 18, 0.85)";
            ctx.beginPath();
            ctx.ellipse(mx, my + open / 2, bandW * 0.22, open / 2 + 1, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(img, sx, sy, bandW / scale, bandH / scale, mx - bandW / 2, my + open, bandW, bandH);
          }
        }
        ctx.restore();
      } else {
        // No portrait (or no avatar consent): initials with a ring that pulses with the voice.
        const r = Math.min(W, H) * 0.28;
        ctx.strokeStyle = `rgba(124, 194, 173, ${0.35 + smooth * 0.65})`;
        ctx.lineWidth = 6 + smooth * 14;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r + smooth * 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#2f5d50";
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `600 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials, W / 2, H / 2);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [imageUrl, mouth, eyes, level, initials]);

  return <canvas ref={canvasRef} width={480} height={540} role="img" aria-label={label} className="avatar-canvas" />;
}
