import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
});

const page = await browser.newPage();
await page.goto("https://youtube.com");

console.log(await page.content());

await browser.close();
