import { useId } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function mergeClassNames(
  ...names: Array<string | false | null | undefined>
) {
  return names.filter(Boolean).join(" ");
}

export type KitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "sm" | "icon";
  block?: boolean;
};

export function KitButton({
  className,
  variant = "default",
  size,
  block = false,
  ...props
}: KitButtonProps) {
  return (
    <button
      className={mergeClassNames(
        "gg-button",
        variant !== "default" && `gg-button--${variant}`,
        size && `gg-button--${size}`,
        block && "gg-button--block",
        className
      )}
      {...props}
    />
  );
}

export type KitButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "sm" | "icon";
  block?: boolean;
};

export function KitButtonLink({
  className,
  variant = "default",
  size,
  block = false,
  ...props
}: KitButtonLinkProps) {
  return (
    <a
      className={mergeClassNames(
        "gg-button",
        variant !== "default" && `gg-button--${variant}`,
        size && `gg-button--${size}`,
        block && "gg-button--block",
        className
      )}
      {...props}
    />
  );
}

export type KitChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "soft" | "live" | "alpha" | "bravo";
};

export function KitChip({
  className,
  tone = "default",
  ...props
}: KitChipProps) {
  return (
    <span
      className={mergeClassNames(
        "gg-chip",
        tone !== "default" && `gg-chip--${tone}`,
        className
      )}
      {...props}
    />
  );
}

export type KitPanelProps = PropsWithChildren<
  HTMLAttributes<HTMLElement> & {
    eyebrow?: string;
    title?: string;
    summary?: string;
    actions?: ReactNode;
    transparent?: boolean;
    flush?: boolean;
  }
>;

export function KitPanel({
  actions,
  children,
  className,
  eyebrow,
  summary,
  title,
  transparent = false,
  flush = false,
  ...props
}: KitPanelProps) {
  return (
    <section
      className={mergeClassNames(
        "gg-panel",
        transparent && "gg-panel--transparent",
        flush && "gg-panel--flush",
        className
      )}
      {...props}
    >
      {eyebrow || title || summary || actions ? (
        <div className="gg-panel__header">
          <div>
            {eyebrow ? <p className="gg-panel__eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="gg-panel__title">{title}</h2> : null}
            {summary ? <p className="gg-panel__summary">{summary}</p> : null}
          </div>
          {actions ? <div className="gg-action-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type KitCardProps = PropsWithChildren<
  HTMLAttributes<HTMLElement> & {
    eyebrow?: string;
    title?: string;
    meta?: string;
    actions?: ReactNode;
  }
>;

export function KitCard({
  actions,
  children,
  className,
  eyebrow,
  meta,
  title,
  ...props
}: KitCardProps) {
  return (
    <article className={mergeClassNames("gg-card", className)} {...props}>
      {eyebrow || title || meta || actions ? (
        <div className="gg-card__header">
          <div>
            {eyebrow ? <p className="gg-card__eyebrow">{eyebrow}</p> : null}
            {title ? <h3 className="gg-card__title">{title}</h3> : null}
            {meta ? <p className="gg-card__meta">{meta}</p> : null}
          </div>
          {actions ? <div className="gg-action-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

export type KitNoticeProps = HTMLAttributes<HTMLParagraphElement> & {
  tone?: "default" | "success" | "warning" | "danger";
};

export function KitNotice({
  className,
  tone = "default",
  ...props
}: KitNoticeProps) {
  return (
    <p
      className={mergeClassNames(
        "gg-notice",
        tone !== "default" && `gg-notice--${tone}`,
        className
      )}
      {...props}
    />
  );
}

type KitFieldBaseProps = {
  label: string;
  error?: string | null;
};

export type KitTextFieldProps = KitFieldBaseProps &
  InputHTMLAttributes<HTMLInputElement> & {
    hint?: string;
  };

export function KitTextField({
  className,
  error,
  hint,
  label,
  ...props
}: KitTextFieldProps) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? errorId : showHint ? hintId : undefined;

  return (
    <label className={mergeClassNames("gg-field", className)}>
      <span id={labelId}>{label}</span>
      <input
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={error ? "true" : undefined}
        {...props}
      />
      {showHint ? (
        <p className="gg-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="gg-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

export type KitSelectFieldProps = KitFieldBaseProps &
  SelectHTMLAttributes<HTMLSelectElement>;

export function KitSelectField({
  children,
  className,
  error,
  label,
  ...props
}: KitSelectFieldProps) {
  return (
    <label className={mergeClassNames("gg-field", className)}>
      <span>{label}</span>
      <select aria-invalid={error ? "true" : undefined} {...props}>
        {children}
      </select>
      {error ? (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

export type KitTextareaFieldProps = KitFieldBaseProps &
  TextareaHTMLAttributes<HTMLTextAreaElement>;

export function KitTextareaField({
  className,
  error,
  label,
  ...props
}: KitTextareaFieldProps) {
  return (
    <label className={mergeClassNames("gg-field", className)}>
      <span>{label}</span>
      <textarea aria-invalid={error ? "true" : undefined} {...props} />
      {error ? (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}
