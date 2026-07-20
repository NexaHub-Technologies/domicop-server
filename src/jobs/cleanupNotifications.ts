/**
 * Removes notification logs older than 60 days. Run via `bun run cleanup:notifications`
 * (invoke on a schedule with system cron or a platform scheduler).
 */

import { supabase } from "../lib/supabase";

export async function cleanupOldNotifications(): Promise<{
  success: boolean;
  deletedCount: number;
  error?: string;
}> {
  try {
    console.log("[Cleanup] Starting notification cleanup job...");

    // Call the database function
    const { data, error } = await supabase.rpc("cleanup_old_notifications");

    if (error) {
      console.error("[Cleanup] Error:", error);
      return {
        success: false,
        deletedCount: 0,
        error: error.message,
      };
    }

    console.log(`[Cleanup] Deleted ${data} old notifications`);

    return {
      success: true,
      deletedCount: data || 0,
    };
  } catch (error) {
    console.error("[Cleanup] Unexpected error:", error);
    return {
      success: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// If this file is run directly
if (require.main === module) {
  cleanupOldNotifications().then((result) => {
    if (result.success) {
      console.log(`[Cleanup] Job completed. Deleted ${result.deletedCount} notifications.`);
      process.exit(0);
    } else {
      console.error("[Cleanup] Job failed:", result.error);
      process.exit(1);
    }
  });
}
