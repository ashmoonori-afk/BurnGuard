import type { Config } from "tailwindcss";

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // Semantic tokens — resolved through CSS variables in `src/index.css`.
        // Using `rgb(var(--xxx) / <alpha-value>)` keeps Tailwind's alpha
        // modifier (`bg-accent/10`, `border-border/60`) working against
        // plain hex values defined in the raw palette.
        border: "rgb(var(--border) / <alpha-value>)",
        input: "rgb(var(--input) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          foreground: "rgb(var(--success-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning) / <alpha-value>)",
          foreground: "rgb(var(--warning-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive) / <alpha-value>)",
          foreground: "rgb(var(--destructive-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--popover) / <alpha-value>)",
          foreground: "rgb(var(--popover-foreground) / <alpha-value>)",
        },
        // Card tints — soft backgrounds behind project and system
        // thumbnails, re-tuned per theme in `src/index.css`.
        tint: {
          rose: "rgb(var(--tint-rose) / <alpha-value>)",
          slate: "rgb(var(--tint-slate) / <alpha-value>)",
          sky: "rgb(var(--tint-sky) / <alpha-value>)",
          fuchsia: "rgb(var(--tint-fuchsia) / <alpha-value>)",
          blue: "rgb(var(--tint-blue) / <alpha-value>)",
          stone: "rgb(var(--tint-stone) / <alpha-value>)",
          amber: "rgb(var(--tint-amber) / <alpha-value>)",
          emerald: "rgb(var(--tint-emerald) / <alpha-value>)",
          violet: "rgb(var(--tint-violet) / <alpha-value>)",
        },
        // Raw brand palette — mirrors the CSS custom properties in
        // `src/index.css`. Use these (e.g. `text-brand-500`) when a
        // component explicitly wants a brand colour outside the
        // semantic slots.
        grey: {
          50: "var(--color-grey-50)",
          100: "var(--color-grey-100)",
          150: "var(--color-grey-150)",
          200: "var(--color-grey-200)",
          300: "var(--color-grey-300)",
          400: "var(--color-grey-400)",
          500: "var(--color-grey-500)",
          600: "var(--color-grey-600)",
          700: "var(--color-grey-700)",
          800: "var(--color-grey-800)",
          900: "var(--color-grey-900)",
        },
        brand: {
          50: "var(--color-blue-50)",
          100: "var(--color-blue-100)",
          200: "var(--color-blue-200)",
          300: "var(--color-blue-300)",
          400: "var(--color-blue-400)",
          500: "var(--color-blue-500)",
          600: "var(--color-blue-600)",
          700: "var(--color-blue-700)",
          800: "var(--color-blue-800)",
          900: "var(--color-blue-900)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["SF Mono", "Consolas", "Menlo", "monospace"],
      },
      boxShadow: {
        "app-1": "0 1px 2px rgba(28, 43, 54, 0.06), 0 1px 1px rgba(28, 43, 54, 0.04)",
        "app-2": "0 2px 4px rgba(28, 43, 54, 0.08), 0 1px 2px rgba(28, 43, 54, 0.04)",
        "app-3": "0 6px 16px rgba(28, 43, 54, 0.10), 0 2px 4px rgba(28, 43, 54, 0.05)",
        "app-4": "0 16px 32px rgba(28, 43, 54, 0.14), 0 4px 8px rgba(28, 43, 54, 0.06)",
      },
      zIndex: {
        dialog: "50",
        toast: "60",
        present: "100",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
