// src/mcp-wrapper.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class McpWrapper {
    private client: Client;
    private transport: StdioClientTransport | null = null;

    constructor(
        private serverCommand: string,
        private serverArgs: string[]
    ) {
        this.client = new Client(
            { name: "adaptive-proxy-client", version: "1.0.0" },
            { capabilities: {} }
        );
    }

    async connect() {
        console.error(`[Connection] Spawning: ${this.serverCommand} ${this.serverArgs.join(" ")}`);
        this.transport = new StdioClientTransport({
            command: this.serverCommand,
            args: this.serverArgs,
        });
        await this.client.connect(this.transport);
        console.error("[Connection] Connected.");
    }

    async listTools() {
        if (!this.transport) throw new Error("Not connected");
        const result = await this.client.listTools();
        return result.tools;
    }

    async callTool(name: string, args: any) {
        if (!this.transport) throw new Error("Not connected");
        const result = await this.client.callTool({ name, arguments: args });
        return result;
    }
}