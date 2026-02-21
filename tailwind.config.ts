import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#070A12",
        slate: "#0E1423",
        electric: "#33D8FF",
        neon: "#6A7CFF",
        punch: "#FF6B6B",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(51,216,255,0.3), 0 20px 80px rgba(51,216,255,0.18)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        pulseBorder: {
          "0%,100%": { borderColor: "rgba(106,124,255,0.35)" },
          "50%": { borderColor: "rgba(51,216,255,0.9)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        pulseBorder: "pulseBorder 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
