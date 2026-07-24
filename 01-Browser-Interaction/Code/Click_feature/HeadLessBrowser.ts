import { chromium } from "playwright";
import { OpenRouter } from '@openrouter/sdk';
import { writeFile } from "fs/promises";

import dotenv from "dotenv";
dotenv.config();

const client = new OpenRouter({
  apiKey: process.env.key,
});

// Safety cap so a single call never blows past your OpenRouter prompt-token
// ceiling, regardless of how bloated a page's HTML is. ~4 chars/token is a
// rough rule of thumb, so 8000 chars ≈ 2000 tokens.
const MAX_HTML_CHARS = 8000;
const truncate = (s: string): string =>
  s.length > MAX_HTML_CHARS ? s.slice(0, MAX_HTML_CHARS) + "...[truncated]" : s;

const startBrowser = async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  return { browser, page };
};

const ask_llm = async (query: string, html_: string) => {
  const completion = await client.chat.send({
    chatRequest: {
      model: "deepseek/deepseek-chat-v3.1",
      maxTokens: 50,
      messages: [
        {
          role: 'user',
          content: `You are a strict HTML element locator. You do not chat, explain, or add commentary — you output exactly one line of text per response, nothing else.

        INPUT YOU WILL RECEIVE:
        1. A block of raw HTML from a webpage. Elements inside the page footer are prefixed with "[footer] ".
        2. A query describing a button/element the user wants to click (may include an ordinal, e.g. "2nd OK button", or a location like "in the footer").

        YOUR TASK:
        Search the HTML for interactive elements (button, a, input[type=button/submit], or any element with role="button") whose visible text/label most closely matches the query's intent.

        OUTPUT RULES (return exactly one of these, no quotes, no markdown, no punctuation added):

        1. NO MATCH FOUND:
           Return exactly: invalid

        2. EXACTLY ONE MATCHING ELEMENT:
           Return the element's exact accessible text as it appears in the HTML (do NOT include the "[footer] " prefix — that is location metadata only).
           Example: OK

        3. MULTIPLE MATCHING ELEMENTS, but the user's query did NOT specify which one (no ordinal like "1st", "2nd", "third"):
           Return exactly: Multiple

        4. MULTIPLE MATCHING ELEMENTS, and the user's query DID specify an ordinal (e.g. "click the 2nd OK button"):
           Return the exact text followed by a space and the ordinal number (as a digit).
           Example, if there are 3 "OK" buttons and user asked for the 2nd one: OK 2

        MATCHING RULES:
        - Match on visible/accessible text, trimmed of extra whitespace, case-insensitive for comparison purposes — but return the text exactly as it appears in the HTML (preserve original casing), excluding the "[footer] " prefix.
        - If the query specifies a location (e.g. "in the footer", "at the bottom"), only consider elements prefixed with "[footer] ", and ignore elements elsewhere on the page even if their text matches better.
        - Prefer exact text matches over partial/fuzzy matches.
        - If no exact match exists, use the closest semantic match (e.g. query "confirm" matching a button labeled "Confirm Order" is acceptable only if nothing closer exists).
        - Only consider elements that are clickable (buttons, links, or elements with role="button"/onclick handlers). Ignore plain text, labels, or disabled elements.
        - If the query itself contains an ordinal but there is in fact only ONE matching element, ignore the ordinal and just return the text (case 2) — do not append a number.
        - Never return explanations, reasoning, HTML tags, CSS selectors, or surrounding text — only the final string per the rules above.

        Your output will be inserted directly into code like:
        await page.getByRole('YOUR_OUTPUT').click();

        So absolute precision and brevity are mandatory — a single wrong character or added word will break the automation.

        Wait for the HTML and query in the next message before responding.

      ------------------
      QUERY :

        ` + query + `
        And here is the HTML content ::` + html_,
        },
      ],
    }
  });
  return (completion.choices[0].message.content);
};

