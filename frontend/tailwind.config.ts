import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Surface — near-black with warm undertone
        ink: {
          base: '#0a0a0c',
          surface: '#131316',
          elevated: '#1a1a1f',
          hover: '#22222a',
        },
        // Sport identities — distinct hues across the wheel
        football: {
          DEFAULT: '#10b981', // emerald
          dark: '#064e3b',
          glow: 'rgba(16, 185, 129, 0.18)',
        },
        basketball: {
          DEFAULT: '#f59e0b', // amber
          dark: '#78350f',
          glow: 'rgba(245, 158, 11, 0.18)',
        },
        tennis: {
          DEFAULT: '#a855f7', // violet
          dark: '#581c87',
          glow: 'rgba(168, 85, 247, 0.18)',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.32s ease-out',
        'slide-up': 'slideUp 0.34s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(6px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.65' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
