import { existsSync } from "node:fs";
import { chromium, devices } from "playwright";

const desktop = devices["Desktop Chrome"];
const linuxChromium = "/usr/bin/chromium";

const startBrowser = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(linuxChromium) ? linuxChromium : undefined,
  });
  const context = await browser.newContext({ ...desktop });
  return { context, browser };
};

(async () => {
  const { context, browser } = await startBrowser();
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/");
  console.log(await page.title());
  await browser.close();
})();
