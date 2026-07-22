import { existsSync } from "node:fs";
import { chromium, devices } from "playwright";

const desktop = devices["Desktop Chrome"];
const executableCandidates = [
  process.env.PLAYWRIGHT_BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/brave",
].filter(Boolean);

const executablePath = executableCandidates.find((candidate) =>
  existsSync(candidate)
);

const startBrowser = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const context = await browser.newContext({ ...desktop });
  return { context, browser };
};

(async () => {
  let browser;

  try {
    const started = await startBrowser();
    browser = started.browser;

    const page = await started.context.newPage();
    await page.goto("https://www.youtube.com/");
    console.log(await page.title());
  } catch (error) {
    console.error("Failed to start a headless browser.");
    console.error(
      "Set PLAYWRIGHT_BROWSER_PATH to a working browser executable on Arch Linux."
    );
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
