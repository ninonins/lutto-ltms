# LTMS Captcha Relay Bot

Simple Node.js service that:

1. opens the LTMS portal in Playwright,
2. fills your LTMS credentials,
3. captures the captcha and sends it to Telegram,
4. accepts your Telegram reply as the captcha answer,
5. logs in and checks whether the violations page has any content.

## What this is

- Single LTMS account only
- Single Telegram chat only
- Long-polling Telegram bot
- One active check at a time
- In-memory session state only

## What this is not

- No OCR or captcha bypass
- No persistence
- No webhook setup
- No guarantee LTMS selectors stay stable

## Setup

1. Install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Copy the example env file and fill it:

```bash
cp .env.example .env
```

3. Export the variables into the shell, or use a process manager that loads them.

4. Start the service:

```bash
npm start
```

## Commands

- `/check` starts a login attempt and sends a captcha image
- `/retry` refreshes the flow and sends a new captcha
- `/cancel` aborts the current run
- Any plain text message while waiting for captcha is treated as the captcha answer

## Notes about LTMS selectors

The LTMS portal can change markup without notice. The implementation includes fallback selectors and text-based heuristics, but you should expect at least one live validation pass on the target EC2 host.

If login or violations detection fails, update the selector candidates in [src/ltms.js](/Users/ninoreyjandayan/Desktop/ltocheck/src/ltms.js).
