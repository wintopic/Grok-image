import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveImagesEndpoint, extractImageCandidates } from "../functions/_lib/image-api.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("deriveImagesEndpoint", () => {
  it("replaces chat completions with image generations", () => {
    assert.equal(
      deriveImagesEndpoint("https://api.spacexapi.com/v1/chat/completions"),
      "https://api.spacexapi.com/v1/images/generations",
    );
  });
});

describe("extractImageCandidates", () => {
  it("extracts b64_json images", () => {
    const candidates = extractImageCandidates({ data: [{ b64_json: png }] });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].b64, png);
  });

  it("extracts markdown image URLs from chat content", () => {
    const candidates = extractImageCandidates({
      choices: [{ message: { content: "![robot](https://example.com/generated.png)" } }],
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].url, "https://example.com/generated.png");
  });

  it("extracts data URI images", () => {
    const candidates = extractImageCandidates({
      choices: [{ message: { content: `data:image/png;base64,${png}` } }],
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].mediaType, "image/png");
  });

  it("extracts plain image URLs", () => {
    const candidates = extractImageCandidates("download: https://cdn.example.com/img/result.webp");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].url, "https://cdn.example.com/img/result.webp");
  });
});
