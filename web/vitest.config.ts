import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    include: [
      "lib/**/__tests__/**/*.spec.ts",
      "lib/**/*.spec.ts",
      "scripts/__tests__/**/*.spec.ts",
    ],
    environment: "node",
  },
});
