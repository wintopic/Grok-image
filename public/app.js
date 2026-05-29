const form = document.querySelector("#generateForm");
const authForm = document.querySelector("#authForm");
const accessTokenInput = document.querySelector("#accessToken");
const authButton = document.querySelector("#authButton");
const authMessage = document.querySelector("#authMessage");
const authModal = document.querySelector("#authModal");
const countInput = document.querySelector("#count");
const promptInput = document.querySelector("#prompt");
const promptCounter = document.querySelector("#promptCounter");
const promptHistory = document.querySelector("#promptHistory");
const generateButton = document.querySelector("#generateButton");
const clearButton = document.querySelector("#clearButton");
const clearPromptButton = document.querySelector("#clearPromptButton");
const downloadAllButton = document.querySelector("#downloadAllButton");
const gallery = document.querySelector("#gallery");
const statusLine = document.querySelector("#statusLine");
const modelLine = document.querySelector("#modelLine");
const configBadge = document.querySelector("#configBadge");
const configBadgeText = document.querySelector("#configBadgeText");
const errorDetails = document.querySelector("#errorDetails");
const detailsText = document.querySelector("#detailsText");
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const lightboxClose = document.querySelector("#lightboxClose");

const tokenKey = "grok-image-access-token";
const themeKey = "grok-image-theme";
const historyKey = "grok-image-prompt-history";
const PROMPT_MAX = 4000;
const HISTORY_LIMIT = 8;

let serviceConfigured = false;
let lastImages = [];

initTheme();
updatePromptCounter();
renderHistory();
boot();

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await verifyAccess(accessTokenInput.value.trim(), false);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generate();
});

promptInput.addEventListener("input", updatePromptCounter);

promptInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
  }
});

clearButton.addEventListener("click", () => {
  lastImages = [];
  downloadAllButton.hidden = true;
  gallery.replaceChildren(emptyState());
  setDetails(null);
  setStatus("准备就绪");
});

clearPromptButton.addEventListener("click", () => {
  promptInput.value = "";
  updatePromptCounter();
  promptInput.focus();
});

downloadAllButton.addEventListener("click", downloadAll);

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(themeKey, next);
});

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !lightbox.hidden) {
    closeLightbox();
  }
});

function initTheme() {
  const stored = localStorage.getItem(themeKey);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggle.setAttribute("aria-label", theme === "dark" ? "切换到浅色主题" : "切换到深色主题");
}

function updatePromptCounter() {
  const length = promptInput.value.length;
  promptCounter.textContent = `${length} / ${PROMPT_MAX}`;
  promptCounter.classList.toggle("is-limit", length >= PROMPT_MAX);
}

async function boot() {
  await loadConfig();
  showAuthModal();
  const cachedToken = sessionStorage.getItem(tokenKey);
  if (cachedToken) {
    accessTokenInput.value = cachedToken;
    await verifyAccess(cachedToken, true);
  } else {
    accessTokenInput.focus();
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    serviceConfigured = Boolean(config.configured);
    modelLine.textContent = config.model ? `模型：${config.model}` : "模型未配置";
    configBadgeText.textContent = serviceConfigured ? "服务已就绪" : "服务未配置";
    configBadge.classList.toggle("badge-warn", !serviceConfigured);
    generateButton.disabled = !serviceConfigured;
    if (!serviceConfigured) {
      setStatus("服务未配置");
      setDetails(config.message || "服务未配置");
    }
  } catch (error) {
    serviceConfigured = false;
    configBadgeText.textContent = "无法连接";
    configBadge.classList.add("badge-warn");
    generateButton.disabled = true;
    setStatus("无法读取配置");
    setDetails(error.message || "配置读取失败");
  }
}

async function verifyAccess(accessToken, silent) {
  if (!serviceConfigured) {
    setAuthMessage("服务未配置，暂时无法验证访问码。", true);
    return false;
  }
  if (!accessToken) {
    setAuthMessage("请输入访问码。", true);
    accessTokenInput.focus();
    return false;
  }

  setAuthBusy(true);
  setAuthMessage(silent ? "正在验证已保存的访问码。" : "正在验证。", false);

  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new ApiError(body.error || "访问码验证失败。", body.details);
    }

    sessionStorage.setItem(tokenKey, accessToken);
    hideAuthModal();
    setStatus("准备就绪");
    return true;
  } catch (error) {
    sessionStorage.removeItem(tokenKey);
    showAuthModal();
    setAuthMessage(error.message || "访问码验证失败。", true);
    if (!silent) {
      setDetails(error.details || null);
    }
    return false;
  } finally {
    setAuthBusy(false);
  }
}

