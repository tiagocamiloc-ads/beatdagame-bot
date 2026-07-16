import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        column: {
          pending: "#f59e0b",
          approved: "#22c55e",
          rejected: "#ef4444",
          published: "#3b82f6",
        },
      },
    },
  },
  plugins: [],
};

export default config;
