import { EventEmitter } from "events";
import * as config from "./config.ts";
import {
  CoverState,
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

  private closeLimiterGPIO: any;
  private openLimiterGPIO: any;
  private motorOpenGPIO: any;
  private motorCloseGPIO: any;

  constructor() {
    super();

    this.state = {
      currentPosition: 0,
      targetPosition: 0,
      positionState: COVER_STOPPED,
      calibrating: false,
    };
    this.calibrationInfo = {
      calibrated: false,
      openTime: 60000,
      closeTime: 60000,
    };
    this.lastStateChangeTime = Date.now();
    this.positionAtLastStateChange = 0;
    this.controlLoop = null;

    try {
      // onoff uses EPOLL which is only available on Linux
      const onoff = require("onoff");
      this.closeLimiterGPIO = new onoff.Gpio(config.CLOSE_LIMITER_GPIO, "in");
      this.openLimiterGPIO = new onoff.Gpio(config.OPEN_LIMITER_GPIO, "in");
      this.motorOpenGPIO = new onoff.Gpio(config.MOTOR_OPEN_GPIO, "out");
      this.motorCloseGPIO = new onoff.Gpio(config.MOTOR_CLOSE_GPIO, "out");
    } catch (err) {
      this.closeLimiterGPIO = null;
      this.openLimiterGPIO = null;
      this.motorOpenGPIO = null;
      this.motorCloseGPIO = null;
    }

    storage
      .getItem(config.COVER_KEY)
      .then((data) => {
        if (data) {
          try {
            this.calibrationInfo = JSON.parse(data) as CoverCalibrationInfo;
          } catch (err) {}
        }
      })
      .finally(() => {
        this.startPolling();
      });
  }

  startPolling(): void {
    this.controlLoop = setInterval(() => {
      const previousPositionState = this.state.positionState;
      const previousPosition = this.state.currentPosition;

      if (this.state.currentPosition < this.state.targetPosition) {
        this.state.positionState = COVER_OPENING;
        this.motorCloseGPIO?.writeSync(0);
        this.motorOpenGPIO?.writeSync(1);
      } else if (this.state.currentPosition > this.state.targetPosition) {
        this.state.positionState = COVER_CLOSING;
        this.motorOpenGPIO?.writeSync(0);
        this.motorCloseGPIO?.writeSync(1);
      } else {
        this.state.positionState = COVER_STOPPED;
        this.motorOpenGPIO?.writeSync(0);
        this.motorCloseGPIO?.writeSync(0);
      }

      if (this.state.positionState !== previousPositionState) {
        this.lastStateChangeTime = Date.now();
        this.positionAtLastStateChange = previousPosition;
      }

      if (
        this.calibrationInfo.calibrated &&
        this.state.positionState !== COVER_STOPPED &&
        this.state.targetPosition !== this.state.currentPosition
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
        this.openLimiterGPIO &&
        this.closeLimiterGPIO
      ) {
        if (this.closeLimiterGPIO.readSync() !== 0) {
          this.motorCloseGPIO?.writeSync(0);
          this.motorOpenGPIO?.writeSync(0);
          this.state.positionState = COVER_STOPPED;
          this.state.targetPosition = 0;
          this.state.currentPosition = 0;
        }
        if (this.openLimiterGPIO.readSync() !== 0) {
          this.motorCloseGPIO?.writeSync(0);
          this.motorOpenGPIO?.writeSync(0);
          this.state.positionState = COVER_STOPPED;
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

  stopPolling(): void {
    if (this.controlLoop) {
      clearInterval(this.controlLoop);
      this.controlLoop = null;
    }
  }

  getState(): CoverState {
    return { ...this.state };
  }

  open(): void {
    if (!this.state.calibrating) {
      this.state.targetPosition = 100;
    }
  }

  close(): void {
    if (!this.state.calibrating) {
      this.state.targetPosition = 0;
    }
  }

  stop(): void {
    if (!this.state.calibrating) {
      this.state.targetPosition = this.state.currentPosition;
    }
  }

  setTargetPosition(position: number): void {
    if (!this.state.calibrating) {
      if (position < 0 || position > 100) {
        throw new Error("Position must be between 0 and 100");
      }
      this.state.targetPosition = position;
    }
  }

  calibrate(): void {
    if (this.state.calibrating) {
      return;
    }

    this.state.calibrating = true;
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
            this.state.calibrating = false;
            this.emit("change", { state: this.getState() });
          }
          break;
      }
    }, 100);
  }
}

export default CoverController;
