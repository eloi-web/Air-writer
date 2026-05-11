# AirWriter

**AirWriter** is a browser-based air drawing app. Point your webcam at your hands and draw in mid-air — no mouse, no touchscreen, no stylus required.

Live demo: https://air-writer-eloi.vercel.app

## Features

### Drawing
- **Pinch to draw** — right hand index + thumb pinch starts a stroke
- **Middle finger to erase** — extend only the middle finger on your right hand
- **Brush pressure simulation** — the tighter the pinch, the thicker the stroke
- **Stroke smoothing** — exponential moving average keeps strokes fluid
- **Adjustable brush size** — slider from 2 to 30 px

### Color & Palette
- **Three palettes** — Neon, Pastel, Mono — cycle through them with the toolbar button
- **Color dwell picker** — hover your right index finger over a swatch for ~1.5 s to select it
- **Color temperature presets** — palettes are hand-tuned warm/cool/neutral sets

### Canvas
- **Background modes** — Plain black, Dot grid, Line grid — toggle in the toolbar
- **Undo** — Ctrl+Z, the toolbar button, or left-hand pinch gesture (up to 20 steps)
- **Clear all** — toolbar button or left-hand fist gesture (with flash feedback)
- **Save / Export** — composites the webcam feed + drawing and downloads a PNG

### Two-hand support
| Hand | Gesture | Action |
|------|---------|--------|
| Right | Pinch | Draw |
| Right | Middle finger only | Erase |
| Right | Index hover on swatch | Pick color (dwell) |
| Left | Pinch | Undo last stroke |
| Left | Fist | Clear canvas |

### UI
- **Responsive toolbar** — collapses to a floating action button on mobile
- **Landmark overlay** — toggle to see MediaPipe's hand skeleton
- **Help modal** — press the `?` button for a full gesture/shortcut reference
- **Stroke counter** — HUD shows total strokes drawn in the session
- **PWA support** — installable on desktop and mobile ("Add to Home Screen")
- **Arista Pro + DM Sans** — custom typography

## Requirements

- A modern browser (Chrome or Edge recommended for best MediaPipe performance)
- A webcam

## Scripts

```sh
npm install       # install dependencies
npm run dev       # start local dev server
npm run build     # production build
npm run preview   # preview production build
```

## Tech Stack

- **React 19 + TypeScript + Vite 6**
- **Tailwind CSS v4** (CSS-variable-based theme)
- **MediaPipe Hands** — real-time hand landmark detection (CDN, `maxNumHands: 2`)
- **react-webcam** — webcam feed
- **HTML5 Canvas** — three-layer compositing (background grid, drawing, landmarks)
- **Service Worker** — cache-first PWA shell

## License

MIT
