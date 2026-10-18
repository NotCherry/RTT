/// <reference types="cypress" />

describe("web and API integration", () => {
  it("captures a sample robot pose through the real API and opens it in the Archive", () => {
    // Observe requests without stubbing: this also checks the production Nginx proxy.
    cy.intercept("GET", "/api/robots/demo").as("sampleRobot");
    cy.intercept("POST", "/api/sessions").as("createSession");
    cy.intercept("PUT", "/api/sessions/*/demonstrations", (request) => {
      if (request.body.demonstrations.some((item: { name: string }) => item.name === "CI sample pose")) {
        request.alias = "savePose";
      }
    });
    cy.visit("/teach/pose");
    cy.wait("@createSession").its("response.statusCode").should("equal", 200);
    cy.contains("button", "Open sample robot").click();
    cy.wait("@sampleRobot").its("response.statusCode").should("equal", 200);
    cy.wait("@createSession").its("response.statusCode").should("equal", 200);
    cy.get('[aria-label="Pose name"]').type("CI sample pose");
    cy.contains("button", "Capture pose").click();
    cy.wait("@savePose").then(({ request, response }) => {
      expect(response?.statusCode).to.equal(200);
      const pose = request.body.demonstrations.find((item: { name: string }) => item.name === "CI sample pose");
      expect(pose.kind).to.equal("pose");
      expect(pose.keyframes).to.have.length(1);
      expect(pose.keyframes[0].positions).to.have.length(2);
    });
    cy.contains("a", "Archive").click();
    cy.contains("CI sample pose").should("be.visible");
  });
});
