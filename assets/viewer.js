const state = {
  styles: [],
  categories: [],
  query: "",
  category: "All",
  promptCache: new Map(),
  activeStyle: null,
  dialogToken: 0,
};

const els = {
  cats: document.querySelector("#cats"),
  grid: document.querySelector("#grid"),
  q: document.querySelector("#q"),
  count: document.querySelector("#count"),
  viewTitle: document.querySelector("#view-title"),
  empty: document.querySelector("#empty"),
  reset: document.querySelector("#reset"),
  loadError: document.querySelector("#load-error"),
  loadErrorDetail: document.querySelector("#load-error-detail"),
  dialog: document.querySelector("#preview"),
  dialogMeta: document.querySelector("#dialog-meta"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogDesc: document.querySelector("#dialog-desc"),
  dialogMotion: document.querySelector("#dialog-motion"),
  dialogNote: document.querySelector("#dialog-note"),
  dialogVideo: document.querySelector("#dialog-video"),
  dialogRaw: document.querySelector("#dialog-raw"),
  dialogCopy: document.querySelector("#dialog-copy"),
  dialogClose: document.querySelector("#dialog-close"),
  promptText: document.querySelector("#prompt-text"),
  promptStatus: document.querySelector("#prompt-status"),
  live: document.querySelector("#live"),
};

const pad = (value) => String(value).padStart(2, "0");

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function styleById(id) {
  return state.styles.find((style) => style.styleId === id);
}

function announce(message) {
  els.live.textContent = "";
  window.setTimeout(() => {
    els.live.textContent = message;
  }, 30);
}

function categoryButton(label, count, value) {
  const button = element("button", "cat");
  button.type = "button";
  button.dataset.category = value;
  button.setAttribute("aria-pressed", String(state.category === value));

  const name = element("span", "", label);
  const number = element("span", "num", String(count));
  button.append(name, number);
  return button;
}

function renderCategories() {
  const total = state.styles.length;
  const fragment = document.createDocumentFragment();
  fragment.append(categoryButton("All styles", total, "All"));
  for (const category of state.categories) {
    fragment.append(categoryButton(category.name, category.count, category.name));
  }
  els.cats.replaceChildren(fragment);
}

function matches(style, query) {
  if (state.category !== "All" && style.category !== state.category) return false;
  if (!query) return true;

  const haystack = normalize(
    [
      style.name,
      style.category,
      style.description,
      style.explainerNote,
      style.motion,
      style.styleId,
    ].join(" ")
  );
  return haystack.includes(query);
}

function createPlate(style) {
  const article = element("article", "plate");

  const media = element("button", "media");
  media.type = "button";
  media.dataset.open = style.styleId;
  media.setAttribute("aria-label", `Preview ${style.name}`);

  const image = element("img");
  image.src = style.poster;
  image.alt = `${style.name} poster frame`;
  image.width = 1280;
  image.height = 720;
  image.decoding = "async";
  image.loading = style.order <= 8 ? "eager" : "lazy";

  const fallback = element("span", "media-fallback", style.name);
  fallback.hidden = true;

  image.addEventListener(
    "error",
    () => {
      image.remove();
      fallback.hidden = false;
    },
    { once: true }
  );

  media.append(image, fallback);

  const body = element("div", "plate-body");

  const meta = element("p", "meta");
  meta.append(
    element("span", "num", `#${pad(style.order)}`),
    element("span", "", style.category)
  );

  const heading = element("h3");
  const titleButton = element("button", "", style.name);
  titleButton.type = "button";
  titleButton.dataset.open = style.styleId;
  heading.append(titleButton);

  const description = element("p", "desc", style.description);

  const actions = element("div", "actions");
  const copyButton = element("button", "text-button action primary", "Copy prompt");
  copyButton.type = "button";
  copyButton.dataset.copy = style.styleId;
  copyButton.setAttribute("aria-label", `Copy prompt for ${style.name}`);

  const previewButton = element("button", "text-button action", "Preview");
  previewButton.type = "button";
  previewButton.dataset.open = style.styleId;
  previewButton.setAttribute("aria-label", `Preview ${style.name}`);

  actions.append(copyButton, previewButton);
  body.append(meta, heading, description, actions);
  article.append(media, body);
  return article;
}

function render() {
  const query = normalize(state.query.trim());
  const visible = state.styles.filter((style) => matches(style, query));

  const fragment = document.createDocumentFragment();
  for (const style of visible) fragment.append(createPlate(style));
  els.grid.replaceChildren(fragment);

  const filtered = Boolean(query) || state.category !== "All";
  els.grid.hidden = visible.length === 0;
  els.empty.hidden = visible.length !== 0;
  els.count.textContent = filtered
    ? `${visible.length} of ${state.styles.length} styles`
    : `${state.styles.length} styles`;
  els.viewTitle.textContent = state.category === "All" ? "All styles" : state.category;

  for (const button of els.cats.querySelectorAll(".cat")) {
    button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
  }
}

async function loadPrompt(style) {
  if (state.promptCache.has(style.styleId)) {
    return state.promptCache.get(style.styleId);
  }

  const request = fetch(new URL(style.file, document.baseURI), { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("the file is empty");
      return text;
    })
    .catch((error) => {
      state.promptCache.delete(style.styleId);
      throw error;
    });

  state.promptCache.set(style.styleId, request);
  return request;
}

async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based copy below.
    }
  }

  const area = element("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-2000px";
  area.style.left = "-2000px";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("the browser blocked clipboard access");
}

