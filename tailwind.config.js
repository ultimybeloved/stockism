import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // The theme is a `dark` class on <html> (set by App from the player's
  // choice). `dark:` styles apply under it and `light:` styles apply without
  // it. Both wrap the check in :where(), so they weigh the same as a plain class.
  darkMode: 'selector',
  theme: {
    extend: {},
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('light', '&:where(:not(.dark, .dark *))');
    }),
  ],
};
