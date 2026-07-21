const posixDir = __dirname.split("\\").join("/");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    `${posixDir}/app/**/*.{js,ts,jsx,tsx,mdx}`,
    `${posixDir}/components/**/*.{js,ts,jsx,tsx,mdx}`,
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0a0a12",
          card: "#12131c",
          border: "#242534",
        },
        accent: {
          DEFAULT: "#7c5cff",
          soft: "#a78bfa",
          glow: "#22d3ee",
        },
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(124, 92, 255, 0.55)",
      },
    },
  },
  plugins: [],
};
