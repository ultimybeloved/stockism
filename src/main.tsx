import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import MarketDataProvider from './app/MarketDataProvider';
import CrashScreen from './shared/components/CrashScreen';
import './index.css';
import './styles/seasonFrames.css';
import './styles/titles.css';
import './styles/cosmetics/art.css';
import './styles/cosmetics/names.css';
import './styles/cosmetics/effects.css';
import './styles/cosmetics/backdrops.css';
import './styles/cosmetics/swatches.css';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,
  // Groups errors by deploy, so a spike can be traced to the build that caused
  // it and a fix can be confirmed as actually shipped. Matches the version shown
  // in the site footer, which is what a player quotes in a bug report.
  release: __APP_VERSION__,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Sentry.ErrorBoundary fallback={({ error }) => <CrashScreen error={error} fullPage />}>
        <MarketDataProvider>
          <App />
        </MarketDataProvider>
      </Sentry.ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
