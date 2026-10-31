"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, TextField } from "./ui";

/**
 * Modal built on the native <dialog> element: focus is moved into the dialog and trapped,
 * Escape closes it, and focus returns to the trigger. All handled by the browser.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <h2 id={titleId}>{title}</h2>
      {open && children}
    </dialog>
  );
}

/** Confirmation before destructive actions. Optionally requires typing a word. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  requireWord,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  requireWord?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { messages } = useI18n();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
    }
  }, [open]);
  const canConfirm = !requireWord || typed.trim() === requireWord;
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <div className="stack">
        <p>{message}</p>
        {requireWord && (
          <TextField
            label={format(messages.settings.typeToConfirm, { word: requireWord })}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="row">
          <Button
            variant="danger"
            busy={busy}
            disabled={!canConfirm}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {messages.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Step-up authentication before sensitive actions (export, delete, MFA changes). */
export function ReauthDialog({
  open,
  mfaEnabled,
  onDone,
  onClose,
}: {
  open: boolean;
  mfaEnabled: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { messages } = useI18n();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/reauth", { password, ...(mfaEnabled ? { code } : {}) });
      onDone();
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={messages.settings.reauthTitle} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <p>{messages.settings.reauthText}</p>
        <TextField
          label={messages.auth.password}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {mfaEnabled && (
          <TextField
            label={messages.settings.mfaCodeIfEnabled}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="row">
          <Button type="submit" busy={busy}>
            {messages.common.confirm}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {messages.common.cancel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
