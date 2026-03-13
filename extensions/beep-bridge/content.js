/**
 * content.js — BeepBot Bridge Content Script
 *
 * Runs in every page in an isolated world. Receives commands from
 * background.js via chrome.runtime.onMessage and executes real DOM
 * actions that are indistinguishable from user input.
 *
 * Maintains a numbered element map ([1], [2], ...) matching the
 * format used by BrowserManager's CDP-based accessibility tree reader.
 */

// Element reference map — rebuilt on each read()
let elementRefs = []; // index 0 unused; [1] = first element

// Interactive roles that get numbered references
const INTERACTIVE_ROLES = new Set([
  "link", "button", "textbox", "checkbox", "radio", "combobox",
  "searchbox", "switch", "slider", "spinbutton", "menuitem",
  "tab", "option",
]);

// Roles to skip (container-only — walk children at same depth)
const SKIP_ROLES = new Set([
  "generic", "none", "presentation", "group", "list",
  "listitem", "paragraph", "section", "article", "main",
  "banner", "contentinfo", "complementary", "region",
]);

// ─── Message Handler ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const result = await executeAction(msg);
      sendResponse(result);
    } catch (err) {
      sendResponse({ error: err.message || String(err) });
    }
  })();
  return true; // Keep channel open for async response
});

async function executeAction(cmd) {
  switch (cmd.action) {
    case "read":
      return readPage(cmd.maxElements ?? 150);
    case "click":
      return await clickElement(cmd.ref, cmd.selector, cmd.text);
    case "type":
      return await typeText(cmd.text, cmd.ref, cmd.selector, cmd.pressEnter);
    case "scroll":
      return scrollPage(cmd.direction, cmd.pixels);
    default:
      throw new Error(`Unknown content action: ${cmd.action}`);
  }
}

// ─── READ — Accessibility-like Tree ──────────────────────────────

function readPage(maxElements) {
  elementRefs = [null]; // index 0 unused
  const outputLines = [];
  let refIndex = 1;

  function walk(node, depth) {
    if (refIndex > maxElements) return;
    if (isHidden(node)) return;

    const role = getRole(node);
    const name = getAccessibleName(node);

    // Skip container roles — walk children at same depth
    if (SKIP_ROLES.has(role)) {
      for (const child of node.children) walk(child, depth);
      return;
    }

    const indent = "  ".repeat(depth);

    if (INTERACTIVE_ROLES.has(role)) {
      const displayName = name || getPlaceholder(node) || "";
      outputLines.push(`${indent}[${refIndex}] ${role}: "${displayName}"`);
      elementRefs.push({
        element: node,
        role,
        name: displayName,
        selector: generateSelector(node),
      });
      refIndex++;
    } else if (isTextNode(node)) {
      // Leaf text — only show if non-empty and not duplicate of parent
      const text = node.textContent?.trim();
      if (text && text.length > 0 && text.length < 500) {
        outputLines.push(`${indent}${text.substring(0, 200)}`);
      }
      return; // Text nodes have no meaningful children
    } else if (name && role) {
      outputLines.push(`${indent}- ${role}: "${name}"`);
    }

    // Walk children
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  walk(document.body, 0);

  const header = `Page: ${document.title}\nURL: ${window.location.href}\nInteractive elements: ${refIndex - 1}\n---\n`;
  return {
    content: header + outputLines.join("\n"),
    url: window.location.href,
    title: document.title,
    elementCount: refIndex - 1,
  };
}

// ─── CLICK ───────────────────────────────────────────────────────

async function clickElement(ref, selector, text) {
  const el = resolveElement(ref, selector, text);
  if (!el) throw new Error(`Element not found: ${ref ? `[${ref}]` : selector || text}`);

  // Scroll into view
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  await sleep(randomBetween(50, 150));

  // Get position for realistic click coordinates
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2 + randomBetween(-5, 5);
  const y = rect.top + rect.height / 2 + randomBetween(-5, 5);

  // Dispatch real mouse events in correct order
  const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...eventOpts, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", eventOpts));
  await sleep(randomBetween(30, 80));
  el.dispatchEvent(new PointerEvent("pointerup", { ...eventOpts, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent("mouseup", eventOpts));
  el.dispatchEvent(new MouseEvent("click", eventOpts));

  // Build description matching BrowserManager format
  const role = getRole(el);
  const name = getAccessibleName(el) || "";
  const description = ref
    ? `[${ref}] ${role}: "${name}"`
    : selector || text || `${role}: "${name}"`;

  return {
    clicked: description,
    url: window.location.href,
    x: Math.round(x),
    y: Math.round(y),
    metadata: getElementMetadata(el),
  };
}

// ─── TYPE ────────────────────────────────────────────────────────

async function typeText(text, ref, selector, pressEnter) {
  let el;
  let description = "";

  if (ref || selector) {
    el = resolveElement(ref, selector);
    if (!el) throw new Error(`Element not found: ${ref ? `[${ref}]` : selector}`);

    // Click to focus
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(randomBetween(50, 100));
    el.focus();
    el.click();
    await sleep(randomBetween(100, 200));

    const role = getRole(el);
    const name = getAccessibleName(el) || "";
    description = ref ? `[${ref}] ${role}: "${name}"` : selector;
  } else {
    el = document.activeElement;
  }
  if (!el) throw new Error("No element focused for typing");

  // Type character by character with human-like delays
  for (const char of text) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));

    // Update value via native setter (triggers React/Vue change detection)
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const setter =
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) {
        setter.call(el, el.value + char);
      } else {
        el.value += char;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      document.execCommand("insertText", false, char);
    }

    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
    await sleep(randomBetween(40, 110));
  }

  if (pressEnter) {
    await sleep(randomBetween(100, 300));
    const enterOpts = { key: "Enter", code: "Enter", keyCode: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
    el.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
    el.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
  }

  const truncated = text.length > 50 ? text.slice(0, 50) + "..." : text;
  const into = description ? ` into ${description}` : "";
  const enter = pressEnter ? " + Enter" : "";

  return {
    message: `Typed "${truncated}"${into}${enter}`,
    metadata: el ? getElementMetadata(el) : null,
  };
}

