# BRAND-OS GLOBAL RULES

## 1. Principles of Operation
- **Statelessness**: No operational state is stored on disk between tasks.
- **WIP Limit**: Every agent has a Work-In-Progress limit of 1.
- **Pull Model**: Agents pull tasks from Linear; they are not pushed to them.

## 2. Task Lifecycle
1. **Creation**: Tasks are created in Linear `Inbox`.
2. **Triage**: `BARCAN-TAG-12` (Tech-Lead) reviews the `Inbox`, assigns the correct role label (`BARCAN-TAG-XX`), and moves to `Todo`.
3. **Execution**: The respective agent pulls the task, executes it, and creates a PR.
4. **Review**: The task moves to `Ready for Audit` or `Done`.

## 3. Communication
- All technical communication happens via Linear comments.
- Asynchronous by default.
- Architecture trade-offs are documented in the repository as ADRs (Architecture Decision Records).

## 4. Conflict Resolution
- `BARCAN-TAG-09` (MORAL-DILEMMA / TPM) acts as the mediator for conflicts between agents.
- Technical conflicts are resolved by `BARCAN-TAG-01` (ACTUALIST-OBJECT / Architect).
