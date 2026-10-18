import { defineConfig } from "cypress";

export default defineConfig({
  allowCypressEnv: false,
  video: false,
  e2e: {
    baseUrl: "http://localhost:8080",
    supportFile: false,
    specPattern: "cypress/e2e/**/*.cy.ts",
  },
});