// ─── SCROLL ──────────────────────────────────────────────────────

function scrollPage(direction, pixels = 400) {
  const amount = pixels + randomBetween(-20, 20);
  const yDelta = direction === "up" ? -amount : amount;
  window.scrollBy({ top: yDelta, behavior: "smooth" });
  return { message: `Scrolled ${direction} ${Math.abs(amount)}px` };
}

// ─── Element Resolution ──────────────────────────────────────────

function resolveElement(ref, selector, text) {
  // Try numbered reference first
  if (ref != null) {
    const refNum = typeof ref === "string" ? parseInt(ref, 10) : ref;
    const entry = elementRefs[refNum];
    if (entry && entry.element) {
      // Verify element is still in DOM
      if (document.contains(entry.element)) return entry.element;
      // Fallback: try to find by stored selector
      if (entry.selector) {
        try { return document.querySelector(entry.selector); } catch {}
      }
    }
    throw new Error(`Element [${refNum}] not found. Use browser_read to refresh the element list.`);
  }

  // Try CSS selector
  if (selector) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {}
  }

  // Try text search
  if (text) {
    // ARIA label
    const byLabel = document.querySelector(`[aria-label="${CSS.escape(text)}"]`);
    if (byLabel) return byLabel;

    // Button/link text content
    const candidates = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')];
    const match = candidates.find((el) => el.textContent?.trim().includes(text));
    if (match) return match;

    // Broad text search (leaf nodes only)
    const all = [...document.querySelectorAll("*")];
    return all.find((el) => el.children.length === 0 && el.textContent?.trim().includes(text)) || null;
  }

  return null;
}

// ─── Role & Name Computation ─────────────────────────────────────

