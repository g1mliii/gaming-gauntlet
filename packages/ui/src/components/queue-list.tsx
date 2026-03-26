import type { QueueItem } from "@gaming-gauntlet/contracts";

type QueueListProps = {
  items: QueueItem[];
  title?: string;
  transparent?: boolean;
};

export function QueueList({ items, title = "Approved queue", transparent = false }: QueueListProps) {
  return (
    <section className={`gg-panel ${transparent ? "gg-panel--transparent" : ""}`}>
      <div className="gg-panel__header">
        <div>
          <p className="gg-panel__eyebrow">Match flow</p>
          <h2 className="gg-panel__title">{title}</h2>
        </div>
      </div>
      {items.length > 0 ? (
        <ul className="gg-queue">
          {items.map((item) => (
            <li key={item.id} className="gg-queue__item">
              <span className={`gg-chip ${item.status === "live" ? "gg-chip--live" : "gg-chip--soft"}`}>
                {item.status}
              </span>
              <strong>{item.title}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gg-empty">No games are queued yet.</p>
      )}
    </section>
  );
}
