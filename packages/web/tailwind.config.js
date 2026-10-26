/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        akilimo: {
          green: '#2D5A27',
          lightGreen: '#A3C585',
          gold: '#D4AF37',
          dark: '#1A1A1A',
        }
      }
    },
  },
  plugins: [],
}
