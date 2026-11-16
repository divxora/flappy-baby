import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

declare global {
  interface Window {
    __APP_MOUNTED__?: boolean;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  document.body.innerHTML =
    '<div style="padding:24px;font-family:system-ui,sans-serif;color:#f87171;background:#0b1120;">Missing #root mount element in index.html.</div>';
} else {
  window.__APP_MOUNTED__ = true;
  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
