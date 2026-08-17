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
  cy.intercept("GET", "/api/robots/demo", {
    body: sampleRobot,
  }).as("loadDemoRobot");
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

describe("demonstration archive", () => {
  beforeEach(() => {
    stubSession();
    cy.visit("/");
  });

  it("captures a pose and persists its archive record", () => {
    cy.contains("button", "Load the 2-joint sample arm").click();
    cy.wait("@createSession");

    cy.contains("button", "Capture pose").click();
    cy.wait("@saveDemonstrations")
      .its("request.body.demonstrations.0")
      .should((demonstration) => {
        expect(demonstration.kind).to.equal("pose");
        expect(demonstration.frames).to.have.length(1);
        expect(demonstration.target).to.deep.equal([0, 0]);
      });

    cy.get('[role="tab"]').contains("Demonstrations").click();
    cy.contains("1 captured item").should("be.visible");
    cy.contains("Pose 01").should("be.visible");
    cy.contains("Preview pose").click();
  });

  it("authors full-robot checkpoints in the timeline", () => {
    cy.contains("button", "Load the 2-joint sample arm").click();
    cy.wait("@createSession");

    cy.contains("button", "Record gesture").click();
    cy.get('[role="tab"]').contains("Timeline").should("be.visible");
    cy.contains("button", "Capture checkpoint").click();
    cy.contains("button", "Stop recording").click();

    cy.get('[role="tab"]').contains("Timeline").click();
    cy.contains("checkpoint", { matchCase: false }).should("be.visible");
    cy.get('input[aria-label="shoulder_joint at checkpoint 1"]').should(
      "have.value",
      "0",
    );
    cy.get('input[aria-label="elbow_joint at checkpoint 1"]').type("0.5");
  });

  it("organizes captured work in named datasets", () => {
    cy.contains("button", "Load the 2-joint sample arm").click();
    cy.wait("@createSession");
    cy.contains("button", "Capture pose").click();
    cy.wait("@saveDemonstrations");
    cy.wait("@saveDatasets");

    cy.get('[role="tab"]').contains("Datasets").click();
    cy.contains("Untitled dataset").should("be.visible");
    cy.contains("button", "New dataset").click();
    cy.get('input[aria-label="Rename Dataset 2"]')
      .clear()
      .type("reach training");
    cy.contains("reach training").should("be.visible");
    cy.get('select[aria-label="Dataset for Pose 01"]')
      .select("reach training")
      .invoke("val")
      .should("match", /^dataset-/);
  });

  it("records multiple frames for a gesture", () => {
    cy.contains("button", "Load the 2-joint sample arm").click();
    cy.wait("@createSession");

    cy.contains("button", "Record gesture").click();
    cy.contains("button", "Stop recording").should("be.visible");
    cy.wait(300);
    cy.contains("button", "Stop recording").click();

    cy.wait("@saveDemonstrations")
      .its("request.body.demonstrations.0")
      .should((demonstration) => {
        expect(demonstration.kind).to.equal("gesture");
        expect(demonstration.frames.length).to.be.greaterThan(1);
        expect(demonstration.current).to.deep.equal([0, 0]);
      });

    cy.get('[role="tab"]').contains("Demonstrations").click();
    cy.contains("Gesture 01").should("be.visible");
    cy.contains("Replay gesture").should("be.visible");
  });
});
