import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';

// Feature-detected progressive enhancement polyfills per modern-web-guidance
if (typeof window !== 'undefined') {
  if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
    import('@oddbird/popover-polyfill');
  }
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    import('invokers-polyfill');
  }
}

const appName = import.meta.env.VITE_APP_NAME || 'GitVillage';

createInertiaApp({
  title: (title) => (title ? `${title} · ${appName}` : appName),
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.tsx', { eager: true });
    const page = pages[`./Pages/${name}.tsx`];
    if (!page) {
      throw new Error(`Inertia page not found: ./Pages/${name}.tsx`);
    }
    return page as never;
  },
  setup({ el, App, props }) {
    if (!el) return;
    createRoot(el).render(<App {...props} />);
  },
  progress: {
    color: '#0a84ff',
  },
});
