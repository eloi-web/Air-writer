/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Hands, Results } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

const COLORS = ['#02f71b', '#F0F0F0', '#FF3B30', '#007AFF', '#FFCC00', '#FF00FF'];

// Stroke smoothing: exponential moving average factor (0=no smoothing, 1=full lag)
const SMOOTHING = 0.5;

// How many frames a finger must hover over a color swatch to select it
const COLOR_DWELL_FRAMES = 45; // ~1.5s at 30fps

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
  const [isErasing, setIsErasing] = useState(false);
  // dwellIdx: which color swatch the right-hand index is hovering (-1 = none), dwellProgress 0–1
  const [dwellIdx, setDwellIdx] = useState(-1);
  const [dwellProgress, setDwellProgress] = useState(0);

  // Undo history: array of ImageData snapshots
  const undoStackRef = useRef<ImageData[]>([]);
  // Color swatch DOM refs for gesture hit-testing
  const colorSwatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // We keep mutable state in refs to avoid adding them to onResults dependencies
  const stateRef = useRef({
    color: COLORS[0],
    brushSize: 8,
    showLandmarks: false,
    isFisting: false,
    isErasing: false,
    lastDrawPoint: null as { x: number, y: number } | null,
    smoothedPoint: null as { x: number, y: number } | null,
    canvasCtx: null as CanvasRenderingContext2D | null,
    landmarksCtx: null as CanvasRenderingContext2D | null,
    // color dwell tracking
    dwellIdx: -1,
    dwellFrames: 0,
    // left-hand undo pinch tracking
    leftPinchWasActive: false,
    leftFistWasActive: false,
  });

  // Sync state to refs
  useEffect(() => {
    stateRef.current.color = COLORS[activeColorIdx];
    stateRef.current.brushSize = brushSize;
    stateRef.current.showLandmarks = showLandmarks;
    stateRef.current.isFisting = isFisting;
    stateRef.current.isErasing = isErasing;
  }, [activeColorIdx, brushSize, showLandmarks, isFisting, isErasing]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && landmarksCanvasRef.current) {
        // Save current drawing before resize
        const ctx = canvasRef.current.getContext('2d');
        let saved: ImageData | null = null;
        if (ctx && canvasRef.current.width > 0 && canvasRef.current.height > 0) {
          saved = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        canvasRef.current.width = canvasRef.current.offsetWidth;
        canvasRef.current.height = canvasRef.current.offsetHeight;
        landmarksCanvasRef.current.width = landmarksCanvasRef.current.offsetWidth;
        landmarksCanvasRef.current.height = landmarksCanvasRef.current.offsetHeight;
        stateRef.current.canvasCtx = canvasRef.current.getContext('2d');
        stateRef.current.landmarksCtx = landmarksCanvasRef.current.getContext('2d');

        if (saved && stateRef.current.canvasCtx) {
          stateRef.current.canvasCtx.putImageData(saved, 0, 0);
        }
      }
    };
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [isStarted]);

  // Keyboard undo: Ctrl+Z
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoLastStroke();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Save current canvas state to undo stack (call before each stroke)
  const saveSnapshot = useCallback(() => {
    const ctx = stateRef.current.canvasCtx;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || canvas.width === 0 || canvas.height === 0) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStackRef.current.push(snapshot);
    // Keep max 20 snapshots to avoid memory bloat
    if (undoStackRef.current.length > 20) undoStackRef.current.shift();
  }, []);

  const undoLastStroke = useCallback(() => {
    const ctx = stateRef.current.canvasCtx;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    stateRef.current.lastDrawPoint = null;
    stateRef.current.smoothedPoint = null;
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = stateRef.current.canvasCtx;
    const canvas = canvasRef.current;
    if (ctx && canvas) {
      saveSnapshot();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setIsFisting(true);
    setTimeout(() => setIsFisting(false), 500);
  }, [saveSnapshot]);

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

    ctx.save();
    ctx.translate(composite.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, offsetX, offsetY, video.videoWidth * scale, video.videoHeight * scale);
    ctx.restore();

    ctx.drawImage(canvasRef.current, 0, 0);

    const link = document.createElement('a');
    link.download = `AirWriter_${Date.now()}.png`;
    link.href = composite.toDataURL('image/png');
    link.click();
  }, []);

  const onResults = useCallback((results: Results) => {
    const { canvasCtx, landmarksCtx } = stateRef.current;
    if (!canvasCtx || !canvasRef.current || !landmarksCanvasRef.current || !webcamRef.current?.video) return;

    if (landmarksCtx) landmarksCtx.clearRect(0, 0, landmarksCanvasRef.current.width, landmarksCanvasRef.current.height);

    const videoWidth = webcamRef.current.video.videoWidth;
    const videoHeight = webcamRef.current.video.videoHeight;
    const windowWidth = canvasRef.current.width;
    const windowHeight = canvasRef.current.height;
    if (!videoWidth || !videoHeight) return;

    const scale = Math.max(windowWidth / videoWidth, windowHeight / videoHeight);
    const offsetX = (windowWidth - videoWidth * scale) / 2;
    const offsetY = (windowHeight - videoHeight * scale) / 2;

    const mapCoords = (lm: any) => ({
      x: (1 - lm.x) * videoWidth * scale + offsetX,
      y: lm.y * videoHeight * scale + offsetY,
    });

    const getDist3D = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

    const isCurled3D = (landmarks: any[], tipIdx: number) => {
      const tip3D = landmarks[tipIdx];
      const pip3D = landmarks[tipIdx - 2];
      const mcp3D = landmarks[tipIdx - 3];
      const wrist3D = landmarks[0];
      return getDist3D(tip3D, wrist3D) < getDist3D(pip3D, wrist3D) &&
        getDist3D(tip3D, mcp3D) < getDist3D(pip3D, mcp3D);
    };

    // ─── SEPARATE HANDS BY HANDEDNESS ───────────────────────────────────────
    let rightLandmarks: any[] | null = null;
    let leftLandmarks: any[] | null = null;

    if (results.multiHandLandmarks && results.multiHandedness) {
      results.multiHandLandmarks.forEach((lm, i) => {
        // MediaPipe labels from camera's perspective; mirrored video flips left/right
        const label = results.multiHandedness![i]?.label;
        if (label === 'Left') rightLandmarks = lm;   // camera-left = user-right (mirrored)
        else leftLandmarks = lm;
      });
    }

    // ─── LEFT HAND: UNDO (pinch) and CLEAR (fist) ───────────────────────────
    if (leftLandmarks) {
      const lm = leftLandmarks as any[];
      const wrist3D = lm[0];
      const palmSize3D = getDist3D(wrist3D, lm[5]);
      const thumb = lm[4];
      const indexTip = lm[8];
      const leftFist = isCurled3D(lm, 8) && isCurled3D(lm, 12) && isCurled3D(lm, 16) && isCurled3D(lm, 20);
      const leftPinch = getDist3D(thumb, indexTip) < palmSize3D * 0.7;

      if (leftFist && !stateRef.current.leftFistWasActive) {
        clearCanvas();
      }
      stateRef.current.leftFistWasActive = leftFist;

      if (leftPinch && !stateRef.current.leftPinchWasActive) {
        undoLastStroke();
      }
      stateRef.current.leftPinchWasActive = leftPinch;

      // Draw left-hand indicator
      if (landmarksCtx) {
        const tipPos = mapCoords(indexTip);
        landmarksCtx.beginPath();
        landmarksCtx.arc(tipPos.x, tipPos.y, 12, 0, 2 * Math.PI);
        landmarksCtx.fillStyle = leftPinch ? 'rgba(255,200,0,0.7)' : leftFist ? 'rgba(255,60,60,0.7)' : 'rgba(255,200,0,0.3)';
        landmarksCtx.fill();
      }
    } else {
      stateRef.current.leftFistWasActive = false;
      stateRef.current.leftPinchWasActive = false;
    }

    // ─── RIGHT HAND: DRAW / ERASE / COLOR PICK ──────────────────────────────
    if (rightLandmarks) {
      const lm = rightLandmarks as any[];
      const wrist3D = lm[0];
      const palmSize3D = getDist3D(wrist3D, lm[5]);
      const tip = lm[8];
      const thumb = lm[4];

      const fist = isCurled3D(lm, 8) && isCurled3D(lm, 12) && isCurled3D(lm, 16) && isCurled3D(lm, 20);

      // ERASER: only middle finger extended, rest curled (index, ring, pinky curled)
      const eraserGesture = isCurled3D(lm, 8) && !isCurled3D(lm, 12) && isCurled3D(lm, 16) && isCurled3D(lm, 20);
      setIsErasing(eraserGesture);
      stateRef.current.isErasing = eraserGesture;

      // Landmark display
      if (stateRef.current.showLandmarks && landmarksCtx) {
        landmarksCtx.fillStyle = '#FF3B30';
        for (const point of lm) {
          const pt = mapCoords(point);
          landmarksCtx.beginPath();
          landmarksCtx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
          landmarksCtx.fill();
        }
      }

      const tipPos = mapCoords(tip);
      const thumbPos = mapCoords(thumb);
      const middleTip = lm[12];
      const middlePos = mapCoords(middleTip);

      // PINCH detection with hysteresis
      const pinchDist3D = getDist3D(thumb, tip);
      const wasDrawing = !!stateRef.current.lastDrawPoint;
      const pinchThreshold = wasDrawing ? palmSize3D * 1.5 : palmSize3D * 1.1;
      const isPinching = pinchDist3D < pinchThreshold && !fist;

      // Active draw point: midpoint of pinch
      const rawPoint = { x: (tipPos.x + thumbPos.x) / 2, y: (tipPos.y + thumbPos.y) / 2 };

      // Eraser uses middle fingertip as draw point
      const erasePoint = middlePos;

      // ── COLOR PICKER VIA DWELL ─────────────────────────────────────────────
      // Only do color dwell when NOT drawing/erasing
      if (!isPinching && !eraserGesture) {
        let foundSwatchIdx = -1;
        const swatchRefs = colorSwatchRefs.current;
        for (let i = 0; i < swatchRefs.length; i++) {
          const el = swatchRefs[i];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          // Convert tipPos (canvas px) to screen px
          const canvasEl = landmarksCanvasRef.current!;
          const canvasRect = canvasEl.getBoundingClientRect();
          const screenX = canvasRect.left + tipPos.x * (canvasRect.width / canvasEl.width);
          const screenY = canvasRect.top + tipPos.y * (canvasRect.height / canvasEl.height);
          if (screenX >= rect.left && screenX <= rect.right && screenY >= rect.top && screenY <= rect.bottom) {
            foundSwatchIdx = i;
            break;
          }
        }

        if (foundSwatchIdx !== -1 && foundSwatchIdx === stateRef.current.dwellIdx) {
          stateRef.current.dwellFrames++;
          const progress = stateRef.current.dwellFrames / COLOR_DWELL_FRAMES;
          setDwellProgress(Math.min(progress, 1));
          if (stateRef.current.dwellFrames >= COLOR_DWELL_FRAMES) {
            setActiveColorIdx(foundSwatchIdx);
            stateRef.current.color = COLORS[foundSwatchIdx];
            stateRef.current.dwellFrames = 0;
            setDwellProgress(0);
          }
        } else {
          stateRef.current.dwellIdx = foundSwatchIdx;
          stateRef.current.dwellFrames = 0;
          setDwellIdx(foundSwatchIdx);
          setDwellProgress(0);
        }
      } else {
        stateRef.current.dwellIdx = -1;
        stateRef.current.dwellFrames = 0;
        setDwellIdx(-1);
        setDwellProgress(0);
      }

      // ── DRAW / ERASE ────────────────────────────────────────────────────────
      const activePoint = eraserGesture ? erasePoint : rawPoint;

      // Smooth the point via exponential moving average
      if (stateRef.current.smoothedPoint) {
        stateRef.current.smoothedPoint = {
          x: stateRef.current.smoothedPoint.x * SMOOTHING + activePoint.x * (1 - SMOOTHING),
          y: stateRef.current.smoothedPoint.y * SMOOTHING + activePoint.y * (1 - SMOOTHING),
        };
      } else {
        stateRef.current.smoothedPoint = { ...activePoint };
      }
      const smoothed = stateRef.current.smoothedPoint;

      if (fist && !eraserGesture) {
        // Right-hand fist only clears when NO left hand (left hand handles undo/clear)
        if (!leftLandmarks && !stateRef.current.isFisting) {
          clearCanvas();
        }
        stateRef.current.lastDrawPoint = null;
        stateRef.current.smoothedPoint = null;
      } else if (isPinching || eraserGesture) {
        if (stateRef.current.lastDrawPoint) {
          // Save snapshot at stroke start (first segment)
          if (!wasDrawing) saveSnapshot();

          canvasCtx.beginPath();
          canvasCtx.moveTo(stateRef.current.lastDrawPoint.x, stateRef.current.lastDrawPoint.y);
          canvasCtx.lineTo(smoothed.x, smoothed.y);
          canvasCtx.lineWidth = eraserGesture ? stateRef.current.brushSize * 3 : stateRef.current.brushSize;
          canvasCtx.lineCap = 'round';
          canvasCtx.lineJoin = 'round';

          if (eraserGesture) {
            canvasCtx.globalCompositeOperation = 'destination-out';
            canvasCtx.strokeStyle = 'rgba(0,0,0,1)';
            canvasCtx.shadowBlur = 0;
          } else {
            canvasCtx.globalCompositeOperation = 'source-over';
            canvasCtx.strokeStyle = stateRef.current.color;
            canvasCtx.shadowBlur = Math.max(10, stateRef.current.brushSize * 1.5);
            canvasCtx.shadowColor = stateRef.current.color;
          }
          canvasCtx.stroke();
          canvasCtx.shadowBlur = 0;
          canvasCtx.globalCompositeOperation = 'source-over';
        } else {
          // Stroke just started — save snapshot before first draw
          saveSnapshot();
        }
        stateRef.current.lastDrawPoint = smoothed;

        // Cursor
        if (landmarksCtx && !stateRef.current.showLandmarks) {
          landmarksCtx.beginPath();
          const r = (eraserGesture ? stateRef.current.brushSize * 3 : stateRef.current.brushSize) / 2 + 2;
          landmarksCtx.arc(smoothed.x, smoothed.y, r, 0, 2 * Math.PI);
          landmarksCtx.fillStyle = eraserGesture ? 'rgba(255,255,255,0.4)' : '#FFFFFF';
          landmarksCtx.shadowBlur = 15;
          landmarksCtx.shadowColor = eraserGesture ? '#FFFFFF' : stateRef.current.color;
          landmarksCtx.fill();
          landmarksCtx.shadowBlur = 0;
          if (eraserGesture) {
            landmarksCtx.strokeStyle = 'rgba(255,255,255,0.8)';
            landmarksCtx.lineWidth = 1.5;
            landmarksCtx.stroke();
          }
        }
      } else {
        stateRef.current.lastDrawPoint = null;
        stateRef.current.smoothedPoint = null;

        // Hover cursor
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
      stateRef.current.lastDrawPoint = null;
      stateRef.current.smoothedPoint = null;
      stateRef.current.dwellIdx = -1;
      stateRef.current.dwellFrames = 0;
      setDwellIdx(-1);
      setDwellProgress(0);
    }
  }, [clearCanvas, undoLastStroke, saveSnapshot]);

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
          maxNumHands: 2,
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
          <h1 className="font-body-md text-4xl sm:text-5xl md:text-6xl font-bold text-primary mb-6 tracking-[0.2em] drop-shadow-[0_0_15px_rgba(240,240,240,0.8)] text-center break-keep">
            AIR WRITER
          </h1>
          <p className="font-sans text-secondary mb-12 max-w-[500px] w-full text-center leading-relaxed text-base sm:text-lg">
            <strong className="text-primary">Right hand:</strong> Pinch (index + thumb) to draw. Middle finger only = erase. Hover index over a color to pick it.<br />
            <strong className="text-yellow-400">Left hand:</strong> Pinch = undo. Fist = clear all.
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
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-on-surface uppercase tracking-widest">R: Pinch to Draw</span>
            </div>
            <div className="flex items-center gap-2 opacity-80">
              <span className="material-symbols-outlined text-primary text-[16px] sm:text-[18px]">back_hand</span>
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-on-surface uppercase tracking-widest">R: Middle finger = Erase</span>
            </div>
            <div className="flex items-center gap-2 opacity-60">
              <span className="material-symbols-outlined text-yellow-400 text-[16px] sm:text-[18px]">undo</span>
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-on-surface uppercase tracking-widest">L: Pinch = Undo</span>
            </div>
            <div className="flex items-center gap-2 opacity-60">
              <span className="material-symbols-outlined text-red-400 text-[16px] sm:text-[18px]">front_hand</span>
              <span className="font-sans font-bold text-[10px] sm:text-[12px] text-on-surface uppercase tracking-widest">L: Fist = Clear</span>
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
                  <div key={color} className="relative shrink-0 snap-center">
                    {/* Dwell progress ring */}
                    {dwellIdx === idx && dwellProgress > 0 && (
                      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 40 40">
                        <circle
                          cx="20" cy="20" r="18"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                          strokeDasharray={`${dwellProgress * 113} 113`}
                          strokeLinecap="round"
                          transform="rotate(-90 20 20)"
                          opacity="0.9"
                        />
                      </svg>
                    )}
                    <button
                      ref={el => { colorSwatchRefs.current[idx] = el; }}
                      onClick={() => setActiveColorIdx(idx)}
                      className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 transition-all duration-200 ${activeColorIdx === idx ? 'border-primary shadow-[0_0_15px_rgba(255,255,255,0.7)] scale-110' : 'border-transparent hover:border-primary/50'}`}
                      style={{ backgroundColor: color }}
                    />
                  </div>
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
                onClick={undoLastStroke}
                className="flex flex-col items-center justify-center text-on-surface-variant hover:text-yellow-400 hover:bg-yellow-400/10 transition-colors py-2 px-1 sm:px-3 rounded-xl w-16 sm:w-20 md:w-24"
              >
                <span className="material-symbols-outlined mb-1 text-[20px] sm:text-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>undo</span>
                <span className="font-sans text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Undo</span>
              </button>

              <div
                className={`flex flex-col items-center justify-center py-2 px-1 sm:px-3 rounded-xl w-16 sm:w-20 md:w-24 transition-all ${isErasing ? 'bg-white/20 text-white' : 'text-on-surface-variant opacity-40'}`}
              >
                <span className="material-symbols-outlined mb-1 text-[20px] sm:text-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>ink_eraser</span>
                <span className="font-sans text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Eraser</span>
              </div>

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