// Extract used to locate a clickable element. Captures icon-only links
// (footer socials etc. usually have no visible text, just an aria-label
// or title on an <a> wrapping an <svg>) and tags footer elements so
// location-aware queries like "in the footer" can be resolved correctly.
const extractClickables = async (page: import('playwright').Page): Promise<string> => {
  return await page.evaluate(() => {
    const selector = 'a, button, input[type=button], input[type=submit], [role="button"], [onclick]';
    const els = Array.from(document.querySelectorAll(selector));

    return els
      .map(el => {
        const visibleText = (el.textContent || (el as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ');
        const label = visibleText || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!label) return null;

        const tag = el.tagName.toLowerCase();
        const href = el.getAttribute('href');
        const inFooter = el.closest('footer') ? '[footer] ' : '';
        return `${inFooter}<${tag}${href ? ` href="${href}"` : ''}>${label}</${tag}>`;
      })
      .filter(Boolean)
      .join('\n');
  });
};

const cleanHtml = async (page: import('playwright').Page): Promise<string> => {
  const raw = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;

    clone.querySelectorAll('script, style, svg, noscript, link, meta').forEach(el => el.remove());

    clone.querySelectorAll('span').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent || ''));
    });

    clone.querySelectorAll('*').forEach(el => {
      const keep = ['href', 'alt', 'role', 'type', 'value'];
      [...el.attributes].forEach(attr => {
        if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
      });
    });

    return clone.outerHTML;
  });

  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const ask_state = async (html: string, query: string) => {
  const completion = await client.chat.send({
    chatRequest: {
      model: "deepseek/deepseek-chat-v3.1",
      maxTokens: 100,
      messages: [
        {
          role: 'user',
          content: `You are a strict HTML question-answering assistant. You do not chat, explain your reasoning, or add commentary beyond what is explicitly requested — you answer only the user's query, based only on what is present in the HTML.

          INPUT YOU WILL RECEIVE:
          1. HTML — the current HTML state of a webpage.
          2. QUERY — a question about that page (e.g. "did a modal open?", "is there an error message?", "what does the bio say?").

          YOUR TASK:
          Answer the QUERY using only the given HTML — never invent information not present in it.
          If the QUERY asks about something not observable in the HTML, say so plainly rather than guessing.

          OUTPUT RULES:
          - Answer in the shortest possible complete form — a single word, short phrase, or one short sentence. No preamble, no markdown, no restating the question.
          - If the query is a yes/no question, answer strictly "Yes" or "No" optionally followed by a brief 3-6 word clarifier if essential.
          - If the query cannot be answered from the HTML, respond exactly: "Not found"
          - Never output HTML tags, CSS selectors, class names, or raw markup in your answer — describe things in plain natural language only.
          - Never return explanations of your reasoning, only the final answer.

          Your output will be consumed programmatically by another script. Precision and brevity are mandatory.

          ------------
          HTML:
          ` + html + `

          QUERY: ` + query
        },
      ],
    }
  });
  return (completion.choices[0].message.content);
};

const clickByText = async (page: import('playwright').Page, text: string) => {
  const roles = ['link', 'button'] as const;

  for (const role of roles) {
    const locator = page.getByRole(role, { name: text });
    const count = await locator.count();
    if (count > 0) {
      await locator.first().click({ force: true });
      return;
    }
  }

  await page.getByText(text).first().click({ force: true });
};

const run = async (url: string, nlum: string, msg: string) => {
  const { browser, page } = await startBrowser();
  console.log("Started browser");

  for (let i = 0; i < 3; i++) {
    try {
      console.log("Trial:", i);
      await page.goto(url, { timeout: 10000 });
      break;
    } catch (err) {
      if (i === 2) {
        throw new Error(`Failed to load ${url} after 3 attempts`, {
          cause: err,
        });
      }
    }
  }

  const clickables = truncate(await extractClickables(page));
  console.log("Clickable elements extracted");

  const text = await ask_llm(nlum, clickables);
  console.log("LLM returned:", text);

  if (text === "invalid") {
    throw new Error(`No matching element found for query: "${nlum}"`);
  }
  if (text === "Multiple") {
    throw new Error(`Multiple matching elements found for query: "${nlum}" — need to disambiguate`);
  }
  console.log("Clicking...");

  const before_url = page.url();

  // Some links (target="_blank") open a NEW tab instead of navigating the
  // current page. If we don't capture that new tab, `page` never changes
  // and the state check below will always see the old page.
  const context = page.context();
  const [newPage] = await Promise.all([
    context.waitForEvent("page", { timeout: 3000 }).catch(() => null),
    clickByText(page, text),
  ]);

  let targetPage = page;
  if (newPage) {
    console.log("New tab opened, switching context to it");
    await newPage.waitForLoadState("networkidle").catch(() => {});
    targetPage = newPage;
  } else {
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  console.log("Clicked", text);

  // Sanity check: did the click actually do anything observable? If not,
  // the LLM likely matched the wrong element and we're about to ask a
  // question against a page that never changed.
  const navigated = newPage !== null || targetPage.url() !== before_url;
  if (!navigated) {
    console.warn(
      `Warning: clicked "${text}" but no navigation or new tab was detected — the page state is likely unchanged, and the following answer may be unreliable.`
    );
  }

  const changed_html = truncate(await cleanHtml(targetPage));
  console.log("Captured resulting page state");
  console.log(targetPage.url());

  await writeFile("output.txt", changed_html, "utf-8");

  console.log("Asking about page state...");
  const result = await ask_state(changed_html, msg);
  console.log(result);

  await browser.close();
};

// url, natural-language query for what to click, question about the result
const url = "https://gagan-9vo.pages.dev/";
run(url, "The github link provided at the footer", "get me the Bio of his github");
