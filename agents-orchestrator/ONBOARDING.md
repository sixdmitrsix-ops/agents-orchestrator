# Onboarding: `agents-orchestrator` (BARCAN-TAG OS)

Welcome to the **BARCAN-TAG Orchestration System**! This service manages an autonomous AI engineering organization based on philosophical and operational rigor.

## 1. Full Agent List

| ID | Agent Name | Role |
|----|-----------|------|
| `BARCAN-TAG-01` | ACTUALIST-OBJECT | Solution Architect |
| `BARCAN-TAG-02` | RIGID-DESIGNATOR | Backend / Integration Engineer |
| `BARCAN-TAG-03` | BELIEF-INTENSION | UI/UX Designer |
| `BARCAN-TAG-04` | MODAL-QUANTIFIER | Data Scientist / ML Engineer |
| `BARCAN-TAG-05` | NECESSARY-IDENTITY | SRE / DevOps |
| `BARCAN-TAG-06` | DEONTIC-CONSISTENCY | QA Automation |
| `BARCAN-TAG-07` | SECOND-ORDER-KNOWLEDGE | AppSec / DevSecOps |
| `BARCAN-TAG-08` | SUBSTITUTIVITY-SALVA-VERITATE | Data Engineer / DBA |
| `BARCAN-TAG-09` | MORAL-DILEMMA | Technical Product Manager |
| `BARCAN-TAG-10` | DEONTIC-PROHIBITION | Data Governance / Compliance |
| `BARCAN-TAG-11` | CLIENT-PERCEPTION | Frontend Engineer |
| `BARCAN-TAG-12` | TECH-LEAD | Tech-Lead / Code Reviewer |

---

## 2. System Architecture

The system operates on a **Stateless Pull Model** using Linear as the source of truth.

### Workflow:
1. **Inbox**: New tasks land here.
2. **Triage**: `BARCAN-TAG-12` (Tech-Lead) pulls from Inbox, analyzes, adds a role tag (e.g., `BARCAN-TAG-02`), and moves to `Todo`.
3. **Operational Pull**: The agent with the matching tag pulls the task into `In Progress`.
4. **Execution**: Jules executes the task in an isolated workspace.
5. **Closure**: Code is pushed, PR created, and Linear task is updated to `Done` or `Ready for Audit`.

---

## 3. Interaction Map

```
                        ┌─────────────┐
                        │  TAG-09     │
                        │  Медиатор   │◄── Арбитр конфликтов
                        └──────┬──────┘
                               │ декомпозиция
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │  TAG-01  │    │  TAG-02  │    │  TAG-06  │
        │ Architect│───►│ Backend  │    │   QA     │
        └──────────┘    └──────────┘    └──────────┘
              │                │
              ▼                ▼
        ┌──────────┐    ┌──────────┐
        │  TAG-08  │    │  TAG-04  │
        │Data Eng. │───►│ ML Eng.  │
        └──────────┘    └──────────┘
              │
              ▼
        ┌──────────┐    ┌──────────┐
        │  TAG-03  │    │  TAG-05  │
        │  UX/UI   │───►│  DevOps  │
        └──────────┘    └──────────┘
              │
              ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │  TAG-11  │    │  TAG-07  │    │  TAG-10  │
        │ Frontend │◄──►│  AppSec  │◄──►│Compliance│
        └──────────┘    └──────────┘    └──────────┘
```

---

## 4. Configuration and Setup

### A. Linear Labels
Ensure you have labels created in Linear exactly matching the IDs: `BARCAN-TAG-01` through `BARCAN-TAG-12`.

### B. Environment Variables
- `LINEAR_API_KEY`: Master management key.
- `JULES_TOKEN_01` to `JULES_TOKEN_12`: Tokens for each agent account.

### C. Execution
```bash
cd agents-orchestrator
npm install
node pull-engine.js
```

---

## 5. Global Rules
Refer to `BRAND-OS_GLOBAL_RULES.md` for governing principles and `AGENT_TEMPLATE.md` for adding new agents.
