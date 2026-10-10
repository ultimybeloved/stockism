import './shared/sentry';
import { initializeApp } from 'firebase-admin/app';
import loadServices from './serviceLoader';
import servicePaths from './servicePaths';

initializeApp();

// Loads only the service owning the invoked function - see serviceLoader.ts.
loadServices(exports, __dirname, servicePaths);
