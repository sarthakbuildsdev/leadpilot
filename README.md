# LeadPilot

A local CRM for freelancers and small businesses. Track leads, follow-ups, and won revenue with a Node.js/Express API and PostgreSQL.

This first version is a **single-user local CRM**. It does **not** include login, password hashing, or multi-user access. Run it only on a trusted computer. Anyone who can open the app can read and change all leads.

## What you need

- Windows 10/11
- Node.js and npm
- PostgreSQL (the project was built against PostgreSQL 18.x)
- A database named `leadpilot`
- The `postgres` user password for your local PostgreSQL install

## One-time setup (Windows PowerShell)

1. Open PowerShell and go to the project folder:

```powershell
cd C:\Users\SARTHAK\leadpilot
```

2. Install dependencies (already done if `node_modules` exists):

```powershell
npm install
```

3. Create your environment file. Do **not** commit this file.

```powershell
Copy-Item .env.example .env
notepad .env
```

Set values like this (use **your** PostgreSQL password; never share it in chat logs or frontend code):

```
PORT=3000
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_postgres_password
PGDATABASE=leadpilot
```

4. Confirm PostgreSQL is running and the `leadpilot` database exists. In `psql` or pgAdmin:

```sql
CREATE DATABASE leadpilot;
```

If the database already exists, skip that command. The app creates the `leads` table on startup with `CREATE TABLE IF NOT EXISTS` and never drops existing tables.

If your PostgreSQL tools are on a custom path (for example `D:\Program File\`), start the Windows service from Services (`postgresql-x64-18` or similar) or use pgAdmin. The app connects over TCP to `localhost:5432` and does not need the PostgreSQL install path.

## Run the app

Development (auto-restart):

```powershell
cd C:\Users\SARTHAK\leadpilot
npm run dev
```

Production-style:

```powershell
cd C:\Users\SARTHAK\leadpilot
npm start
```

Open [http://localhost:3000](http://localhost:3000)

If authentication fails, the server prints a clear message asking you to set `PGPASSWORD` in `.env`. It will not print the password.

## Tests

```powershell
cd C:\Users\SARTHAK\leadpilot
npm test
```

These tests cover validation, safe SQL query building, and API behavior with a mocked database. They do not require PostgreSQL.

## How to try each feature

1. **Dashboard stats** — Open the app. Empty stats should show zeros. Add leads with statuses New, Contacted, Interested, Won, and Lost. Won revenue should include only Won amounts. Pipeline value should exclude Won and Lost.
2. **Charts** — Status and source charts update from `/api/stats` with no extra libraries.
3. **Add lead** — Use **Add Lead**. Name and business are required. Save. The row should appear in **Leads**.
4. **View / edit** — Use **View** or **Edit**. Change status, amount, notes, or follow-up date.
5. **Search and filters** — On **Leads**, search by name/business/email/phone. Filter by status, source, and follow-up (overdue / today / upcoming / none). Click column headers to sort.
6. **Follow-ups** — Create a lead with yesterday’s date (overdue), today’s date, and a future date. Open **Follow-ups**. Overdue rows are highlighted.
7. **Delete** — Click **Delete**, confirm in the dialog, and confirm the lead is gone after refresh.
8. **Persistence** — Restart the server (`Ctrl+C`, then `npm start`). Data should still be there (PostgreSQL), not only in the browser.
9. **API** — In PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:3000/api/stats
Invoke-RestMethod http://localhost:3000/api/leads
```

Create a lead:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/leads -ContentType "application/json" -Body '{"name":"Test Client","business":"Test Co","status":"New","amount":5000,"source":"Website"}'
```

## REST API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | App health (no secrets) |
| GET | `/api/stats` | Dashboard totals and chart data |
| GET | `/api/leads` | List leads (`search`, `status`, `source`, `followup`, `sort`, `order`) |
| GET | `/api/leads/:id` | One lead |
| POST | `/api/leads` | Create |
| PUT | `/api/leads/:id` | Full update |
| DELETE | `/api/leads/:id` | Delete |

Lead fields: `name`, `business`, `phone`, `email`, `source`, `status`, `amount`, `notes`, `followup_date`, `created_at`.

Statuses: `New`, `Contacted`, `Interested`, `Won`, `Lost`.

Sources: `Website`, `Referral`, `LinkedIn`, `Instagram`, `Cold Call`, `Email`, `Other`.

## Security notes

- Passwords live only in `.env`. `.gitignore` ignores `.env`.
- Queries are parameterized.
- Helmet sets security headers.
- Initialization never runs `DROP TABLE` or `TRUNCATE`.
- There is no authentication. Do not expose this server to the public internet.

## Project layout

- `server.js` — starts the HTTP server and initializes the database
- `src/` — Express app, routes, validation, PostgreSQL pool
- `public/` — dashboard HTML, CSS, and JavaScript
- `tests/` — Node.js built-in test runner
