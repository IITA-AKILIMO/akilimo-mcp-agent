import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

// index.html sets the initial theme before React renders to avoid a flash
const currentTheme = (): Theme =>
  document.documentElement.getAttribute('data-bs-theme') === 'light' ? 'light' : 'dark';

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this visit
    }
    setTheme(next);
  };

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      <span className="d-none d-sm-inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
};
