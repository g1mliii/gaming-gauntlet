import { z } from "zod";

export const roleSchema = z.enum(["owner", "streamer", "mod"]);

export type Role = z.infer<typeof roleSchema>;
