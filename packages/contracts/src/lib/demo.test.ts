import { createDemoMatchSnapshot } from "./demo";

describe("createDemoMatchSnapshot", () => {
  it("creates a snapshot with live and queued defaults", () => {
    const snapshot = createDemoMatchSnapshot();
    expect(snapshot.queue.find((entry) => entry.id === snapshot.currentGameId)?.title).toBe(
      "Mario Kart 8 Deluxe"
    );
    expect(snapshot.queue.filter((entry) => entry.status === "queued")).toHaveLength(1);
  });
});
