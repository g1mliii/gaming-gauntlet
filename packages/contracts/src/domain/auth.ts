import { z } from "zod";

import { chatStateSchema, matchStatusSchema, playerSchema, subscriptionHealthSchema } from "./match";
import { roleSchema } from "./roles";

export const twitchLoginSchema = z
  .string()
  .trim()
  .min(3)
  .max(25)
  .regex(/^[a-z0-9_]+$/);

export const authIntentSchema = z.enum(["dashboard", "invite", "chat"]);
export const channelLinkStatusSchema = z.enum(["pending", "active"]);
export const chatIntegrationStatusSchema = z.enum(["idle", "ready", "needs_consent", "repairing", "revoked"]);

export const authUserSchema = z.object({
  id: z.string().min(1),
  twitchUserId: z.string().min(1),
  login: twitchLoginSchema,
  displayName: z.string().min(1)
});

export const authChannelSchema = z.object({
  id: z.string().min(1),
  twitchChannelId: z.string().min(1),
  login: twitchLoginSchema,
  displayName: z.string().min(1)
});

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  user: authUserSchema.nullable(),
  ownedChannel: authChannelSchema.nullable()
});

export const channelLinkMembershipSchema = z.object({
  id: z.string().min(1),
  role: roleSchema,
  createdAt: z.string().datetime(),
  user: authUserSchema,
  channel: authChannelSchema
});

export const channelLinkInviteSchema = z.object({
  code: z.string().min(1),
  shareUrl: z.url(),
  invitedChannelLogin: twitchLoginSchema,
  expiresAt: z.string().datetime(),
  claimedAt: z.string().datetime().nullable()
});

export const channelLinkSummarySchema = z.object({
  id: z.string().min(1),
  status: channelLinkStatusSchema,
  pairKey: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ownerChannel: authChannelSchema,
  linkedChannel: authChannelSchema.nullable(),
  invitedChannelLogin: twitchLoginSchema.nullable(),
  memberships: z.array(channelLinkMembershipSchema),
  pendingInvite: channelLinkInviteSchema.nullable(),
  chatIntegration: z.object({
    ownerAuthorized: z.boolean(),
    linkedAuthorized: z.boolean(),
    status: chatIntegrationStatusSchema
  })
});

export const channelLinksResponseSchema = z.object({
  items: z.array(channelLinkSummarySchema)
});

export const createChannelLinkRequestSchema = z.object({
  invitedChannelLogin: twitchLoginSchema
});

export const addChannelLinkMemberRequestSchema = z.object({
  login: twitchLoginSchema,
  role: z.literal("mod").default("mod")
});

export const inviteStatusSchema = z.object({
  code: z.string().min(1),
  status: z.enum(["pending", "accepted", "expired", "not_found"]),
  invitedChannelLogin: twitchLoginSchema.nullable(),
  ownerChannel: authChannelSchema.nullable(),
  claimedChannel: authChannelSchema.nullable(),
  expiresAt: z.string().datetime().nullable()
});

export const matchSummarySchema = z.object({
  id: z.string().min(1),
  channelLinkId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  status: matchStatusSchema,
  chatState: chatStateSchema,
  chatEnabledUntil: z.string().datetime().nullable(),
  boardRevision: z.number().int().nonnegative(),
  subscriptionHealth: subscriptionHealthSchema,
  targetWins: z.number().int().positive().nullable(),
  players: z.array(playerSchema).min(2),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const matchesResponseSchema = z.object({
  items: z.array(matchSummarySchema)
});

export type AddChannelLinkMemberRequest = z.infer<typeof addChannelLinkMemberRequestSchema>;
export type AuthIntent = z.infer<typeof authIntentSchema>;
export type AuthChannel = z.infer<typeof authChannelSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type ChannelLinkInvite = z.infer<typeof channelLinkInviteSchema>;
export type ChatIntegrationStatus = z.infer<typeof chatIntegrationStatusSchema>;
export type ChannelLinkMembership = z.infer<typeof channelLinkMembershipSchema>;
export type ChannelLinkSummary = z.infer<typeof channelLinkSummarySchema>;
export type CreateChannelLinkRequest = z.infer<typeof createChannelLinkRequestSchema>;
export type InviteStatus = z.infer<typeof inviteStatusSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;

export function canCreateBroadcasterInvite(role: z.infer<typeof roleSchema>): boolean {
  return role === "owner";
}

export function canManageModerators(role: z.infer<typeof roleSchema>): boolean {
  return role === "owner" || role === "streamer";
}

export function canCreateMatches(role: z.infer<typeof roleSchema>): boolean {
  return role === "owner" || role === "streamer" || role === "mod";
}
