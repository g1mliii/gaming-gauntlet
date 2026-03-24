import { z } from "zod";

export const voteRecordSchema = z.object({
  voterId: z.string().min(1),
  suggestionId: z.string().min(1)
});

export type VoteRecord = z.infer<typeof voteRecordSchema>;

export function applyViewerVote(existingVotes: VoteRecord[], incomingVote: VoteRecord): VoteRecord[] {
  return [...existingVotes.filter((vote) => vote.voterId !== incomingVote.voterId), incomingVote];
}

export function tallyVotes(votes: VoteRecord[]): Record<string, number> {
  return votes.reduce<Record<string, number>>((totals, vote) => {
    totals[vote.suggestionId] = (totals[vote.suggestionId] ?? 0) + 1;
    return totals;
  }, {});
}
