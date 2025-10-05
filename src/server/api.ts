import type { Application, Request, Response } from "express";
import * as winston from "winston";
import * as config from "./config.ts";
import {
  COVER_OPENING,
  COVER_CLOSING,
  COVER_STOPPED,
} from "../shared/cover-state.ts";
import { type CoverEvent, CoverController } from "./cover-controller.ts";

declare global {
  namespace Express {
    interface Locals {
      coverController: CoverController;
      logger: winston.Logger;
    }
  }
}

export function configureApiRoutes(app: Application): void {
  function waitForCoverEvent(
    timeout: number,
    callback: (timedOut: boolean, event: CoverEvent | null) => void
  ): void {
    let listener: ((state: CoverEvent) => void) | null = null;
    let timeoutHandle = setTimeout(() => {
      if (listener) {
        app.locals?.coverController.removeListener("change", listener);
      }
      callback(true, null);
    }, timeout);

    listener = (state: CoverEvent) => {
      if (listener) {
        app.locals?.coverController.removeListener("change", listener);
      }
      clearTimeout(timeoutHandle);
      callback(false, state);
    };

    app.locals?.coverController.addListener("change", listener);
  }

  app.get("/api/1/poll-state", (req: Request, res: Response) => {
    const queryState = JSON.parse(req.query.state as string);

    if (
      req.app.locals.coverController &&
      JSON.stringify(queryState) !==
      JSON.stringify(req.app.locals.coverController.getState())
    ) {
      res.json({
        success: true,
        change: true,
        state: req.app.locals.coverController.getState(),
      });
    } else {
      res.writeHead(200, {
        "Content-Type": "application/json",
      });
      res.write(""); // flush headers to the client
      waitForCoverEvent(
        parseInt(req.query.timeout as string, 10) < 60000
          ? parseInt(req.query.timeout as string, 10)
          : 60000,
        (timedOut, event) => {
          res.write(
            JSON.stringify({
              success: true,
              change: timedOut
                ? false
                : JSON.stringify(queryState) !== JSON.stringify(event?.state),
              state: timedOut ? null : event?.state,
            })
          );
          res.end();
        }
      );
    }
  });

  app.post("/api/1/report-error", (req: Request, res: Response) => {
    req.app.locals?.logger.error(
      `Client error: ${req.body.source}:${req.body.lineno}:${req.body.colno} - ${req.body.message}\n${req.body.stack}`
    );
    res.status(200).end();
  });

  app.post("/api/1/set-position-state", async (req: Request, res: Response) => {
    try {
      if (!req.app.locals.coverController) {
        throw new Error("CoverController not initialized");
      }

      switch (req.body.positionState) {
        case COVER_OPENING:
          req.app.locals.coverController.open();
          break;
        case COVER_CLOSING:
          req.app.locals.coverController.close();
          break;
        case COVER_STOPPED:
          req.app.locals.coverController.stop();
          break;
        default:
          throw new Error("Invalid positionState");
      }

      res.json({
        success: true,
      });
    } catch (err: any) {
      req.app.locals.logger?.error(err.stack);
      res.status(500).json({
        success: false,
      });
    }
  });

  app.get("/api/1/hardware-state", (req: Request, res: Response) => {
    try {
      if (!req.app.locals.coverController) {
        throw new Error("CoverController not initialized");
      }
      res.json(req.app.locals.coverController.getHardwareState());
    } catch (err: any) {
      req.app.locals.logger?.error(err.stack);
      res.status(500).json({
        success: false,
      });
    }
  });

  app.post("/api/1/calibrate", async (req: Request, res: Response) => {
    try {
      if (!req.app.locals.coverController) {
        throw new Error("CoverController not initialized");
      }

      req.app.locals.coverController.calibrate();
      req.app.locals.logger?.info("Calibrating cover");
      res.json({
        success: true,
      });
    } catch (err: any) {
      req.app.locals.logger?.error(err.stack);
      res.status(500).json({
        success: false,
      });
    }
  });
}
