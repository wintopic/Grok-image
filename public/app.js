const form = document.querySelector("#generateForm");
const accessTokenInput = document.querySelector("#accessToken");
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

const tokenKey = "image-worker-access-token";
accessTokenInput.value = sessionStorage.getItem(tokenKey) || "";

loadConfig();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generate();
});

clearButton.addEventListener("click", () => {
  gallery.replaceChildren();
  setDetails(null);
  setStatus("Ready");
});

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    modelLine.textContent = config.model || "Model";
    configBadge.textContent = config.configured ? "Configured" : "Needs Env";
    configBadge.classList.toggle("badge-warn", !config.configured);
  } catch (error) {
    configBadge.textContent = "Offline";
    configBadge.classList.add("badge-warn");
    setStatus(error.message || "Could not load config");
  }
}

async function generate() {
  const prompt = promptInput.value.trim();
  const accessToken = accessTokenInput.value.trim();
  const count = Number.parseInt(countInput.value, 10) || 1;

  if (!accessToken) {
    setStatus("Access code required");
    accessTokenInput.focus();
    return;
  }
  if (!prompt) {
    setStatus("Prompt required");
    promptInput.focus();
    return;
  }

  sessionStorage.setItem(tokenKey, accessToken);
  setBusy(true);
  setStatus("Generating");
  setDetails(null);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, count, accessToken }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new ApiError(body.error || "Generation failed", body.details);
    }

    renderImages(body.images || []);
    setStatus(`${body.images?.length || 0} image(s) from ${body.source || "API"}`);
  } catch (error) {
    setStatus(error.message || "Generation failed");
    setDetails(error.details || error.stack || String(error));
  } finally {
    setBusy(false);
  }
}

function renderImages(images) {
  gallery.replaceChildren();
  if (images.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No image returned";
    gallery.append(empty);
    return;
  }

  for (const image of images) {
    const item = document.createElement("article");
    item.className = "image-card";

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = "Generated image";
    img.loading = "lazy";

    const footer = document.createElement("div");
    footer.className = "image-actions";

    const source = document.createElement("span");
    source.textContent = image.source || "image";

    const link = document.createElement("a");
    link.href = image.dataUrl;
    link.download = image.filename || "generated-image.jpg";
    link.textContent = "Download";

    footer.append(source, link);
    item.append(img, footer);
    gallery.append(item);
  }
}

function setBusy(isBusy) {
  generateButton.disabled = isBusy;
  generateButton.textContent = isBusy ? "Generating" : "Generate";
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
