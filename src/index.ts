import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { logger } from "@bogeychan/elysia-logger";
import { authRoutes } from "./routes/auth";
import { memberRoutes } from "./routes/members";
import { onboardingRoutes } from "./routes/onboarding";
import { dashboardRoutes } from "./routes/dashboard";
import { savingsRoutes } from "./routes/savings";
import { contributionRoutes } from "./routes/contributions";
import { paymentRoutes, webhookHandler } from "./routes/payments";
import { loanRoutes } from "./routes/loans";
import { dividendRoutes } from "./routes/dividends";
import { messageRoutes } from "./routes/messages";
import { notificationRoutes } from "./routes/notifications";
import { websocketRoutes } from "./routes/websocket";
import { announcementRoutes } from "./routes/announcements";
import { reportRoutes } from "./routes/reports";

const app = new Elysia()
  .use(
    cors({
      origin: [process.env.CLIENT_ADMIN_ORIGIN!, "http://localhost:3001", /^exp:\/\//],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  )
  .use(logger({ level: "info" }))
  .use(swagger({ documentation: { info: { title: "DOMICOP API", version: "2.0.0" } } }))

  // Root route - API info
  .get("/", () => ({
    name: "DOMICOP API",
    version: "2.0.0",
    status: "running",
    documentation: "/swagger",
    health: "/health",
  }))

  .get("/health", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  }))

  // Paystack webhook must be mounted BEFORE any body-parsing middleware
  .use(webhookHandler)

  // All application routes
  .use(authRoutes)
  .use(memberRoutes)
  .use(onboardingRoutes)
  .use(dashboardRoutes)
  .use(savingsRoutes)
  .use(contributionRoutes)
  .use(paymentRoutes)
  .use(loanRoutes)
  .use(dividendRoutes)
  .use(messageRoutes)
  .use(notificationRoutes)
  .use(websocketRoutes)
  .use(announcementRoutes)
  .use(reportRoutes)

  .onError(({ code, error, set }) => {
    const err = error as Error;
    console.error(`[${code}]`, err.message);
    if (code === "VALIDATION") {
      set.status = 422;
      return { error: "Validation failed", details: err.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Route not found" };
    }
    const status = typeof set.status === "number" && set.status >= 400 ? set.status : 500;
    set.status = status;
    return { error: err.message ?? "Internal server error" };
  })

  .listen(process.env.PORT ?? 3000);

console.log(`✓ DOMICOP API running on http://localhost:${app.server?.port}`);
export type App = typeof app;
