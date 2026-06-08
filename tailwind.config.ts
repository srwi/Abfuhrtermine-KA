import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (shadcn-style): each is a raw `R G B` triplet in CSS
        // vars so Tailwind's `/ <alpha-value>` opacity utilities keep working.
        // Light/dark values live in src/app.css under :root and .dark.
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--muted-foreground) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)'
      },
      boxShadow: {
        glow: '0 20px 80px rgba(15, 23, 42, 0.18)'
      }
    }
  },
  plugins: []
} satisfies Config;