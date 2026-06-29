# Onboarding: `agents-orchestrator`

Welcome to the **Agents Orchestrator**! This service is the "brain" that manages your AI workforce (Jules agents) by coordinating their activities between **Linear** (tasks) and **GitHub** (code).

## 1. How It Works (The Pull System)

Instead of pushing tasks to agents, this service implements a **Pull System**:
1. **WIP Check**: The orchestrator checks if an agent is already working on something in Linear.
2. **Pull**: If free, it looks for a task in Linear that matches the agent's allowed roles.
3. **Lock**: It atomically assigns the task to the agent to prevent others from taking it.
4. **Execute**: It clones the code into a private workspace, injects the role prompt, and calls Jules.
5. **Finish**: It reports back to Linear, updates the status, and wipes the workspace.

---

## 2. Prerequisites

- **Node.js**: v18+
- **Linear API Key**: With write access to your team.
- **Jules API Key**: For each agent (provided via environment variables).
- **Environment Variables**:
  - `LINEAR_API_KEY`: Your master key for Linear management.
  - `JULES_API_URL`: The endpoint for the Jules execution service.
  - `JULES_TOKEN_1`, `JULES_TOKEN_2`, etc.: Individual tokens for your agents.

---

## 3. Configuration (`config/agents-matrix.json`)

This file binds physical Google accounts to their operational capabilities.

```json
{
  "agents": [
    {
      "id": "worker-01",
      "google_account_email": "jules-techlead@gmail.com",
      "linear_user_id": "linear_user_uuid_here",
      "jules_api_token": "env:JULES_TOKEN_1",
      "allowed_roles": ["role-techlead"]
    }
  ]
}
```

---

## 4. Integration into your Metaproject

To integrate this orchestrator into your existing workflow:

### A. Linear Setup
1. **Labels**: Create labels in Linear matching your role names (e.g., `role-architect`, `role-developer`).
2. **Workflow States**: Ensure you have `Inbox`, `Todo`, `In Progress`, `Ready for Audit`, and `Done` states.
3. **Task Formatting**: Ensure task descriptions contain the GitHub repository URL. The orchestrator uses this to know where to clone the code.

### B. Role Prompts
Edit files in `roles/role-*.md` to define the "personality" and rules for each agent. The orchestrator automatically injects the safety protocol and agent email.

### C. Deployment
Run the service as a background process (e.g., using `pm2` or as a Docker container).

```bash
cd agents-orchestrator
npm install
LINEAR_API_KEY=xxx node pull-engine.js
```

---

## 5. The Techlead Workflow (The Gatekeeper)

The **Techlead** is special. He doesn't write code.
- He pulls tasks from the **Inbox** (tasks with no assignee and no labels).
- He analyzes the requirements.
- He must output a report containing the string `role-xxx` (e.g., `role-architect`).
- The orchestrator will then:
  1. Add the `role-architect` label to the task.
  2. Move it to `Todo`.
  3. Unassign the Techlead.
- This makes the task visible to the Architect agents!

---

## 6. Critical Advice for Production

1. **Structured Logging**: Switch to `pino` for better observability.
2. **Disk Space**: Regularly monitor the `workspace/` folder. While the orchestrator cleans up, a crash might leave "orphaned" folders.
3. **Rate Limits**: If running >10 agents, increase the `POLL_INTERVAL` to avoid Linear API rate limits.
4. **Git Security**: The orchestrator sanitizes URLs, but ensure the server running the orchestrator has restricted SSH keys.
