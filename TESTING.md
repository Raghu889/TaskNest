# Validation report

## Passed in the build environment

- Python compilation (`python -m py_compile app.py`).
- JavaScript syntax (`node --check static/app.js`).
- 13 automated backend tests (`python -m unittest discover -s tests -v`):
  1. Selected-only, duplicate-safe suggestion approval.
  2. Atomic rollback of an invalid approval batch.
  3. Overdue notification deduplication and completed-task suppression.
  4. Effort estimates do not become deadlines at task creation.
  5. Timer elapsed time, pause behavior, and effort notification deduplication.
  6. Snooze suppression and reminder rearming.
  7. Once-per-local-day digest behavior.
  8. Input validation, cross-origin rejection, and local Host restrictions.
  9. SQLite persistence and completed subtasks.
  10. AI response validation and rejection of unsupported evidence (mocked provider).
  11. Audio multipart request construction (mocked provider).
  12. Email disabled by default.
  13. Successful email outbox delivery marked once (mocked SMTP).
- HTTP smoke checks for the HTML, CSS, JavaScript, favicon, and state endpoint.
- Static checks for client references to HTML element IDs.

## Not verified here

A headless browser launch was attempted, but the browser binary was unavailable and its download failed. Therefore rendered layout, browser notification delivery, real microphone recording, and end-to-end browser interactions were not validated in this environment.

No provider key or SMTP account was supplied. Real AI extraction, speech transcription, and email delivery are implemented but were not exercised against live services. No messages were sent. Provider errors are surfaced to the user.

## Manual acceptance checklist

1. Launch the app, choose Try an example, and select Find tasks.
2. Select one suggestion, enter 30 minutes and a due date, add two subtasks, and approve it. Confirm only that task appears in My tasks.
3. Revisit the source note and confirm the selected suggestion is marked added while the others remain available.
4. Edit the title and subtasks. Reload the page and confirm persistence.
5. Start and pause a timer; verify elapsed time persists. Complete the task and confirm it no longer receives new reminders.
6. Create a task with a past deadline, wait up to 30 seconds, and check Notifications. Wait another minute; confirm no duplicate event. Snooze and confirm a new reminder becomes possible after one hour.
7. Set the daily summary to a time already passed today. Confirm one summary appears. Further checks that day must not create duplicates.
8. Allow microphone permission; record, pause, resume, stop, play back, and download a recording.
9. With AI configured, transcribe a short recording, review/edit the transcript, then extract tasks. Test an invalid API key and confirm a visible error without clearing the input.
10. Configure SMTP, explicitly enable email, create a new overdue task, and confirm delivery and the inbox's sent status.
11. Enable browser notifications and keep the tab open. Confirm a new reminder appears as a system notification if supported by the browser/OS.
12. Check the Capture, Tasks, Review, Settings, and modal views on a narrow phone viewport and at 200% zoom. Use Tab and Enter to navigate controls.

The backend is intentionally local and single-user. Do not use this as a publicly exposed service without a separate authentication and deployment design.
