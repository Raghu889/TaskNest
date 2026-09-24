# TaskNest

A runnable, single-user web app that turns notes, thoughts, and recorded conversations into a task list you control.

## Start in under a minute

Requires **Python 3.11 or newer**. The runtime uses the standard library; there are no packages to install and no frontend build step.

1. Extract this ZIP.
2. Open a terminal in the `tasknest` directory.
3. Run:

```bash
python app.py
```

On Linux/macOS, use `python3 app.py` if necessary. Windows users can also double-click `start.bat`; Linux/macOS users can run `sh start.sh`.

4. Open **http://localhost:8000** in your browser.
5. Click **Try an example**, then **Find tasks**. Select a suggestion, edit its details, and click **Add selected tasks**.

Keep the terminal running. Press Ctrl+C to stop the app. Data survives restarts in `data/tasknest.sqlite3`. Start one server process per database.

## What is implemented

- Typed notes and pasted transcripts, with draft recovery in browser local storage.
- Save notes without extracting tasks.
- Conservative basic task extraction without an API key.
- Optional AI summaries, task suggestions, subtasks, and supporting quotes.
- Review screen: select only the tasks you want, edit titles/details/subtasks, choose priorities, effort estimates, and due dates.
- Transactional, duplicate-safe approval. Unselected suggestions remain attached to the original note.
- Manual tasks, task editing, completion, cancellation, search, and status filters.
- Persistent subtask checkboxes and source-note links.
- Microphone recording, pause/resume, playback, audio download, and file upload.
- Optional post-recording transcription through an OpenAI-compatible provider.
- Start/pause task timers, effort-budget check-ins, and add-more-time controls.
- Deadline reminders, one-hour snoozing, daily summaries, and a notification inbox.
- Optional browser notifications and optional SMTP email delivery.
- JSON export of notes and tasks, responsive interface, keyboard-operable forms, and native modal focus behavior.

## AI and transcription setup

Copy `.env.example` to `.env` in the project directory:

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
AI_API_KEY=your_provider_key
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
TRANSCRIPTION_MODEL=whisper-large-v3-turbo
```

Restart the server. In Capture, enable **Use AI extraction**. Recorded/uploaded audio can now be sent with **Transcribe audio**. Transcription appends editable text to the current note; click **Find tasks** afterward.

The default integration targets Groq's documented OpenAI-compatible endpoints. Provider availability, model access, pricing, and quotas depend on your account. Other providers require compatible `/chat/completions` JSON-object mode and `/audio/transcriptions` endpoints, and appropriate model names. The server requires HTTPS for provider URLs.

The provider key stays on the backend. Choosing AI extraction sends the note body to the provider. Choosing transcription sends the selected audio. Obtain permission from everyone before recording. The app does not upload recordings automatically, store audio on disk, or capture system audio from a remote meeting. Microphone input captures what the microphone can hear.

### Basic mode versus AI mode

Basic mode recognizes English verb-led actions such as “Test the login flow”, “We need to update the release notes”, and “I'll schedule a meeting”. It does not provide semantic understanding, infer complex subtasks, or reliably interpret arbitrary conversation. It marks extracted items as suggestions. No actions are invented to fill an empty list.

AI mode produces structured suggestions and validates their supporting quotes against the supplied note. Invalid output produces a visible error without clearing the draft. Dates mentioned in a note stay in the task description: users explicitly set dates during review to avoid ambiguous timezone or relative-date assumptions. All extracted tasks require user approval.

## Reminder behavior

| Setting/action | Behavior |
| --- | --- |
| Estimated effort | Work budget in minutes. Zero means unspecified. It does not create a deadline. |
| Start timer | Starts elapsed work time. It continues across page closure and server restarts until paused or the task leaves “in progress”. |
| Pause timer | Saves elapsed work; does not mark the task complete. |
| Effort reached | Creates one check-in per effort-budget version while the timer is running. |
| Add 15 min effort | Extends the budget to at least elapsed time plus 15 minutes. |
| Due date/time | Creates one overdue reminder when reached, unless the task is completed/cancelled. |
| Snooze reminders 1h | Suppresses new deadline/effort reminders for one hour, then permits another reminder. Existing inbox entries remain visible. |
| Daily summary | Once per configured local day at or after the chosen time. Includes pending/overdue/unscheduled counts and up to 30 task names. |
| Completed overall | The summary's completed count is a lifetime total, not a completion count for today. |

The worker checks every 15 seconds. Browser tabs fetch new notifications every 15 seconds, so display can lag by about 30 seconds. Set the daily time and timezone in Settings. Default: 18:00, Asia/Kolkata. The UTC offset fallback helps systems without IANA timezone data, including some Windows installations. If using fallback, update it yourself when daylight saving changes; alternatively install `tzdata` for Python timezone support.

If the server is stopped or the computer is asleep, reminders cannot be sent. On restart, overdue tasks are checked and today's summary is generated if its time has passed; summaries for missed prior days are not replayed. Timers measure wall time, so a running timer includes computer sleep time. Pause timers when you stop working.

Browser notifications need permission and this page open. The inbox works without notification permission. This project does not implement background Web Push or mobile push.

## Optional email

Configure `.env` with your mail provider's SMTP details:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_username
SMTP_PASSWORD=your_app_password
SMTP_FROM=your_verified_sender@example.com
SMTP_SECURITY=starttls
```

