import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { loadConfig, lastConfigLoadWasFromNetwork } from './lib/config.js';

// Runtime config must resolve before App mounts - session.js/api/client.js
// read config.* synchronously and throw if it's not loaded yet (see
// lib/config.js). Failure here means /config.json is missing or malformed
// (e.g. a broken deploy), not a normal user-facing error, so it gets a
// plain message rather than routing into the app's own error UI.
async function bootstrap() {
  const target = document.getElementById('app');
  try {
    await loadConfig();
  } catch (err) {
    console.error('Failed to load app configuration:', err);
    target.textContent = 'Small Stash failed to load its configuration. Please try refreshing the page.';
    return;
  }
  // Passed through as the initial connectivity signal - see config.js's
  // lastConfigLoadWasFromNetwork() doc comment for why navigator.onLine
  // alone isn't trustworthy at boot.
  mount(App, { target, props: { initiallyOnline: lastConfigLoadWasFromNetwork() } });
}

bootstrap();
