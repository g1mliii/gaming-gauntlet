import type { PropsWithChildren, ReactNode } from "react";

type PageShellProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  deck: string;
  actions?: ReactNode;
  emphasis?: "hero" | "section" | "compact";
  tone?: "default" | "overlay";
}>;

export function PageShell({
  eyebrow,
  title,
  deck,
  actions,
  emphasis = "hero",
  tone = "default",
  children,
}: PageShellProps) {
  const TitleTag = emphasis === "hero" ? "h1" : "h2";

  return (
    <section className={`gg-shell gg-shell--${tone} gg-shell--${emphasis}`}>
      <header className="gg-shell__header">
        <div>
          {eyebrow ? <p className="gg-shell__eyebrow">{eyebrow}</p> : null}
          {title ? (
            <TitleTag className="gg-shell__title">{title}</TitleTag>
          ) : null}
          {deck ? <p className="gg-shell__deck">{deck}</p> : null}
        </div>
        {actions ? <div className="gg-shell__actions">{actions}</div> : null}
      </header>
      <div className="gg-shell__body">{children}</div>
    </section>
  );
}
