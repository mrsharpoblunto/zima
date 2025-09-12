import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";
import fs from "fs";
import storage from "node-persist";
import { v4 } from "uuid";
import coverAccessory from "./cover-accessory.ts";

import express from "express";
import type { Express, Request, Response } from "express";

//express middleware
import morgan from "morgan";
import compression from "compression";
import errorHandler from "errorhandler";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import winston from "winston";

import * as config from "./config.ts";
import { configureApiRoutes } from "./api.ts";
import { CoverController } from "./cover-controller.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure express and its middleware
const app: Express = express();
const port = process.env.PORT || config.APP_SERVER_PORT;

app.enable("trust proxy");
app.set("port", port);
app.use(compression());

// configure logging
app.locals.logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `${info.timestamp} - ${info.level}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console({
      level: config.LOG_LEVEL,
    }),
  ],
});
app.use(
  morgan("combined", {
    stream: {
      write: (message: string) => {
        app.locals.logger?.verbose(message);
      },
    },
  })
);

app.use(cookieParser(v4()));
app.use(bodyParser.json());
if (process.env.NODE_ENV !== "production") {
  app.use(errorHandler());
}

(async () => {
  // setup storage engine
  await storage.init({
    dir: "persist",
    forgiveParseErrors: true,
  });

  app.locals.coverController = new CoverController();
  configureApiRoutes(app);
  configureRoutes(app);
  await startServer(app);
  await startHomekitServer(app);
})();

function configureRoutes(app: Express) {
  app.use(
    express.static(
      path.join(__dirname, "../../dist/client"),
      config.PUBLIC_STATIC_CACHING
    )
  );
  // serve the web UI
  app.get("/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../dist/client", "index.html"));
  });
}

async function startHomekitServer(app: Express) {
  if (!app.locals.coverController) {
    app.locals.logger?.error("CoverController not initialized");
    return;
  }

  const accessory = coverAccessory(app.locals.coverController);
  accessory.publish({
    port: config.HOMEKIT_PORT,
    username: config.HOMEKIT_USERNAME,
    pincode: config.HOMEKIT_PINCODE,
  });
  app.locals.logger?.info("Published HomeKit Accessory Info");
}

async function startServer(app: Express): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = config.APP_HTTPS
      ? https.createServer(sslConfig(), app)
      : http.createServer(app);
    let started = false;
    server
      .listen(port, () => {
        app.locals.logger?.info(
          "Express server awaiting connections on port " + port
        );
        resolve();
        started = true;
      })
      .on("error", (err: NodeJS.ErrnoException) => {
        if (started) {
          app.locals.logger?.error(err.stack);
          process.exit(1);
        } else if (err.code === "EACCES") {
          app.locals.logger?.error(
            `Unable to listen on port ${port}. This is usually due to the process not having permissions to bind to this port. Did you mean to run the server in dev mode with a non-priviledged port instead?`
          );
          reject(err);
        } else if (err.code === "EADDRINUSE") {
          app.locals.logger?.error(
            `Unable to listen on port ${port} because another process is already listening on this port. Do you have another instance of the server already running?`
          );
          reject(err);
        }
      });
  });
}

interface SSLConfig {
  cert?: string;
  key?: string;
}

function sslConfig(): SSLConfig {
  const cert = tryReadFileSync(config.SSL_CERT);
  const key = tryReadFileSync(config.SSL_KEY);
  return {
    ...(cert ? { cert } : {}),
    ...(key ? { key } : {}),
  };
}

function tryReadFileSync(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (err) {
    return null;
  }
}
