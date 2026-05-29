const form = document.querySelector("#generateForm");
const authForm = document.querySelector("#authForm");
const accessTokenInput = document.querySelector("#accessToken");
const authButton = document.querySelector("#authButton");
const authMessage = document.querySelector("#authMessage");
const authModal = document.querySelector("#authModal");
const countInput = document.querySelector("#count");
const promptInput = document.querySelector("#prompt");
const generateButton = document.querySelector("#generateButton");
const clearButton = document.querySelector("#clearButton");
const gallery = document.querySelector("#gallery");
const statusLine = document.querySelector("#statusLine");
const modelLine = document.querySelector("#modelLine");
const configBadge = document.querySelector("#configBadge");
const errorDetails = document.querySelector("#errorDetails");
const detailsText = document.querySelector("#detailsText");

const tokenKey = "grok-image-access-token";
let serviceConfigured = false;

boot();

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await verifyAccess(accessTokenInput.value.trim(), false);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generate();
});

clearButton.addEventListener("click", () => {
  gallery.replaceChildren(emptyState());
  setDetails(null);
  setStatus("准备就绪");
});

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
    configBadge.textContent = serviceConfigured ? "服务已就绪" : "服务未配置";
    configBadge.classList.toggle("badge-warn", !serviceConfigured);
    generateButton.disabled = !serviceConfigured;
    if (!serviceConfigured) {
      setStatus("服务未配置");
      setDetails(config.message || "服务未配置");
    }
  } catch (error) {
    serviceConfigured = false;
    configBadge.textContent = "无法连接";
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
    setStatus(`已生成 ${body.images?.length || 0} 张，来源：${body.source || "接口"}`);
  } catch (error) {
    setStatus(error.message || "生成失败");
    setDetails(error.details || error.stack || String(error));
  } finally {
    setBusy(false);
  }
}

function renderImages(images) {
  gallery.replaceChildren();
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

function emptyState(text = "暂无图片") {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
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
  document.body.classList.remove("locked");
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
