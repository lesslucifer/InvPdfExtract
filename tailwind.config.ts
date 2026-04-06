import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      bg: {
        DEFAULT: '#1c1c1e',
        secondary: '#2c2c2e',
        hover: '#3a3a3c',
      },
      border: {
        DEFAULT: '#48484a',
      },
      text: {
        DEFAULT: '#f5f5f7',
        secondary: '#aeaeb2',
        muted: '#636366',
      },
      accent: {
        DEFAULT: '#0a84ff',
      },
      confidence: {
        high: '#34c759',
        medium: '#ff9f0a',
        low: '#ff3b30',
      },
    },
    fontFamily: {
      sans: ['-apple-system', 'BlinkMacSystemFont', "'SF Pro Text'", "'Segoe UI'", 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      mono: ["'SF Mono'", 'Menlo', 'Monaco', 'monospace'],
    },
    fontSize: {
      '2.5':  ['10px', { lineHeight: '1.4' }],
      '2.75': ['11px', { lineHeight: '1.4' }],
      '3':    ['12px', { lineHeight: '1.4' }],
      '3.25': ['13px', { lineHeight: '1.4' }],
      '3.5':  ['14px', { lineHeight: '1.4' }],
      '4':    ['16px', { lineHeight: '1.4' }],
      '5':    ['20px', { lineHeight: '1.3' }],
    },
    borderRadius: {
      none:    '0',
      sm:      '3px',
      DEFAULT: '4px',
      md:      '6px',
      lg:      '8px',
      xl:      '10px',
      '2xl':   '12px',
      full:    '9999px',
    },
    extend: {
      spacing: {
        '0.5': '2px',
        '1':   '4px',
        '1.5': '6px',
        '2':   '8px',
        '2.5': '10px',
        '3':   '12px',
        '3.5': '14px',
        '4':   '16px',
        '5':   '20px',
        '6':   '24px',
        '8':   '32px',
        '10':  '40px',
        '12':  '48px',
      },
      maxHeight: {
        '400': '400px',
        '480': '480px',
      },
      width: {
        '5':   '20px',
        '100': '100px',
        '80':  '320px',
      },
      height: {
        '5':  '20px',
        '8':  '32px',
        '9':  '36px',
      },
      boxShadow: {
        overlay:  '0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px #48484a',
        modal:    '0 8px 32px rgba(0,0,0,0.4)',
        dropdown: '0 2px 8px rgba(0,0,0,0.2)',
      },
      keyframes: {
        'overlay-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'detail-in': {
          from: { opacity: '0', maxHeight: '0' },
          to:   { opacity: '1', maxHeight: '400px' },
        },
        'settings-notification-fade': {
          '0%':   { opacity: '0', transform: 'translateY(-4px)' },
          '10%':  { opacity: '1', transform: 'translateY(0)' },
          '80%':  { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'suggestion-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      animation: {
        'overlay-in':                    'overlay-in 0.15s ease-out',
        'detail-in':                     'detail-in 0.15s ease-out',
        'settings-notification-fade':    'settings-notification-fade 4s ease-in-out',
        'suggestion-in':                 'suggestion-in 0.1s ease-out',
        'spin-slow':                     'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
