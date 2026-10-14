/// <reference types="cypress" />

const sampleRobot = {
  id: "demo-slider-arm",
  name: "slider-arm",
  filename: "slider-arm.urdf",
  root: "base",
  links: [
    { name: "base", visuals: [] },
    { name: "arm", visuals: [] },
    { name: "forearm", visuals: [] },
  ],
  joints: [
    {
      name: "shoulder_joint",
      type: "revolute",
      parent: "base",
      child: "arm",
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 1, 0],
      lower: -1.57,
      upper: 1.57,
      controllable: true,
    },
    {
      name: "elbow_joint",
      type: "revolute",
      parent: "arm",
      child: "forearm",
      origin: { xyz: [0, 0, 1], rpy: [0, 0, 0] },
      axis: [0, 1, 0],
      lower: -2.2,
      upper: 2.2,
      controllable: true,
    },
  ],
};

function stubSession() {
  cy.intercept("GET", "/api/robots/default", { body: sampleRobot });
  cy.intercept("GET", "/api/robots/demo", { body: sampleRobot }).as(
    "loadDemoRobot",
  );
  cy.intercept("POST", "/api/sessions", {
    body: {
      session_id: "session-under-test",
      robot: sampleRobot,
      state: { type: "state", positions: [0, 0], training: false },
    },
  }).as("createSession");
  cy.intercept("PUT", "/api/sessions/session-under-test/demonstrations", {
    body: { status: "saved", demonstrations: 1 },
  }).as("saveDemonstrations");
  cy.intercept("PUT", "/api/sessions/session-under-test/datasets", {
    body: { status: "saved", datasets: 1 },
  }).as("saveDatasets");
}

describe("routed teaching workspace", () => {
  beforeEach(() => {
    stubSession();
    cy.visit("/teach/pose");
    cy.wait("@createSession");
  });

  it("navigates between full workspace pages", () => {
    cy.contains("Pose").should("have.attr", "href", "/teach/pose");
    cy.contains("Timeline").click();
    cy.location("pathname").should("eq", "/teach/timeline");
    cy.contains("Author the robot motion.").should("be.visible");
    cy.contains("Archive").click();
    cy.location("pathname").should("eq", "/archive");
    cy.contains("Organize expected behavior.").should("be.visible");
    cy.contains("Train").click();
    cy.location("pathname").should("eq", "/train");
    cy.contains("Build, compare, then train.").should("be.visible");
    cy.contains("Evaluate").click();
    cy.location("pathname").should("eq", "/evaluate");
    cy.contains("Inspect the learned motion.").should("be.visible");
  });

  it("captures a full pose with an authored keyframe", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("button", "Capture pose").click();
    cy.get("@saveDemonstrations.all")
      .should((requests: any) => {
        const demonstration = requests.at(-1)?.request.body.demonstrations[0];
        expect(demonstration).to.exist;
        expect(demonstration.kind).to.equal("pose");
        expect(demonstration.keyframes).to.have.length(1);
        expect(demonstration.keyframes[0].frame).to.equal(0);
      });
  });

  it("authors multiple keyframes on animation channels", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("Timeline").click();
    cy.contains("button", "Insert full-pose key").click();
    cy.get('input[aria-label="shoulder_joint at selected keyframe"]')
      .clear()
      .type("0.5");
    cy.get('input[aria-label="shoulder_joint slider at selected keyframe"]')
      .should("have.attr", "min", "-1.57")
      .and("have.attr", "max", "1.57")
      .and("have.value", "0.5");
    cy.get('[aria-label="Insert frame"]').clear().type("10");
    cy.contains("button", "Insert full-pose key").click();
    cy.contains("button", "Save keyframes").click();
    cy.get("@saveDemonstrations.all")
      .should((requests: any) => {
        const demonstration = requests.at(-1)?.request.body.demonstrations[0];
        expect(demonstration).to.exist;
        expect(demonstration.kind).to.equal("gesture");
        expect(demonstration.keyframes.length).to.be.greaterThan(1);
        expect(demonstration.keyframes[0]).to.have.property(
          "interpolation",
          "linear",
        );
      });
    cy.contains("authored keyframes", { matchCase: false }).should(
      "be.visible",
    );
    cy.get('[aria-label="Robot animation channels"]').should("be.visible");
  });

  it("organizes demonstrations in the archive datasets page", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("button", "Capture pose").click();
    cy.wait("@saveDemonstrations");
    cy.wait("@saveDatasets");
    cy.contains("Archive").click();
    cy.contains("Untitled dataset").should("be.visible");
    cy.contains("button", "New dataset").click();
    cy.get('input[aria-label="Rename Dataset 2"]')
      .clear()
      .type("reach training");
    cy.contains("reach training").should("be.visible");
  });
});
