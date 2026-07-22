import { chromium } from "playwright";

const startBrowser = async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  return { browser, page };
};

const run =async (url:string,nlum:string) => {
  const { browser, page } = await startBrowser();
  console.log("Started Browser")
  for (let i = 0; i < 3; i++) {
    try {
      console.log("Trial : ",i)
      await page.goto(url, { timeout: 10000 });
      break;
    } catch(err) {
      if (i === 2) {
        throw new Error(`Failed to load ${url} after 3 attempts`, {
          cause: err,
        });
    }
  }
  //console.log("Output: ")
 // console.log(await page.title());
    const html_content = page.content();
    // no need to store if using context api but we are using it so uhh

    // use context dev api to get the "getbytext" button where it needs to be clicked
    // Have it clicked "getbytext"
    // get changed dom
    // compare with prev
    // return two things, "changed dom" and "change ": just the minimal diff
    // structurize in ref to how they provides their api :
    // diff sdks

  await browser.close();
}}

//url,nlu message
run("https://gagan-9vo.pages.dev/","THe github link provided at the footer")
