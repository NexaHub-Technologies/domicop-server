import Elysia from "elysia";
import { supabase } from "../lib/supabase";

/**
 * Blocks suspended members only — unlike requireActive, pending members
 * are allowed through. Must be used AFTER authenticate middleware.
 */
export const blockSuspended = new Elysia({ name: "blockSuspended" }).derive(
  { as: "scoped" },
  async ({ userId, role, set }: any) => {
    if (role === "admin") {
      return {};
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      set.status = 404;
      throw new Error("Profile not found");
    }

    if (profile.status === "suspended") {
      set.status = 403;
      throw new Error("Account suspended. Please contact support for assistance.");
    }

    return {};
  },
);
