import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import App from './App.jsx';
import './App.css';
import './admin-console.css';
import './admin-console-mobile.css';
import './admin-console-pages.css';

// Faceted ROME and sector URLs are useful for visitors but do not yet have
// dedicated, stable SEO content. Keep the base pages as canonical targets.
const path = window.location.pathname.replace(/\/+$/, '') || '/';
if (window.location.search && (path === '/metiers' || /^\/departement\/[^/]+$/.test(path))) {
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement('meta');
    robots.setAttribute('name', 'robots');
    document.head.appendChild(robots);
  }
  robots.setAttribute('content', 'noindex,follow');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChakraProvider value={defaultSystem}>
      <App />
    </ChakraProvider>
  </React.StrictMode>
);
