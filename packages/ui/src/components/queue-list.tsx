import type {
  PublicQueuePreviewItem,
  QueueItem,
} from "@gaming-gauntlet/contracts";

type QueueListProps = {
  items: Array<QueueItem | PublicQueuePreviewItem>;
  title?: string;
  summary?: string;
  transparent?: boolean;
  emptyLabel?: string;
};

export function QueueList({
  items,
  title = "Approved queue",
  summary,
  transparent = false,
  emptyLabel = "No games are queued yet.",
}: QueueListProps) {
  return (
    <section className={`gg-panel ${transparent ? "gg-panel--transparent" : ""}`}>
      <div className="gg-panel__header">
        <div>
          <p className="gg-panel__eyebrow">Match flow</p>
          <h2 className="gg-panel__title">{title}</h2>
          {summary ? <p className="gg-panel__summary">{summary}</p> : null}
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
        <p className="gg-empty">{emptyLabel}</p>
      )}
    </section>
  );
}
