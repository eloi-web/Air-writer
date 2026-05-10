/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Hands, Results, LandmarkList } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

const COLORS = ['#02f71b', '#F0F0F0', '#FF3B30', '#007AFF', '#FFCC00', '#FF00FF'];

export default function App() {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarksCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const [activeColorIdx, setActiveColorIdx] = useState(0);
  const [brushSize, setBrushSize] = useState(8);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [isFisting, setIsFisting] = useState(false);

  // We keep mutable state in refs to avoid adding them to onResults dependencies
  const stateRef = useRef({
    color: COLORS[0],
    brushSize: 8,
    showLandmarks: false,
    isFisting: false,
    lastDrawPoint: null as { x: number, y: number } | null,
    canvasCtx: null as CanvasRenderingContext2D | null,
    landmarksCtx: null as CanvasRenderingContext2D | null,
  });

  // Sync state to refs
  useEffect(() => {
    stateRef.current.color = COLORS[activeColorIdx];
    stateRef.current.brushSize = brushSize;
    stateRef.current.showLandmarks = showLandmarks;
    stateRef.current.isFisting = isFisting;
  }, [activeColorIdx, brushSize, showLandmarks, isFisting]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && landmarksCanvasRef.current) {
        canvasRef.current.width = canvasRef.current.offsetWidth;
        canvasRef.current.height = canvasRef.current.offsetHeight;
        landmarksCanvasRef.current.width = landmarksCanvasRef.current.offsetWidth;
        landmarksCanvasRef.current.height = landmarksCanvasRef.current.offsetHeight;
        // Re-get contexts
        stateRef.current.canvasCtx = canvasRef.current.getContext('2d');
        stateRef.current.landmarksCtx = landmarksCanvasRef.current.getContext('2d');
      }
    };
    window.addEventListener('resize', handleResize);
    // Add small delay to ensure DOM is ready and styled
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [isStarted]);

  const clearCanvas = useCallback(() => {
    if (stateRef.current.canvasCtx && canvasRef.current) {
      stateRef.current.canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    // Visual feedback
    setIsFisting(true);
    setTimeout(() => setIsFisting(false), 500);
  }, []);

  const exportCanvas = useCallback(() => {
    if (!canvasRef.current || !webcamRef.current?.video) return;

    const composite = document.createElement('canvas');
    composite.width = canvasRef.current.width;
    composite.height = canvasRef.current.height;
    const ctx = composite.getContext('2d');
    if (!ctx) return;

    const video = webcamRef.current.video;
    const scale = Math.max(composite.width / video.videoWidth, composite.height / video.videoHeight);
    const offsetX = (composite.width - video.videoWidth * scale) / 2;
    const offsetY = (composite.height - video.videoHeight * scale) / 2;

    // Draw video flipped horizontally to match the screen view
    ctx.save();
    ctx.translate(composite.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, offsetX, offsetY, video.videoWidth * scale, video.videoHeight * scale);
    ctx.restore();

    // Draw the drawing canvas over it
    ctx.drawImage(canvasRef.current, 0, 0);

    const link = document.createElement('a');
    link.download = `AirWriter_${Date.now()}.png`;
    link.href = composite.toDataURL('image/png');
    link.click();
  }, []);

  const onResults = useCallback((results: Results) => {
    const { canvasCtx, landmarksCtx } = stateRef.current;
    if (!canvasCtx || !canvasRef.current || !landmarksCanvasRef.current || !webcamRef.current?.video) return;

    // Always clear landmarks canvas each frame
    if (landmarksCtx) landmarksCtx.clearRect(0, 0, landmarksCanvasRef.current.width, landmarksCanvasRef.current.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];

      // Calculate object-cover mapping
      const videoWidth = webcamRef.current.video.videoWidth;
      const videoHeight = webcamRef.current.video.videoHeight;
      const windowWidth = canvasRef.current.width;
      const windowHeight = canvasRef.current.height;
      if (!videoWidth || !videoHeight) return;

      const videoAspect = videoWidth / videoHeight;
      const windowAspect = windowWidth / windowHeight;

      const scale = Math.max(windowWidth / videoWidth, windowHeight / videoHeight);
      const offsetX = (windowWidth - videoWidth * scale) / 2;
      const offsetY = (windowHeight - videoHeight * scale) / 2;

      const mapCoords = (lm: any) => {
        // Mirrored X because the video is flipped via scale-x-[-1]
        const videoX = (1 - lm.x) * videoWidth;
        const videoY = lm.y * videoHeight;
        return {
          x: videoX * scale + offsetX,
          y: videoY * scale + offsetY
        };
      };

      // Draw landmarks if toggled
      if (stateRef.current.showLandmarks && landmarksCtx) {
        landmarksCtx.fillStyle = '#FF3B30';
        for (const lm of landmarks) {
          const pt = mapCoords(lm);
          landmarksCtx.beginPath();
          landmarksCtx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
          landmarksCtx.fill();
        }
      }

      // Extract keypoints for drawing
      const tip = landmarks[8]; // Index tip
      const thumb = landmarks[4]; // Thumb tip

      // 3D Distance using raw landmarks for more robust gesture detection
      const getDist3D = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

      const wrist3D = landmarks[0];
      const indexMcp3D = landmarks[5];
      const palmSize3D = getDist3D(wrist3D, indexMcp3D);

      const isCurled3D = (tipIdx: number) => {
        const tip3D = landmarks[tipIdx];
        const pip3D = landmarks[tipIdx - 2];
        const mcp3D = landmarks[tipIdx - 3];

        // A finger is curled if its tip is closer to the wrist than the PIP joint
        // This is scale-invariant and unaffected by hand orientation in 3D
        return getDist3D(tip3D, wrist3D) < getDist3D(pip3D, wrist3D) &&
          getDist3D(tip3D, mcp3D) < getDist3D(pip3D, mcp3D);
      };

      // FIST: require all 4 fingers (index, middle, ring, pinky) to be curled
      const fist = isCurled3D(8) && isCurled3D(12) && isCurled3D(16) && isCurled3D(20);

      // PINCH (Draw)
      const pinchDist3D = getDist3D(thumb, tip);

      // Hysteresis for pinch: easier to maintain a pinch than to start one
      const wasDrawing = !!stateRef.current.lastDrawPoint;
      const pinchThreshold = wasDrawing ? (palmSize3D * 1.5) : (palmSize3D * 1.1);

      // If we are making a fist, it's definitely not a pinch (prevents false positive drawing while clearing)
      const isDrawing = (pinchDist3D < pinchThreshold) && !fist;

      // Screen space coords for drawing
      const tipPos = mapCoords(tip);
      const thumbPos = mapCoords(thumb);
      const drawCenter = { x: (tipPos.x + thumbPos.x) / 2, y: (tipPos.y + thumbPos.y) / 2 };

      if (fist) {
        // Fist to clear
        if (!stateRef.current.isFisting) {
          clearCanvas();
        }
        stateRef.current.lastDrawPoint = null;
      } else if (isDrawing) {
        // DRAW
        if (stateRef.current.lastDrawPoint) {
          canvasCtx.beginPath();
          canvasCtx.moveTo(stateRef.current.lastDrawPoint.x, stateRef.current.lastDrawPoint.y);
          canvasCtx.lineTo(drawCenter.x, drawCenter.y);
          canvasCtx.strokeStyle = stateRef.current.color;
          canvasCtx.lineWidth = stateRef.current.brushSize;
          canvasCtx.lineCap = 'round';
          canvasCtx.lineJoin = 'round';

          // Glow effect
          canvasCtx.shadowBlur = Math.max(10, stateRef.current.brushSize * 1.5);
          canvasCtx.shadowColor = stateRef.current.color;

          canvasCtx.stroke();
          canvasCtx.shadowBlur = 0; // reset
        }
        stateRef.current.lastDrawPoint = drawCenter;

        // Draw active cursor on landmarks canvas
        if (landmarksCtx && !stateRef.current.showLandmarks) {
          landmarksCtx.beginPath();
          landmarksCtx.arc(drawCenter.x, drawCenter.y, stateRef.current.brushSize / 2 + 2, 0, 2 * Math.PI);
          landmarksCtx.fillStyle = '#FFFFFF';
          landmarksCtx.shadowBlur = 15;
          landmarksCtx.shadowColor = '#FFFFFF';
          landmarksCtx.fill();
          landmarksCtx.shadowBlur = 0;
        }
      } else {
        // HOVER
        stateRef.current.lastDrawPoint = null;

        // Draw hover cursor on landmarks canvas
        if (landmarksCtx && !stateRef.current.showLandmarks) {
          landmarksCtx.beginPath();
          landmarksCtx.arc(tipPos.x, tipPos.y, stateRef.current.brushSize / 2 + 2, 0, 2 * Math.PI);
          landmarksCtx.fillStyle = stateRef.current.color;
          landmarksCtx.globalAlpha = 0.5;
          landmarksCtx.fill();
          landmarksCtx.globalAlpha = 1.0;
        }
      }
    } else {
      // No hands detected
      stateRef.current.lastDrawPoint = null;
    }
  }, [clearCanvas]);

  useEffect(() => {
    if (!isStarted) return;
    let isMounted = true;
    let hands: Hands | null = null;
    let camera: Camera | null = null;

    const setupMediaPipe = async () => {
      try {
        hands = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0,
          minDetectionConfidence: 0.3,
          minTrackingConfidence: 0.3
        });

        hands.onResults(onResults);

        if (webcamRef.current?.video) {
          camera = new Camera(webcamRef.current.video, {
            onFrame: async () => {
              if (!isMounted) return;
              if (webcamRef.current?.video && hands) {
                try {
                  await hands.send({ image: webcamRef.current.video });
                } catch (e) {
                  console.error("Camera frame send error:", e);
                }
              }
            }
          });
          camera.start().then(() => {
            if (isMounted) setIsReady(true);
          });
        }
      } catch (err) {
        console.error("MediaPipe Init Error:", err);
      }
    };

    // Small delay to ensure webcam element is ready
    const timer = setTimeout(() => {
      if (isMounted) setupMediaPipe();
    }, 1000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (camera) {
        camera.stop();
      }
      if (hands) {
        try {
          hands.close();
        } catch (e) { }
      }
    };
  }, [onResults, isStarted]);

  return (
    <div className={`text-on-background h-screen w-screen flex flex-col overflow-hidden font-body-md relative bg-[#000000] transition-colors duration-500`}>
      {/* INITIAL PROMPT STATE */}
      {!isStarted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-[100] bg-black/95 backdrop-blur-lg px-4 sm:px-8">
          <h1 className="font-mono text-4xl sm:text-5xl md:text-6xl font-bold text-primary mb-6 tracking-[0.2em] drop-shadow-[0_0_15px_rgba(240,240,240,0.8)] text-center break-keep">
            AIR WRITER
          </h1>
          <p className="font-sans text-secondary mb-12 max-w-[500px] w-full text-center leading-relaxed text-base sm:text-lg">
            Hold up your hand to move the cursor.<br />
            Pinch your index and thumb to draw.<br />
            Make a fist to clear the canvas.
          </p>
          <button
            onClick={() => setIsStarted(true)}
            className="bg-primary text-on-primary px-8 sm:px-10 py-3 sm:py-4 rounded-full font-bold uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-transform flex items-center justify-center gap-3 text-xs sm:text-sm shrink-0 w-max"
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>videocam</span>
            Start Camera
          </button>
        </div>
      )}

      {/* CAMERA & CANVAS CONTAINER */}
      {isStarted && (
        <div className="absolute inset-0 md:p-lg flex items-center justify-center z-0 pointer-events-none">
          <div className="relative w-full h-full md:max-w-6xl md:max-h-[85vh] md:rounded-[3rem] overflow-hidden glass-panel-active md:border md:border-outline-variant/30 flex items-center justify-center pointer-events-auto bg-black/50">
            <Webcam
              ref={webcamRef}
              className="absolute inset-0 w-full h-full object-cover object-center opacity-60 mix-blend-screen"
              mirrored={true}
              videoConstraints={{
                facingMode: "user"
              }}
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-none w-full h-full object-cover"
            />
            <canvas
              ref={landmarksCanvasRef}
              className="absolute inset-0 pointer-events-none w-full h-full object-cover z-10"
            />
            <div className={`absolute inset-0 pointer-events-none bg-white transition-opacity duration-300 z-20 ${isFisting ? 'opacity-20' : 'opacity-0'}`} />
          </div>
        </div>
      )}

      {/* TopAppBar */}
      <header className="bg-transparent flex justify-between items-center w-full px-lg py-md fixed top-0 left-0 z-50 pointer-events-none">
        <div className="font-headline-md text-headline-xl text-primary tracking-widest drop-shadow-[0_0_10px_rgba(240,240,240,0.5)]">
          AIR WRITER
        </div>
        <div className="flex items-center gap-sm pointer-events-auto">
          <a href="#" className="text-secondary hover:text-primary transition-colors p-sm rounded-full glass-panel scale-95 hover:scale-100 transition-transform">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>
      </header>

      {/* Main Content Info */}
      {isStarted && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none bg-black/80 backdrop-blur-sm">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
          <p className="font-headline-md text-primary tracking-widest animate-pulse">WARMING UP CAMERA...</p>
        </div>
      )}

      {/* HUD Info */}
      {isStarted && isReady && (
        <>
          <div className="absolute top-24 left-4 sm:left-lg glass-panel px-3 sm:px-md py-2 sm:py-sm rounded-2xl flex flex-col gap-1 sm:gap-sm border border-outline-variant/20 z-40 pointer-events-none">
            <div className="flex items-center gap-2 opacity-80">
              <span className="material-symbols-outlined text-primary text-[16px] sm:text-[18px]">pinch</span>
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-on-surface uppercase tracking-widest">Pinch to Draw</span>
            </div>
            <div className="flex items-center gap-2 opacity-80">
              <span className="material-symbols-outlined text-primary text-[16px] sm:text-[18px]">front_hand</span>
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-on-surface uppercase tracking-widest">Fist to Clear</span>
            </div>
          </div>

          <div className="absolute top-24 right-4 sm:right-md bg-surface-container-highest/80 backdrop-blur-md px-2 sm:px-sm py-1 rounded-full flex items-center gap-2 border border-[#02f71b]/30 z-40">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-xl px-3 sm:px-4 py-1 sm:py-1.5 rounded-full border border-[#02f71b]/10">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-[#02f71b] animate-pulse shadow-[0_0_12px_#02f71b]"></div>
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-[#02f71b] tracking-[0.2em]">TRACKING</span>
            </div>
          </div>

          {/* Bottom Nav / Controls */}
          <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[95%] md:w-max max-w-[500px] md:max-w-none z-50 flex flex-col md:flex-row gap-3 md:gap-md p-3 md:p-sm glass-panel bg-surface-container/80 rounded-[2rem] md:rounded-full backdrop-blur-xl border border-outline-variant/10 shadow-2xl items-center pointer-events-auto">

            {/* Top row on mobile: Colors and Brush size */}
            <div className="flex w-full md:w-auto items-center justify-between md:justify-start gap-4 md:gap-2 px-2 md:border-r md:border-outline-variant/30 md:pr-4">
              {/* Colors */}
              <div className="flex gap-2 overflow-x-auto hide-scrollbar scroll-smooth snap-x pb-1 md:pb-0">
                {COLORS.map((color, idx) => (
                  <button
                    key={color}
                    onClick={() => setActiveColorIdx(idx)}
                    className={`shrink-0 snap-center w-8 h-8 md:w-10 md:h-10 rounded-full border-2 transition-all duration-200 ${activeColorIdx === idx ? 'border-primary shadow-[0_0_15px_rgba(255,255,255,0.7)] scale-110' : 'border-transparent hover:border-primary/50'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Brush Size */}
            <div className="flex w-full md:w-auto items-center justify-between md:justify-center gap-3 px-2 md:px-4 md:border-r md:border-outline-variant/30">
              <span className="material-symbols-outlined text-secondary text-sm">line_weight</span>
              <input
                type="range"
                min="2" max="30"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="flex-grow md:w-32 accent-primary h-1.5 bg-surface-variant rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Actions */}
            <div className="flex w-full md:w-auto items-center justify-around md:justify-center gap-1 px-1 pt-2 border-t border-outline-variant/30 md:border-t-0 md:pt-0">
              <button
                onClick={() => setShowLandmarks(s => !s)}
                className={`flex flex-col items-center justify-center py-2 px-1 sm:px-3 rounded-xl transition-all w-16 sm:w-20 md:w-24 ${showLandmarks ? 'bg-[#02f71b]/20 text-[#02f71b]' : 'text-on-surface-variant hover:text-primary hover:bg-white/5'}`}
              >
                <span className="material-symbols-outlined mb-1 text-[20px] sm:text-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>visibility</span>
                <span className="font-sans text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Marks</span>
              </button>

              <button
                onClick={exportCanvas}
                className="flex flex-col items-center justify-center text-on-surface-variant hover:text-primary hover:bg-white/5 transition-colors py-2 px-1 sm:px-3 rounded-xl w-16 sm:w-20 md:w-24"
              >
                <span className="material-symbols-outlined mb-1 text-[20px] sm:text-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>photo_camera</span>
                <span className="font-sans text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Save</span>
              </button>

              <button
                onClick={clearCanvas}
                className="flex flex-col items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors py-2 px-1 sm:px-3 rounded-xl w-16 sm:w-20 md:w-24"
              >
                <span className="material-symbols-outlined mb-1 text-[20px] sm:text-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>delete_sweep</span>
                <span className="font-sans text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Clear</span>
              </button>

              <div className="hidden md:block w-px h-8 bg-outline-variant/30 my-auto mx-1"></div>

              <button
                onClick={() => {
                  setIsStarted(false);
                  setIsReady(false);
                }}
                className="flex flex-col items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors py-2 px-1 sm:px-3 rounded-xl w-16 sm:w-20 md:w-24"
              >
                <span className="material-symbols-outlined mb-1 text-[20px] sm:text-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>stop_circle</span>
                <span className="font-sans text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Stop</span>
              </button>
            </div>

          </nav>
        </>
      )}
    </div>
  );
}

