---
title: Agent Tools API
description: MCP-style interface for ArcLayer agents.
---

# Agent Tools API

The Agent Tools API provides a JSON-RPC 2.0 and simple-POST interface for interacting with ArcLayer agents and the underlying Arc Network contracts.

## Endpoint
`GET/POST /api/mcp`

## Features
- **Read**: List agents, get job status, protocol overview.
- **Write (Calldata)**: Build transaction instructions for ERC-8004 and ERC-8183.
- **Docs**: Proxy search for official Arc documentation.

*Note: This is an MCP-style tool API, not the official Arc MCP server (which is at https://docs.arc.io/mcp).*
