import type { Config } from "tailwindcss";

const config: Config = {
  // IMPORTANT:
  // 'media' (default) = follow OS dark/light setting
  // 'class' = only enable dark: styles when <html class="dark"> exists
  // Repo-Mind is light-mode only, so 'class' prevents black unreadable chips
  // when the user's Windows theme is Dark.
  darkMode: "class",

  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        panel: "var(--panel)",
        foreground: {
          DEFAULT: "var(--foreground)",
          muted: "var(--foreground-muted)",
        },
        border: {
          DEFAULT: "var(--border)",
          hover: "var(--border-hover)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        success: "var(--success)",
        error: "var(--error)",
      },
      boxShadow: {
        premium: "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
        "premium-hover": "0 8px 30px -4px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;