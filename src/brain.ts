import OpenAI from "openai";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolSchema {
  pinned: string[];
  noise: string[];
  ghosts: string[];
}

export async function learnToolSchema(toolDef: Tool, sample: any, apiKey: string): Promise<ToolSchema> {
  // 1. Initialize Client Just-In-Time (JIT)
  const openai = new OpenAI({ apiKey });

  // 2. Contextualize
  const toolContext = `
  Tool Name: "${toolDef.name}"
  Description: "${toolDef.description || "No description provided."}"
  Input Arguments: ${JSON.stringify(toolDef.inputSchema?.properties || {})}
  `;

  // 3. Shrink Sample
  const safeSample = JSON.stringify(sample, (key, value) => {
    if (Array.isArray(value) && value.length > 3) return value.slice(0, 3);
    if (typeof value === 'string' && value.length > 500) return value.substring(0, 500) + "...(truncated)";
    return value;
  }, 2).substring(0, 20000); 

  const prompt = `
  You are a Senior Data Architect specializing in API Optimization.
  
  CONTEXT:
  The user is calling an API tool. We want to filter the massive JSON output to save tokens.
  I am providing the Tool Definition (so you know what it does) and a Data Sample.

  TOOL DEFINITION:
  ${toolContext}

  DATA SAMPLE:
  ${safeSample}

  TASK:
  Classify the fields in the Data Sample into 3 Tiers:

  1. "pinned" (The Identity): 
     - Fields ABSOLUTELY required to identify the result. 
     - Usually: ids, names, titles, status, types.
     - CRITICAL: If the object represents a node in a graph (like a Work Item, File, or PR), you MUST pin 'relations', 'links', or 'parent' fields so we can traverse hierarchy.

  2. "noise" (The Trash):
     - Technical metadata that offers no business value.
     - Examples: urls (if redundant), _links, watermarks, ETags, internal hashes, avatar URLs.
  
  3. "ghosts" (The Vault):
     - Everything else. Useful data, but heavy.
     - Descriptions, bodies, dates, creators, tags, custom fields, priorities.

  OUTPUT RULES:
  - Return STRICT JSON: { "pinned": [], "noise": [], "ghosts": [] }
  - Use Dot Notation for nested keys (e.g., "fields.System.Title").
  - Do not invent fields not present in the sample.
  - No markdown, no comments.
  `;

  try {
    const response = await openai.responses.create({
      model: "gpt-5.1", 
      instructions: "Output valid JSON only.",
      input: prompt,
      temperature: 0,
    });

    const txt = response.output_text;
    const cleanJson = txt.replace(/```json/g, "").replace(/```/g, "").replace(/\/\/.*$/gm, "").trim();
    
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error(`[Brain] Learning Failed for ${toolDef.name}:`, error);
    return { pinned: Object.keys(sample), noise: [], ghosts: [] };
  }
}