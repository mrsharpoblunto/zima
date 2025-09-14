import { EventEmitter } from "events";
import * as config from "./config.ts";
import { type Logger } from "winston";
import * as libgpiod from "node-libgpiod";
import {
  type CoverState,
  COVER_OPENING,
  COVER_CLOSING,
  COVER_STOPPED,
} from "../shared/cover-state.ts";
import storage from "node-persist";

export interface CoverEvent {
  state: CoverState;
}

type CoverCalibrationInfo = {
  calibrated: boolean;
  openTime: number; // milliseconds
  closeTime: number; // milliseconds
};

export class CoverController extends EventEmitter {
  private state: CoverState;
  private controlLoop: NodeJS.Timeout | null;
  private calibrationInfo: CoverCalibrationInfo;
  private lastStateChangeTime: number;
  private positionAtLastStateChange: number;

  private chip: any;
  private closeLimiterLine: any;
  private openLimiterLine: any;
  private motorOpenLine: any;
  private motorCloseLine: any;
  private logger: Logger;
  private waitForLimiter: boolean;

  constructor(logger: Logger) {
    super();

    this.logger = logger;
    this.state = {
      currentPosition: 0,
      targetPosition: 0,
      positionState: COVER_STOPPED,
      calibration: "uncalibrated",
    };
    this.calibrationInfo = {
      calibrated: false,
      openTime: 10000,
      closeTime: 15000,
    };
    this.lastStateChangeTime = 0;
    this.positionAtLastStateChange = 0;
    this.controlLoop = null;
    this.waitForLimiter = false;

    try {
      this.chip = new libgpiod.Chip(0);

      this.closeLimiterLine = new libgpiod.Line(
        this.chip,
        config.CLOSE_LIMITER_GPIO
      );
      this.closeLimiterLine.requestInputMode();

      this.openLimiterLine = new libgpiod.Line(
        this.chip,
        config.OPEN_LIMITER_GPIO
      );
      this.openLimiterLine.requestInputMode();

      this.motorOpenLine = new libgpiod.Line(this.chip, config.MOTOR_OPEN_GPIO);
      this.motorOpenLine.requestOutputMode();

      this.motorCloseLine = new libgpiod.Line(
        this.chip,
        config.MOTOR_CLOSE_GPIO
      );
      this.motorCloseLine.requestOutputMode();
    } catch (err) {
      if (err instanceof Error) {
        logger.error("Failed to register GPIO pins");
        logger.error(err.stack);
      }
      // Probably not running on a Raspberry Pi, disable GPIO control & fake
      // calibration
      this.calibrationInfo.calibrated = true;
      this.state.calibration = "calibrated";
      this.chip = null;
      this.closeLimiterLine = null;
      this.openLimiterLine = null;
      this.motorOpenLine = null;
      this.motorCloseLine = null;
    }

    storage
      .getItem(config.COVER_KEY)
      .then((data) => {
        if (data) {
          try {
            this.calibrationInfo = JSON.parse(data) as CoverCalibrationInfo;
            if (this.calibrationInfo.calibrated) {
              this.state.calibration = "calibrated";
            }
          } catch (err) {
            logger.error("Failed to load persisted settings");
          }
        }
      })
      .finally(() => {
        this.startPolling();
      });

    process.on("SIGINT", () => {
      this.cleanup();
    });
    process.on("SIGTERM", () => {
      this.cleanup();
    });
  }

  startPolling(): void {
    this.controlLoop = setInterval(() => {
      const previousPositionState = this.state.positionState;
      const previousPosition = this.state.currentPosition;

      switch (this.state.positionState) {
        case COVER_OPENING:
          if (
            !this.waitForLimiter &&
            this.state.currentPosition >= this.state.targetPosition
          ) {
            this.logger.info("Stopping open...");
            this.state.positionState = COVER_STOPPED;
            this.motorOpenLine?.setValue(0);
            this.motorCloseLine?.setValue(0);
          }
          break;
        case COVER_CLOSING:
          if (
            !this.waitForLimiter &&
            this.state.currentPosition <= this.state.targetPosition
          ) {
            this.logger.info("Stopping close...");
            this.state.positionState = COVER_STOPPED;
            this.motorOpenLine?.setValue(0);
            this.motorCloseLine?.setValue(0);
          }
          break;
        case COVER_STOPPED:
          if (this.state.currentPosition !== this.state.targetPosition) {
            // Need to move
            if (this.state.currentPosition < this.state.targetPosition) {
              this.logger.info("Opening...");
              this.state.positionState = COVER_OPENING;
              this.motorOpenLine?.setValue(1);
              this.motorCloseLine?.setValue(0);
            } else if (this.state.currentPosition > this.state.targetPosition) {
              this.logger.info("Closing...");
              this.state.positionState = COVER_CLOSING;
              this.motorOpenLine?.setValue(0);
              this.motorCloseLine?.setValue(1);
            }
          }
          break;
      }

      if (this.state.positionState !== previousPositionState) {
        this.lastStateChangeTime = Date.now();
        this.positionAtLastStateChange = previousPosition;
      }

      if (
        this.calibrationInfo.calibrated &&
        this.state.positionState !== COVER_STOPPED
      ) {
        // Estimate position based on time elapsed since last state change
        const elapsedTime = Date.now() - this.lastStateChangeTime;

        if (this.state.positionState === COVER_OPENING) {
          const percentagePerMs = 100 / this.calibrationInfo.openTime;
          const positionChange = elapsedTime * percentagePerMs;
          this.state.currentPosition = Math.min(
            100,
            this.positionAtLastStateChange + positionChange
          );
        } else if (this.state.positionState === COVER_CLOSING) {
          const percentagePerMs = 100 / this.calibrationInfo.closeTime;
          const positionChange = elapsedTime * percentagePerMs;
          this.state.currentPosition = Math.max(
            0,
            this.positionAtLastStateChange - positionChange
          );
        }
      }

      // if limiter switches engage, stop the cover and set currentPosition to 0 or 100
      // but also ensure we give the cover time to move before checking limiters
      if (
        Date.now() - this.lastStateChangeTime > 5000 &&
        this.chip &&
        this.state.positionState !== COVER_STOPPED
      ) {
        if (this.closeLimiterLine.getValue() !== 0) {
          this.logger.info("Close limiter engaged - Stopping...");
          this.state.targetPosition = 0;
          this.state.currentPosition = 0;
        }
        if (this.openLimiterLine.getValue() !== 0) {
          this.logger.info("Open limiter engaged - Stopping...");
          this.state.targetPosition = 100;
          this.state.currentPosition = 100;
        }
      }

      // Emit change event if state changed
      if (
        this.state.positionState !== previousPositionState ||
        Math.abs(this.state.currentPosition - previousPosition) > 0.5
      ) {
        this.emit("change", { state: this.getState() });
      }
    }, 100);
  }

