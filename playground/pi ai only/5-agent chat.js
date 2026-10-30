import { createModels } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { Agent } from "@earendil-works/pi-agent-core";
// Reuse Pi's saved login, just like our earlier examples.
import { AuthStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

const credentials = AuthStorage.create();
const models = createModels({ credentials });
models.setProvider(openaiProvider());
const model = models.getModel("openai", "gpt-6.1-sol");

// Agent holds the conversation and runs the model/tool loop for us.
const agent = new Agent({
    initialState: { model },
    // Give Agent a way to call the model through our provider collection.
    // bind keeps this function connected to the models object it belongs to.
    streamFn: models.streamSimple.bind(models),
});

// Agent adds our message, gets the reply, and keeps both in its state.
await agent.prompt("Hi");
if (agent.state.errorMessage) {
    throw new Error(agent.state.errorMessage);
}

// prompt() does not return the reply. Read it from Agent's conversation state.
const response = agent.state.messages.at(-1);
if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage || response.stopReason);
}
for (const block of response.content) {
    if (block.type === "text") console.log(block.text);
}
