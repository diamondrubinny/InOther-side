"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { Dialog } from "./Dialog";
import { Button, Checkbox } from "./ui";

interface A11yPrefs {
  scale: number;
  contrast: boolean;
  links: boolean;
  readable: boolean;
  noMotion: boolean;
}

const DEFAULTS: A11yPrefs = { scale: 1, contrast: false, links: false, readable: false, noMotion: false };
const STORAGE_KEY = "inother_a11y";

function apply(p: A11yPrefs) {
  const root = document.documentElement;
  root.style.setProperty("--font-scale", String(p.scale));
  root.classList.toggle("a11y-contrast", p.contrast);
  root.classList.toggle("a11y-links", p.links);
  root.classList.toggle("a11y-readable", p.readable);
  root.classList.toggle("a11y-no-motion", p.noMotion);
}

/**
 * Accessibility adjustments menu. This is an aid, NOT a replacement for accessible code:
 * the site itself is built to WCAG 2.1 AA (semantics, keyboard, contrast, labels).
 * Preferences are stored only in this browser (localStorage), never sent to the server.
 */
export function AccessibilityMenu() {
  const { messages } = useI18n();
  const t = messages.a11y;
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULTS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = { ...DEFAULTS, ...(JSON.parse(saved) as Partial<A11yPrefs>) };
        setPrefs(parsed);
        apply(parsed);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const update = (next: A11yPrefs) => {
    setPrefs(next);
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <Button variant="secondary" small onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span aria-hidden="true">♿</span> {t.open}
      </Button>
      <Dialog open={open} title={t.title} onClose={() => setOpen(false)}>
        <div className="stack">
          <div className="row" role="group" aria-label={t.textSize}>
            <span>{t.textSize}:</span>
            <Button small variant="secondary" onClick={() => update({ ...prefs, scale: Math.max(0.9, +(prefs.scale - 0.1).toFixed(1)) })}>
              A− <span className="visually-hidden">{t.smaller}</span>
            </Button>
            <span aria-live="polite">{Math.round(prefs.scale * 100)}%</span>
            <Button small variant="secondary" onClick={() => update({ ...prefs, scale: Math.min(1.6, +(prefs.scale + 0.1).toFixed(1)) })}>
              A+ <span className="visually-hidden">{t.larger}</span>
            </Button>
          </div>
          <Checkbox label={t.contrast} checked={prefs.contrast} onChange={(e) => update({ ...prefs, contrast: e.target.checked })} />
          <Checkbox label={t.underlineLinks} checked={prefs.links} onChange={(e) => update({ ...prefs, links: e.target.checked })} />
          <Checkbox label={t.readableFont} checked={prefs.readable} onChange={(e) => update({ ...prefs, readable: e.target.checked })} />
          <Checkbox label={t.stopAnimations} checked={prefs.noMotion} onChange={(e) => update({ ...prefs, noMotion: e.target.checked })} />
          <p className="hint">{t.note}</p>
          <div className="row">
            <Button variant="secondary" onClick={() => update(DEFAULTS)}>
              {t.reset}
            </Button>
            <Button onClick={() => setOpen(false)}>{messages.common.close}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
