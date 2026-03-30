import { chromium } from "playwright";

const LOGIN_SELECTORS = {
  launchLogin: [
    'a:has-text("LOG IN")',
    'button:has-text("LOG IN")',
    'a:has-text("Login")',
    'button:has-text("Login")',
    'a[href*=":9999:"]',
  ],
  username: [
    'input[name="P101_USERNAME"]',
    'input[placeholder*="EMAIL OR LTO CLIENT NUMBER" i]',
    'input[name*="USER" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
    'input[type="text"]',
  ],
  password: [
    'input[name="P101_PASSWORD"]',
    'input[placeholder*="PASSWORD" i]',
    'input[name*="PASS" i]',
    'input[type="password"]',
  ],
  captchaInput: [
    'input[name*="CAPTCHA" i]',
    'input[id*="CAPTCHA" i]',
    'input[placeholder*="SECURITY CODE" i]',
    'input[placeholder*="captcha" i]',
    'input[aria-label*="captcha" i]',
  ],
  submit: [
    'button:has-text("Sign In")',
    'button:has-text("SIGN IN")',
    'button:has-text("Login")',
    'button:has-text("LOG IN")',
    'input[type="submit"]',
    'button[type="submit"]',
    'a:has-text("Login")',
  ],
  captchaImage: [
    '#P9999_CAPTCHA_IMG img',
    '#P9999_CAPTCHA_IMG',
    'img[alt*="captcha" i]',
    'img[src*="captcha" i]',
    'canvas[id*="captcha" i]',
    'canvas',
    'img',
  ],
  captchaRefresh: [
    '#btn-refresh-captcha',
    'text=/refresh security code/i',
    'button:has-text("Refresh")',
    'button[title*="refresh" i]',
    'a[title*="refresh" i]',
    'span.fa-refresh',
    'button:has(.fa-refresh)',
  ],
};

const POST_LOGIN_SELECTORS = {
  logout: [
    'a:has-text("Logout")',
    'button:has-text("Logout")',
    'a[href*="logout" i]',
  ],
  loginForm: [
    '#P9999_USERNAME',
    '#P9999_PASSWORD',
    'input[placeholder*="EMAIL OR LTO CLIENT NUMBER" i]',
    'input[placeholder*="PASSWORD" i]',
  ],
  violationMenu: [
    'a:has-text("Violations")',
    'button:has-text("Violations")',
    'a[href*="violation" i]',
    'a[href*="apprehension" i]',
    'a:has-text("Traffic Violations")',
  ],
  violationsHeading: [
    'text=/^Violations$/i',
    'text=/Violations/i',
  ],
  violationsContainer: [
    '.ui-dialog',
    '.ui-dialog-content',
    '.t-Dialog-page',
    '.t-Region',
  ],
  noData: [
    'text=/no data/i',
    'text=/no records/i',
    'text=/no violation/i',
    'text=/no apprehension/i',
  ],
  tableRows: [
    "table tbody tr",
    '[role="rowgroup"] [role="row"]',
    ".t-Report-report tbody tr",
    ".a-GV-table tbody tr",
  ],
  error: [
    '.t-Alert--danger',
    '.alert-danger',
    '.error',
    'text=/invalid/i',
    'text=/captcha/i',
  ],
};

const VIOLATION_TABS = [
  "Demerit Points",
  "Unsettled",
  "History",
];

function buildRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function firstVisibleLocator(page, selectors, options = {}) {
  const timeout = options.timeout ?? 1_500;

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout });
      return locator;
    } catch {
      // Keep trying candidates.
    }
  }

  return null;
}

async function maybeClick(page, selectors) {
  const locator = await firstVisibleLocator(page, selectors, { timeout: 1_000 });
  if (!locator) {
    return false;
  }

  await locator.click();
  return true;
}

export class LtmsClient {
  #config;
  #browser = null;
  #context = null;
  #page = null;

  constructor(config) {
    this.#config = config;
  }

  getPage() {
    return this.#page;
  }

