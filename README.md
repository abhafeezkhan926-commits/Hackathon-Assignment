# HCM Lite — MERN HR Management System

HCM Lite is a role-based HR management starter application for the Saylani Hackathon brief dated 24 October 2026. It includes a React/Vite interface and an Express/Mongoose API, with data stored in MongoDB. This ZIP contains source code and setup templates; it does **not** include real credentials or installed `node_modules` folders.

> **Verification note:** The backend's pure business-logic test suite and source syntax checks were run in the build environment. Package installation could not finish because the package registry request timed out, so a Vite production build, browser-level UI run, and database-backed integration tests have not been verified here. Read “Known limitations” before presenting this as production-ready.

## Features in this source package

- **Roles and access:** Admin, HR, and Employee; backend authentication and role middleware; employee-owned personal endpoints; email or username sign-in; bcrypt password hashes; HTTP-only session cookie; logout; temporary-password change enforcement; account activation/deactivation.
- **First-run setup:** Create the company and first Admin from the setup screen, or bootstrap an Admin from environment variables. Setup creates a `General` department and configured annual, sick, casual, and unpaid leave types—not fake employee records or demo metrics.
- **People operations:** Admin-created HR accounts; HR/Admin employee accounts; profile details; email and username uniqueness constraints; temporary credentials shown once; employee directory search and status filters; profile avatar update/remove with backend file-content validation and optional Cloudinary storage; CSV export and dry-run import validation.
- **Attendance:** Employee check-in/out, server timestamps, duplicate check-in conflict, time calculations, late-arrival rules, employee correction requests, and HR/Admin review.
- **Leave:** Employee applications, holiday/weekend-aware working-day calculations, overlap and balance checks, HR/Admin approval or rejection, and notifications. Smart leave suggestions are optional and require AI configuration; they never submit or approve a request automatically.
- **Payroll:** Salary structures, HRA and medical allowance calculations, monthly draft creation, salary deductions, illustrative progressive annualized tax calculation, Admin-only finalization/locking, employee-visible finalized payslips, and PDF downloads.
- **Company setup:** Basic company settings, departments, designations, holidays, office-hours/grace period, and leave quotas.
- **Dashboards and communication:** Role-sensitive dashboards, saved-record-derived KPIs, announcements, notifications/read state, Admin-only audit log viewing, and an optional hosted LLM chat with constrained backend tools.
- **Project hygiene:** Separate client and server environment examples, centralized API errors, security middleware, rate limits, README, and unit tests for core date/payroll utility logic.

## Requirements

- Node.js 20 or later (Node.js 22 recommended)
- npm
- MongoDB Atlas URI or a reachable local MongoDB service
- Optional: Cloudinary account for profile pictures
- Optional: OpenAI-compatible hosted chat-completions endpoint and API key for AI assistant / Smart Leave

## Install and run locally

From the `hcm-lite` root directory:

### 1. Install dependencies

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 2. Configure the backend

Copy `server/.env.example` to `server/.env` and configure at least:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/hcm_lite
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
```

Generate a secure JWT secret using Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use a different strong secret in every environment. Never commit `server/.env` or share it publicly.

### 3. Configure the frontend

Copy `client/.env.example` to `client/.env`:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

Only public values belong in a Vite environment file. **Never put MongoDB credentials, JWT secrets, Cloudinary API secrets, or AI provider keys in `client/.env`.**

### 4. Start both apps

From the root:

```bash
npm run dev
```

Or start them separately in two terminals:

```bash
npm --prefix server run dev
npm --prefix client run dev
```

Frontend: `http://localhost:5173`  
API health: `http://localhost:5000/api/health`

The API must be reachable from the browser and `CLIENT_ORIGIN` must contain the exact frontend origin. For production, set `COOKIE_SECURE=true`, use HTTPS, set `NODE_ENV=production`, and use an adequately random `JWT_SECRET` of at least 32 characters.

## First Admin setup

On a fresh database, open the frontend and complete the first-run setup form. It creates the company and the initial Admin account. The Admin setup endpoint is intended only for initial initialization and returns a conflict once initialization is complete.

Alternative for a fresh database: set `ADMIN_EMAIL`, `ADMIN_USERNAME` (optional), `ADMIN_NAME` (optional), `ADMIN_PASSWORD`, and optionally `COMPANY_NAME` in `server/.env`. `ADMIN_PASSWORD` must be at least 12 characters and contain uppercase, lowercase, and numeric characters. Start the API; it will bootstrap the Admin if no Admin exists. Remove bootstrap credentials from deployment configuration after setup.

There is no public Admin self-registration flow. Admin creates HR accounts; Admin or HR can create Employee accounts. Temporary passwords must be changed before the new account can access normal app features.

### Reset a local development database

**Warning: this destroys all data in the selected database.** Stop the application first, confirm `MONGODB_URI` points only to your local development database, then drop the `hcm_lite` database from `mongosh` or a MongoDB GUI. Do not use this instruction against a production database.

## Optional services

### Cloudinary profile images

