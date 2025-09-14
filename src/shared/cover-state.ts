export const COVER_CLOSING = 0;
export const COVER_OPENING = 1;
export const COVER_STOPPED = 2;

export type CoverState = {
  currentPosition: number;
  positionState: number;
  calibration: "uncalibrated" | "inprogress" | "calibrated";
};
