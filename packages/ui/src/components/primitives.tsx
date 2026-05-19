import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

function mergeClassNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export type KitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "default";
};

export function KitButton({
  className,
  variant = "default",
  ...props
}: KitButtonProps) {
  return (
    <button
      className={mergeClassNames(
        "gg-button",
        variant !== "default" && `gg-button--${variant}`,
        className
      )}
      {...props}
    />
  );
}

export type KitChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "soft" | "live";
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
  ...props
}: KitPanelProps) {
  return (
    <section
      className={mergeClassNames(
        "gg-panel",
        transparent && "gg-panel--transparent",
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
  tone?: "default" | "success" | "warning";
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
  InputHTMLAttributes<HTMLInputElement>;

export function KitTextField({
  className,
  error,
  label,
  ...props
}: KitTextFieldProps) {
  return (
    <label className={mergeClassNames("gg-field", className)}>
      <span>{label}</span>
      <input aria-invalid={error ? "true" : undefined} {...props} />
      {error ? <p className="gg-field__error">{error}</p> : null}
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
      {error ? <p className="gg-field__error">{error}</p> : null}
    </label>
  );
}
