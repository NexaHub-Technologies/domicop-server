import { rateLimit } from "elysia-rate-limit";

const errResponse = (msg: string) =>
  new Response(JSON.stringify({ error: msg }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });

export const authRateLimit = rateLimit({
  max: 10,
  duration: 60_000,
  errorResponse: errResponse("Too many auth attempts. Wait 1 minute."),
});
export const paymentRateLimit = rateLimit({
  max: 30,
  duration: 60_000,
  errorResponse: errResponse("Too many payment requests."),
});
export const generalRateLimit = rateLimit({
  max: 100,
  duration: 60_000,
  errorResponse: errResponse("Rate limit exceeded."),
});
