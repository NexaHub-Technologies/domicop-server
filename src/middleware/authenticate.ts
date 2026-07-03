import Elysia from "elysia";
import { supabaseAuth, supabase } from "../lib/supabase";

const PUBLIC_PATHS = [
  "/v1/banks",
  "/v1/auth/login",
  "/v1/auth/register",
  "/v1/auth/reset-password",
  "/v1/auth/confirm-reset",
  "/v1/auth/resend-verification",
  "/v1/auth/refresh",
  "/v1/auth/oauth/google",
  "/v1/webhooks/paystack",
  // WebSocket route authenticates itself in beforeHandle (browser clients
  // pass the token as ?token= since they cannot set headers)
  "/v1/ws/notifications",
  "/banks",
  "/auth/login",
  "/auth/register",
  "/auth/reset-password",
  "/auth/confirm-reset",
  "/auth/resend-verification",
  "/auth/refresh",
  "/auth/oauth/google",
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
    const {
      data: { user },
      error,
    } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      set.status = 401;
      throw new Error("Invalid or expired token");
    }

    // Admin authorization lives in admin_profiles (see 20260703_admin_profiles_table).
    // A row there is what makes an account an admin; members have none.
    const { data: adminRow } = await supabase
      .from("admin_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    const isAdmin = !!adminRow;

    return {
      user,
      role: isAdmin ? "admin" : "member",
      isAdmin,
      userId: user.id,
      token,
    };
  },
);