Set the following only in `server/.env`:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
MAX_UPLOAD_MB=5
```

The UI and profile operations continue working when Cloudinary is unconfigured, but avatar uploads return a clear unavailable error rather than pretending that a picture was saved. Supported image uploads are JPG/JPEG, PNG, and WebP and are checked by their file content on the backend.

### AI assistant and Smart Leave

Set these server-only values to your provider's compatible chat-completions endpoint:

```env
AI_API_KEY=
AI_API_BASE_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-4o-mini
AI_REQUESTS_PER_HOUR=20
```

Choose a model/provider that supports the request format and tool-calling used by the assistant. Smart Leave expects a JSON-object response. If AI is not configured or fails, regular HR workflows remain available and the leave form can be completed manually. Do not use the AI assistant as a substitute for payroll or HR review.

## Role summary

- **Admin:** company settings, HR accounts, employee directory, attendance/leave reviews, payroll draft review and finalization, announcements, dashboards, and audit log viewing.
- **HR:** employee accounts and directory, attendance and leave reviews, payroll draft preparation/review, announcements, and operational dashboards. HR cannot create Admin users or finalize payroll.
- **Employee:** own profile/contact/avatar, own attendance, own leave requests and balance, own finalized payslips, announcements, notifications, and AI questions restricted to permitted personal/company information.

The server determines role from the authenticated user record. The browser's chosen role or hidden menu items do not grant permissions.

## API map

All API endpoints use `/api` as the base path.

| Area | Key endpoints |
|---|---|
| Health and setup | `GET /health`, `GET /setup/status`, `POST /setup/initialize` |
| Authentication | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/change-password` |
| HR accounts | `GET /users`, `POST /users/hr`, `GET /users/:id`, `PATCH /users/:id/profile`, `PATCH /users/:id/status`, `POST /users/:id/reset-password` |
| Employees | `GET /employees`, `POST /employees`, `GET /employees/:id`, `PATCH /employees/:id`, `PATCH /employees/:id/status`, `GET /employees/export.csv`, `POST /employees/import/dry-run`, `POST /employees/import` |
| Own profile | `GET /profile`, `PATCH /profile`, `POST /profile/avatar`, `DELETE /profile/avatar`, `GET /profile/summary`, `GET /profile/notifications`, `PATCH /profile/notifications/:id/read` |
| Attendance | `POST /attendance/check-in`, `POST /attendance/check-out`, `GET /attendance/mine`, `GET /attendance`, `POST /attendance/corrections`, `GET /attendance/corrections`, `PATCH /attendance/corrections/:id/decision` |
| Leave | `GET /leaves/mine`, `POST /leaves`, `GET /leaves`, `PATCH /leaves/:id/decision`, `POST /leaves/:id/cancel` |
| Company | `GET/PATCH /company/settings`, `GET/POST/PATCH /company/departments`, `GET/POST /company/designations`, `GET /company/leave-types`, `GET/POST /company/holidays` |
| Payroll | `GET /payroll/runs`, `POST /payroll/runs/draft`, `POST /payroll/runs/:id/finalize`, `GET /payroll/mine`, `GET /payroll/payslips`, `GET /payroll/payslips/:id/pdf` |
| Other | `GET/POST/PATCH /announcements`, `GET /audit`, `GET /dashboard`, `POST /ai/chat`, `POST /ai/parse-leave` |

Some routes are role-restricted; use an authenticated session and respect the role requirements. For the exact request schema, inspect the validator in the matching route file.

## CSV employee import

Use the directory's **Import CSV** button. Supported columns are:

```csv
employeeCode,fullName,username,email,department,designation,joiningDate,basicSalary
```

- `joiningDate` must use `YYYY-MM-DD`.
- `department` must exactly match the name of an active department (case-insensitive lookup).
- `basicSalary` must be greater than zero.
- Dry-run validation identifies rows and fields that need correction and creates no accounts.
- The import is blocked unless every row passes validation. It accepts at most 500 data rows and a 5 MB file.
- Temporary credentials are returned once after a successful import. Download them and share them securely; do not commit this file to source control.

## Tests and builds

```bash
npm --prefix server test
npm --prefix client test
npm run build
```

The server test command runs `node:test` unit tests for payroll tax boundaries, payroll totals, working-day calculation, and payroll period parsing. The UI tests use Vitest. A production build is produced by Vite. Database-backed integration and real-provider tests require MongoDB and configured external services.

## Five-minute demo walkthrough

1. Start MongoDB and both apps; open the first-run setup and create the company/Admin.
2. Sign in as Admin and create an HR account; keep the one-time temporary credential safe.
3. Sign out, sign in as HR, change the temporary password, and create an Employee profile.
4. Sign out, sign in as Employee, change the temporary password, update contact details, and check in.
5. Submit a leave request; sign back in as HR and approve/reject it; view the resulting notification as the employee.
6. Return as Admin, prepare a monthly payroll draft, review the generated breakdown, and finalize only if the data is appropriate. The employee can then download a finalized payslip.
7. Try the CSV dry-run using a small sample, and optionally configure Cloudinary/AI before demoing those integrations.

## Known limitations / review before production

This source is a substantial hackathon implementation, not a certified payroll/HR product. The following items are not fully implemented or verified here:

- Camera face-presence and GPS/geofence attendance bonus is not implemented. Do not claim biometric identity verification.
- There is no outbound email-provider integration for password-reset links or invitation messages. Admin password resets use a one-time temporary password flow.
- The implementation uses rollback logic for multi-record account creation; transaction-based guarantees and race-condition behavior have not been verified against a live replica-set MongoDB database.
- Automated integration tests against a real MongoDB deployment, browser testing, and a production build could not be completed in this environment because dependency installation timed out at the package registry.
- Cloudinary and AI functions require valid provider credentials and have not been tested against live providers here.
- Payroll tax slabs are an illustrative hackathon calculation, not professional tax advice. Reconcile the assignment's exact rounding/tax examples before using real salary data.
- Metrics are based on the records currently stored by this implementation; review formulas and date/timezone behavior against the exact brief before using the numbers for business decisions.
- Some optional assignment details (full CSV export scoping, historical employment tracking, advanced policy search, rich admin audit filtering, and additional reporting slices) may require further development.

Do not use production employee or payroll data until a developer has completed security review, integration tests, backup/restore drills, and a jurisdiction-appropriate payroll review.
