const { LinearClient } = require("@linear/sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Load configuration
const configPath = path.join(__dirname, "config", "agents-matrix.json");
const matrix = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Helper to get tokens from env if they start with 'env:'
function getToken(tokenStr) {
  if (tokenStr.startsWith("env:")) {
    const envVar = tokenStr.split(":")[1];
    return process.env[envVar];
  }
  return tokenStr;
}

const POLL_INTERVAL = 60000; // 60 seconds

async function runEngine() {
  console.log("Starting Pull Engine...");
  while (true) {
    const agentPromises = matrix.agents.map(agent => processAgent(agent));
    await Promise.allSettled(agentPromises);
    console.log(`Waiting ${POLL_INTERVAL / 1000} seconds for next cycle...`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

async function processAgent(agent) {
  console.log(`Processing agent: ${agent.id} (${agent.google_account_email})`);
  const linearToken = getToken(agent.jules_api_token); // Assuming Jules API token or a separate Linear token?
  // Wait, the TZ says jules_api_token, but we also need Linear token.
  // Actually, usually Jules agents have their own tokens, but for Linear SDK we need a Linear API key.
  // I will assume LINEAR_API_KEY is available or used per agent if specified.
  // Let's assume a global LINEAR_API_KEY for now or check if it should be in matrix.
  // Re-reading TZ: "jules_api_token": "env:JULES_TOKEN_1"
  // It doesn't explicitly mention Linear Token per agent in the JSON sample.
  // I'll use a global process.env.LINEAR_API_KEY for the orchestrator to manage Linear.

  const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

  try {
    // WIP Check
    const hasWIP = await checkWIP(linearClient, agent.linear_user_id);
    if (hasWIP) {
      console.log(`Agent ${agent.id} has active tasks. Skipping.`);
      return;
    }

    // Pull Task
    const task = await pullTask(linearClient, agent);
    if (!task) {
      console.log(`No suitable tasks for agent ${agent.id}.`);
      return;
    }

    // Atomic Assign
    const assigned = await assignTask(linearClient, task, agent);
    if (!assigned) {
      console.log(`Failed to assign task ${task.id} to agent ${agent.id} (possibly taken).`);
      return;
    }

    // Execution
    await executeTask(agent, task);

  } catch (error) {
    console.error(`Error processing agent ${agent.id}:`, error.message);
  }
}

async function checkWIP(linearClient, userId) {
  const issues = await linearClient.issues({
    filter: {
      assignee: { id: { eq: userId } },
      state: { name: { eq: "In Progress" } }
    }
  });
  return issues.nodes.length > 0;
}

async function pullTask(linearClient, agent) {
  const isTechleadOnly = agent.allowed_roles.length === 1 && agent.allowed_roles[0] === "role-techlead";

  // Try to pull as Techlead if applicable
  if (agent.allowed_roles.includes("role-techlead")) {
    const inboxIssues = await linearClient.issues({
      filter: {
        state: { name: { eq: "Inbox" } },
        assignee: { null: true }
      },
      orderBy: "priority",
      first: 1
    });
    if (inboxIssues.nodes.length > 0) return inboxIssues.nodes[0];
  }

  // If not Techlead or no Inbox tasks, try other roles
  const operationalRoles = agent.allowed_roles.filter(r => r !== "role-techlead");
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

async function assignTask(linearClient, task, agent) {
  // Get the 'In Progress' state ID for the team
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
    fs.mkdirSync(workspaceDir, { recursive: true });

    // 1. Prepare context
    const role = await determineRole(agent, task);
    const context = await prepareContext(role, task);

    // 2. Clone Repo (Simulated logic to find repo URL from task description/metadata)
    const repoUrlMatch = (task.description || "").match(/https:\/\/github\.com\/[^\s)]+/);
    const repoUrl = repoUrlMatch ? repoUrlMatch[0] : null;

    if (repoUrl) {
      console.log(`Cloning repository ${repoUrl} for agent ${agent.id}...`);
      try {
        execSync(`git clone ${repoUrl} .`, {
          cwd: workspaceDir,
          env: { ...process.env, GIT_AUTHOR_NAME: `Jules ${role}`, GIT_AUTHOR_EMAIL: agent.google_account_email }
        });
      } catch (e) {
        console.error(`Git clone failed for ${repoUrl}:`, e.message);
      }
    }

    // 3. Call Jules API (Stateless Injection)
    console.log(`Calling Jules API for ${agent.id} on task ${task.number} with role ${role}...`);
    const julesResponse = await callJulesAPI(agent, context, workspaceDir);

    // 4. Update Linear Status and Comment
    await finishTask(agent, task, julesResponse, role);

  } finally {
    // Cleanup (Pull-system closure)
    if (fs.existsSync(workspaceDir)) {
      console.log(`Cleaning up workspace for task ${task.number}...`);
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}

async function callJulesAPI(agent, context, workspaceDir) {
  const token = getToken(agent.jules_api_token);
  // Hypothetical Jules API endpoint
  const JULES_API_URL = process.env.JULES_API_URL || "https://api.jules.ai/v1/execute";

  try {
    const response = await axios.post(JULES_API_URL, {
      prompt: context,
      workspace_path: workspaceDir,
      clean_session: true,
      agent_email: agent.google_account_email
    }, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error("Jules API Call failed:", error.response ? error.response.data : error.message);
    return { success: false, report: "Jules API failed to execute." };
  }
}

async function finishTask(agent, task, julesResponse, role) {
  const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
  const team = await task.team;
  const states = await team.states();

  let newStateName = "Done";
  let labelIdsToAdd = [];

  if (role === "role-techlead") {
    newStateName = "Todo";
    // Parse role tags from julesResponse.report (e.g., "Role assigned: role-architect")
    const roleTagMatch = (julesResponse.report || "").match(/role-[a-z-]+/);
    if (roleTagMatch) {
      const tagToApply = roleTagMatch[0];
      const teamLabels = await team.labels();
      const label = teamLabels.nodes.find(l => l.name === tagToApply);
      if (label) labelIdsToAdd.push(label.id);
    }
  } else if (role === "role-architect") {
    newStateName = "Ready for Audit";
  }

  const newState = states.nodes.find(s => s.name === newStateName) || states.nodes.find(s => s.name === "Done");

  await task.addComment({
    body: `Jules Agent (${role}) report:\n${julesResponse.report || "Task completed."}`
  });

  const updateData = { stateId: newState.id };
  if (labelIdsToAdd.length > 0) {
    updateData.labelIds = labelIdsToAdd;
  }

  await linearClient.issueUpdate(task.id, updateData);
}

async function determineRole(agent, task) {
  if (agent.allowed_roles.includes("role-techlead") && (await task.state).name === "Inbox") {
    return "role-techlead";
  }
  const labels = await task.labels();
  const roleLabel = labels.nodes.find(l => agent.allowed_roles.includes(l.name));
  return roleLabel ? roleLabel.name : agent.allowed_roles[0];
}

async function prepareContext(role, task) {
  const rolePromptPath = path.join(__dirname, "roles", `${role}.md`);
  const systemPrompt = fs.readFileSync(rolePromptPath, "utf8");
  const taskDescription = task.description || "No description";
  const taskTitle = task.title;

  return `${systemPrompt}\n\nTask: ${taskTitle}\nDescription: ${taskDescription}`;
}

// Start engine if run directly
if (require.main === module) {
  runEngine().catch(console.error);
}

module.exports = { checkWIP, pullTask, assignTask, prepareContext };