  async startLoginAttempt() {
    await this.#cleanupBrowser();

    this.#browser = await chromium.launch({ headless: this.#config.headless });
    this.#context = await this.#browser.newContext();
    this.#page = await this.#context.newPage();
    this.#page.setDefaultTimeout(this.#config.playwrightTimeoutMs);

    await this.#page.goto(this.#config.ltmsPortalUrl, {
      waitUntil: "domcontentloaded",
    });

    await this.#page.waitForLoadState("networkidle").catch(() => {});
    await this.#openLoginPageIfNeeded();
    await this.#prepareLoginFields();

    const captchaBuffer = await this.#captureCaptcha();

    return {
      runId: buildRunId(),
      captchaBuffer,
    };
  }

  async refreshCaptcha() {
    this.#ensurePage();

    const refreshClicked = await maybeClick(this.#page, LOGIN_SELECTORS.captchaRefresh);
    if (!refreshClicked) {
      await this.#page.reload({ waitUntil: "domcontentloaded" });
      await this.#page.waitForLoadState("networkidle").catch(() => {});
      await this.#prepareLoginFields();
    } else {
      await this.#page.waitForTimeout(1_000);
    }

    await this.#prepareLoginFields();
    return this.#captureCaptcha();
  }

  async submitCaptcha(captchaText) {
    this.#ensurePage();

    const captchaInput = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.captchaInput);
    if (!captchaInput) {
      throw new Error("Unable to find LTMS captcha input");
    }

    await captchaInput.fill("");
    await captchaInput.fill(captchaText.trim());

    const submitButton = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.submit);
    if (!submitButton) {
      throw new Error("Unable to find LTMS login button");
    }

    await Promise.allSettled([
      this.#page.waitForLoadState("networkidle", { timeout: this.#config.playwrightTimeoutMs }),
      submitButton.click(),
    ]);

    const loginResult = await this.#detectLoginResult();
    if (loginResult.status !== "success") {
      return loginResult;
    }

    const violations = await this.checkViolations();
    return {
      status: "success",
      violations,
    };
  }

  async hasReusableSession() {
    if (!this.#page) {
      return false;
    }

    const loginForm = await firstVisibleLocator(this.#page, POST_LOGIN_SELECTORS.loginForm, {
      timeout: 1_000,
    });
    if (loginForm) {
      return false;
    }

    return true;
  }

  async checkViolations() {
    this.#ensurePage();

    const sessionActive = await this.hasReusableSession();
    if (!sessionActive) {
      throw new Error("LTMS session is no longer logged in");
    }

    await this.#openViolationsPage();
    const tabs = [];

    for (const tabName of VIOLATION_TABS) {
      const text = await this.#scrapeViolationTab(tabName);
      tabs.push({
        name: tabName,
        text,
        hasContent: text.trim().length > 0,
      });
    }

    return {
      anyContent: tabs.some((tab) => tab.hasContent),
      tabs,
    };
  }

  async cancel() {
    await this.#cleanupBrowser();
  }

  async #prepareLoginFields() {
    const usernameInput = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.username);
    const passwordInput = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.password);

    if (!usernameInput || !passwordInput) {
      throw new Error("Unable to find LTMS username/password fields");
    }

    await usernameInput.fill("");
    await usernameInput.fill(this.#config.ltmsUsername);
    await passwordInput.fill("");
    await passwordInput.fill(this.#config.ltmsPassword);
  }

  async #openLoginPageIfNeeded() {
    const existingUsernameInput = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.username, {
      timeout: 1_500,
    });
    const existingPasswordInput = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.password, {
      timeout: 1_500,
    });

    if (existingUsernameInput && existingPasswordInput) {
      return;
    }

    const loginButton = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.launchLogin, {
      timeout: 4_000,
    });

    if (!loginButton) {
      throw new Error("Unable to find LTMS login entry button on the home page");
    }

    await Promise.allSettled([
      this.#page.waitForLoadState("domcontentloaded", { timeout: this.#config.playwrightTimeoutMs }),
      loginButton.click(),
    ]);

    await this.#page.waitForLoadState("networkidle").catch(() => {});
  }

  async #captureCaptcha() {
    const captchaLocator = await firstVisibleLocator(this.#page, LOGIN_SELECTORS.captchaImage, {
      timeout: 2_500,
    });

    if (!captchaLocator) {
      throw new Error("Unable to find LTMS captcha image");
    }

    return captchaLocator.screenshot({
      type: "png",
      animations: "disabled",
    });
  }

  async #detectLoginResult() {
    const currentUrl = this.#page.url();

    const logoutLocator = await firstVisibleLocator(this.#page, POST_LOGIN_SELECTORS.logout, {
      timeout: 2_000,
    });
    if (logoutLocator) {
      return { status: "success" };
    }

    const errorLocator = await firstVisibleLocator(this.#page, POST_LOGIN_SELECTORS.error, {
      timeout: 1_200,
    });
    if (errorLocator) {
      const message = (await errorLocator.textContent())?.trim() || "LTMS login failed";
      return { status: "failed", reason: message };
    }

    if (/login|public_portal/i.test(currentUrl)) {
      return {
        status: "failed",
        reason: "Still on LTMS login page after submission. The captcha may be incorrect.",
      };
    }

    return { status: "success" };
  }

  async #openViolationsPage() {
    const menu = await firstVisibleLocator(this.#page, POST_LOGIN_SELECTORS.violationMenu, {
      timeout: 5_000,
    });

    if (menu) {
      await Promise.allSettled([
        this.#page.waitForLoadState("networkidle", { timeout: this.#config.playwrightTimeoutMs }),
        menu.click(),
      ]);
    } else {
      const links = await this.#page.locator("a").all();
      for (const link of links) {
        const text = ((await link.textContent()) || "").trim().toLowerCase();
        if (text.includes("violation") || text.includes("apprehension")) {
          await Promise.allSettled([
            this.#page.waitForLoadState("networkidle", { timeout: this.#config.playwrightTimeoutMs }),
            link.click(),
          ]);
          break;
        }
      }
    }

    const heading = await firstVisibleLocator(this.#page, POST_LOGIN_SELECTORS.violationsHeading, {
      timeout: 5_000,
    });
    if (!heading) {
      throw new Error("Unable to open LTMS Violations page");
    }
  }

  async #scrapeViolationTab(tabName) {
    const tab = await firstVisibleLocator(this.#page, [
      `role=tab[name="${tabName}"]`,
      `button:has-text("${tabName}")`,
      `a:has-text("${tabName}")`,
      `text=/^${tabName}$/i`,
    ], {
      timeout: 3_000,
    });

    if (!tab) {
      return "Tab not found.";
    }

    await tab.click().catch(() => {});
    await this.#page.waitForTimeout(500);

    const extracted = await this.#page.evaluate(({ tabName, tabs, containerSelectors }) => {
      function visibleText(node) {
        if (!node) {
          return "";
        }

        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          return "";
        }

        return (node.innerText || "").trim();
      }

      function sanitize(text) {
        if (!text) {
          return "";
        }

        let cleaned = text;
        cleaned = cleaned.replace(/\bViolations\b/gi, "");
        cleaned = cleaned.replace(/\bClose\b/gi, "");
        for (const label of tabs) {
          cleaned = cleaned.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
        }

        cleaned = cleaned
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n")
          .trim();

        return cleaned;
      }

      let container = null;
      for (const selector of containerSelectors) {
        const candidates = Array.from(document.querySelectorAll(selector));
        container = candidates.find((candidate) => {
          const text = visibleText(candidate);
          return tabs.every((label) => text.includes(label));
        });
        if (container) {
          break;
        }
      }

      const baseText = sanitize(visibleText(container || document.body));
      if (!baseText) {
        return "";
      }

      const lines = baseText.split("\n");
      const filtered = lines.filter((line) => {
        const normalized = line.trim().toLowerCase();
        if (!normalized) {
          return false;
        }
        if (tabs.some((label) => normalized === label.toLowerCase())) {
          return false;
        }
        return true;
      });

      if (tabName === "Demerit Points") {
        const pointLine = filtered.find((line) => /\bpoints?\b/i.test(line));
        return pointLine || filtered.join("\n");
      }

      const meaningful = filtered.filter((line) => !/^violations$/i.test(line));
      return meaningful.join("\n").trim();
    }, {
      tabName,
      tabs: VIOLATION_TABS,
      containerSelectors: POST_LOGIN_SELECTORS.violationsContainer,
    });

    if (extracted) {
      return extracted;
    }

    const noDataLocator = await firstVisibleLocator(this.#page, POST_LOGIN_SELECTORS.noData, {
      timeout: 1_000,
    });
    if (noDataLocator) {
      return ((await noDataLocator.textContent()) || "No records").trim();
    }

    for (const selector of POST_LOGIN_SELECTORS.tableRows) {
      const rows = await this.#page.locator(selector).allInnerTexts().catch(() => []);
      const cleanedRows = rows.map((row) => row.trim()).filter(Boolean);
      if (cleanedRows.length > 0) {
        return cleanedRows.join("\n");
      }
    }

    return "No visible content.";
  }

  #ensurePage() {
    if (!this.#page) {
      throw new Error("No active LTMS browser session");
    }
  }

  async #cleanupBrowser() {
    await this.#context?.close().catch(() => {});
    await this.#browser?.close().catch(() => {});
    this.#context = null;
    this.#browser = null;
    this.#page = null;
  }
}
