# MachineMD bug log

Every bug below was found during my own testing in headless Chrome (desktop 1440 px and mobile 390 px, light and dark), screenshotted at the moment it happened, fixed, re-tested and screenshotted again. Screenshots are in [`screenshots/`](screenshots/).

| ID | Page / endpoint | Severity | Status | Before | After |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | Dashboard and Reports, mobile | Medium | Fixed | `BUG-01-dashboard-mobile-horizontal-overflow.png` | `BUG-01-fixed.png` |
| BUG-02 | Machines list, search box | High | Fixed | `BUG-02-machines-search-drops-typed-characters.png` | `BUG-02-fixed.png` |
| BUG-03 | All forms in dialogs (maintenance, machine, user, retrain) | High | Fixed | `BUG-03-maintenance-form-loses-focus-while-typing.png` | `BUG-03-fixed.png` |
| BUG-04 | Machines list (and other tables), last rows | Low | Fixed | `BUG-04-toast-covers-last-row-actions.png` | `BUG-04-fixed.png` |
| BUG-05 | Login after sign-out | Low | Fixed | `BUG-05-signin-after-logout-returns-to-previous-page.png` | `BUG-05-fixed.png` |
| BUG-06 | What-if simulator / `POST /api/whatif` | High | Fixed | `BUG-06-whatif-disagrees-with-live-prediction.png` | `BUG-06-fixed.png` |

## BUG-01: Page scrolls sideways on mobile (Dashboard, Reports)

- **Steps:** sign in as admin at 390 px width, open the Dashboard (or Reports).
- **Expected:** the page fits the screen; no horizontal scrolling.
- **Actual:** the page was 407 px wide on a 390 px screen (17 px overflow; 23 px on Reports). The health-trend chart card and the recent-alerts card stuck out past the right edge.
- **Cause:** CSS grid items default to `min-width: auto`, so a Recharts container or a long no-wrap line forced the single mobile column wider than the viewport.
- **Fix:** `.grid > * { min-width: 0 }` in `frontend/src/index.css`.
- **Re-test:** horizontal overflow is 0 px on all 11 pages at 390 px (acceptance check RS1).

## BUG-02: Machine search drops typed characters

- **Steps:** Machines page, type `compressor` quickly into the search box.
- **Expected:** the box shows `compressor` and the table shows the 7 compressors.
- **Actual:** the box showed `or` and the table 17 rows.
- **Cause:** every keystroke was written straight into the URL (`?q=`), and the input read its value back from the URL. With fast typing the router update lagged and characters were lost.
- **Fix:** the input keeps its own state and syncs to the URL after a 250 ms pause; URL updates use functional `setParams` so filters never overwrite each other (`frontend/src/pages/Machines.jsx`).
- **Re-test:** typed `compressor` → box `compressor`, 7 rows (acceptance check M3).

## BUG-03: Form dialogs lose focus while typing, and the dialog closes

- **Steps:** Maintenance log → **Log maintenance**, click into *Issue*, type `Bearing noise`.
- **Expected:** the text appears in the Issue field.
- **Actual:** after the first character focus jumped to the dialog's close (×) button; the space in `Bearing noise` then "clicked" it and the dialog closed, losing the input.
- **Cause:** the `Modal` focus effect depended on the parent's inline `onClose` function, so it re-ran on every keystroke and re-focused the first focusable element, which was the header close button.
- **Fix:** the effect now runs only when the dialog opens; `onClose` is held in a ref; initial focus goes to the first form field in the body and is skipped if the user already clicked inside (`frontend/src/components/feedback.jsx`). This fixes every dialog in the app.
- **Re-test:** typed text stays in the field and focus stays put (flow checks F2–F8, acceptance AL3/MT2).

## BUG-04: Toast message covers the Edit/Delete buttons of the last table rows

- **Steps:** add a machine (it appears as the last row), then click its Edit button while the success toast is still showing.
- **Expected:** the edit form opens.
- **Actual:** nothing happened. The click landed on the toast fixed at the bottom-right, which covered the row's action buttons.
- **Fix:** extra bottom padding (`pb-28`) on the main content area, so the last rows can always be scrolled clear of the toast stack (`frontend/src/components/Layout.jsx`).
- **Re-test:** the Edit button on the newly added last row opens the form (flow check F4).

## BUG-05: After signing out, the next sign-in lands on the previous user's last page

- **Steps:** sign in, open Settings, click **Sign out**, sign in again (as anyone).
- **Expected:** a fresh sign-in starts on the Dashboard.
- **Actual:** it went back to `/settings`, the previous session's page. For a shared screen that is surprising and leaks navigation context.
- **Fix:** the "return to where you were" redirect is only remembered when a session *ends unexpectedly* (expired token, deep link). A deliberate sign-out clears it (`frontend/src/lib/auth.jsx`, `frontend/src/App.jsx`).
- **Re-test:** sign-out → sign-in lands on `/`, and an expired session still returns to the requested page (flow checks F12, F14).

## BUG-06: What-if simulator disagrees with the machine's live prediction

- **Steps:** What-if → *Start from a machine* → **ACU-007** (live prediction 61 %, High). Do not move any slider.
- **Expected:** the gauge shows the same 61 % High, because nothing has changed yet.
- **Actual:** the gauge showed **14 % Low**. The simulator scored the latest values as a flat steady state and ignored the rising trend over the last 7 readings, which is exactly what the live model reacts to. In 8 of 30 machines the result differed noticeably; a user could think a High-risk machine was fine.
- **Fix:**
  1. With a machine selected, the simulator now sends `mode: "trend"`. The API scores the slider values as the machine's newest reading after its previous 6 real readings: the simulated reading *replaces* the newest one, not appends to it (`backend/ml/serve.py: window_with_current`, `backend/app/routers/whatif.py`).
  2. Slider defaults keep 3 decimals so unchanged values are exact.
  3. Machine-type mode keeps the documented steady-state behaviour.
- **Re-test:** for all 30 machines, unchanged sliders match the live probability within 0.002. Raising temperature or vibration is still monotonic. Added the regression test `test_whatif_machine_matches_live_prediction`.

## Other observations (not bugs)

- The first version of my own test harness treated deliberate 4xx responses (wrong-password test, viewer write probes) as console errors. I changed the harness, not the app: 4xx are now tracked separately and every one must be an intentional negative test (acceptance check E2).
- No issues remain open from local testing. The live-site results are added after deployment.
