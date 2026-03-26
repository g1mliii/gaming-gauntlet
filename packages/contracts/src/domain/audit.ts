import { z } from "zod";

import { twitchLoginSchema } from "./auth";

export const auditActionSchema = z.enum([
  "auth.login",
  "auth.logout",
  "channel_link.created",
  "channel_link.accepted",
  "member.assigned",
  "member.revoked",
  "match.created"
]);

export const auditActorSchema = z.object({
  id: z.string().min(1),
  login: twitchLoginSchema,
  displayName: z.string().min(1)
});

export const auditLogEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  action: auditActionSchema,
  actor: auditActorSchema.nullable(),
  channelLinkId: z.string().min(1).nullable(),
  channelPairLabel: z.string().min(1).nullable(),
  matchId: z.string().min(1).nullable(),
  matchTitle: z.string().min(1).nullable(),
  payload: z.record(z.string(), z.unknown())
});

export const auditLogResponseSchema = z.object({
  items: z.array(auditLogEntrySchema)
});

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditActor = z.infer<typeof auditActorSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
