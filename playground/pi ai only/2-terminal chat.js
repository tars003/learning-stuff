import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createModels, Type } from "@earendil-works/pi-ai";
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

// Describe a capability to the model. This does not implement or run it.
const getTimeTool = {
    name: "get_time",
    description: "Get the current time.",
    parameters: Type.Object({}),
};

const context = { messages: [], tools: [getTimeTool] };
const input = createInterface({ input: stdin, output: stdout });

try {
    while (true) {
        // wait here untill user enters a message
        const text = await input.question("you> ");

        if (text === "/exit") break;
        if (!text.trim()) continue;

        context.messages.push({
            role: "user",
            content: text,
            timestamp: Date.now(),
        });

        while (true) {

            const stream = models.stream(model, context)
            stdout.write("pi> ");
            // Wait for events and print each new piece of text as it arrives.
            for await (const event of stream) {
                if (event.type === "text_delta") {
                    stdout.write(event.delta);
                }
            }
            stdout.write("\n");
            // Get the completed message and retain it for the next request.
            const response = await stream.result();

            if (response.stopReason === "error" || response.stopReason === "aborted") {
                throw new Error(response.errorMessage || response.stopReason);
            }
            context.messages.push(response);

            const toolCalls = response.content.filter(block => block.type === "toolCall");

            if (toolCalls.length === 0) break;

            for (const call of toolCalls) {
                if (call.name !== "get_time") {
                    throw new Error(`Unknown tool: ${call.name}`);
                }

                // Our program reads the clock. The model does not execute this code.
                const time = new Date().toISOString();

                // Link the result to the exact tool call that requested it.
                const toolResult = {
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    content: [{ type: "text", text: time }],
                    isError: false,
                    timestamp: Date.now(),
                };
                context.messages.push(toolResult);
                console.dir(toolResult, { depth: null });
            }

        }
    }

} finally {
    input.close();
}