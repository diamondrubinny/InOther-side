"use client";

import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useI18n } from "@/i18n/client";

type ButtonVariant = "primary" | "secondary" | "danger" | "link";

export function Button({
  variant = "primary",
  busy = false,
  small = false,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean; small?: boolean }) {
  const classes = ["btn", variant !== "primary" ? variant : "", small ? "small" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" {...rest} className={classes} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
}

/** Text input with a visible label, hint and error wired via aria-describedby. */
export function TextField({ label, hint, error, required, id, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && <span id={hintId} className="hint">{hint}</span>}
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {error && <span id={errorId} className="error-text">{error}</span>}
    </div>
  );
}

export function TextArea({ label, hint, error, required, id, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && <span id={hintId} className="hint">{hint}</span>}
      <textarea
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {error && <span id={errorId} className="error-text">{error}</span>}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  id,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && <span id={hintId} className="hint">{hint}</span>}
      <select id={inputId} required={required} aria-describedby={hintId} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

export function Checkbox({ label, id, ...rest }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="check">
      <input type="checkbox" id={inputId} {...rest} />
      <label htmlFor={inputId}>{label}</label>
    </div>
  );
}

export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const baseId = useId();
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map((o) => (
        <div className="check" key={o.value}>
          <input
            type="radio"
            id={`${baseId}-${o.value}`}
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <label htmlFor={`${baseId}-${o.value}`}>{o.label}</label>
        </div>
      ))}
    </fieldset>
  );
}

/** Errors are announced immediately (role=alert); success/info politely (role=status). */
export function Alert({ kind, children }: { kind: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading() {
  const { messages } = useI18n();
  return (
    <p className="row muted" role="status">
      <span className="spinner" aria-hidden="true" />
      {messages.common.loading}
    </p>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ inlineSize: `${clamped}%` }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="card muted">{children}</p>;
}
