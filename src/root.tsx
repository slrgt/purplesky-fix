/**
 * Root component for PurpleSky.
 *
 * This is the outermost Qwik component – it wraps the entire app.
 * QwikCityProvider handles routing; the <head> includes PWA meta tags.
 *
 * HOW TO EDIT:
 *  - To change the page title, edit the <title> tag below
 *  - To add global meta tags (OG tags, etc.), add them inside <head>
 *  - The <body> renders RouterOutlet which shows the current route
 */

import { component$, useVisibleTask$ } from '@builder.io/qwik';
import { QwikCityProvider, RouterOutlet } from '@builder.io/qwik-city';

import './global.css';

/**
 * Register the service worker on ALL platforms.
 *
 * The SW is essential for the app to work on static hosts (GitHub Pages):
 * it intercepts q-data.json requests for dynamic routes (post, profile, etc.)
 * and returns synthetic empty-loader responses so QwikCity stays in SPA mode.
 * Without it, every client-side navigation triggers a full page reload (MPA
 * fallback) because GitHub Pages returns 404 HTML for missing q-data.json files.
 *
 * Note: Service workers do NOT cause "persistent storage" prompts — those come
 * from navigator.storage.persist() which we don't call.
 */
const ServiceWorkerRegister = component$(() => {
  useVisibleTask$(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const base = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((e) => console.error('SW register failed:', e));
  });
  return null;
});

export default component$(() => {
  return (
    <QwikCityProvider>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

        {/* PWA meta tags */}
        <meta name="theme-color" content="#1a1a2e" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        {/* Avoid caching HTML so users get fresh chunk references after deploys (avoids "Loading failed" for old q-*.js) */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />

        {/* App info */}
        <title>PurpleSky</title>
        <meta name="description" content="Bluesky PWA – feeds, forums, consensus, collaboration" />
        <link rel="manifest" href={`${import.meta.env.BASE_URL}manifest.json`} />
        <link rel="icon" type="image/svg+xml" href={`${import.meta.env.BASE_URL}icon.svg`} />
        <link rel="apple-touch-icon" href={`${import.meta.env.BASE_URL}icon.svg`} />

        {/* Phantom-click guard: blocks link/button activation unless preceded by a
            real pointerdown+pointerup on the same element. Must be an inline script
            so it registers on document (capture phase) BEFORE Qwik's event delegation
            boots, otherwise Qwik processes Link navigations before the guard can
            intercept them. */}
        <script dangerouslySetInnerHTML={`(function(){
  var s={downEl:null,upOk:false,lastPT:0};
  var SEL='a[href],button';
  var PT_KEY_MS=500;
  function isReal(e){
    return(e.pointerType==='mouse'&&e.button===0)||e.pointerType==='touch'||(e.pointerType==='pen'&&e.isPrimary);
  }
  document.addEventListener('pointerdown',function(e){
    s.lastPT=Date.now();
    if(!isReal(e))return;
    var el=(e.target).closest(SEL);
    if(el){s.downEl=el;s.upOk=false;}
  },true);
  document.addEventListener('pointerup',function(e){
    if(s.downEl&&(e.target).closest(SEL)===s.downEl)s.upOk=true;
  },true);
  document.addEventListener('pointermove',function(){s.lastPT=Date.now();},true);
  document.addEventListener('click',function(e){
    var el=(e.target).closest(SEL);
    if(!el){s.downEl=null;s.upOk=false;return;}
    var ok=s.downEl===el&&s.upOk;
    s.downEl=null;s.upOk=false;
    if(!ok){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;
    var el=e.target.closest&&e.target.closest(SEL);
    if(!el)return;
    if(Date.now()-s.lastPT<PT_KEY_MS){e.preventDefault();e.stopImmediatePropagation();}
  },true);
})()`} />
      </head>
      <body>
        {/* Skip link for keyboard users (accessibility) */}
        <a class="skip-link" href="#main-content">
          Skip to content
        </a>
        <RouterOutlet />
        <ServiceWorkerRegister />
      </body>
    </QwikCityProvider>
  );
});
