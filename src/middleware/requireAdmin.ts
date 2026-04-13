import Elysia from "elysia";
import { authenticate } from "./authenticate";

export const requireAdmin = new Elysia({ name: "requireAdmin" })
  .use(authenticate)
  .derive({ as: "scoped" }, ({ role, set }) => {
    if (role !== "admin") {
      set.status = 403;
      throw new Error("Admin access required");
    }
    return {};
  });
