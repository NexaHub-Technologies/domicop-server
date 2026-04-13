import Elysia from "elysia";
import { supabaseAuth } from "../lib/supabase";

export const authenticate = new Elysia({ name: "authenticate" }).derive(
  { as: "global" },
  async ({ headers, set }) => {
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

    return {
      user,
      role: (user.app_metadata?.user_role as string) ?? "member",
      userId: user.id,
      token,
    };
  },
);
