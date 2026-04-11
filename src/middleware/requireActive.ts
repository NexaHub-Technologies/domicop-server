import Elysia from "elysia";
import { supabase } from "../lib/supabase";

/**
 * Middleware to require active account status
 * Blocks access to financial operations for pending/suspended users
 * Must be used AFTER authenticate middleware
 */
export const requireActive = new Elysia({ name: "requireActive" }).derive(
  { as: "scoped" },
  async ({ userId, set }) => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("status, role")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      set.status = 404;
      throw new Error("Profile not found");
    }

    // Check account status
    if (profile.status === "pending") {
      set.status = 403;
      throw new Error(
        "Account pending approval. Please wait for admin verification before performing this action.",
      );
    }

    if (profile.status === "suspended") {
      set.status = 403;
      throw new Error(
        "Account suspended. Please contact support for assistance.",
      );
    }

    // Only active users can proceed
    return { profile };
  },
);
