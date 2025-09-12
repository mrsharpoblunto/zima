import React from "react";
import { createRoot } from "react-dom/client";
import {
  type CoverState,
  COVER_CLOSING,
  COVER_OPENING,
  COVER_STOPPED,
} from "../shared/cover-state.ts";

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
  return (
    <>
      <style>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: 'Pixelify Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #121212;
          color: #f5f5f5;
          overflow-x: hidden;
          image-rendering: pixelated;
        }
        
        #app-container {
          height: 100vh;
          width: 100vw;
          position: relative;
          margin: 0 auto;
          scroll-snap-type: y proximity;
          overflow-y: scroll;
        }
        
        .toggle-button {
          appearance: none;
          position: fixed;
          top: 8px;
          left: 8px;
          cursor: pointer;
          z-index: 100;
          border: none;
        }
        
        .toggle-switch {
          width: 96px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .toggle-slider {
          width: 96px;
          height: 48px;
          background-color: #121212;
          border: 4px solid #f5f5f5;
          position: relative;
          transition: all 0.2s ease;
        }
        
        .toggle-slider.on {
          background-color: #4CAF50;
        }
        
        .toggle-knob {
          position: absolute;
          left: 4px;
          top: 4px;
          width: 32px;
          height: 32px;
          background-color: #f5f5f5;
          transition: transform 0.2s ease;
        }
        
        .toggle-slider.on .toggle-knob {
          transform: translateX(48px);
        }
        
        .volume-button {
          position: fixed;
          top: 8px;
          right: calc(8px + env(scrollbar-width, 15px));
          z-index: 100;
        }
        
        .volume-control {
          width: 104px;
          height: 48px;
          cursor: pointer;
          position: relative;
        }
        
        .volume-control::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 104px;
          height: 48px;
          background-color: #f5f5f5;
          clip-path: polygon(0% 0%, 100% 100%, 0% 100%);
          z-index: 0;
        }
        
        .volume-triangle {
          position: absolute;
          top: 7px;
          left: 4px;
          width: 83px;
          height: 37px;
          background-color: #121212;
          clip-path: polygon(0% 0%, 100% 100%, 0% 100%);
          overflow: hidden;
          z-index: 1;
        }
        
        .volume-fill {
          position: absolute;
          top: 0;
          right: 0;
          height: 100%;
          background-color: #4CAF50;
          clip-path: polygon(0% 0%, 100% 100%, 0% 100%);
          z-index: 2;
        }
        
        .volume-slider {
          position: absolute;
          top: 0px;
          width: 8px;
          height: 56px;
          background-color: #f5f5f5;
          transform: translateX(-4px);
          z-index: 3;
        }
        
        .visualization-list {
          width: 100%;
          max-width: 860px;
          display: flex;
          flex-direction: column;
          margin: 0 auto;
        }
        
        .visualization-item {
          width: 100%;
          scroll-snap-align: start;
          cursor: pointer;
          display: flex;
          position: relative;
          aspect-ratio: 2/1;
        }
        
        .visualization-name {
          position: absolute;
          bottom: 4px;
          left: 8px;
          font-family: 'Pixelify Sans', monospace;
          color: white;
          font-size: 24px;
          z-index: 10;
        }
        
        .visualization-canvas {
          width: 100%;
          height: auto;
          display: block;
          transition: all 0.1s ease;
          border: 0px solid #ffffff;
        }

        .visualization-canvas.selected {
          border: 4px solid #ffffff;
        }
      `}</style>
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
