# Optima | AI-Powered Hiring Platform

**Live:** [optima-interview.vercel.app](https://optima-interview.vercel.app)

Optima changes the traditional job application process with AI interviews. Candidates complete a weekly connecting interview and are automatically matched to companies whose job postings fit their answers, skills, and resume. No initial cover letters, no cold applications. Companies receive a ranked list of compatible candidates without sifting through hundreds of unqualified submissions.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [How the Matching Works](#how-the-matching-works)
3. [Tech Stack](#tech-stack) 
4. [Project Structure](#project-structure)
5. [Local Setup](#local-setup)
6. [Environment Variables](#environment-variables)
7. [Deployment](#deployment)
8. [Team Contributions](#team-contributions)

---

## What It Does

### For Candidates

- **Connecting Interviews** — Once per week, a candidate completes an AI interview of sixteen questions: six general questions that everyone is asked that week, eight written by Claude from the candidate's saved job postings, and two long ones (coding for technical roles, a case question otherwise). Most questions get two to two and a half minutes; the whole interview runs 42 to 44 minutes. Upon completion, the system scores the candidate against every open job in their field and creates applications for matches that score 40% or above.

- **Mock Interview Practice** — Candidates can practice at any time (up to 3 sessions per day) for any job title and industry. Each mock interview generates role-specific questions, grades every answer line by line on the same scorecard as the weekly interview, and produces a full results breakdown with per-question feedback and an overall score. Mock sessions generate Match records that companies can browse but are separate from formal applications.

- **Camera and Voice Coach** — A coach reads the candidate's camera and microphone in the browser. It is on in every connecting interview and optional in practice. It gives live tips on eye contact (and which way the eyes went), posture, framing and light, and, when answers are dictated, on pace, pitch movement, volume and filler words, followed by a delivery report in the results that says what to work on first. No video or sound leaves the device: only summary numbers are stored.

- **Fair Play in Connecting Interviews** — A camera and microphone check must pass before the interview can begin (a face in the picture, alone, lit and in focus, and a microphone that hears). Questions are served one at a time and the clock is kept on the server. The interview runs in full screen; leaving the window is recorded and the third time ends it, pasting is turned off, and an interview closed part-way scores 0. Time off camera, time turned away from the screen and a second person in the picture take points off the score. Companies see the record with each application.

- **Profile Builder** — Candidates fill out a multi-tab profile covering contact info, demographic data (kept confidential for diversity reporting), a PDF resume upload (parsed automatically for ATS scoring), skills, desired roles, location, pay range, work type preference, and availability. The more complete the profile, the more accurate the AI matching.

- **Job Board** — Candidates can browse all active job postings with filters for industry, location type, hours, level, and salary. Jobs can be saved as favourites, which determines which postings are targeted in the next connecting interview.

- **Interview Hub** — A central dashboard for tracking all past mock and connecting interview sessions, viewing historical scores, and reviewing per-session results.

### For Companies

- **Job Postings** — Companies can create detailed job postings covering title, industry, description, responsibilities, required skills, education/experience requirements, salary range, work term, start date, hours type, job level, and up to 5 company-specific interview questions that get injected into the AI question generation.

- **Ranked Applicants** — Each job posting shows applicants ranked by their compatibility score. Companies can view a full score breakdown (overall score, interview performance, answer relevance, skills match, and resume ATS score), read the AI's reasoning for the match, and update a candidate's status (applied → viewed → contacted).

- **Score Reference Dashboard** — The company dashboard includes an at-a-glance scoring guide that explains what each score range means and how matching works, plus a link to the full grading rubric.

- **Company Profile** — Companies can upload a logo (with in-browser crop tool), write a company description, and list multiple office locations.

---

## How Scoring Works

Claude never produces a number. For every answer it picks one of five written levels on each line of a fixed scorecard and marks each point the question looks for as covered, partly covered or missing. All arithmetic is done in code (`backend/rubric.py`). Each new answer is rated three times and the middle rating kept, and the result is stored under a fingerprint of the question and the answer, so the same answer to the same question always gets the same grade.

| Line of the scorecard | Spoken answers | Coding answers |
|---|---|---|
| Answers the question / Correct | 20% | 40% |
| Evidence / Approach | 30% | 20% |
| Covers what the role needs | 35% | 20% |
| Clear and organised / Explained and readable | 15% | 20% |

The top level for Evidence is only given when the answer contains a figure for what was done or what came of it. The grader has to quote the figure, and the code checks that the quote is in the answer.

A skipped question scores 0 and counts in full. An interview with fewer than three quarters of its questions answered is not sent to any company.

The interview is then matched against each open job in the candidate's field:

| Factor | Weight | What It Measures |
|---|---|---|
| Interview Performance | 40% | The interview's own score: every question weighted by its time limit, less any points the camera took off |
| Answer Relevance | 35% | How far the answers show this job's work, and how many of its required skills they show |
| Profile Skills Match | 10% | How many of the job's required skills are on the candidate's own list |
| Resume ATS Score | 15% | How far the resume shows this job's work and its required skills |

Only candidates who score **40% or above** appear in a company's applicant list.

The full account, with the research behind it and its limits, is in [`docs/SCORING.md`](docs/SCORING.md). The site's owner can test the live grader at `/scoring-check` (it asks for the backend's `ADMIN_KEY`): it grades reference answers of known quality as many times as asked and shows whether any score moves, whether each lands where it should, and the scorecard behind each score.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend framework | React 19 + Vite | Component-based UI with fast HMR |
| Routing | React Router v7 | Client-side SPA routing |
| Styling | CSS custom properties | Design tokens for theming across all pages |
| Image cropping | react-easy-crop | In-browser profile picture / logo cropping |
| Backend framework | FastAPI (Python) | Async REST API with automatic OpenAPI docs |
| ORM | SQLAlchemy | Database models and query building |
| Database (local) | SQLite | Zero-config local development |
| Database (production) | PostgreSQL via Neon | Serverless Postgres on Vercel |
| AI — question generation | Anthropic Claude API | Generates role-specific interview questions from job descriptions |
| AI — answer scoring | Anthropic Claude API | Evaluates and scores candidate answers against job postings |
| AI — TTS | OpenAI TTS API | Text-to-speech audio playback of interview questions |
| File storage (local) | Local filesystem (`/uploads`) | Avatars and resumes during local development |
| File storage (production) | Vercel Blob | CDN-hosted avatars and resumes in production |
| Authentication | JWT (python-jose + passlib/bcrypt) | Stateless auth with role-based access (candidate vs. company) |
| Resume parsing | pdfplumber | Extracts plain text from uploaded PDF resumes for ATS scoring |
| HTTP client (backend) | httpx | Async HTTP calls to Vercel Blob API |
| Deployment | Vercel | Frontend static build + backend as Python serverless functions |

---

## Project Structure

```
optima_interview/
├── backend/
│   ├── main.py                  # FastAPI app init, CORS, static file serving, router registration
│   ├── database.py              # SQLAlchemy engine setup (SQLite local / PostgreSQL prod)
│   ├── models.py                # All database models: User, JobPosting, InterviewSession,
│   │                            #   InterviewQuestion, InterviewRun, Match, Application, Favourite
│   ├── schemas.py               # Pydantic request/response schemas for all endpoints
│   ├── auth.py                  # JWT creation, decoding, password hashing, role guards
│   ├── claude_client.py         # Every call to Claude: writing questions, and picking a written level
│   │                            #   for each line of the scorecard. It never returns a score
│   ├── rubric.py                # The scorecard, its levels and weights, and every sum behind a score
│   ├── scoring.py               # Rates a new answer three times, keeps the middle, stores the grade
│   ├── reference_answers.py     # Answers of known quality that the scoring check grades
│   ├── consistency_check.py     # Command-line check: 100 people, same answers, same grade
│   ├── tests/                   # Unit tests for the scoring rules (python -m unittest discover -s tests)
│   ├── interview_rules.py       # How an interview runs: time limits, leaving the window,
│   │                            #   the fair-play record, and the coach's numbers
│   ├── question_bank.py         # Industry → job role mappings, the general questions everyone is asked,
│   │                            #   and fallback question templates
│   ├── requirements.txt         # Python dependencies
│   ├── .env.example             # Template for required environment variables
│   ├── vercel.json              # Vercel Python serverless function config
│   └── routers/
│       ├── auth.py              # POST /auth/register, /auth/login, GET /auth/me, password reset
│       ├── interviews.py        # Start, begin, answer one question at a time, finish; leaving
│       │                        #   and closing; answer scoring; match + application creation
│       ├── jobs.py              # CRUD for job postings
│       ├── scoring.py           # The published scoring rules, and the owner's check of the live grader
│       ├── matches.py           # Candidate-job matches from mock interviews (company view)
│       ├── applications.py      # Formal applications from connecting interviews,
│       │                        #   status updates, tailored resume/cover letter uploads
│       ├── profile.py           # Profile read/update, avatar upload, resume upload + parsing
│       ├── favourites.py        # Save/remove/list favourite job postings
│       └── tts.py               # OpenAI TTS endpoint for interview question audio
│
└── frontend/
    └── src/
        ├── App.jsx              # Route definitions; every page but the landing page loads on demand
        ├── index.css            # Imports the typeface and the stylesheets in styles/
        ├── main.jsx             # React DOM entry point
        ├── api/
        │   └── client.js        # All fetch calls to the backend API, grouped by resource
        ├── context/
        │   └── AuthContext.jsx  # Global auth state (user object, login/logout), JWT persistence
        ├── lib/                 # Shared logic with no interface of its own
        │   ├── score.js         # The four parts of a match score and the send line (40)
        │   ├── flags.js         # The interviews switch and the limits shown in the interface
        │   ├── useLockdown.js   # Notices when a candidate leaves the interview window
        │   ├── dictation.js     # Capitals and full stops for dictated answers where the browser adds none
        │   └── coach/           # The coach: measuring a frame and a stretch of sound, tallying, tips, camera and microphone readers
        ├── components/          # Shared pieces: AppShell, Modal, ScoreLine, Scorecard, JobForm, FairPlay,
        │   │                    #   DeliveryReport, StartInterview, ImageCropModal and others
        │   ├── coach/           # The coach's tile on the interview page
        │   └── landing/         # The landing page's live examples
        ├── styles/              # tokens, base, ui, product, shell, app, pages, auth,
        │                        #   interview, landing, lab
        └── pages/
            ├── Landing.jsx          # Public landing page
            ├── AuthPage.jsx         # Login and registration (candidate + company)
            ├── Dashboard.jsx        # Role-split home page
            ├── CandidateProfile.jsx # Profile editor with PDF resume upload and skills
            ├── JobPostingsPage.jsx  # Candidate job board with filters and saved roles
            ├── InterviewHub.jsx     # Applications, weekly interview and practice history
            ├── InterviewPage.jsx    # Live interview: one question at a time, lockdown, coach
            ├── ResultsPage.jsx      # The score, each answer's scorecard, the delivery report, what was sent
            ├── CompanyProfile.jsx   # Company info editor with logo upload/crop
            ├── CompanyJobs.jsx      # Company's job postings manager (create, edit, close)
            ├── CompanyApplicants.jsx  # Ranked applicant list for a specific job posting
            ├── GradingRubric.jsx    # How scoring works, read from the server's own rules
            ├── ScoringCheck.jsx     # The owner's check of the live grader (asks for the admin key)
            └── ForgotPasswordPage.jsx  # Says plainly that password reset is not built yet
```

---

## Local Setup

### Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- An **Anthropic API key** (required — used for question generation and answer scoring)
- An **OpenAI API key** (required for text-to-speech; mock interviews will work without it but TTS will fail)

### 1. Clone the repository
 
```bash
git clone https://github.com/Ryanvsar/Optima.git
cd Optima/optima_interview
```

### 2. Backend setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Open .env and fill in your API keys (see Environment Variables section below)

# Start the backend server
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive API docs (Swagger UI) are at `http://localhost:8000/docs`.

The SQLite database (`nexus.db`) is created automatically on first run. No migrations needed — SQLAlchemy creates all tables from the models on startup.

### 3. Frontend setup

In a separate terminal:

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The frontend will be at `http://localhost:5173`.

> **Note:** The frontend reads the backend URL from the `VITE_API_URL` environment variable. In development this defaults to `http://localhost:8000`, so no extra config is needed unless your backend runs on a different port.

### 4. Verify everything is working

1. Open `http://localhost:5173`
2. Click through the welcome screen to the landing page
3. Register as a candidate and as a company (two separate accounts)
4. As a candidate: upload a resume PDF, add skills, browse and favourite a job
5. Start a mock interview — if questions generate and the results page loads, the Anthropic API key is working correctly
6. Check that profile picture upload and crop work on the profile page

---

## Environment Variables

Create `backend/.env` by copying `backend/.env.example`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
SECRET_KEY=your_random_secret_key_here
ADMIN_KEY=your_secret_admin_key_here
```

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Powers all AI features — question generation, answer grading, and candidate-job scoring via Claude |
| `OPENAI_API_KEY` | Yes | Powers text-to-speech audio playback of interview questions |
| `SECRET_KEY` | Yes | Random string used to sign JWT tokens. Use a long random value in production (e.g. `openssl rand -hex 32`) |
| `ADMIN_KEY` | Yes | Secret key for owner-only actions: the scoring check at `/scoring-check`, and removing a test account |

### Production-only variables (set in Vercel dashboard)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string from Neon (e.g. `postgresql://user:pass@host/db`) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token for avatar and resume file uploads |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins (e.g. `https://optima-interview.vercel.app`) |
| `VITE_API_URL` | Backend API base URL used by the frontend build (set as a Vercel environment variable) |
| `VITE_INTERVIEWS_ENABLED` | Set to `true` on the frontend project to let candidates start interviews. Anything else leaves them switched off |
| `VITE_FACE_MODEL_URL` | Optional. Where the camera coach loads its face model from. Defaults to Google's hosted copy; set it to serve your own |
| `CLAUDE_MODEL` | Optional. The Claude model that writes and grades. Defaults to `claude-sonnet-4-6` |
| `GRADER_MODEL` | Optional. A different model for grading than for writing questions. Defaults to `CLAUDE_MODEL` |
| `GRADER_SAMPLES` | Optional. How many times a new answer is rated before the middle rating is kept (default 3; use an odd number). 5 is steadier and costs more; 1 is cheapest |
| `GRADER_PARALLEL` | Optional. How many calls to Claude run at once while an interview is scored (default 6) |
| `SCORING_BUDGET_SECONDS` | Optional. How long one scoring request keeps starting new work before it reports back and the page asks again (default 50). It finishes the step it is on first (four answers, or two roles), so a request can run a little longer than this. If your host stops requests after less than two minutes, set it to `1`: one step a request |
| `MATCH_PRACTICE_INTERVIEWS` | Optional. Set to `0` to stop scoring practice interviews against open roles, which saves one Claude call per open role in the field |

> In development, if `DATABASE_URL` is not set, the backend falls back to a local SQLite file. If `BLOB_READ_WRITE_TOKEN` is not set, uploaded files are saved to a local `backend/uploads/` directory and served as static files.

---

## Deployment

The app is deployed entirely on **Vercel**.

**Frontend** is deployed as a standard Vite/React static site. Vercel builds it with `npm run build` and serves the output.

**Backend** is deployed as a Python serverless function. The entry point is `backend/api/index.py`, which wraps the FastAPI app for the Vercel Python runtime. Every API route runs as a serverless function invocation.

**Database** uses [Neon](https://neon.tech) serverless PostgreSQL. The SQLAlchemy engine is configured with `NullPool` in production to avoid stale connections between serverless invocations.

**File storage** uses Vercel Blob. Uploaded avatars are stored at `avatars/avatar_{user_id}.jpg` and resumes at `resumes/resume_{user_id}.pdf`.

To deploy your own instance:

1. Fork the repository
2. Create a new Vercel project and connect it to your fork
3. Set the root directory to `optima_interview/frontend` for the frontend deployment
4. Create a second Vercel project pointed at `optima_interview/backend` for the API
5. Add all production environment variables in the Vercel dashboard
6. Provision a Neon PostgreSQL database and add the connection string as `DATABASE_URL`
7. Create a Vercel Blob store and add the token as `BLOB_READ_WRITE_TOKEN`

---

## Team Contributions

### Ryan Vandersar — Backend

Ryan designed and built the entire server-side of the platform.

- **Database schema** — Designed all SQLAlchemy models (`User`, `JobPosting`, `InterviewSession`, `InterviewQuestion`, `Match`, `Application`, `Favourite`) and their relationships
- **Authentication system** — JWT-based auth with bcrypt password hashing, role-based access guards (`require_company`, `get_current_user`), and a full password reset flow
- **AI integration** (`claude_client.py`) — Engineered all prompts for Claude: role-specific interview question generation (incorporating company-specified questions with highest priority), per-answer grading, and the multi-factor candidate-job compatibility scoring system
- **Interview engine** (`routers/interviews.py`) — Built the full interview lifecycle: session creation with rate limiting (1 connecting interview per 7 days, 3 mock interviews per day), answer submission, individual answer grading, session scoring, and automatic post-completion match/application creation
- **Matching algorithm** — Implemented the weighted 4-component scoring model (40% interview performance + 35% answer relevance + 10% skills + 15% ATS), the `_create_matches()` flow for mock interviews, and the `_create_applications()` flow for connecting interviews including the 40% score threshold filter
- **Retroactive scoring** — Built the background task that scores the past week's connecting interviews against newly posted jobs, so companies get an immediate applicant pool when they post
- **File handling** — Built the dual-mode file storage system (Vercel Blob in production, local filesystem in development) for avatar and resume uploads, plus PDF text extraction via pdfplumber for ATS scoring
- **Job postings API** — Full CRUD for job postings including candidate count enrichment, active/inactive toggling, and filtering
- **Vercel deployment** — Configured the Python serverless function entry point, PostgreSQL connection pooling for serverless (`NullPool`), and production environment setup

### Rahul Jindal — Frontend

Rahul designed and built the entire client-side experience.

- **Landing page & welcome screen** — Built the cinematic particle-canvas welcome screen with mouse-reactive animation, and the full marketing landing page including the hero section, animated stats bar, features grid, how-it-works steps, and CTA section with scroll-triggered reveal animations
- **Authentication pages** — Built the login and registration flows including the role toggle (candidate vs. company), form validation, and the location autocomplete dropdown for company signup that normalizes location data across ~60 Canadian and US cities
- **Candidate profile editor** — Built the 4-tab profile editor (Contact, About, Resume & Skills, Preferences) with PDF resume upload and in-browser preview, tag-based skill and desired roles input, pay range controls, and all work preference toggles
- **Interview UI** (`InterviewPage.jsx`) — Built the live interview interface with question display, text-to-speech audio playback, answer text areas, session progress tracking, and submission flow
- **Results & scoring pages** — Built the post-interview results page with per-question score breakdowns and feedback display, and the grading rubric reference page for companies
- **Interview Hub** — Built the candidate's session history view showing all past mock and connecting interviews with scores and navigation to results
- **Job board** — Built the candidate-facing job browsing page with industry, location type, hours, level, and salary filters, and favourite toggling with instant UI feedback
- **Company dashboard & applicants** — Built the company job management views including job creation/editing forms with all extended fields, the ranked applicant list with score breakdowns and status controls, and the employer dashboard with the candidate score guide and matching explainer
- **Company profile** — Built the company profile editor with logo upload and the in-browser image crop/zoom modal (reused for candidate avatars)
- **Navbar & auth context** — Built the role-aware persistent navigation and the global authentication context that persists JWT tokens across sessions
- **Design system** — Established the full CSS custom property design system (colors, typography, spacing, shadows, border radii, easing curves) used consistently across all pages
