import { createRoot } from 'react-dom/client'
import App from './App.js'

// StrictMode intentionally removed: xterm uses imperative DOM manipulation
// (requestAnimationFrame-based rendering) that crashes during StrictMode's
// dev-only double-mount/unmount cycle.
createRoot(document.getElementById('root')!).render(<App />)
