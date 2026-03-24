import type { QueueItem } from "@gaming-gauntlet/contracts";

type QueueListProps = {
  items: QueueItem[];
  title?: string;
};

export function QueueList({ items, title = "Approved queue" }: QueueListProps) {
  return (
    <section className="gg-panel">
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
              <span className="gg-chip gg-chip--soft">{item.status}</span>
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
