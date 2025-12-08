import "dotenv/config";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

import * as fs from "fs";
import _ from "lodash";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpHub } from "./mcp-hub.js";
import { learnToolSchema, ToolSchema } from "./brain.js";

// --- CONFIG ---
const CONFIG_PATH = path.join(__dirname, "../config/servers.json");
const REGISTRY_PATH = path.join(__dirname, "../config/registry.json");
const MAX_FLOATING_ITEMS = 5;

// Load Configuration
let CONFIG: any = {};
try {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error("config/servers.json missing");
    CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
} catch (e) {
    console.error(`[Fatal] Failed to load configuration: ${e}`);
    process.exit(1);
}

const OPENAI_KEY = CONFIG.adapter?.openaiApiKey;
if (!OPENAI_KEY) {
    console.error("[Fatal] 'adapter.openaiApiKey' missing in servers.json");
    process.exit(1);
}

// --- TYPES & STATE ---
interface RegistryEntry {
    status: "learning" | "optimized";
    schema: ToolSchema;
    stats: Record<string, number>;
}
type Registry = Record<string, RegistryEntry>;

let registry: Registry = {};
const toolCache: Map<string, Tool> = new Map(); 
const learningLocks = new Set<string>(); 
let isDirty = false;

function loadRegistry() {
    if (fs.existsSync(REGISTRY_PATH)) {
        try { registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")); } 
        catch (e) { console.error("[Persistence] Corrupt registry, resetting."); }
    }
}
function saveRegistry() {
    if (!fs.existsSync(path.dirname(REGISTRY_PATH))) fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    isDirty = false;
}
setInterval(() => { if (isDirty) saveRegistry(); }, 5000); 

// --- ENGINE (The Masker) ---
function applyMask(data: any, entry: RegistryEntry, allowList: string[], toolName: string) {
    const { schema, stats } = entry;
    const output: any = {};

    const floating = Object.entries(stats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, MAX_FLOATING_ITEMS)
        .map(([key]) => key);

    const resolve = (pathStr: string) => {
        const parts = pathStr.startsWith("fields.") ? ["fields", pathStr.substring(7)] : pathStr.split('.');
        return _.get(data, parts);
    };
    const set = (pathStr: string, val: any) => {
        const parts = pathStr.startsWith("fields.") ? ["fields", pathStr.substring(7)] : pathStr.split('.');
        _.set(output, parts, val);
    };

    const fieldsToKeep = new Set([...schema.pinned, ...floating, ...allowList]);

    fieldsToKeep.forEach(pathStr => {
        const val = resolve(pathStr);
        if (val !== undefined) set(pathStr, val);
    });

    const ghostsAvailable = schema.ghosts.filter(g => !fieldsToKeep.has(g) && resolve(g) !== undefined);
    
    if (ghostsAvailable.length > 0) {
        output._ghosts = ghostsAvailable;
        output._tip = `To retrieve hidden fields, call ${toolName} with 'include=['field_name']'`;
    }

    if (output.relations && Array.isArray(output.relations)) {
        output.relations = output.relations.map((r: any) => ({
            rel: r.rel, url: r.url,
            attributes: r.attributes ? { name: r.attributes.name } : undefined
        }));
    }

    return output;
}

// --- MAIN SERVER ---
async function main() {
    loadRegistry();

    const hub = new McpHub();
    if (CONFIG.servers) {
        for (const [ns, cfg] of Object.entries(CONFIG.servers)) {
            // @ts-ignore
            await hub.addServer(ns, cfg);
        }
    }

    const server = new Server({ name: "federated-gateway", version: "2.1.0" }, { capabilities: { tools: {} } });

    // 2. List Tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const tools = await hub.getAllTools();
        
        return {
            tools: tools.map(t => {
                toolCache.set(t.name, t); // Cache the definition for Smart Injection later

                if (registry[t.name]?.status === "optimized") {
                    const modifiedSchema = { ...t.inputSchema };
                    // @ts-ignore
                    if (modifiedSchema.properties && modifiedSchema.properties.fields) {
                         // @ts-ignore
                         modifiedSchema.properties.fields.description += " (Merged into 'include')";
                    }

                    return {
                        ...t,
                        description: `[Optimized] ${t.description}. Hidden fields listed in '_ghosts' can be fetched via 'include'.`,
                        inputSchema: {
                            ...modifiedSchema,
                            properties: {
                                // @ts-ignore
                                ...modifiedSchema.properties,
                                include: { 
                                    type: "array", 
                                    items: { type: "string" },
                                    description: "Optional: List of ghost fields to retrieve." 
                                }
                            }
                        }
                    };
                }
                return t;
            })
        };
    });

    // 3. Call Tool
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const toolName = req.params.name;
        let { include, fields, ...args } = (req.params.arguments || {}) as any;

        // --- A. GENERIC CONTEXT INJECTION ---
        // 1. Get Environment for this specific server
        const serverEnv = hub.getServerEnv(toolName);
        
        // 2. Get the Schema for this specific tool
        const toolDef = toolCache.get(toolName);
        const expectedArgs = toolDef?.inputSchema?.properties ? Object.keys(toolDef.inputSchema.properties) : [];

        // 3. Auto-Inject: If Env has key AND Tool expects key AND Arg is missing -> Inject
        Object.entries(serverEnv).forEach(([envKey, envVal]) => {
            // Match keys directly (e.g. env.project -> arg.project)
            if (expectedArgs.includes(envKey) && !args[envKey]) {
                args[envKey] = envVal;
            }
        });
        // ------------------------------------

        // B. Call Upstream
        const upstreamArgs = { ...args };
        if (fields) upstreamArgs.fields = fields;

        const responseObj = await hub.callTool(toolName, upstreamArgs);
        const result = responseObj.result as any;

        if (!result.content || result.content[0].type !== 'text') return result;

        let rawJson;
        try { rawJson = JSON.parse(result.content[0].text); } catch { return result; }

        // PATH 1: LEARNING
        if (!registry[toolName] && !learningLocks.has(toolName)) {
            if (toolDef) {
                learningLocks.add(toolName);
                console.error(`[Adaptive] Learning schema for: ${toolName}...`);
                
                learnToolSchema(toolDef, rawJson, OPENAI_KEY).then(schema => {
                    registry[toolName] = { status: "optimized", schema, stats: {} };
                    isDirty = true;
                    learningLocks.delete(toolName);
                    console.error(`[Adaptive] Learned ${toolName}.`);
                });
            }
            return result;
        }

        // PATH 2: FILTERING
        if (registry[toolName]?.status === "optimized") {
            const entry = registry[toolName];
            const allowList: string[] = [];
            
            if (Array.isArray(include)) {
                allowList.push(...include);
                include.forEach(f => {
                    entry.stats[f] = (entry.stats[f] || 0) + 1;
                });
                isDirty = true;
            }

            if (Array.isArray(fields)) allowList.push(...fields);
            
            const normalizedAllowList = allowList.map(reqField => {
                const prefixed = `fields.${reqField}`;
                if (entry.schema.ghosts.includes(prefixed) || entry.schema.pinned.includes(prefixed)) {
                    return prefixed;
                }
                return reqField;
            });

            const cleanJson = applyMask(rawJson, entry, normalizedAllowList, toolName);
            return { content: [{ type: "text", text: JSON.stringify(cleanJson, null, 2) }] };
        }

        return result;
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[Federation] Gateway Running.");
}

main().catch(console.error);