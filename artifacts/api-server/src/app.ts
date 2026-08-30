import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind CapRover's nginx (or any reverse proxy) so X-Forwarded-* headers are
// honoured for req.protocol / req.get("host") and correct https redirect URLs.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production (e.g. CapRover single-container) the same server also serves the
// built frontend. Set SERVE_STATIC_DIR to the Vite build output (dist/public).
// In Replit dev this is unset and Vite serves the frontend separately.
const staticDir = process.env["SERVE_STATIC_DIR"];
if (staticDir && fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  // SPA fallback: any non-/api GET returns index.html so client routing works.
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (/^\/api(?:\/|$)/.test(req.path)) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving static frontend");
}

export default app;
