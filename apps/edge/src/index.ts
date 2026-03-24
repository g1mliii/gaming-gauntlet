import {
  createDemoMatchSnapshot,
  createMatchRequestSchema,
  extensionBootstrapRequestSchema
} from "@gaming-gauntlet/contracts";
import { SignJWT } from "jose";

import type { Env } from "./env";
import { MatchCoordinator } from "./durable-objects/match-coordinator";
import { json, methodNotAllowed } from "./lib/response";

export { MatchCoordinator };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "gaming-gauntlet-edge",
        routes: [
          "/api/health",
          "/api/demo/match",
          "/api/matches",
          "/api/twitch/eventsub",
          "/api/extension/jwt",
          "/ws/matches/:matchId"
        ]
      });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "gaming-gauntlet-edge",
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/demo/match") {
      return json(createDemoMatchSnapshot());
    }

    if (url.pathname === "/api/matches") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const body = await request.json();
      const result = createMatchRequestSchema.safeParse(body);

      if (!result.success) {
        return json(
          {
            error: "invalid_match_request",
            details: result.error.flatten()
          },
          { status: 400 }
        );
      }

      return json(
        {
          ok: true,
          message: "Bootstrap route only. Persist to D1 in Phase 2.",
          match: createDemoMatchSnapshot({
            matchId: `match_${result.data.slug}`,
            slug: result.data.slug,
            title: result.data.title,
            targetWins: result.data.targetWins
          })
        },
        { status: 201 }
      );
    }

    if (url.pathname === "/api/twitch/eventsub") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const messageType = request.headers.get("Twitch-Eventsub-Message-Type");
      const body = (await request.json()) as Record<string, unknown>;

      if (messageType === "webhook_callback_verification") {
        return new Response(String(body.challenge ?? ""), {
          headers: {
            "content-type": "text/plain; charset=utf-8"
          }
        });
      }

      return json({
        ok: true,
        accepted: true,
        messageType: messageType ?? "notification",
        note: "EventSub payload received. Queue ingestion lands in Phase 3."
      });
    }

    if (url.pathname === "/api/extension/jwt") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const body = await request.json();
      const result = extensionBootstrapRequestSchema.safeParse(body);

      if (!result.success) {
        return json(
          {
            error: "invalid_extension_request",
            details: result.error.flatten()
          },
          { status: 400 }
        );
      }

      if (!env.TWITCH_EXTENSION_SECRET) {
        return json(
          {
            error: "extension_secret_not_configured",
            note: "Set TWITCH_EXTENSION_SECRET before using the EBS token endpoint."
          },
          { status: 501 }
        );
      }

      const secret = new TextEncoder().encode(env.TWITCH_EXTENSION_SECRET);
      const token = await new SignJWT({
        channel_id: result.data.channelId,
        opaque_user_id: result.data.opaqueUserId,
        role: result.data.role,
        user_id: result.data.userId
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(secret);

      return json({ ok: true, token });
    }

    if (url.pathname.startsWith("/ws/matches/")) {
      const matchId = url.pathname.split("/").at(-1);
      if (!matchId) {
        return json({ error: "match_id_required" }, { status: 400 });
      }

      const coordinatorId = env.MATCH_COORDINATOR.idFromName(matchId);
      const coordinator = env.MATCH_COORDINATOR.get(coordinatorId);
      const targetUrl = new URL(request.url);
      targetUrl.pathname = "/ws";
      targetUrl.searchParams.set("matchId", matchId);

      return coordinator.fetch(new Request(targetUrl, request));
    }

    if (url.pathname.startsWith("/api/matches/") && url.pathname.endsWith("/snapshot")) {
      const matchId = url.pathname.split("/")[3];
      const coordinatorId = env.MATCH_COORDINATOR.idFromName(matchId);
      const coordinator = env.MATCH_COORDINATOR.get(coordinatorId);
      const targetUrl = new URL(request.url);
      targetUrl.pathname = "/snapshot";
      targetUrl.searchParams.set("matchId", matchId);
      return coordinator.fetch(targetUrl.toString());
    }

    return json({ error: "not_found" }, { status: 404 });
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) {
      console.log("queue message received", message.body);
    }
  }
} satisfies ExportedHandler<Env>;
