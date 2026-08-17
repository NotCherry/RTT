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
