// ==UserScript==
// @name         Amex Offers Add All
// @namespace    https://github.com/ethansane/credittools
// @version      1.0.0
// @description  Adds a single-click control to add all available American Express offers to your card.
// @updateURL    https://raw.githubusercontent.com/ethansane/credittools/main/scripts/amex-offer.js
// @downloadURL  https://raw.githubusercontent.com/ethansane/credittools/main/scripts/amex-offer.js
// @match        https://*.americanexpress.com/*offers*
// @match        https://americanexpress.com/*offers*
// @match        https://global.americanexpress.com/*offers*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    clickDelayMs: 1200,
    settleDelayMs: 900,
    scrollDelayMs: 1300,
    waitForButtonChangeMs: 7000,
    maxClicks: 500,
    noProgressPasses: 4,
  };

  const ADD_BUTTON_SELECTORS = [
    'button[data-testid="merchantOfferListAddButton"]',
    'button[title="add to list card"]',
    'button[aria-label*="Add to Card" i]',
    'button[aria-label*="Add offer" i]',
    'button[title*="Add to Card" i]',
  ];

  const LOAD_MORE_TEXT = /^(show more|load more|more offers|view more)$/i;
  const ADD_TEXT = /\b(add|activate|enroll)\b.*\b(card|offer|list)\b/i;
  const NOT_ADD_TEXT = /\b(added|remove|view details|terms apply|learn more|done)\b/i;

  let running = false;
  let stopRequested = false;
  let clickedCount = 0;
  let passCount = 0;
  let attemptedButtons = new WeakSet();

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function textOf(element) {
    return [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isElementUsable(element) {
    if (!element || attemptedButtons.has(element)) return false;
    if (element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (element.closest("[aria-disabled='true']")) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return element.getClientRects().length > 0;
  }

  function isAddOfferButton(button) {
    if (!isElementUsable(button)) return false;

    const testId = button.getAttribute("data-testid") || "";
    const title = button.getAttribute("title") || "";
    if (testId === "merchantOfferListAddButton") return true;
    if (title.toLowerCase() === "add to list card") return true;

    const text = textOf(button);
    return ADD_TEXT.test(text) && !NOT_ADD_TEXT.test(text);
  }

  function queryAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function findAddButtons() {
    const bySelector = ADD_BUTTON_SELECTORS.flatMap(queryAll);
    const fallback = Array.from(document.querySelectorAll("button")).filter(isAddOfferButton);
    const buttons = [...bySelector, ...fallback].filter(isAddOfferButton);
    return Array.from(new Set(buttons));
  }

  function findLoadMoreButton() {
    return Array.from(document.querySelectorAll("button"))
      .filter(isElementUsable)
      .find((button) => LOAD_MORE_TEXT.test(textOf(button)));
  }

  function clickLikeUser(button) {
    button.scrollIntoView({ block: "center", inline: "center" });
    button.focus({ preventScroll: true });
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    button.click();
  }

  async function waitForButtonToChange(button) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < CONFIG.waitForButtonChangeMs) {
      if (!document.contains(button)) return;
      if (!isElementUsable(button)) return;
      await sleep(250);
    }
  }

  function injectStyles() {
    if (document.getElementById("amex-add-all-style")) return;

    const style = document.createElement("style");
    style.id = "amex-add-all-style";
    style.textContent = `
      #amex-add-all-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: flex;
        gap: 8px;
        align-items: center;
        max-width: min(420px, calc(100vw - 32px));
        padding: 10px;
        border: 1px solid #b5d7f4;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
        color: #1f1f1f;
        font: 14px/1.35 Arial, Helvetica, sans-serif;
      }

      #amex-add-all-panel button {
        min-height: 36px;
        border: 1px solid #006fcf;
        border-radius: 6px;
        padding: 0 12px;
        background: #006fcf;
        color: #fff;
        cursor: pointer;
        font: inherit;
        white-space: nowrap;
      }

      #amex-add-all-panel button[data-stop] {
        border-color: #737373;
        background: #fff;
        color: #333;
      }

      #amex-add-all-status {
        min-width: 120px;
        color: #333;
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(message) {
    const status = document.getElementById("amex-add-all-status");
    if (status) status.textContent = message;
  }

  function setStartButtonLabel(label) {
    const button = document.getElementById("amex-add-all-start");
    if (button) button.textContent = label;
  }

  function ensureControls() {
    if (document.getElementById("amex-add-all-panel")) return;

    injectStyles();

    const panel = document.createElement("div");
    panel.id = "amex-add-all-panel";
    panel.innerHTML = `
      <button id="amex-add-all-start" type="button">Add all Amex offers</button>
      <button id="amex-add-all-stop" data-stop type="button">Stop</button>
      <span id="amex-add-all-status">Ready</span>
    `;

    document.body.appendChild(panel);
    document.getElementById("amex-add-all-start").addEventListener("click", run);
    document.getElementById("amex-add-all-stop").addEventListener("click", () => {
      stopRequested = true;
      setStatus("Stopping...");
    });
  }

  async function scrollForMoreOffers() {
    const beforeY = window.scrollY;
    const beforeHeight = document.documentElement.scrollHeight;
    const step = Math.max(window.innerHeight * 0.85, 650);

    window.scrollBy({ top: step, left: 0, behavior: "smooth" });
    await sleep(CONFIG.scrollDelayMs);

    const afterY = window.scrollY;
    const afterHeight = document.documentElement.scrollHeight;
    return afterHeight > beforeHeight + 20 || Math.abs(afterY - beforeY) > 20;
  }

  async function run() {
    if (running) return;

    running = true;
    stopRequested = false;
    clickedCount = 0;
    passCount = 0;
    attemptedButtons = new WeakSet();
    setStartButtonLabel("Running...");

    try {
      let noProgressPasses = 0;

      while (!stopRequested && clickedCount < CONFIG.maxClicks) {
        passCount += 1;
        const buttons = findAddButtons();

        if (buttons.length > 0) {
          noProgressPasses = 0;
          const button = buttons[0];
          attemptedButtons.add(button);
          clickedCount += 1;
          setStatus(`Clicked ${clickedCount}; ${buttons.length - 1} queued`);
          clickLikeUser(button);
          await waitForButtonToChange(button);
          await sleep(CONFIG.clickDelayMs);
          continue;
        }

        const loadMoreButton = findLoadMoreButton();
        if (loadMoreButton) {
          setStatus(`Loading more... (${clickedCount})`);
          attemptedButtons.add(loadMoreButton);
          clickLikeUser(loadMoreButton);
          await sleep(CONFIG.scrollDelayMs);
          continue;
        }

        const moved = await scrollForMoreOffers();
        const newButtons = findAddButtons().length;
        if (newButtons > 0) {
          noProgressPasses = 0;
          continue;
        }

        noProgressPasses += 1;
        setStatus(`Scanning... ${clickedCount} added`);

        if (!moved || noProgressPasses >= CONFIG.noProgressPasses) break;
        await sleep(CONFIG.settleDelayMs);
      }

      const suffix = clickedCount >= CONFIG.maxClicks ? " hit max limit" : "";
      setStatus(stopRequested ? `Stopped at ${clickedCount}` : `Done: ${clickedCount}${suffix}`);
    } catch (error) {
      console.error("[Amex Offers Add All]", error);
      setStatus(`Error after ${clickedCount}; see console`);
    } finally {
      running = false;
      stopRequested = false;
      setStartButtonLabel("Add all Amex offers");
      console.info(
        `[Amex Offers Add All] clicked=${clickedCount}, passes=${passCount}`
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureControls, { once: true });
  } else {
    ensureControls();
  }
})();
