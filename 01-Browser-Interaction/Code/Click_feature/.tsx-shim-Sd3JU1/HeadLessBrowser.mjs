import { chromium } from "playwright";


const startBrowser=async ()=>{
const browser = await chromium.launch({
  headless: true,
});

  const page = await browser.newPage();
return {browser,page}
}

(async () => {
  let { browser, page } = startBrowser();
  await page.goto("https://youtube.com");

  console.log(await page.content());

  await browser.close();
})
