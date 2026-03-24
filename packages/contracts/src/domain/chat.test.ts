import { parseChatCommand } from "./chat";

describe("parseChatCommand", () => {
  it("parses suggestions", () => {
    expect(parseChatCommand("!gg suggest Balatro")).toEqual({
      kind: "suggest",
      raw: "!gg suggest Balatro",
      argument: "Balatro"
    });
  });

  it("falls back to unknown for non-commands", () => {
    expect(parseChatCommand("hello world").kind).toBe("unknown");
  });
});
