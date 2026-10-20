import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createModels, validateToolArguments } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createCodingTools } from "@earendil-works/pi-coding-agent";
// This internal helper reuses Pi's saved login, including token refresh.
import { AuthStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

const credentials = AuthStorage.create();
const models = createModels({ credentials });
models.setProvider(openaiProvider());
const model = models.getModel("openai", "gpt-6.1-sol");

// Borrow Pi's read, bash, edit, and write implementations, not its agent loop.
// Relative paths start in the directory where you launch this program.
// This directory is NOT a sandbox: these tools have your user's permissions.
const tools = createCodingTools(process.cwd());
const toolsByName = new Map(tools.map(tool => [tool.name, tool]));

// Send descriptions and input schemas to the model, not executable functions.
const context = {
    messages: [],
    tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
    })),
};
const input = createInterface({ input: stdin, output: stdout });
console.log(`Working directory: ${process.cwd()}`);
console.log("Tools: read, bash, edit, write. No sandbox or approval prompts. /exit quits.");

try {
    // Outer loop: wait for each new user message.
    while (true) {
        const text = await input.question("you> ");
        if (text === "/exit") break;
        if (!text.trim()) continue;

        context.messages.push({ role: "user", content: text, timestamp: Date.now() });

        // Inner loop: keep calling the model until it stops requesting tools.
        while (true) {
            const stream = models.stream(model, context);
            stdout.write("pi> ");
            for await (const event of stream) {
                if (event.type === "text_delta") stdout.write(event.delta);
            }
            stdout.write("\n");

            const response = await stream.result();
            if (response.stopReason === "error" || response.stopReason === "aborted") {
                throw new Error(response.errorMessage || response.stopReason);
            }
            context.messages.push(response);
            const toolCalls = response.content.filter(block => block.type === "toolCall");
            if (toolCalls.length === 0) break;
            // Do not execute commands whose arguments may have been cut off.
            if (response.stopReason === "length") {
                throw new Error("Model output was truncated; tools were not executed.");
            }

            // Execute every requested tool, one at a time, before calling the model again.
            for (const call of toolCalls) {
                console.log(`[tool: ${call.name}]`, call.arguments);
                let result;
                let isError = false;
                try {
                    const tool = toolsByName.get(call.name);
                    if (!tool) throw new Error(`Unknown tool: ${call.name}`);
                    const args = validateToolArguments(tool, call);
                    result = await tool.execute(call.id, args);
                } catch (error) {
                    // Return tool failures to the model so it can respond to the actual error.
                    isError = true;
                    result = { content: [{ type: "text", text: error.message || String(error) }] };
                }

                // Show the result locally. Extra details stay out of model history.
                console.dir(result, { depth: null });
                context.messages.push({
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    content: result.content,
                    isError,
                    timestamp: Date.now(),
                });
            }
        }
    }
} finally {
    input.close();
}
