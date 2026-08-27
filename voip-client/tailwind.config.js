/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./dist/**/*.html",
    "./dist/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1e3a5f',
          dark: '#152843',
          light: '#2d568c',
        },
        accent: {
          DEFAULT: '#16a34a',
          dark: '#15803d',
          light: '#22c55e',
        }
      }
    },
  },
  plugins: [],
}
