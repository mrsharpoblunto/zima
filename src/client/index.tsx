import React from "react";
import { createRoot } from "react-dom/client";
import {
  type CoverState,
  COVER_CLOSING,
  COVER_OPENING,
  COVER_STOPPED,
} from "../shared/cover-state.ts";
import { WaterCausticsCanvas } from "./WaterCausticsCanvas.tsx";
import {
  Settings,
  ChevronsUp,
  ChevronUp,
  Pause,
  ChevronDown,
  ChevronsDown,
  X,
  Loader2,
} from "lucide-react";

const LONGPOLL_TIMEOUT = 30000;

function useRemoteState(): [
  CoverState,
  (newState: Partial<CoverState>) => void
] {
  const [remoteState, setRemoteState] = React.useState<CoverState>({
    currentPosition: 0,
    targetPosition: 0,
    positionState: 2,
    calibrating: false,
  });

  const polling = React.useRef(false);

  const pollState = (state: CoverState) => {
    const startTime = new Date();
    const controller = new AbortController();
    const abortTimeout = setTimeout(
      () => controller.abort(),
      LONGPOLL_TIMEOUT + 5000
    );
    const visibilityChange = () => {
      if (document.hidden) {
        controller.abort();
      }
    };
    window.addEventListener("visibilitychange", visibilityChange);

    const pollNext = (state: CoverState) =>
      setTimeout(
        () => pollState(state),
        new Date().getTime() - startTime.getTime() < 1000 ? 1000 : 0
      );

    fetch(
      `/api/1/poll-state?state=${JSON.stringify(
        state
      )}&timeout=${LONGPOLL_TIMEOUT}`,
      {
        signal: controller.signal,
      }
    )
      .then((res) => res.json())
      .then((res) => {
        if (res.success && res.change) {
          setRemoteState(res.state as CoverState);
        }
        pollNext(res.state || state);
      })
      .catch((_err) => {
        pollNext(state);
      })
      .finally(() => {
        clearTimeout(abortTimeout);
        window.removeEventListener("visibilitychange", visibilityChange);
      });
  };

  if (!polling.current) {
    polling.current = true;
    pollState(remoteState);
  }

  const updateState = React.useCallback(
    (newState: Partial<CoverState>) => {
      setRemoteState((prevState) => ({
        ...prevState,
        ...newState,
      }));
    },
    [setRemoteState]
  );

  return [remoteState, updateState];
}

function open(updateState: (newState: Partial<CoverState>) => void) {
  const optimisticState = {
    targetPosition: 100,
    positionState: COVER_OPENING,
  };
  updateState(optimisticState);
  fetch("/api/1/set-position-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(optimisticState),
  });
}

function close(updateState: (newState: Partial<CoverState>) => void) {
  const optimisticState = {
    targetPosition: 0,
    positionState: COVER_CLOSING,
  };
  updateState(optimisticState);
  fetch("/api/1/set-position-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(optimisticState),
  });
}

function stop(updateState: (newState: Partial<CoverState>) => void) {
  const optimisticState = {
    positionState: COVER_STOPPED,
  };
  updateState(optimisticState);
  fetch("/api/1/set-position-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(optimisticState),
  });
}

