import { z } from "zod";

import { matchStatusSchema, subscriptionHealthSchema } from "./match";

export const twitchExtensionRoleSchema = z.enum([
  "broadcaster",
  "moderator",
  "viewer",
  "external",
]);

export const twitchExtensionModeSchema = z.enum([
  "config",
  "dashboard",
  "viewer",
]);

export const twitchExtensionAnchorSchema = z.enum([
  "component",
  "panel",
  "video_overlay",
]);

export const extensionBroadcasterConfigSchema = z.object({
  version: z.literal(1),
  matchSlug: z.string().min(1).nullable(),
});

export const twitchExtensionAuthContextSchema = z.object({
  channelId: z.string().min(1),
  clientId: z.string().min(1),
  token: z.string().min(1),
  helixToken: z.string().min(1).nullable().optional(),
  opaqueUserId: z.string().min(1).nullable(),
  role: twitchExtensionRoleSchema,
  userId: z.string().min(1).nullable(),
});

export const extensionMatchPlayerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  wins: z.number().int().nonnegative(),
});

export const extensionMatchSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  status: matchStatusSchema,
  boardRevision: z.number().int().nonnegative(),
  subscriptionHealth: subscriptionHealthSchema,
  targetWins: z.number().int().positive().nullable(),
  players: z.array(extensionMatchPlayerSchema).min(2),
  updatedAt: z.string().datetime(),
});

export const extensionMatchesResponseSchema = z.object({
  items: z.array(extensionMatchSummarySchema),
});

export type ExtensionBroadcasterConfig = z.infer<
  typeof extensionBroadcasterConfigSchema
>;
export type ExtensionMatchPlayer = z.infer<typeof extensionMatchPlayerSchema>;
export type ExtensionMatchSummary = z.infer<typeof extensionMatchSummarySchema>;
export type TwitchExtensionAnchor = z.infer<typeof twitchExtensionAnchorSchema>;
export type TwitchExtensionAuthContext = z.infer<
  typeof twitchExtensionAuthContextSchema
>;
export type TwitchExtensionMode = z.infer<typeof twitchExtensionModeSchema>;
export type TwitchExtensionRole = z.infer<typeof twitchExtensionRoleSchema>;
