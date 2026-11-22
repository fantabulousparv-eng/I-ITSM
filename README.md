# I-ITSM

**Intelligent IT Service Management and Incident Resolution System** is a full-stack OOP course project for running an IT service desk. An employee reports an outage, a technician investigates it, and an administrator can verify the fix and close the ticket. Each incident carries its assignment history, response and resolution deadlines, and audit trail.

## Run locally

You need Node.js 22.12 or later, npm, and a running MongoDB instance. The commands below use Git Bash and start from the repository root.

**1. Start the backend.** Install its dependencies:

```bash
cd itsm-backend
npm ci
```

Use [the backend configuration example](itsm-backend/.env.example) as a reference. The default database is `mongodb://localhost:27017/itsm_db`. If you use another database, set `MONGO_URI` in the backend environment. Before the first startup, choose your own `JWT_SECRET`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`. The seed credentials apply when the admin account is first created. This repository currently tracks the backend `.env` file, so keep private values in your shell environment and out of commits.

```bash
npm run dev
```

On startup the API connects to MongoDB, seeds the service catalogue and SLA policies, and ensures an administrator exists. Open [the local health endpoint](http://localhost:5000/api/health) and check that `database` reads `connected`.

**2. Start the frontend.** Leave the backend running. In a second terminal at the repository root:

```bash
cd itsm-frontend
npm ci
npm run dev
```

Open the **Local** URL printed by Vite (usually [localhost:5173](http://localhost:5173)). Register an employee or technician, or sign in with the administrator account. If you change the backend address, set `VITE_API_BASE` for the frontend, including the `/api` suffix.

**Optional demo data.** For a local demo database, run `npm run seed:demo` from `itsm-backend`. The script creates sample users and prints their sign-in details. It skips sample ticket creation if incidents already exist.

## Try an incident workflow

1. **Employee:** Open **Report** and describe an outage. Select the affected service, impact and urgency. Submit the report and copy the ticket ID.
2. **Technician:** Find the assigned ticket in **Queue**. Acknowledge it, move it to **In progress**, add an investigation note, then enter a resolution summary and select **Resolved**.
3. **Administrator:** Open the same ticket, review the fix, select **Verified**, then **Closed**. The audit history records the transitions. **Insights** shows resolution timing and SLA compliance across tickets.

The default priority strategy combines impact, urgency and service criticality, with an adjustment for the number of affected users. Assignment strategies can rank technicians by skills, workload or experience. If automatic dispatch fails, the ticket stays in the queue for manual assignment.

## AI support chat

Signed-in users can open **Support chat** for troubleshooting or help drafting a ticket. Chat messages and recent conversation history are sent to Google Gemini. The backend holds the API key. The user reviews the advice and submits any incident through **Report**.

To enable chat, run the following in Git Bash from `itsm-backend` before starting the API. If the API is already running there, stop it with Ctrl+C first. Run the first line, then paste your key at the hidden prompt.

```bash
read -rsp "Gemini API key: " GEMINI_API_KEY; echo
export GEMINI_API_KEY
npm run dev
```

Use `GEMINI_MODEL` to select another model available to your Google project. The ticket workflow also runs without a Gemini key.

## Code layout

| Area | Implementation |
| --- | --- |
| Frontend | [React dashboard components](itsm-frontend/src/components) and [Axios API client](itsm-frontend/src/services/api.js) |
| API | [Express routes](itsm-backend/routes) for authentication, incidents, services, analytics, notifications and chat |
| Domain logic | [Services](itsm-backend/services) orchestrate intake, assignment, SLA monitoring and resolution |
| Object-oriented design | [Patterns](itsm-backend/patterns) implement interchangeable strategies, a lifecycle state machine, an event bus, notification creation and repositories |
| Persistence | [Mongoose models](itsm-backend/models) store users, incidents, services, policies, notifications and audit records in MongoDB |

To build the frontend for distribution, run `npm run build` from `itsm-frontend`. Vite writes the output to `dist/`.