function calibrate(updateState: (newState: Partial<CoverState>) => void) {
  const optimisticState = {
    calibrating: true,
  };
  updateState(optimisticState);
  fetch("/api/1/calibrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

function App() {
  const [state, updateState] = useRemoteState();
  return (
    <>
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        #app-container {
          background: #f2f2f2;
        }
        .wrapper {
          width: calc(100dvh * 0.5625);
          padding: 10px;
          height: 100dvh;
          max-width: 768px;
          display: flex;
          flex-direction: row;
          position: relative;
          box-sizing: border-box;
        }
        .pool-cover {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .pool-bench {
          margin-top: 16px;
          z-index: 2;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .pool-bench-slat {
          display: flex;
          height: 6px;
          background: linear-gradient(to bottom, #e6c9a3 0%, #ddb896 40%, #d4a680 100%);
          border-radius: 4px;
          border: 1px solid #c09570;
          margin: 1px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }
        .pool-cover-surface {
          z-index: 1;
          display: flex;
          flex-direction: column;
          position: absolute;
          top: 32px;
          left: 8px;
          right: 8px;
          transition: height 1.5s linear;
        }
        .pool-cover-surface-inner {
          flex: 1;
          margin-left: 8px;
          margin-right: 8px;
          background: radial-gradient(ellipse at center, #0080ff 0%, #0080ff 30%, #0060ff 80%, #0050ee 100%);
        }
        .pool-cover-surface-cap {
          height: 8px;
          background: linear-gradient(to bottom, #e0e0e0 0%, #b8b8b8 20%, #999999 50%, #b8b8b8 80%, #cccccc 100%);
          border-radius: 1px;
          border: 1px solid #666;
        }
        .pool {
          position: absolute;
          top: 96px;
          bottom: 32px;
          left: 20px;
          right: 20px;
          background: #00ccff;
          border-radius: 64px;
          border: 1px solid #00bbff;
          overflow: hidden;
          box-shadow: 0 0 12px 4px rgba(0, 0, 0, 0.15);
        }
        .controls {
          width: 64px;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px 8px;
          align-items: center;
        }
        .control-button {
          width: 48px;
          height: 48px;
          background: #333;
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
          font-size: 20px;
        }
        .control-button:hover {
          background: #444;
        }
        .control-button:active {
          background: #222;
        }
        .control-button.config {
          margin-top: 4px;
          margin-bottom: 16px;
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-dialog {
          background: white;
          border-radius: 12px;
          padding: 24px;
          max-width: 400px;
          width: 90%;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .modal-title {
          font-size: 20px;
          font-weight: bold;
          color: #333;
        }
        .modal-close {
          background: none;
          border: none;
          cursor: pointer;
          color: #666;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-close:hover {
          color: #333;
        }
        .modal-body {
          color: #666;
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .modal-footer {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
        .modal-button {
          padding: 10px 20px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.2s;
        }
        .modal-button.cancel {
          background: #e0e0e0;
          color: #333;
        }
        .modal-button.cancel:hover {
          background: #d0d0d0;
        }
        .modal-button.confirm {
          background: #333;
          color: white;
        }
        .modal-button.confirm:hover {
          background: #444;
        }
        .modal-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .modal-button:disabled:hover {
          background: #e0e0e0;
        }
        .modal-button.confirm:disabled:hover {
          background: #333;
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div className="wrapper">
        <PoolCover currentPosition={state.currentPosition} />
        <Controls state={state} updateState={updateState} />
      </div>
    </>
  );
}

function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PoolCover(props: { currentPosition: number }) {
  return (
    <div className="pool-cover">
      <div className="pool">
        <WaterCausticsCanvas />
      </div>
      <div
        className="pool-cover-surface"
        style={{
          height: `calc((100dvh - 100px) * ${
            (100 - props.currentPosition) / 100
          } + 50px)`,
        }}
      >
        <div className="pool-cover-surface-inner" />
        <div className="pool-cover-surface-cap" />
      </div>
      <div className="pool-bench">
        <div className="pool-bench-slat" />
        <div className="pool-bench-slat" />
        <div className="pool-bench-slat" />
        <div className="pool-bench-slat" />
        <div className="pool-bench-slat" />
        <div className="pool-bench-slat" />
        <div className="pool-bench-slat" />
      </div>
    </div>
  );
}

function Controls({
  state,
  updateState,
}: {
  state: CoverState;
  updateState: (newState: Partial<CoverState>) => void;
}) {
  const [showCalibrationModal, setShowCalibrationModal] = React.useState(false);

  const handleOpenHoldStart = () => {
    open(updateState);
  };

  const handleOpenHoldEnd = () => {
    stop(updateState);
  };

  const handleCloseHoldStart = () => {
    close(updateState);
  };

  const handleCloseHoldEnd = () => {
    stop(updateState);
  };

  const handleCalibrate = () => {
    calibrate(updateState);
    setShowCalibrationModal(false);
  };

  return (
    <>
      <Modal
        isOpen={showCalibrationModal || state.calibrating}
        onClose={() => {
          if (!state.calibrating) {
            setShowCalibrationModal(false);
          }
        }}
        title="Calibrate Pool Cover"
      >
        <div className="modal-body">
          Are you sure you want to calibrate the pool cover? This will reset the
          position tracking and may take several minutes to complete.
        </div>
        <div className="modal-footer">
          <button
            className="modal-button cancel"
            onClick={() => setShowCalibrationModal(false)}
            disabled={state.calibrating}
          >
            Cancel
          </button>
          <button
            className="modal-button confirm"
            onClick={handleCalibrate}
            disabled={state.calibrating}
          >
            {state.calibrating ? (
              <>
                <Loader2
                  size={16}
                  className="spinner"
                  style={{ marginRight: "8px", display: "inline-block" }}
                />
                Calibrating...
              </>
            ) : (
              "Confirm"
            )}
          </button>
        </div>
      </Modal>
      <div className="controls">
        <button
          className="control-button config"
          onClick={() => setShowCalibrationModal(true)}
        >
          <Settings size={24} />
        </button>
        <button className="control-button" onClick={() => open(updateState)}>
          <ChevronsUp size={24} />
        </button>
        <button
          className="control-button"
          onMouseDown={handleOpenHoldStart}
          onMouseUp={handleOpenHoldEnd}
          onMouseLeave={handleOpenHoldEnd}
          onTouchStart={handleOpenHoldStart}
          onTouchEnd={handleOpenHoldEnd}
        >
          <ChevronUp size={24} />
        </button>
        <button className="control-button" onClick={() => stop(updateState)}>
          <Pause size={24} />
        </button>
        <button
          className="control-button"
          onMouseDown={handleCloseHoldStart}
          onMouseUp={handleCloseHoldEnd}
          onMouseLeave={handleCloseHoldEnd}
          onTouchStart={handleCloseHoldStart}
          onTouchEnd={handleCloseHoldEnd}
        >
          <ChevronDown size={24} />
        </button>
        <button className="control-button" onClick={() => close(updateState)}>
          <ChevronsDown size={24} />
        </button>
      </div>
    </>
  );
}

window.onerror = function (message, source, lineno, colno, error) {
  fetch(`/api/1/report-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      source,
      lineno,
      colno,
      stack: error?.stack,
    }),
  });
  return false;
};

const container = document.getElementById("app-container");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
