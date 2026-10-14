import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { partitionModelOptions } from "@/lib/loki/models";

async function main() {
  const options = [
    { id: "gpt-oss-120b", provider: "groq", label: "GPT", usable: true },
    { id: "grok-4.7", provider: "xAI", label: "Grok", usable: true, own: true },
    { id: "gemini-flash", provider: "google", label: "Gemini", usable: false, reason: "Add a key" },
  ];
  const exhausted = [
    { id: "groq/gpt-oss-120b", state: "exhausted" as const, note: "Out of free budget" },
  ];
  const ownDuplicate = { ...options[0], own: true, provider: "Groq" };
  assert.equal(
    partitionModelOptions([...options, ownDuplicate], exhausted).available.find(
      (o) => o.id === ownDuplicate.id,
    )?.own,
    true,
  );
  assert.equal(partitionModelOptions([...options, ownDuplicate], exhausted).unavailable.length, 1);
  const js = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ModelPicker} from './src/components/loki/ModelPicker';
    function Harness(){const [value,setValue]=React.useState();return <ModelPicker value={value} onChange={(m)=>{window.picked=m??'auto';setValue(m)}}/>}
    createRoot(document.getElementById('app')).render(<Harness/>);
  `,
      },
      bundle: true,
      write: false,
      jsx: "automatic",
      format: "iife",
      define: { "process.env.NODE_ENV": "'production'" },
    })
  ).outputFiles[0].text;
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (process.env.CI) throw error;
    console.log("↷ model picker skipped: Chromium unavailable; CI runs it");
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let budgetCalls = 0,
      modelCalls = 0;
    let failModels = false;
    await page.route("http://loki.fixture/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/loki/models") {
        modelCalls++;
        return route.fulfill({
          status: failModels ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            failModels
              ? { error: "offline" }
              : {
                  options,
                  autoSummary: null,
                  autoStartsAt: "groq/gpt-oss-120b",
                  addKeyHref: "/models",
                },
          ),
        });
      }
      if (path === "/api/ai/budget") {
        const call = ++budgetCalls;
        // Deliberately finishes after models: the old effect cleaned up on
        // setData and dropped this response, leaving stale choices enabled.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            headline: `Budget reading ${call}`,
            ownKeys: [],
            models: call === 1 ? exhausted : [{ ...exhausted[0], state: "known", note: null }],
          }),
        });
      }
      return route.fulfill({ contentType: "text/html", body: '<main id="app"></main>' });
    });
    await page.goto("http://loki.fixture/");
    await page.addScriptTag({ content: js });
    const trigger = page.getByRole("button", { name: "Auto", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Choose a model" });
    await dialog.getByText("Budget reading 1", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: /Grok 4.7/ }).isEnabled(), true);
    assert.equal(await dialog.getByRole("button", { name: /GPT-OSS 120B/ }).isVisible(), false);
    await dialog.getByText("Unavailable right now (2)", { exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: /GPT-OSS 120B/ }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await trigger.click();
    await dialog.getByText("Budget reading 2", { exact: true }).waitFor();
    assert.equal(modelCalls, 2);
    assert.equal(budgetCalls, 2);
    await dialog.getByRole("button", { name: /GPT-OSS 120B/ }).click();
    assert.equal(await page.evaluate("window.picked"), "gpt-oss-120b");
    assert.equal(await dialog.count(), 0);

    failModels = true;
    await page.locator(".ui-loki-model-trigger").click();
    await page.getByRole("alert").waitFor();
    failModels = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await dialog.getByRole("button", { name: /Grok 4.7/ }).waitFor();
    await dialog.getByText("Budget reading 4", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("fc-overlay-open")),
      false,
    );
    console.log(
      "✓ delayed budget, quota grouping, reopen freshness, selection, retry and sheet dismissal",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
