/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#15110d",
          card: "#211a13",
          border: "#392c20",
        },
        accent: {
          DEFAULT: "#e2854f",
          soft: "#f0c896",
          glow: "#ff9a52",
        },
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(226, 133, 79, 0.55)",
      },
    },
  },
  plugins: [],
};
