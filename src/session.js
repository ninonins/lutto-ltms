const ACTIVE_STATES = new Set([
  "awaiting_captcha",
  "submitting_login",
  "checking_violations",
  "logged_in",
]);

export class SessionManager {
  #state = "idle";
  #run = null;

  getState() {
    return this.#state;
  }

  getRun() {
    return this.#run;
  }

  hasActiveRun() {
    return ACTIVE_STATES.has(this.#state);
  }

  isLoggedIn() {
    return this.#state === "logged_in";
  }

  begin(run) {
    if (this.hasActiveRun()) {
      throw new Error("Another LTMS check is already running");
    }

    this.#run = run;
    this.#state = "awaiting_captcha";
    return this.#run;
  }

  transition(nextState) {
    if (!this.#run && nextState !== "idle") {
      throw new Error("Cannot transition without an active run");
    }

    this.#state = nextState;
  }

  complete(metadata = {}) {
    this.#state = "logged_in";
    if (this.#run) {
      this.#run = { ...this.#run, ...metadata };
    }
    return this.#run;
  }

  fail(error) {
    this.#state = "failed";
    if (this.#run) {
      this.#run = { ...this.#run, error };
    }
    return this.#run;
  }

  reset() {
    this.#state = "idle";
    this.#run = null;
  }
}
