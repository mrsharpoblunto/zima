import * as hap from "hap-nodejs";
import * as config from "./config.ts";
import { type CoverState } from "../shared/cover-state.ts";
import CoverController from "./cover-controller.ts";

export default function (coverController: CoverController): hap.Accessory {
  const accessoryUUID = hap.uuid.generate("hap-nodejs:accessories:zima");

  const cover = new hap.Accessory("Zima", accessoryUUID);

  cover
    .getService(hap.Service.AccessoryInformation)!
    .setCharacteristic(hap.Characteristic.Manufacturer, config.MANUFACTURER)
    .setCharacteristic(hap.Characteristic.Model, config.MODEL)
    .setCharacteristic(hap.Characteristic.SerialNumber, config.SERIAL);

  const service = cover.addService(hap.Service.Door, "Pool Cover");

  // We can only get this characteristic to 0 (CLOSED) or 100 (OPEN)
  service
    .getCharacteristic(hap.Characteristic.CurrentPosition)
    .on("get", function (cb: (error: Error | null, value?: number) => void) {
      cb(null, coverController.getState().currentPosition);
    });

  // We can only set this characteristic to 0 (CLOSED) or 100 (OPEN)
  service
    .getCharacteristic(hap.Characteristic.TargetPosition)
    .on(
      "set",
      function (value: hap.CharacteristicValue, cb: (error?: Error) => void) {
        try {
          coverController.setTargetPosition(value as number);
          cb();
        } catch (err: any) {
          cb(err);
        }
      }
    )
    .on("get", function (cb: (error: Error | null, value?: number) => void) {
      cb(null, coverController.getTargetPosition());
    });

  // We can only set this characteristic to 0 (DECREASING), 1 (INCREASING) or 2 (STOPPED)
  service
    .getCharacteristic(hap.Characteristic.PositionState)
    .on(
      "set",
      function (value: hap.CharacteristicValue, cb: (error?: Error) => void) {
        try {
          if (value === hap.Characteristic.PositionState.DECREASING) {
            coverController.close();
          } else if (value === hap.Characteristic.PositionState.INCREASING) {
            coverController.open();
          } else if (value === hap.Characteristic.PositionState.STOPPED) {
            coverController.stop();
          }
          cb();
        } catch (err: any) {
          cb(err);
        }
      }
    )
    .on("get", function (cb: (error: Error | null, value?: number) => void) {
      cb(null, coverController.getState().positionState);
    });

  coverController.on("change", function ({ state }: { state: CoverState }) {
    service
      .getCharacteristic(hap.Characteristic.CurrentPosition)
      .updateValue(state.currentPosition);
    const target = coverController.getTargetPosition();
    service
      .getCharacteristic(hap.Characteristic.TargetPosition)
      .updateValue(target);
    service
      .getCharacteristic(hap.Characteristic.PositionState)
      .updateValue(state.positionState);
  });

  return cover;
}
