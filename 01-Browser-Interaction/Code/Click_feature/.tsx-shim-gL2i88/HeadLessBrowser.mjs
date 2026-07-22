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
  try {
    const { context, browser } = await startBrowser();
    const page = await context.newPage();
    await page.goto("https://www.youtube.com/");
    console.log(await page.title());
    await browser.close();
  } catch (error) {
    console.error("Failed to start a headless browser.");
    console.error(
      "Set PLAYWRIGHT_BROWSER_PATH to a working browser executable on Arch Linux."
    );
    throw error;
  }
})();
