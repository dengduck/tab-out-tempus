const THEMES = new Set(['system', 'light', 'dark']);

let activeMediaQuery = null;
let activeMediaHandler = null;

function removeSystemListener() {
  if (!activeMediaQuery || !activeMediaHandler) return;

  if (typeof activeMediaQuery.removeEventListener === 'function') {
    activeMediaQuery.removeEventListener('change', activeMediaHandler);
  } else if (typeof activeMediaQuery.removeListener === 'function') {
    activeMediaQuery.removeListener(activeMediaHandler);
  }

  activeMediaQuery = null;
  activeMediaHandler = null;
}

/**
 * Applies a light, dark, or system-resolved theme to the document root.
 * Calling it again replaces any existing system-theme listener.
 *
 * @param {'system'|'light'|'dark'} theme
 * @returns {() => void} Cleanup function for this application.
 */
export function applyTheme(theme = 'system') {
  if (!THEMES.has(theme)) {
    throw new TypeError(`Unsupported theme: ${theme}`);
  }
  if (typeof document === 'undefined' || !document.documentElement) {
    throw new Error('applyTheme requires a documentElement');
  }

  removeSystemListener();
  const root = document.documentElement;

  if (theme !== 'system') {
    root.dataset.theme = theme;
    return () => {};
  }

  if (typeof globalThis.matchMedia !== 'function') {
    root.dataset.theme = 'light';
    return () => {};
  }

  const mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
  const updateTheme = (event = mediaQuery) => {
    root.dataset.theme = event.matches ? 'dark' : 'light';
  };

  activeMediaQuery = mediaQuery;
  activeMediaHandler = updateTheme;
  updateTheme();

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', updateTheme);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(updateTheme);
  }

  return () => {
    if (activeMediaQuery === mediaQuery && activeMediaHandler === updateTheme) {
      removeSystemListener();
    }
  };
}
