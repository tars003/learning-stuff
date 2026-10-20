import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createModels, Type, validateToolArguments } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
// Only authentication is borrowed from Pi. All four tools below are our own code.
import { AuthStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

const credentials = AuthStorage.create();
const models = createModels({ credentials });
models.setProvider(openaiProvider());
const model = models.getModel("openai", "gpt-6.1-sol");

// Turn Node's callback-based command runner into a function we can await.
const runCommand = promisify(execFile);

// Each tool has a description for the model and a function for our program.
// These are basic text tools: no image support, diffs, or output truncation logic.
const tools = [
    {
        name: "read",
        description: "Read an entire UTF-8 text file.",
        parameters: Type.Object({ path: Type.String() }),
        execute: async ({ path }) => {
            return await readFile(path, "utf8");
        },
    },
    {
        name: "write",
        description: "Create or overwrite a UTF-8 text file. Its parent directory must exist.",
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        execute: async ({ path, content }) => {
            await writeFile(path, content, "utf8");
            return `Wrote ${path}`;
        },
    },
    {
        name: "edit",
        description: "Replace one exact, unique piece of text in a UTF-8 file. oldText must be non-empty and appear exactly once.",
        parameters: Type.Object({
            path: Type.String(),
            oldText: Type.String({ minLength: 1 }),
            newText: Type.String(),
        }),
        execute: async ({ path, oldText, newText }) => {
            const content = await readFile(path, "utf8");
            const position = content.indexOf(oldText);
            if (position === -1) throw new Error("oldText was not found; file unchanged.");
            if (content.indexOf(oldText, position + 1) !== -1) {
                throw new Error("oldText occurs more than once; file unchanged. Use a larger unique piece of text.");
            }
            // Build the replacement literally, so characters like $ have no special meaning.
            const updated = content.slice(0, position) + newText + content.slice(position + oldText.length);
            await writeFile(path, updated, "utf8");
            return `Edited ${path}`;
        },
    },
    {
        name: "bash",
        description: "Run a Bash command. Use this for ls, grep, or other shell commands.",
        parameters: Type.Object({ command: Type.String() }),
        execute: async ({ command }) => {
            const { stdout, stderr } = await runCommand("bash", ["-c", command]);
            return `stdout:\n${stdout}\nstderr:\n${stderr}`;
        },
    },
];
const toolsByName = new Map(tools.map(tool => [tool.name, tool]));

// Send only descriptions and schemas, not the execute functions.
const context = {
    messages: [],
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
};
const input = createInterface({ input: stdin, output: stdout });
console.log(`Working directory: ${process.cwd()}`);
console.log("Tools: read, write, edit, bash. No sandbox or approval prompts. /exit quits.");

try {
    // Outer loop: wait for each new user message.
    while (true) {
        const text = await input.question("you> ");
        if (text === "/exit") break;
        if (!text.trim()) continue;
        context.messages.push({ role: "user", content: text, timestamp: Date.now() });

        // Inner loop: keep working until a response has no tool calls.
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
            if (response.stopReason === "length") {
                throw new Error("Model output was truncated; tools were not executed.");
            }

            for (const call of toolCalls) {
                console.log(`[tool: ${call.name}]`, call.arguments);
                let output;
                let isError = false;
                try {
                    const tool = toolsByName.get(call.name);
                    if (!tool) throw new Error(`Unknown tool: ${call.name}`);
                    const args = validateToolArguments(tool, call);
                    output = await tool.execute(args);
                } catch (error) {
                    // Tell the model when a tool fails instead of pretending it succeeded.
                    isError = true;
                    output = error.message || String(error);
                }
                console.log(output);
                context.messages.push({
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    content: [{ type: "text", text: output }],
                    isError,
                    timestamp: Date.now(),
                });
            }
        }
    }
} finally {
    input.close();
}
