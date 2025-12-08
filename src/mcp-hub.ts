import { McpWrapper } from "./mcp-wrapper.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export class McpHub {
    private servers: Map<string, { wrapper: McpWrapper, env: Record<string, string> }> = new Map();

    async addServer(namespace: string, config: ServerConfig) {
        // Merge process.env with specific server env
        const env = { ...process.env, ...config.env };
        
        // Note: You might need to update McpWrapper to accept 'env' in constructor
        // For now, we assume the wrapper inherits process.env, but specialized 
        // env vars (like ADO_PROJECT) need to be handled carefully.
        
        const wrapper = new McpWrapper(config.command, config.args);
        await wrapper.connect();
        this.servers.set(namespace, { wrapper, env: config.env || {} });
        console.error(`[Hub] Connected to '${namespace}'`);
    }

async getAllTools() {
        let allTools: Tool[] = [];

        for (const [namespace, { wrapper }] of this.servers.entries()) {
            try {
                const tools = await wrapper.listTools();
                const namespacedTools = tools.map(t => ({
                    ...t,
                    name: `${namespace}_${t.name}`, 
                    description: `[Source: ${namespace}] ${t.description}`
                }));
                allTools = allTools.concat(namespacedTools);
            } catch (e) {
                console.error(`[Hub] Failed to list tools for ${namespace}`, e);
            }
        }
        return allTools;
    }

    /**
     * Routes "ado_get_item" -> Namespace: "ado", Tool: "get_item"
     */
    async callTool(prefixedName: string, args: any) {
        const firstUnderscore = prefixedName.indexOf('_');
        if (firstUnderscore === -1) throw new Error(`Invalid tool name: ${prefixedName}`);

        const namespace = prefixedName.substring(0, firstUnderscore);
        const originalName = prefixedName.substring(firstUnderscore + 1);

        const server = this.servers.get(namespace);
        if (!server) throw new Error(`Server '${namespace}' not found.`);

        return {
            result: await server.wrapper.callTool(originalName, args),
            env: server.env // Return the env so Proxy can use it for injection
        };
    }
    
    getServerEnv(prefixedName: string) {
        const ns = prefixedName.split('_')[0];
        return this.servers.get(ns)?.env || {};
    }
}