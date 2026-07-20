import Elysia from "elysia";
import { resolveUserFromToken } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/v1/banks",
  "/v1/auth/login",
  "/v1/auth/register",
  "/v1/auth/reset-password",
  "/v1/auth/confirm-reset",
  "/v1/auth/refresh",
  "/v1/webhooks/paystack",
  // WebSocket route authenticates itself in beforeHandle (browser clients
  // pass the token as ?token= since they cannot set headers)
  "/v1/ws/notifications",
  "/banks",
  "/auth/login",
  "/auth/register",
  "/auth/reset-password",
  "/auth/confirm-reset",
  "/auth/refresh",
  "/webhooks/paystack",
  "/ws/notifications",
];

export const authenticate = new Elysia({ name: "authenticate" }).derive(
  { as: "global" },
  async ({ headers, set, path }) => {
    if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      return;
    }

    const authHeader = headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("Missing or malformed Authorization header");
    }
    const token = authHeader.replace("Bearer ", "").trim();

    const resolved = await resolveUserFromToken(token);
    if (!resolved) {
      set.status = 401;
      throw new Error("Invalid or expired token");
    }

    return { ...resolved, token };
  },
);