function getRole(node) {
  // Explicit ARIA role takes priority
  const ariaRole = node.getAttribute?.("role");
  if (ariaRole) return ariaRole;

  // Infer from tag
  const tag = node.tagName;
  if (!tag) return "";

  if (tag === "INPUT") {
    const type = (node.type || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    if (type === "search") return "searchbox";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    return "textbox";
  }

  const TAG_ROLES = {
    BUTTON: "button", A: "link", TEXTAREA: "textbox",
    SELECT: "combobox", IMG: "img",
    H1: "heading", H2: "heading", H3: "heading",
    H4: "heading", H5: "heading", H6: "heading",
    NAV: "navigation", MAIN: "main", FORM: "form",
    TABLE: "table", UL: "list", OL: "list", LI: "listitem",
    SECTION: "section", ARTICLE: "article",
    HEADER: "banner", FOOTER: "contentinfo",
    ASIDE: "complementary", DETAILS: "group",
    SUMMARY: "button", OPTION: "option",
    P: "paragraph", DIV: "generic", SPAN: "generic",
  };

  return TAG_ROLES[tag] || "";
}

function getAccessibleName(node) {
  if (!node.getAttribute) return "";
  return (
    node.getAttribute("aria-label") ||
    node.getAttribute("alt") ||
    node.getAttribute("title") ||
    node.getAttribute("placeholder") ||
    getLabelText(node) ||
    (isInteractiveTag(node) ? node.textContent?.trim().substring(0, 200) : "") ||
    ""
  );
}

function getLabelText(node) {
  if (!node.id) return "";
  const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
  return label ? label.textContent?.trim().substring(0, 200) : "";
}

function getPlaceholder(node) {
  return node.getAttribute?.("placeholder") || node.getAttribute?.("aria-placeholder") || "";
}

function isInteractiveTag(node) {
  const tag = node.tagName;
  return tag === "BUTTON" || tag === "A" || tag === "SUMMARY" ||
    (tag === "INPUT" && (node.type === "submit" || node.type === "button"));
}

// ─── Element Metadata ────────────────────────────────────────────

function getElementMetadata(node) {
  if (!node || !node.tagName) return null;
  return {
    element: node.tagName.toLowerCase(),
    id: node.id || null,
    className: node.className ? String(node.className).substring(0, 100) : null,
    name: node.getAttribute?.("name") || null,
    ariaLabel: node.getAttribute?.("aria-label") || null,
    dataTestId: node.getAttribute?.("data-testid") || null,
    placeholder: node.getAttribute?.("placeholder") || null,
    inputType: node.type || null,
    textContent: node.textContent?.trim().substring(0, 100) || null,
    selector: generateSelector(node),
    fallbacks: generateFallbackSelectors(node),
  };
}

// ─── Visibility & Classification ─────────────────────────────────

function isHidden(node) {
  if (!node.getBoundingClientRect) return false;
  // Fast check: skip hidden attributes
  if (node.hidden) return true;
  if (node.getAttribute?.("aria-hidden") === "true") return true;

  const style = window.getComputedStyle(node);
  return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
}

function isTextNode(node) {
  // Node that contains only direct text (no interactive children)
  if (node.children.length > 0) return false;
  const text = node.textContent?.trim();
  return text && text.length > 0;
}

// ─── Selector Generation ─────────────────────────────────────────

function generateSelector(node) {
  if (!node || !node.tagName) return "";

  // ID selector (most specific)
  if (node.id) return `#${CSS.escape(node.id)}`;

  // data-testid
  const testId = node.getAttribute?.("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

  // Tag + distinguishing attributes
  const tag = node.tagName.toLowerCase();

  // Name attribute (for inputs)
  const name = node.getAttribute?.("name");
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;

  // ARIA label
  const ariaLabel = node.getAttribute?.("aria-label");
  if (ariaLabel) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;

  // For links: href
  if (tag === "a" && node.href) {
    const href = node.getAttribute("href");
    if (href && href.length < 100) return `a[href="${CSS.escape(href)}"]`;
  }

  // Fallback: tag + nth-of-type
  const parent = node.parentElement;
  if (!parent) return tag;
  const siblings = [...parent.children].filter((s) => s.tagName === node.tagName);
  const index = siblings.indexOf(node);
  if (siblings.length > 1) return `${tag}:nth-of-type(${index + 1})`;
  return tag;
}

function generateFallbackSelectors(node) {
  const fallbacks = [];
  if (!node || !node.tagName) return fallbacks;

  const tag = node.tagName.toLowerCase();

  // Class-based selector
  if (node.classList?.length > 0) {
    const classes = [...node.classList].slice(0, 3).map(CSS.escape).join(".");
    fallbacks.push(`${tag}.${classes}`);
  }

  // Role + name
  const role = node.getAttribute?.("role");
  const ariaLabel = node.getAttribute?.("aria-label");
  if (role && ariaLabel) {
    fallbacks.push(`[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`);
  }

  return fallbacks;
}

// ─── Utilities ───────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