  getHardwareState(): any {
    if (this.chip) {
      return {
        motorOpen: this.motorOpenLine.getValue(),
        motorClose: this.motorCloseLine.getValue(),
        openLimiter: this.openLimiterLine.getValue(),
        closeLimiter: this.closeLimiterLine.getValue(),
      };
    }
    return {};
  }

  cleanup(): void {
    if (this.controlLoop) {
      clearInterval(this.controlLoop);
      this.controlLoop = null;
    }
    if (this.chip) {
      this.motorOpenLine?.release();
      this.motorCloseLine?.release();
      this.openLimiterLine?.release();
      this.closeLimiterLine?.release();
    }
    process.exit();
  }

  getState(): CoverState {
    return { ...this.state };
  }

  open(): void {
    this.logger.info("Open command received");
    if (Date.now() - this.lastStateChangeTime > 1000) {
      this.state.targetPosition = 100;
      this.waitForLimiter = this.chip ? true : false;
      this.logger.info(
        `Setting target position to ${this.state.targetPosition}`
      );
    }
  }

  close(): void {
    this.logger.info("Close command received");
    if (Date.now() - this.lastStateChangeTime > 1000) {
      this.state.targetPosition = 0;
      this.waitForLimiter = this.chip ? true : false;
      this.logger.info(
        `Setting target position to ${this.state.targetPosition}`
      );
    }
  }

  stop(): void {
    this.logger.info("Stop command received");
    this.state.targetPosition = this.state.currentPosition;
    this.waitForLimiter = false;
    this.logger.info(
      `Setting target position to ${this.state.currentPosition}`
    );
  }

  setTargetPosition(position: number): void {
    this.logger.info(`Set position command received: ${position}`);
    if (
      this.state.calibration === "calibrated" &&
      Date.now() - this.lastStateChangeTime > 1000
    ) {
      if (position < 0 || position > 100) {
        throw new Error("Position must be between 0 and 100");
      }
      this.state.targetPosition = position;
      this.waitForLimiter = this.chip
        ? position === 0 || position === 100
        : false;
      this.logger.info(`Setting target position to ${position}`);
    }
  }

  calibrate(): void {
    if (this.state.calibration === "inprogress") {
      return;
    }

    this.state.calibration = "inprogress";
    this.state.targetPosition = 0;

    let calibrationState = "INITIAL_CLOSE";
    let startTime: number;
    let calibrationLoop = setInterval(() => {
      switch (calibrationState) {
        case "INITIAL_CLOSE":
          this.state.targetPosition = 0;
          this.state.currentPosition = 100;
          this.state.positionState = COVER_CLOSING;
          calibrationState = "WAITING_FOR_INITIAL_CLOSE";
          break;
        case "WAITING_FOR_INITIAL_CLOSE":
          if (
            this.state.currentPosition === 0 &&
            this.state.positionState === COVER_STOPPED
          ) {
            startTime = Date.now();
            calibrationState = "WAITING_BEFORE_OPEN";
          }
          break;
        case "WAITING_BEFORE_OPEN":
          if (Date.now() - startTime > 2000) {
            this.state.targetPosition = 100;
            this.state.positionState = COVER_OPENING;
            startTime = Date.now();
            calibrationState = "OPENING";
          }
          break;
        case "OPENING":
          if (this.state.positionState === COVER_STOPPED) {
            this.calibrationInfo.openTime = Date.now() - startTime;
            startTime = Date.now();
            calibrationState = "WAITING_BEFORE_CLOSING";
          }
          break;
        case "WAITING_BEFORE_CLOSING":
          if (Date.now() - startTime > 2000) {
            this.state.targetPosition = 0;
            this.state.positionState = COVER_CLOSING;
            startTime = Date.now();
            calibrationState = "CLOSING";
          }
          break;
        case "CLOSING":
          if (this.state.positionState === COVER_STOPPED) {
            this.calibrationInfo.closeTime = Date.now() - startTime;
            this.calibrationInfo.calibrated = true;
            storage.setItem(
              config.COVER_KEY,
              JSON.stringify(this.calibrationInfo)
            );
            clearInterval(calibrationLoop);
            this.state.calibration = "calibrated";
            this.emit("change", { state: this.getState() });
          }
          break;
      }
    }, 100);
  }
}

export default CoverController;
