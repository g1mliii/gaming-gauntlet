import type { PropsWithChildren, ReactNode } from "react";

type PageShellProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  deck: string;
  actions?: ReactNode;
  tone?: "default" | "overlay";
}>;

export function PageShell({
  eyebrow,
  title,
  deck,
  actions,
  tone = "default",
  children
}: PageShellProps) {
  return (
    <section className={`gg-shell gg-shell--${tone}`}>
      <header className="gg-shell__header">
        <div>
          <p className="gg-shell__eyebrow">{eyebrow}</p>
          <h1 className="gg-shell__title">{title}</h1>
          <p className="gg-shell__deck">{deck}</p>
        </div>
        {actions ? <div className="gg-shell__actions">{actions}</div> : null}
      </header>
      <div className="gg-shell__body">{children}</div>
    </section>
  );
}
