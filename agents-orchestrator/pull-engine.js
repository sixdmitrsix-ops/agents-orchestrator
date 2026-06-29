const { LinearClient } = require("@linear/sdk");
const axios = require("axios");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

// Load configuration
const configPath = path.join(__dirname, "config", "agents-matrix.json");
const matrix = JSON.parse(fsSync.readFileSync(configPath, "utf8"));

// Global Linear Client instance for better efficiency
const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

// Helper to get tokens from env if they start with 'env:'
function getToken(tokenStr) {
  if (tokenStr.startsWith("env:")) {
    const envVar = tokenStr.split(":")[1];
    return process.env[envVar];
  }
  return tokenStr;
}

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 60000;

let isRunning = true;

async function runEngine() {
  console.log(`[SYSTEM] Starting Pull Engine with ${matrix.agents.length} agents...`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[SYSTEM] Shutdown signal received. Finishing active tasks...");
    isRunning = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (isRunning) {
    const startTime = Date.now();
    const agentPromises = matrix.agents.map(agent => processAgent(agent));
    await Promise.allSettled(agentPromises);

    const duration = Date.now() - startTime;
    const waitTime = Math.max(0, POLL_INTERVAL - duration);

    if (isRunning) {
      console.log(`[CYCLE] Finished in ${duration}ms. Waiting ${waitTime / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  console.log("[SYSTEM] Engine stopped.");
}

async function processAgent(agent) {
  console.log(`Processing agent: ${agent.id} (${agent.google_account_email})`);

  try {
    // 1. WIP Check (Stage 1)
    const hasWIP = await checkWIP(agent.linear_user_id);
    if (hasWIP) {
      console.log(`[WIP Блокировка] Агент ${agent.id} занят. Пропуск.`);
      return;
    }

    // 2. Pull Task (Stage 2)
    const task = await pullTask(agent);
    if (!task) {
      console.log(`No suitable tasks for agent ${agent.id}.`);
      return;
    }

    // 3. Atomic Assign (Stage 3: Lock & Mutex)
    const assigned = await assignTask(task, agent);
    if (!assigned) {
      console.log(`Failed to assign task ${task.id} to agent ${agent.id} (Race Condition).`);
      return;
    }

    // 4. Execution (Stage 4 & 5)
    await executeTask(agent, task);

  } catch (error) {
    console.error(`Error processing agent ${agent.id}:`, error.message);
  }
}

async function checkWIP(userId) {
  const issues = await linearClient.issues({
    filter: {
      assignee: { id: { eq: userId } },
      state: { name: { eq: "In Progress" } }
    }
  });
  return issues.nodes.length > 0;
}

async function pullTask(agent) {
  const isTechlead = agent.allowed_roles.includes("BARCAN-TAG-12");

  if (isTechlead) {
    // Techlead pulls from Inbox, no assignee, and specifically NO BARCAN labels
    const inboxIssues = await linearClient.issues({
      filter: {
        state: { name: { eq: "Inbox" } },
        assignee: { null: true },
        labels: { null: true }
      },
      orderBy: "priority",
      first: 1
    });
    if (inboxIssues.nodes.length > 0) return inboxIssues.nodes[0];
  }

  const operationalRoles = agent.allowed_roles.filter(r => r !== "BARCAN-TAG-12");
  if (operationalRoles.length > 0) {
    const todoIssues = await linearClient.issues({
      filter: {
        state: { name: { eq: "Todo" } },
        assignee: { null: true },
        labels: { name: { in: operationalRoles } }
      },
      orderBy: "priority",
      first: 1
    });
    return todoIssues.nodes[0];
  }

  return null;
}

async function assignTask(task, agent) {
  const team = await task.team;
  const states = await team.states();
  const inProgressState = states.nodes.find(s => s.name === "In Progress");

  if (!inProgressState) throw new Error("Could not find 'In Progress' state");

  try {
    await linearClient.issueUpdate(task.id, {
      assigneeId: agent.linear_user_id,
      stateId: inProgressState.id
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function executeTask(agent, task) {
  const taskId = task.id;
  const workerId = agent.id;
  const workspaceDir = path.join(__dirname, "workspace", `task-${taskId}-${workerId}`);

  try {
    await fs.mkdir(workspaceDir, { recursive: true });

    // 1. Determine Role and Prepare Context (Stage 4)
    const role = await determineRole(agent, task);
    const context = await prepareContext(role, task, agent);

    // 2. Workspace Sandbox (Stage 5)
    if (context.repositoryUrl) {
      // STRICT SANITIZATION to prevent command injection
      const sanitizedUrl = context.repositoryUrl.replace(/[^\w.:\/-]/g, "");
      console.log(`Cloning sanitized ${sanitizedUrl} for agent ${agent.id}...`);

      try {
        await execAsync(`git clone "${sanitizedUrl}" .`, { cwd: workspaceDir });
        // Use execFile-style or double quotes for safety
        await execAsync(`git config user.name "Jules - ${role.replace(/"/g, "")}"`, { cwd: workspaceDir });
        await execAsync(`git config user.email "${agent.google_account_email.replace(/"/g, "")}"`, { cwd: workspaceDir });
      } catch (e) {
        throw new Error(`Git operations failed: ${e.message}`);
      }
    }

    // 3. Call Jules API (Stateless Injection)
    console.log(`Calling Jules API for agent ${agent.id} [Task ${task.number}]`);
    const julesResponse = await callJulesAPI(agent, context, workspaceDir, task);

    // 4. Teardown and Reporting (Stage 6)
    await finishTask(agent, task, julesResponse, role);

  } catch (error) {
    console.error(`Fault Tolerance: Task ${task.number} failed for agent ${agent.id}:`, error.message);
    await handleTaskFailure(task, agent, error);
  } finally {
    // Stage 6: Disk cleanup
    try {
      if (fsSync.existsSync(workspaceDir)) {
        console.log(`Cleaning up workspace for task ${task.number}...`);
        await fs.rm(workspaceDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error(`Cleanup error for ${workspaceDir}:`, cleanupError.message);
    }
  }
}

async function callJulesAPI(agent, context, workspaceDir, task) {
  const token = getToken(agent.jules_api_token);
  const JULES_API_URL = process.env.JULES_API_URL || "https://api.jules.ai/v1/execute";

  const runPayload = {
    systemPrompt: context.systemPrompt,
    taskContext: {
      id: task.id,
      title: task.title,
      description: task.description,
      metadata: { repositoryUrl: context.repositoryUrl }
    },
    enforceCleanSession: true,
    workspace_path: workspaceDir,
    agent_email: agent.google_account_email
  };

  try {
    const response = await axios.post(JULES_API_URL, runPayload, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    throw new Error(`Jules API Error: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
  }
}

async function finishTask(agent, task, julesResponse, role) {
  const team = await task.team;
  const states = await team.states();

  let newStateName = "Done";
  let assigneeId = agent.linear_user_id;
  let labelIdsToAdd = [];

  if (role === "BARCAN-TAG-12") {
    newStateName = "Todo";
    assigneeId = null; // Techlead requirement

    // Parse role tags from julesResponse.report (e.g., "BARCAN-TAG-01")
    const roleTagMatch = (julesResponse.report || "").match(/BARCAN-TAG-\d+/);
    if (roleTagMatch) {
      const tagToApply = roleTagMatch[0];
      const teamLabels = await team.labels();
      const label = teamLabels.nodes.find(l => l.name === tagToApply);
      if (label) labelIdsToAdd.push(label.id);
    }
  } else if (role === "BARCAN-TAG-01") {
    newStateName = "Ready for Audit";
  }

  const newState = states.nodes.find(s => s.name === newStateName) || states.nodes.find(s => s.name === "Done");

  const report = julesResponse.report || "Task completed successfully.";
  await task.addComment({ body: `### Исполнительный отчет Jules\n${report}` });

  const updateData = {
    stateId: newState.id,
    assigneeId: assigneeId
  };
  if (labelIdsToAdd.length > 0) {
    updateData.labelIds = labelIdsToAdd;
  }

  await linearClient.issueUpdate(task.id, updateData);
}

async function handleTaskFailure(task, agent, error) {
  const team = await task.team;
  const states = await team.states();
  const failedState = states.nodes.find(s => s.name === "Failed") || states.nodes.find(s => s.name === "Canceled");

  await task.addComment({
    body: `### Ошибка выполнения\nАгент: ${agent.id}\nСтек ошибки:\n\`\`\`\n${error.stack || error.message}\n\`\`\``
  });

  await linearClient.issueUpdate(task.id, {
    stateId: failedState ? failedState.id : undefined,
    assigneeId: null
  });
}

async function determineRole(agent, task) {
  const state = await task.state;
  if (agent.allowed_roles.includes("BARCAN-TAG-12") && state.name === "Inbox") {
    return "BARCAN-TAG-12";
  }
  const labels = await task.labels();
  const roleLabel = labels.nodes.find(l => agent.allowed_roles.includes(l.name));
  return roleLabel ? roleLabel.name : agent.allowed_roles[0];
}

async function prepareContext(role, task, agent) {
  // Find the file that starts with the role ID
  const rolesDir = path.join(__dirname, "roles");
  const files = await fs.readdir(rolesDir);
  const roleFile = files.find(f => f.startsWith(role));

  if (!roleFile) throw new Error(`Role file for ${role} not found`);

  const rolePromptPath = path.join(rolesDir, roleFile);
  let systemPrompt = await fs.readFile(rolePromptPath, "utf8");

  systemPrompt = systemPrompt.replace(/\[EMAIL_АГЕНТА\]/g, agent.google_account_email);

  let repositoryUrl = null;
  if (task.description) {
    const match = task.description.match(/https:\/\/github\.com\/[^\s)]+/);
    if (match) repositoryUrl = match[0];
  }

  return { systemPrompt, repositoryUrl };
}

if (require.main === module) {
  runEngine().catch(console.error);
}

module.exports = { checkWIP, pullTask, assignTask, prepareContext, executeTask };
