# seply-learn

A Claude Code plugin for [Seply Learn](https://learn.seply.app). It adds the Seply Learn MCP server and the `seply-learn` skill, which teaches Claude how to read, create and curate Expeditions.

## Install

```sh
claude plugin marketplace add mshafir/seply-learn
claude plugin install seply-learn@seply
```

Then start Claude Code, type `/mcp`, choose **seply-learn** and **Authenticate**. Your browser opens Seply Learn, where you choose what the agent may do.

Try it: *"Make a Seply Learn Expedition from this conversation."*

Seply Learn has the same steps, with a check that your agent connected, under **Connect an agent** (`/connect`).

## A self-hosted server

The plugin connects to `https://learn.seply.app` unless you tell it otherwise. When Claude Code asks for the **Server address** as the plugin is enabled, enter your server's address, like `https://learn.example.com`, with no slash at the end. You can change it later in `/config`.

Your own server's **Connect an agent** page shows these steps with its address filled in.
