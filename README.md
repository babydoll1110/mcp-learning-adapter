# MCP Learning Adapter 🚀

An intelligent adapter that learns MCP server APIs and optimizes token usage by **80%** through automated schema learning and response filtering.

## Overview

This adapter sits between Claude Desktop (or any MCP client) and your MCP servers, automatically learning their response patterns and filtering out noise. Instead of sending massive JSON responses with redundant fields, it intelligently reduces token consumption while maintaining full functionality.

### Key Benefits

- **80% reduction in input tokens** - Dramatically lower costs and faster responses
- **Self-learning** - Automatically discovers and categorizes API response patterns
- **Smart filtering** - Pins important fields, removes noise, ghosts redundant data
- **Drop-in replacement** - Works with existing MCP servers (Node.js-based)
- **Community-driven** - Share your learned schemas in `registry.json`

## Architecture

```
┌─────────────┐
│   Claude    │
│  Desktop    │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  Learning Adapter   │  ← You are here
│  - Brain (learning) │
│  - Registry (cache) │
│  - Proxy (filter)   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   MCP Servers       │
│  (ado, dovetail,    │
│   filesystem, etc.) │
└─────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Servers

Copy the example configuration:

```bash
cp config/servers.json.example config/servers.json
```

Edit `config/servers.json` with your settings:

```json
{
  "adapter": {
    "openaiApiKey": "sk-your-openai-api-key-here"
  },
  "servers": {
    "ado": {
      "command": "node",
      "args": [
        "/path/to/azure-devops-mcp/dist/index.js",
        "your-org-name"
      ],
      "env": {
        "project": "your-project-name",
        "organization": "your-org-name"
      }
    },
    "dovetail-mcp": {
      "command": "node",
      "args": ["/path/to/dovetail-mcp/dist/index.js"],
      "env": {
        "DOVETAIL_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

### 3. Set Up Claude Desktop Integration

Create or edit `.vscode/mcp.json` in your project:

```json
{
  "mcpServers": {
    "learning-adapter": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/ado-learning-adapter/src/adaptive-proxy.ts"
      ],
      "env": {}
    }
  }
}
```

Or add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "learning-adapter": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/ado-learning-adapter/src/adaptive-proxy.ts"
      ]
    }
  }
}
```

### 4. Start Using

The adapter will automatically:
1. Connect to your configured MCP servers
2. Learn response patterns as you use them
3. Build optimized schemas in `config/registry.json`
4. Reduce token usage progressively

## How It Learns 🧠

The adapter uses **GPT 5.1** to analyze API responses and categorize fields into three types:

- **Pinned** 📌 - Essential fields always included (e.g., `id`, `title`, `state`)
- **Noise** 🔇 - Redundant fields removed (e.g., `_links`, `imageUrl`, `descriptor`)
- **Ghosts** 👻 - Fields summarized or count-only (e.g., long lists, nested objects)

After a few API calls, the adapter learns the optimal schema and applies it automatically.

## Token Savings Example 📊

**Before (Raw Response):**
```json
{
  "id": 123,
  "fields": {
    "System.Title": "Fix bug",
    "System.State": "Active",
    "System.AssignedTo": {
      "displayName": "John Doe",
      "url": "https://...",
      "_links": { "avatar": { "href": "..." } },
      "id": "guid-here",
      "uniqueName": "john@...",
      "imageUrl": "https://...",
      "descriptor": "..."
    },
    "_links": { ... }
  }
}
```
~500 tokens

**After (Learned & Filtered):**
```json
{
  "id": 123,
  "fields": {
    "System.Title": "Fix bug",
    "System.State": "Active",
    "System.AssignedTo": { "displayName": "John Doe" }
  }
}
```
~100 tokens (80% reduction!)

## Contributing 🤝

If you use this adapter and it learns schemas for your MCP servers, **please contribute back**!

1. Use the adapter with your MCP servers
2. Let it learn and optimize (check `config/registry.json`)
3. Create a PR with your learned schemas
4. Help the community save tokens and costs! ❤️

The more we share, the better the adapter becomes for everyone.

## Roadmap 🛣️

### Current Support
- ✅ Node.js-based MCP servers
- ✅ Automatic schema learning
- ✅ Response filtering and optimization
- ✅ Multi-server support

### Coming Soon
- 🔜 HTTP/REST MCP servers
- 🔜 Sandbox-based MCP servers
- 🔜 Pre-built schema library
- 🔜 Configuration UI
- 🔜 Performance analytics dashboard

## Configuration Reference ⚙️

### servers.json Structure

```json
{
  "adapter": {
    "openaiApiKey": "string"  // Required for learning (uses GPT 5.1)
  },
  "servers": {
    "server-name": {
      "command": "string",    // Command to run (e.g., "node", "npx")
      "args": ["string"],     // Arguments to pass
      "env": {                // Environment variables
        "KEY": "value"
      }
    }
  }
}
```

### registry.json Structure

This file is auto-generated but you can edit it:

```json
{
  "tool_name": {
    "status": "optimized",  // "learning" or "optimized"
    "schema": {
      "pinned": ["field.path"],   // Always include
      "noise": ["field.path"],    // Always exclude
      "ghosts": ["field.path"]    // Summarize/count
    }
  }
}
```

## Troubleshooting 

**Adapter not connecting?**
- Verify your MCP server paths in `config/servers.json`
- Check that servers run independently: `node /path/to/server/index.js`
- Look for errors in the console output

**Not learning?**
- Ensure `openaiApiKey` is set in `config/servers.json`
- The adapter needs GPT 5.1 access to learn
- Check `config/registry.json` to see learning progress

**High token usage still?**
- Learning takes a few API calls (typically 3-5 calls per tool)
- Check if tool status is "optimized" in `registry.json`
- Some tools may need manual schema adjustments

## License 📝

See [LICENSE](LICENSE) for details.

## Acknowledgments 🙏

Built for the MCP community. Special thanks to all contributors who share their learned schemas!

---

**Questions?** Open an issue!
**Want to contribute?** PRs welcome!
**Love it?** Star the repo! ⭐
