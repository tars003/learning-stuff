import { createModels } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

// Pi keeps your saved login here. This helper reads it and saves refreshed tokens.
// This is an internal Pi helper, so its import path is tied to our pinned version.
import { AuthStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

// Reuse your Pi login without putting any passwords or tokens in this file.
const credentials = AuthStorage.create();
const models = createModels({ credentials });
models.setProvider(openaiProvider());

// Choose the model. This does not call it yet.
const model = models.getModel("openai", "gpt-6.1-sol");

// This is the entire conversation we send: one message from us.
const context = {
  messages: [{ role: "user", content: "Yo Yo Yo", timestamp: Date.now() }],
};

// Make one request and wait for the full response.
const response = await models.complete(model, context);
if (response.stopReason === "error" || response.stopReason === "aborted") {
  throw new Error(response.errorMessage || response.stopReason);
}
// The response contains content blocks. Print just the text blocks.
for (const block of response.content) {
  if (block.type === "text") console.log(block.text);
}


context.messages.push(response);


context.messages.push({
  role: "user",
  content: "What was my previous message?",
  timestamp: Date.now(),
});

const response1 = await models.complete(model, context);
if (response1.stopReason === "error" || response1.stopReason === "aborted") {
  throw new Error(response1.errorMessage || response1.stopReason);
}
// The response contains content blocks. Print just the text blocks.
for (const block of response1.content) {
  if (block.type === "text") console.log(block.text);
}