Use `SMTP_SECURITY=ssl` and your provider's SSL port (often 465) when appropriate. Plaintext SMTP is not supported. Restart the server, then enter the recipient address and enable email in Settings. No email is sent by default.

An email contains the notification title and body, including relevant task names. The worker attempts unsent, unread notifications created in the last 24 hours, up to five times with at least five minutes between attempts. Enabling email may deliver unread recent reminders already in the inbox. Reading an item before delivery suppresses that pending email. Sent status and exhausted retries appear in Notifications. Check the terminal for configuration failures.

The outbox persists across restarts. A process crash after SMTP accepts a message but before the database is updated can result in a duplicate email on retry; SMTP does not provide exactly-once delivery. Stable Message-ID values are included.

## Files

| Path | Purpose |
| --- | --- |
| `app.py` | HTTP API, SQLite persistence, extraction/transcription adapters, timer logic, reminder worker, SMTP outbox |
| `static/index.html` | Application views and forms |
| `static/style.css` | Responsive styling |
| `static/app.js` | Client state, task review, recording, timers, notifications |
| `tests/test_app.py` | Backend integration and reminder tests |
| `.env.example` | Optional AI and SMTP configuration |
| `start.bat`, `start.sh` | Startup helpers |
| `data/tasknest.sqlite3` | Created automatically on first run; not shipped |

## Architecture and API

The browser talks only to the same-origin Python server. Python stores records in SQLite and calls the configured AI/SMTP providers only for opted-in features. A background worker handles notifications independently of the page.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/state` | GET | Notes, tasks, preferences, notification inbox, configured capabilities |
| `/api/export` | GET | Portable JSON export |
| `/api/notes` | POST | Save a note, optionally extract suggestions |
| `/api/approve` | POST | Atomically approve selected suggestions |
| `/api/task` | POST | Create/update a task |
| `/api/timer` | POST | Start/pause a task timer |
| `/api/snooze` | POST | Snooze a task's reminders |
| `/api/transcribe` | POST | Raw audio body, forwarded as provider multipart upload |
| `/api/settings` | POST | Save preferences |
| `/api/notifications/read` | POST | Mark one/all inbox items read |

Mutation requests must include `X-TaskNest: 1`. Requests are restricted to the local server's localhost/127.0.0.1 host and same origin. Static routes are allowlisted, task input is validated, and rendered user text is escaped. AI output never executes code or triggers external task actions.

## Tests

From the project directory:

```bash
python -m unittest discover -s tests -v
```

Tests use temporary databases and mocked provider/SMTP calls. They do not send email or incur AI usage. See `TESTING.md` for the validation performed and untested external services.

## Backups and scope

Stop the server before copying `data/tasknest.sqlite3` to a safe location. To restore, stop the server and replace that database file with the backup. JSON export is for portability; there is no import UI.

This is a local, single-user MVP, not a multi-tenant hosted service. It has no login, account separation, encryption at rest, calendar integration, speaker diarization, real-time streaming transcription, or automatic recording of meeting apps. Recordings stay in memory until the tab is closed; download important audio. Drafts also exist in browser local storage. Use device access controls for private notes. Do not expose this server to a public network; it binds to 127.0.0.1 intentionally.

Audio is limited to 24 MB per transcription request; notes are limited to 60,000 characters and extraction to 40 suggestions. Longer meetings need splitting or externally prepared transcripts. No long-audio chunking is implemented. Frontend lists load all records, which is suitable for a personal MVP rather than very large archives.

A deployment-ready version would need user accounts, a production application server, managed storage, a dedicated worker, monitored delivery, and background push if notifications must work while devices are off.

## Provider references

Integration contracts checked against the official documentation:

- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/api-reference
- https://console.groq.com/docs/structured-outputs
