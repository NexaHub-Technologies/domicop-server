import Elysia from "elysia";

/**
 * Middleware for Paystack secret key authentication
 * Validates requests using Paystack's Bearer token for server-to-server auth
 * Used for payment verification endpoints
 */
export const paystackAuth = new Elysia({ name: "paystackAuth" }).derive(
  { as: "scoped" },
  ({ headers, set }) => {
    const authHeader = headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("Missing or malformed Authorization header");
    }

    const providedKey = authHeader.replace("Bearer ", "").trim();
    const expectedKey = process.env.PAYSTACK_SECRET_KEY;

    if (!expectedKey) {
      set.status = 500;
      throw new Error("Paystack secret key not configured");
    }

    if (providedKey !== expectedKey) {
      set.status = 401;
      throw new Error("Invalid Paystack key");
    }

    return {};
  }
);
