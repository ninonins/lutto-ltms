import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/session.js";

test("session manager starts idle", () => {
  const session = new SessionManager();
  assert.equal(session.getState(), "idle");
  assert.equal(session.hasActiveRun(), false);
});

test("session manager handles active lifecycle", () => {
  const session = new SessionManager();
  session.begin({ runId: "run-1" });

  assert.equal(session.getState(), "awaiting_captcha");
  assert.equal(session.hasActiveRun(), true);

  session.transition("submitting_login");
  assert.equal(session.getState(), "submitting_login");

  session.complete({ hasViolations: true });
  assert.equal(session.getState(), "logged_in");
  assert.equal(session.isLoggedIn(), true);
  assert.equal(session.getRun().hasViolations, true);

  session.reset();
  assert.equal(session.getState(), "idle");
  assert.equal(session.getRun(), null);
});

test("session manager rejects overlapping runs", () => {
  const session = new SessionManager();
  session.begin({ runId: "run-1" });
  assert.throws(() => session.begin({ runId: "run-2" }), /already running/);
});