async function generate() {
  if (!serviceConfigured) {
    setStatus("服务未配置");
    showAuthModal();
    return;
  }

  const accessToken = sessionStorage.getItem(tokenKey) || accessTokenInput.value.trim();
  if (!accessToken) {
    setStatus("请先输入访问码");
    showAuthModal();
    accessTokenInput.focus();
    return;
  }

  const prompt = promptInput.value.trim();
  const count = Number.parseInt(countInput.value, 10) || 1;

  if (!prompt) {
    setStatus("请输入提示词");
    promptInput.focus();
    return;
  }

  setBusy(true);
  setStatus("正在生成");
  setDetails(null);
  showSkeletons(Math.max(1, Math.min(4, count)));
  const startedAt = Date.now();

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, count, accessToken }),
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(tokenKey);
        showAuthModal();
      }
      throw new ApiError(body.error || "生成失败。", body.details);
    }

    renderImages(body.images || []);
    saveHistory(prompt);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    setStatus(`已生成 ${body.images?.length || 0} 张 · ${seconds}s · 来源：${body.source || "接口"}`);
  } catch (error) {
    gallery.replaceChildren(emptyState("生成失败"));
    lastImages = [];
    downloadAllButton.hidden = true;
    setStatus(error.message || "生成失败");
    setDetails(error.details || error.stack || String(error));
  } finally {
    setBusy(false);
  }
}

function showSkeletons(count) {
  gallery.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    gallery.append(card);
  }
}

function renderImages(images) {
  gallery.replaceChildren();
  lastImages = images;
  downloadAllButton.hidden = images.length < 2;
  if (images.length === 0) {
    gallery.append(emptyState("接口没有返回图片"));
    return;
  }

  for (const image of images) {
    const item = document.createElement("article");
    item.className = "image-card";

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = "生成的图片";
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(image.dataUrl));

    const footer = document.createElement("div");
    footer.className = "image-actions";

    const source = document.createElement("span");
    source.textContent = sourceLabel(image.source);

    const link = document.createElement("a");
    link.href = image.dataUrl;
    link.download = image.filename || "grok-image.jpg";
    link.textContent = "下载";

    footer.append(source, link);
    item.append(img, footer);
    gallery.append(item);
  }
}

function downloadAll() {
  lastImages.forEach((image, index) => {
    const link = document.createElement("a");
    link.href = image.dataUrl;
    link.download = image.filename || `grok-image-${index + 1}.jpg`;
    document.body.append(link);
    link.click();
    link.remove();
  });
}

function openLightbox(src) {
  lightboxImage.src = src;
  lightbox.hidden = false;
  document.body.classList.add("locked");
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.src = "";
  if (authModal.hidden) {
    document.body.classList.remove("locked");
  }
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(prompt) {
  const history = readHistory().filter((item) => item !== prompt);
  history.unshift(prompt);
  localStorage.setItem(historyKey, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  renderHistory();
}

function renderHistory() {
  const history = readHistory();
  promptHistory.replaceChildren();
  if (history.length === 0) {
    promptHistory.hidden = true;
    return;
  }
  promptHistory.hidden = false;
  for (const prompt of history) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "history-chip";
    chip.textContent = prompt;
    chip.title = prompt;
    chip.addEventListener("click", () => {
      promptInput.value = prompt;
      updatePromptCounter();
      promptInput.focus();
    });
    promptHistory.append(chip);
  }
}

function emptyState(text = "暂无图片", hint = "输入提示词，点击生成开始创作") {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.innerHTML =
    '<span class="empty-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="4"></rect>' +
    '<circle cx="8.5" cy="8.5" r="1.6"></circle>' +
    '<path d="M21 15l-5-5L5 21"></path>' +
    "</svg></span>";
  const title = document.createElement("p");
  title.textContent = text;
  empty.append(title);
  if (hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "empty-hint";
    hintEl.textContent = hint;
    empty.append(hintEl);
  }
  return empty;
}

function sourceLabel(value) {
  const text = String(value || "");
  if (text.includes("markdown")) {
    return "聊天接口";
  }
  if (text.includes("data_uri")) {
    return "内联图片";
  }
  if (text.includes("b64") || text.includes("base64")) {
    return "Base64 图片";
  }
  if (text.includes("url")) {
    return "图片链接";
  }
  return text || "图片";
}

function showAuthModal() {
  authModal.hidden = false;
  document.body.classList.add("locked");
}

function hideAuthModal() {
  authModal.hidden = true;
  if (lightbox.hidden) {
    document.body.classList.remove("locked");
  }
}

function setAuthBusy(isBusy) {
  authButton.disabled = isBusy;
  authButton.textContent = isBusy ? "验证中" : "验证";
}

function setAuthMessage(text, isError) {
  authMessage.textContent = text;
  authMessage.classList.toggle("is-error", Boolean(isError));
}

function setBusy(isBusy) {
  generateButton.disabled = isBusy || !serviceConfigured;
  generateButton.textContent = isBusy ? "生成中" : "生成图片";
}

function setStatus(text) {
  statusLine.textContent = text;
}

function setDetails(details) {
  if (!details) {
    errorDetails.hidden = true;
    detailsText.textContent = "";
    return;
  }
  errorDetails.hidden = false;
  detailsText.textContent = typeof details === "string" ? details : JSON.stringify(details, null, 2);
}

class ApiError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}
