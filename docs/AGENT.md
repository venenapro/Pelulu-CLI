# Pelulu-CLI Agent System

Pelulu-CLI now includes an OpenHands-style agent system that provides autonomous coding capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Controller                          │
│  Orchestrates all agent components                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐   ┌──────────────┐   ┌──────────────┐
│  Agent Loop │   │ Plan Manager │   │ LLM Client   │
│  (observe→  │   │ (task        │   │ (XiaoZhi AI  │
│   think→act)│   │  decomposition│   │  via MQTT)   │
└──────┬──────┘   └──────────────┘   └──────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                     Tool System                              │
│  file, shell, git, search, agent, ai, ...                   │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Agent Loop (`agent-loop.js`)
The core observe→think→act cycle:
- **Observe**: Builds context from history, workspace, and plan
- **Think**: Sends context to LLM for reasoning
- **Act**: Executes tool calls returned by LLM
- **Loop**: Repeats until "finish" is called or max iterations reached

### 2. Plan Manager (`plan-manager.js`)
Task decomposition and tracking:
- Auto-generates plans for complex tasks
- Tracks step progress (pending → in_progress → completed/failed)
- Supports dynamic plan modification during execution
- Provides visual progress indicators

### 3. LLM Client (`llm-client.js`)
Wraps XiaoZhi AI into a standard interface:
- MQTT-based communication
- Tool call parsing from text responses
- Token usage tracking
- Request timeout and abort support

### 4. Context Builder (`context-builder.js`)
Builds rich workspace context:
- Git status and history
- Project type detection
- File structure analysis
- Runtime environment info
- Cached for performance

### 5. History Condenser (`history-condenser.js`)
Manages long conversations:
- Automatic condensation when history is too long
- Preserves important context (files modified, errors)
- Optional LLM-based summarization
- Token-aware windowing

### 6. System Prompt (`system-prompt.js`)
Builds comprehensive prompts:
- Agent identity and capabilities
- Tool descriptions with schemas
- Workspace context
- Microagents/skills (trigger-based)
- Plan status
- Guidelines and constraints

## Usage

### Basic Usage
The agent system is automatically initialized when you start Pelulu-CLI:

```bash
pelulu
```

Then simply describe your task:
```
> Fix the bug in auth.js where login fails with special characters
```

### Disable Agent Mode
If you want to use the legacy direct tool call mode:

```bash
pelulu --no-agent
```

### Debug Mode
Enable debug logging:

```bash
pelulu --debug
```

## Agent Tool

The agent system is exposed as a tool that can be called directly:

```json
{
  "tool": "agent",
  "action": "run",
  "task": "Implement user authentication with JWT"
}
```

### Actions

| Action | Description |
|--------|-------------|
| `run` | Execute a task with the agent loop |
| `plan` | Create, view, or manage plans |
| `status` | Get agent status and summary |
| `abort` | Abort the current run |
| `reset` | Reset agent state |
| `history` | Get conversation history |
| `context` | Get workspace context |

## Plan Management

### Auto-Planning
Complex tasks automatically get plans:
```
> Implement a REST API with user authentication, CRUD operations, and tests

📋 Plan: Implement REST API
────────────────────────────
🔄 1. Set up Express project structure
⬜ 2. Create User model with Mongoose
⬜ 3. Implement authentication middleware
⬜ 4. Create CRUD routes for users
⬜ 5. Add input validation
⬜ 6. Write unit tests
⬜ 7. Test the API
────────────────────────────
Progress: 14%
```

### Manual Planning
Create plans explicitly:
```json
{
  "tool": "agent",
  "action": "plan",
  "goal": "Refactor auth module",
  "steps": [
    { "description": "Extract auth logic to separate file" },
    { "description": "Add JWT support" },
    { "description": "Update tests" }
  ]
}
```

## Skills/Microagents

Pelulu-CLI loads skills from:
- `.pelulu/skills/*.md`
- `.openhands/microagents/*.md`
- `.agents/skills/*.md`

### Skill File Format
```markdown
---
triggers:
- authentication
- jwt
- login
---
# Authentication Best Practices

When implementing authentication:
1. Always hash passwords with bcrypt
2. Use JWT with short expiration
3. Implement refresh tokens
4. Add rate limiting to login endpoints
```

Skills with triggers are only loaded when the user's message matches the trigger keywords.

## Configuration

Add to your `pelulu.config.json`:

```json
{
  "agent": {
    "name": "Pelulu",
    "max_iterations": 100,
    "max_history": 50,
    "auto_plan": true,
    "max_tokens": 100000
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `max_iterations` | 100 | Maximum agent loop iterations |
| `max_history` | 50 | Maximum messages before condensation |
| `auto_plan` | true | Auto-generate plans for complex tasks |
| `max_tokens` | 100000 | Token limit for history |

## Differences from OpenHands

| Feature | OpenHands | Pelulu-CLI |
|---------|-----------|------------|
| LLM | OpenAI/Anthropic/etc | XiaoZhi AI (MQTT) |
| Runtime | Docker sandbox | Local execution |
| UI | Web React | Terminal Ink |
| Planning | Optional | Auto for complex tasks |
| Skills | Global + repo | Local files |
| Multi-agent | Yes | Single agent |

## Troubleshooting

### Agent not responding
1. Check MQTT connection: `pelulu --debug`
2. Verify XiaoZhi is activated
3. Check network connectivity

### Plan not generating
- Ensure `auto_plan: true` in config
- Task must be complex enough (50+ chars, contain action words)

### History too long
- The agent auto-condenses history
- Use `agent.history` with `condensed: true`
- Adjust `max_history` in config
