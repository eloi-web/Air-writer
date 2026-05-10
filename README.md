# Air Writer

Air Writer is a web application that allows you to draw in thin air using hand gestures. It uses MediaPipe for real-time hand tracking and HTML5 Canvas for rendering.

## Features

- **Pinch to Draw:** Move your hand to move the cursor, and pinch your index finger and thumb together to draw.
- **Fist to Clear:** Close your hand into a fist to clear the canvas.
- **Adjustable Brush:** Change the brush size to draw thicker or thinner lines.
- **Color Selection:** Pick from multiple vibrant colors.
- **Save Art:** Take a snapshot of your drawing and save it as a PNG image.
- **Landmarks View:** Toggle hand landmarks to see what the AI sees under the hood.

## Requirements

- A modern browser with WebGL support
- A webcam

## Scripts

Installs all dependencies:
```sh
npm install
```

Starts the local development server:
```sh
npm run dev
```

Builds the application for production:
```sh
npm run build
```

Previews the compiled production build:
```sh
npm run preview
```

## Technical Details

We use:
- **React + TypeScript + Vite** for the frontend application.
- **Tailwind CSS** for styling interfaces and responsiveness.
- **@mediapipe/hands** from Google to perform hand gesture recognition.
- **react-webcam** to access device cameras.

## License

MIT