function restore(button, label, delay = 1800) {
  window.setTimeout(() => {
    button.textContent = label;
    button.classList.remove("is-done", "is-error");
    button.disabled = false;
  }, delay);
}

async function copyPrompt(id, button) {
  const style = styleById(id);
  if (!style || button.disabled) return;

  if (!button.dataset.label) button.dataset.label = button.textContent;
  const label = button.dataset.label;
  button.disabled = true;
  button.classList.remove("is-done", "is-error");
  button.textContent = "Copying";

  try {
    const prompt = await loadPrompt(style);
    await writeClipboard(prompt);
    button.textContent = "Copied";
    button.classList.add("is-done");
    announce(`Prompt copied: ${style.name}`);
    restore(button, label);
  } catch (error) {
    button.textContent = "Copy failed";
    button.classList.add("is-error");
    announce(`Could not copy the ${style.name} prompt. ${error.message}.`);
    restore(button, label, 2600);
  }
}

function openPreview(id) {
  const style = styleById(id);
  if (!style) return;

  state.activeStyle = style;
  state.dialogToken += 1;
  const token = state.dialogToken;

  els.dialogMeta.replaceChildren(
    element("span", "num", `#${pad(style.order)}`),
    element("span", "", style.category)
  );
  els.dialogTitle.textContent = style.name;
  els.dialogDesc.textContent = style.description;
  els.dialogMotion.textContent = style.motion || "No motion note for this style.";
  els.dialogNote.textContent = style.explainerNote || "No explainer note for this style.";
  els.dialogRaw.href = style.file;

  const video = els.dialogVideo;
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.poster = style.poster;
  video.setAttribute("aria-label", `${style.name} explainer preview`);
  if (style.explainerVideo) video.src = style.explainerVideo;

  els.dialogCopy.disabled = true;
  els.dialogCopy.textContent = "Copy prompt";
  els.dialogCopy.setAttribute("aria-label", `Copy prompt for ${style.name}`);
  els.dialogCopy.classList.remove("is-done", "is-error");
  els.promptText.textContent = "";
  els.promptText.hidden = true;
  els.promptStatus.hidden = false;
  els.promptStatus.textContent = "Loading prompt";

  if (!els.dialog.open) els.dialog.showModal();
  els.dialog.focus();
  document.body.classList.add("dialog-open");

  const url = new URL(window.location.href);
  url.searchParams.set("style", style.styleId);
  window.history.replaceState(null, "", url);

  loadPrompt(style)
    .then((prompt) => {
      if (token !== state.dialogToken) return;
      els.promptText.textContent = prompt;
      els.promptText.hidden = false;
      els.promptStatus.hidden = true;
      els.dialogCopy.disabled = false;
    })
    .catch((error) => {
      if (token !== state.dialogToken) return;
      els.promptStatus.textContent = `Could not load this prompt (${error.message}). Use "Open raw file" instead.`;
    });
}

function closePreview() {
  if (els.dialog.open) els.dialog.close();
}

function resetFilters() {
  state.query = "";
  state.category = "All";
  els.q.value = "";
  render();
  els.q.focus();
}

function showLoadError(error) {
  els.grid.hidden = true;
  els.count.textContent = "Unavailable";
  els.loadError.hidden = false;
  els.loadErrorDetail.textContent =
    window.location.protocol === "file:"
      ? "This page was opened straight from disk, so the browser blocks its data files."
      : `The request failed: ${error.message}.`;
}

function readDeepLink() {
  const id = new URL(window.location.href).searchParams.get("style");
  if (id && styleById(id)) openPreview(id);
}

function bind() {
  els.q.addEventListener("input", () => {
    state.query = els.q.value;
    render();
  });

  els.cats.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    render();
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.querySelector(".sheet-head").scrollIntoView({ block: "start" });
    }
  });

  els.grid.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) {
      openPreview(open.dataset.open);
      return;
    }
    const copy = event.target.closest("[data-copy]");
    if (copy) copyPrompt(copy.dataset.copy, copy);
  });

  els.reset.addEventListener("click", resetFilters);
  els.dialogClose.addEventListener("click", closePreview);

  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) closePreview();
  });

  els.dialog.addEventListener("close", () => {
    state.dialogToken += 1;
    document.body.classList.remove("dialog-open");
    els.dialogVideo.pause();
    els.dialogVideo.removeAttribute("src");
    els.dialogVideo.load();
    const url = new URL(window.location.href);
    url.searchParams.delete("style");
    window.history.replaceState(null, "", url);
  });

  els.dialogCopy.addEventListener("click", () => {
    if (state.activeStyle) copyPrompt(state.activeStyle.styleId, els.dialogCopy);
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const target = document.activeElement;
    const typing =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);

    if (event.key === "/" && !typing && !els.dialog.open) {
      event.preventDefault();
      els.q.focus();
      els.q.select();
      return;
    }

    if (event.key === "Escape" && target === els.q && els.q.value) {
      event.preventDefault();
      state.query = "";
      els.q.value = "";
      render();
    }
  });
}

async function init() {
  bind();

  try {
    const response = await fetch(new URL("data/styles.json", document.baseURI), {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data.styles) || data.styles.length === 0) {
      throw new Error("the manifest has no styles");
    }

    state.styles = data.styles;
    state.categories = Array.isArray(data.categories) ? data.categories : [];

    renderCategories();
    render();
    readDeepLink();
  } catch (error) {
    showLoadError(error);
  }
}

init();
