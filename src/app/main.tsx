/**
 * PurpleSky app entry (Preact). Mounts the app and handles client-side routing.
 */
import { render } from 'preact';
import { App } from './App';
import './app.css';

export function mountApp(root: HTMLElement): void {
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    const base = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((e) => console.error('SW register failed:', e));
  }
  render(<App />, root);
}
