import { z } from "zod";

export const chatCommandKindSchema = z.enum(["suggest", "vote", "board", "help", "unknown"]);

export const chatCommandSchema = z.object({
  kind: chatCommandKindSchema,
  raw: z.string().min(1),
  argument: z.string().nullable()
});

export type ChatCommand = z.infer<typeof chatCommandSchema>;

export function parseChatCommand(input: string): ChatCommand {
  const raw = input.trim();
  const normalized = raw.toLowerCase();

  if (!normalized.startsWith("!gg")) {
    return { kind: "unknown", raw, argument: null };
  }

  const withoutPrefix = raw.slice(3).trim();
  if (!withoutPrefix) {
    return { kind: "help", raw, argument: null };
  }

  const [command, ...rest] = withoutPrefix.split(/\s+/);
  const argument = rest.join(" ").trim() || null;

  switch (command.toLowerCase()) {
    case "suggest":
      return { kind: "suggest", raw, argument };
    case "vote":
      return { kind: "vote", raw, argument };
    case "board":
      return { kind: "board", raw, argument: null };
    case "help":
      return { kind: "help", raw, argument: null };
    default:
      return { kind: "unknown", raw, argument };
  }
}
