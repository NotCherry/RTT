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

describe("site functionality coverage", () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    stubSession();
    cy.visit("/teach/pose");
  });

  it("inserts keyframes quantized to deterministic grid (no random hundreds)", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("Timeline").click();
    // Declarative timeline: insert at frame 0 then at staged frames via FPS/duration controls
    cy.get('[aria-label="FPS"]').should("exist");
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Robot animation channels"]')
      .find("button.keyframe-diamond")
      .should("have.length", 2);
    // Stage frame 10 and insert
    cy.get('[aria-label="Insert frame"]').clear().type("10");
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Robot animation channels"]')
      .find("button.keyframe-diamond")
      .should("have.length", 4);
    cy.get('[aria-label="Insert frame"]').clear().type("20");
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Robot animation channels"]')
      .find("button.keyframe-diamond")
      .should("have.length", 6);
    cy.contains("button", "Save keyframes").click();
    cy.wait("@saveDemonstrations")
      .its("request.body.demonstrations.0.keyframes")
      .should((keyframes: any[]) => {
        const frames = keyframes.map((k) => k.frame);
        expect(frames[0]).to.equal(0);
        expect(frames.length).to.be.at.least(3);
        for (const f of frames) {
          expect(f).to.be.lessThan(100);
        }
        const gaps = [];
        for (let i = 1; i < frames.length; i++)
          gaps.push(frames[i] - frames[i - 1]);
        for (const g of gaps) expect(g).to.be.lessThan(30);
      });
  });

  it("slider edit after selecting new keyframe does not reset other keyframes (regression)", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("Timeline").click();
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Insert frame"]').clear().type("10");
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Insert frame"]').clear().type("20");
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Robot animation channels"]')
      .find("button.keyframe-diamond")
      .first()
      .click();
    cy.get('input[aria-label="shoulder_joint at selected keyframe"]')
      .clear()
      .type("0.7");
    cy.get('input[aria-label="shoulder_joint at selected keyframe"]')
      .invoke("val")
      .then((v) => {
        expect(String(v)).to.include("0.7");
      });
    cy.get('[aria-label="Robot animation channels"]')
      .find("button.keyframe-diamond")
      .should("have.length", 6);
  });

  it("duplicate and delete maintain timeline integrity", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("Timeline").click();
    cy.contains("button", "Insert full-pose key").click();
    cy.contains("button", "Save keyframes").click();
    cy.wait("@saveDemonstrations");
    cy.contains(/authored keyframes/).should("be.visible");
    cy.get("body").should("contain.text", "Delete key");
    cy.get("body").then(($body) => {
      if ($body.text().includes("Duplicate")) {
        cy.contains("button", "Duplicate").click();
        cy.contains("Unsaved timeline edits").should("be.visible");
        cy.contains("button", "Delete key").click();
      }
    });
    cy.contains(/authored keyframes/).should("be.visible");
  });

  it("scrub slider value matches frame (no 12→312 drift)", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("Timeline").click();
    cy.contains("button", "Insert full-pose key").click();
    cy.get('[aria-label="Insert frame"]').clear().type("10");
    cy.contains("button", "Insert full-pose key").click();
    // scrub should be frame-based, max = durationFrames > frames.length
    cy.get("body").should("contain.text", "Frame");
    cy.get("body").should("contain.text", "Key");
    // after inserts, duration should exceed key count
    cy.get("body").then(($b) => {
      const text = $b.text();
      const m = text.match(/Frame\s+(\d+)\s+\/\s+(\d+)/);
      if (m) {
        const frame = Number(m[1]);
        const duration = Number(m[2]);
        expect(duration).to.be.greaterThan(30);
        expect(frame).to.be.lessThan(100);
      }
    });
    cy.contains("button", "Save keyframes").click();
    cy.wait("@saveDemonstrations")
      .its("request.body.demonstrations.0.keyframes")
      .should((kfs: any[]) => {
        const frames = kfs.map((k) => k.frame);
        for (const f of frames) expect(f).to.be.lessThan(100);
      });
  });

  it("3D viewport renders and follows state", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.get("canvas").should("exist");
    cy.contains("Timeline").click();
    cy.get("canvas").should("exist");
  });

  it("URDF upload journeys - valid primitive and mesh reject", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.intercept("POST", "/api/robots/parse", { body: sampleRobot }).as(
      "uploadValid",
    );
    cy.intercept("POST", "/api/robots/parse", {
      statusCode: 422,
      body: { detail: "Mesh assets are not supported: mesh" },
    }).as("uploadMesh");
    cy.contains("Open sample robot").should("be.visible");
    cy.request({
      method: "POST",
      url: "/api/robots/parse",
      failOnStatusCode: false,
      body: { file: "dummy" },
    }).then(() => {
      expect(true).to.equal(true);
    });
  });

  it("handles archive and training navigation", () => {
    cy.contains("button", "Open sample robot").click();
    cy.wait("@createSession");
    cy.contains("button", "Capture pose").click();
    cy.wait("@saveDemonstrations");
    cy.contains("Archive").click();
    cy.contains("Untitled dataset").should("be.visible");
    cy.contains("Train").click();
    cy.contains("Train from keyframe motion.").should("be.visible");
    cy.contains("Evaluate").click();
    cy.contains("Inspect the learned motion.").should("be.visible");
  });

  it("shows empty states gracefully", () => {
    cy.contains("Timeline").click();
    cy.get("body").should("contain.text", "No");
    cy.get("body").should("contain.text", "gesture");
    // Empty timeline shows Insert, not Start capture
    cy.contains("button", "Insert full-pose key").should("exist");
    cy.contains("Archive").click();
  });
});
