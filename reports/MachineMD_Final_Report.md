# MachineMD — Final Report

**Predictive maintenance web application · Version 1.0.0 · 23 November 2026 · Built by Divya Priyadharshini**

| | |
| --- | --- |
| GitHub repository | https://github.com/DIVYAPRIYADHARSHINI-GIT/machinemd (public, branch `main`) |
| Live site | **https://machinemd.vercel.app** (Vercel Hobby, one project, deployed from `main`) |
| Demo logins | Admin `admin@machinemd.com` / `Admin@123` · Viewer `viewer@machinemd.com` / `Viewer@123` |
| Test status | **Live site:** 65/65 acceptance + 15/15 flow checks · **Local / fresh clone / 2-instance simulation:** 65/65 + 15/15 · 34/34 pytest · 8 bugs found and fixed (2 only on the live site), 0 open |

---

## 1. Project summary

MachineMD predicts which machines (pumps, motors, compressors, AC units) are likely to fail soon, from six sensor readings. For each machine it shows:
- the probability of failure within 7 days,
- a 0–100 health score and a Low / Medium / High risk level,
- the remaining useful life in days,
- whether the current sensor pattern is anomalous,
- the sensors that drive the risk.

Admins upload data, retrain and switch models, manage machines and users, and keep the maintenance log. Viewers can see everything but change nothing.

**Tech stack**
- *Frontend:* React 19 + Vite 8 + Tailwind CSS 4, React Router 7, Recharts 3, jsPDF (PDF report in the browser).
- *Backend:* Python 3.12, FastAPI, SQLAlchemy 2 with a file-based SQLite database, numpy, scikit-learn 1.7.2, joblib, bcrypt, PyJWT. No pandas, SHAP, TensorFlow or PyTorch.
- *Deployment:* one Vercel project. The static Vite build plus the FastAPI app run as a single Python serverless function under `/api`.
- *Everything is free:* no external APIs, no API keys.

**Folder structure**

```
machinemd/
├── api/index.py               Vercel entrypoint (imports the FastAPI app)
├── vercel.json                build command, output dir, rewrites, function config
├── requirements.txt           trimmed runtime dependencies for the function
├── backend/
│   ├── app/                   main.py, routers/ (12), services/ (bootstrap, registry, predictions), models.py, security.py, sync.py
│   ├── ml/                    config, generator, features, dataset (labels + split), train, serve (+ explanations)
│   ├── scripts/seed_and_train.py
│   ├── data/                  machinemd.db, models/machinemd-v1.joblib, machinemd-v2.joblib, metrics.json  (committed)
│   └── tests/                 test_api.py, test_selfheal.py, test_multi_instance.py
├── frontend/src/              pages/ (12), components/, lib/
├── e2e/                       acceptance.mjs, flows.mjs, screenshots.mjs, coldstart.mjs …
├── docs/screenshots/          README images
└── reports/                   this report, BUG_LOG.md, screenshots/, evidence/
```

## 2. Features completed — asked vs built

| Requirement | Built | Where |
| --- | --- | --- |
| React + Vite + Tailwind + React Router + Recharts | ✅ | `frontend/` |
| FastAPI, numpy, scikit-learn, joblib, SQLAlchemy + SQLite, JWT + bcrypt | ✅ | `backend/` |
| No SHAP / TF / PyTorch; no pandas | ✅ | `requirements.txt` |
| `/frontend` and `/backend` in one repo | ✅ | repo root |
| One Vercel project and URL; static build + Python function under `/api` | ✅ | `vercel.json`, `api/index.py` |
| Pre-trained models + seeded SQLite committed; DB copied to `/tmp` on cold start | ✅ | `backend/data`, `app/db.py` |
| Admin and Viewer roles, both demo users seeded | ✅ | `services/bootstrap.py` |
| Synthetic generator: 30 machines, 4 types, ~90 days, 6 sensors, realistic failures, noise, 5–8 % failure class | ✅ 7.4 % | `ml/generator.py` |
| CSV upload with column mapping, validation, preview, per-row errors, template, row limit | ✅ 2,000 rows / 512 KB | `routers/readings.py`, Data page |
| `python backend/scripts/seed_and_train.py` writes DB, models and metrics | ✅ ~19 s | `scripts/` |
| Self-healing if the DB or model file is missing | ✅ tested | `services/bootstrap.py`, `test_selfheal.py` |
| Rolling mean / std / slope over 7 readings + raw values | ✅ 24 features | `ml/features.py` |
| Random Forest vs Gradient Boosting, class imbalance handled, time-based split | ✅ | `ml/train.py`, `ml/dataset.py` |
| Health score 0–100, risk Low/Medium/High, admin-editable thresholds | ✅ | Settings page |
| RUL with a Random Forest Regressor | ✅ | `ml/train.py` |
| Isolation Forest anomaly detection | ✅ | anomaly points on charts |
| Global feature importance + per-machine what-if explanations | ✅ | Model Lab, machine detail |
| Accuracy, precision, recall, F1, ROC-AUC, confusion matrix, ROC and PR curves per model, saved with the version | ✅ | `metrics.json`, Model Lab |
| Model registry: version, timestamp, metrics, data size; compare; activate | ✅ | Model Lab |
| Light in-app retrain (seconds, saved to `/tmp`, reset note) | ✅ ~3 s | Model Lab |
| Single, batch and latest-per-machine prediction endpoints | ✅ | `routers/predictions.py` |
| Auth (login, logout, me, change password, JWT expiry) | ✅ | `routers/auth.py` |
| Machines CRUD, readings list/add/bulk, maintenance CRUD, alerts + acknowledge | ✅ | routers |
| Logging maintenance on a high-risk machine handles its alert | ✅ | `handle_alerts_for_machine` |
| Dashboard summary, activity log, CSV export, PDF report, `/api/health` | ✅ | routers, Reports page |
| Validation, proper status codes, centralised errors, login rate limit, CORS | ✅ | `main.py`, `security.py` |
| 11 frontend pages incl. "Waking up the server" message | ✅ 12 incl. 404 | `frontend/src/pages` |
| Sidebar, top bar, responsive, light/dark, skeletons, empty states, toasts, confirm dialogs | ✅ | components |
| Viewer: edit actions hidden in UI and blocked in the API | ✅ | checks V1–V11 |
| In-app note that Vercel storage is temporary | ✅ | banner, Model Lab, Settings |
| Live site, one URL, tested end to end | ✅ https://machinemd.vercel.app | section 7, 10 |
| Consistent data across Vercel's parallel serverless instances | ✅ (added after live testing, BUG-07/08) | `app/sync.py` |

<div class="pair">
<figure><img src="screenshots/working/01-login.png"><figcaption>Login page with demo accounts</figcaption></figure>
<figure><img src="screenshots/working/01b-login-waking-up.png"><figcaption>"Waking up the server, please wait..." during a slow (simulated cold-start) sign-in</figcaption></figure>
</div>

## 3. ML details

**Dataset.** Generated by `backend/ml/generator.py` (numpy, fixed seed 42, nothing downloaded).
- **Fleet:** 30 machines (8 pumps, 8 motors, 7 compressors, 7 AC units) at 5 locations, with readings every 6 hours for 90 days. That is 10,696 readings and 26 recorded failures.
- **Sensors:** temperature (°C), vibration (mm/s), pressure (bar), RPM, running hours since the last service (h) and current draw (A). Each machine type has its own normal operating point.
- **Failure patterns** (realistic, before each failure):
  - gradual wear: temperature and vibration climb over 7–16 days, current rises, pressure and RPM sag;
  - fast faults: only 2–4 days of warning;
  - electrical faults: mostly current and temperature;
  - cooling faults: mostly temperature.
- **Noise and confounders:** a load random-walk, a daily temperature cycle, per-machine calibration offsets, harmless hot spells, sensor glitches, running-hour resets at services, and a ~1-day repair gap after each failure.
- **Class balance:** 7.4 % of labelled readings fall within 7 days of a failure.
- **Machines failing now:** eight machines are degrading towards failures that lie *after* the data ends, so the live dashboard has genuinely risky machines. Those future failures are never stored.

**Features (24).** For each sensor, over the current and previous 6 readings of the same machine: the raw value, rolling mean, rolling standard deviation and least-squares slope. Values are normalised as a deviation from the machine type's normal point (running hours ÷ 1,000), so one model serves all four types.

**Labels.**
- `failure within 7 days` (classification);
- `days to next failure, capped at 14` (RUL regression).

**Models and training method**
- *Random Forest classifier:* 200 trees, depth 12, `class_weight="balanced_subsample"`, monotonic constraints. Its probabilities are calibrated with a logistic fit on **out-of-bag** predictions, because class weights inflate raw probabilities and would make the health score dishonest.
- *Gradient Boosting classifier:* scikit-learn `HistGradientBoostingClassifier`, 250 iterations, `class_weight="balanced"`, the same monotonic constraints.
- *RUL:* Random Forest Regressor, 120 trees, with the opposite monotonic constraints.
- *Anomaly detector:* Isolation Forest (contamination 2 %) fitted on healthy training readings.
- *Monotonic constraints:* hotter, shakier, higher current, lower pressure/RPM or a more erratic signal can never lower the risk. This keeps the what-if simulator physically sensible.
- *Light retrain:* the same pipeline with fewer trees, taking about 3 s.

**Leakage control**
1. Features never look ahead: only the current and previous 6 readings are used.
2. The split is **chronological** and shared by all machines. The test set is the last 30 % of the timeline; the training set is everything more than **7 days before** the cutoff. The gap equals the label horizon, so no training label depends on test-period failures.
3. Readings near the end of the data whose outcome is unknown are **censored** (796 rows unlabelled) instead of being labelled healthy.
4. Calibration uses out-of-bag predictions only, never test data.

The resulting metrics are informative but not perfect (ROC-AUC 0.92–0.94; recall 0.66–0.70). That is the expected range for this noisy data and confirms there is no leakage.

**Class imbalance.** Class weights in both classifiers. An ablation with class weights switched off lowered the Random Forest's F1 from 0.73 to 0.69 and PR-AUC from 0.81 to 0.77, so the weights are kept. Accuracy is never used to choose a model: the do-nothing baseline already scores 0.902.

**Explainability without SHAP**
- *Global:* impurity importance (Random Forest) and permutation importance (Gradient Boosting, drop in PR-AUC).
- *Local what-if:* for one machine, each sensor in turn is reset to its normal value across the 7-reading window and the model is re-run. The drop in failure probability is that sensor's contribution. All 1 + 6 variants are scored in one call, which takes about 18 ms.

## 4. Model results (real numbers)

**Test set:** 2,404 readings from the held-out future period (27 Oct – 19 Nov), 235 of them within 7 days of a failure (9.8 %). Threshold 0.5.

All numbers come from `backend/data/metrics.json`, written by `seed_and_train.py`. The same numbers are shown in the Model Lab.

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC | PR-AUC | TP | FP | FN | TN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Random Forest (v1, serving)** | 0.965 | **0.969** | 0.660 | **0.785** | 0.921 | **0.824** | 155 | 5 | 80 | 2,164 |
| Gradient Boosting (v2) | 0.953 | 0.800 | **0.698** | 0.746 | **0.936** | 0.803 | 164 | 41 | 71 | 2,128 |
| Always "no failure" baseline | 0.902 | 0 | 0 | 0 | 0.500 | 0.098 | 0 | 0 | 235 | 2,169 |

| Other models | Result |
| --- | --- |
| RUL (Random Forest Regressor) | MAE **1.34 days** vs 2.33 days for a constant guess; RMSE 2.50; R² 0.58; MAE 4.37 days on readings within 14 days of a failure |
| Anomaly detector (Isolation Forest) | Flags **18.7 %** of readings in the week before a failure vs **2.2 %** of healthy readings |
| Global sensor importance (Random Forest) | vibration 38.8 % · temperature 26.4 % · running hours 16.8 % · current 11.1 % · pressure 4.2 % · RPM 2.6 % |

<div class="pair">
<figure><img src="screenshots/working/06c-model-lab-confusion-matrices.png"><figcaption>Confusion matrices on the test period</figcaption></figure>
<figure><img src="screenshots/working/06f-model-lab-feature-importance.png"><figcaption>Global feature importance (serving model, by sensor)</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/working/06d-model-lab-roc-curve.png"><figcaption>ROC curves: RF AUC 0.921, GB AUC 0.936</figcaption></figure>
<figure><img src="screenshots/working/06e-model-lab-pr-curve.png"><figcaption>Precision-recall curves: RF AP 0.824, GB AP 0.803</figcaption></figure>
</div>

**Final model choice: Random Forest (v1).**
- It has the best F1 (0.785) and PR-AUC (0.824), the two metrics that matter for a rare failure class.
- At the operating threshold it raises only 5 false alarms in 2,169 healthy readings (precision 0.97). Alarm fatigue is the main reason maintenance teams stop trusting such systems.
- Gradient Boosting ranks slightly better overall (ROC-AUC 0.936) and catches 9 more failure-window readings, but at the cost of 36 more false alarms.
- Both are shipped as registry versions, so an admin can switch to Gradient Boosting in one click. Activating it re-scores all machines (check ML3).

## 5. API list

All routes are under `/api`. Interactive docs: `/api/docs`. "Any" = any signed-in user (admin or viewer).

| Method | Path | Access |
| --- | --- | --- |
| GET | `/health` | Public |
| POST | `/auth/login` (rate limited) | Public |
| POST | `/auth/logout` · GET `/auth/me` · POST `/auth/change-password` | Any |
| GET, POST | `/users` · PUT, DELETE `/users/{id}` | Admin |
| GET | `/machines`, `/machines/meta`, `/machines/{id}` | Any |
| POST · PUT, DELETE | `/machines` · `/machines/{id}` | Admin |
| GET | `/readings`, `/readings/template`, `/readings/sensors` | Any |
| POST | `/readings` · `/readings/upload` | Admin |
| GET | `/predictions/latest`, `/predictions/machine/{id}`, `/predictions/machine/{id}/history` | Any |
| POST | `/predictions/single`, `/predictions/batch` | Any |
| POST | `/predictions/refresh` | Admin |
| GET | `/models`, `/models/active`, `/models/{v}/metrics`, `/models/{v}/feature-importance` | Any |
| POST · DELETE | `/models/{v}/activate`, `/models/retrain` · `/models/{v}` | Admin |
| GET · POST | `/whatif/defaults` · `/whatif` | Any |
| GET | `/maintenance` | Any |
| POST · PUT, DELETE | `/maintenance` · `/maintenance/{id}` | Admin |
| GET · POST | `/alerts` · `/alerts/{id}/acknowledge` | Any · Admin |
| GET | `/dashboard/summary`, `/reports/summary`, `/reports/export/{kind}`, `/settings`, `/activity` | Any |
| PUT | `/settings/thresholds` | Admin |
| POST | `/admin/reset-demo` | Admin |

**Errors** use one JSON shape, `{"detail", "code"}`, with the correct status: 400, 401, 403, 404, 409, 413, 422 (with per-field errors), 429 (with `Retry-After`) and 503.

**Login rate limit:** 5 failed attempts per 5 minutes, per IP and per e-mail.

**CORS:** restricted to configured origins. Same-origin on Vercel needs none.

## 6. Database design

SQLite, 11 tables, defined with SQLAlchemy in `backend/app/models.py`. The seeded file holds:

| Table | Key columns | Relations | Seeded rows |
| --- | --- | --- | --- |
| `users` | email (unique), name, role (admin/viewer), password_hash (bcrypt), is_active, last_login_at | — | 2 |
| `machines` | code (unique), name, type, location, install_date, status, alert_suppressed_until | parent of readings, failures, predictions, alerts, maintenance | 30 |
| `readings` | machine_id, timestamp, temperature, vibration, pressure, rpm, running_hours, current, source | → machines (cascade); index (machine_id, timestamp) | 10,696 |
| `failure_events` | machine_id, timestamp, mode, source | → machines | 26 |
| `predictions` | machine_id, reading_time, model_version, failure_probability, health_score, risk_level, rul_days, anomaly, anomaly_score, contributions (JSON), is_latest | → machines | 2,697 |
| `alerts` | machine_id, prediction_id, risk_level, failure_probability, message, status (Open/Acknowledged/Handled), acknowledged_by/at, handled_at, maintenance_id | → machines, → predictions, → maintenance_logs | 31 |
| `maintenance_logs` | machine_id, issue, action_taken, cost, date, technician, status, created_by | → machines, → users | 39 |
| `model_versions` | version (unique), file_name, created_at, mode (full/light), primary_model, train_rows, test_rows, summary (JSON: metrics, curves, importance, data stats), is_active, is_bundled | ↔ joblib file on disk | 2 |
| `settings` | key, value (JSON), e.g. risk thresholds | — | 1 |
| `activity_logs` | created_at, user_email, action, entity, entity_id, detail | — | 1 |
| `revoked_tokens` | jti, expires_at (logout denylist) | — | 0 |

Logging maintenance on a machine with an open alert does three things: it sets the alert to **Handled**, links it to the maintenance record, and sets `machines.alert_suppressed_until` to the newest reading. That way re-scoring the same readings does not re-raise the alert; only a newer risky reading does.

## 7. Testing summary

**Test suites**
- **pytest (34 tests):** auth, rate limit, viewer 403 on 15 write endpoints, ML acceptance, what-if monotonicity for all 4 machine types, upload with bad rows, retrain/activate, the alert → maintenance flow, dashboard consistency, exports, timing, self-heal with a missing DB and with missing model files, a check that the seed DB is never modified, and **3 multi-instance tests** that start two real uvicorn processes with separate data folders (like two Vercel instances): changes and sign-out reach the second instance, and forged journal entries are rejected.
- **Headless-Chrome acceptance (65 checks)**, run 4 ways:
  - against the **live site** https://machinemd.vercel.app: **65/65**;
  - against the local dev servers: 65/65;
  - against two isolated local instances behind a round-robin proxy (simulating Vercel): 64/64 (before the MT1b check was added);
  - against a fresh clone from GitHub: 64/64 (same suite, before BUG-07/08).
- **Flow checks (15):** theme, machine CRUD, single reading, batch prediction, confirm dialog, users, thresholds, PDF content, password change, logout revocation on every instance, expired session, 404. **15/15 on the live site** and 15/15 locally.
- **Live multi-instance probes:**
  - after a retrain, 12/12 parallel requests see the new version;
  - after Reset demo, 12/12 report the seed's 10,696 readings;
  - after sign-out, 0/12 accept the old token.
- **Vercel build:** the local `vercel build` completes and produces one `python3.12` function that includes `backend/data`.

| Acceptance check | Evidence | Result |
| --- | --- | --- |
| Login works for both roles; the viewer cannot modify anything | L3, L4, V1–V11 (UI hides 9 kinds of edit control; API returns 403 for 8 write calls), pytest `test_viewer_cannot_modify_anything` | **Pass** |
| Pre-trained model loads, predictions appear, metrics are real (leakage checked) | H1, P1–P5: ROC-AUC 0.921/0.936, recall < 0.99, confusion matrix sums to the test size, train ends before test | **Pass** |
| Light retraining creates a new version and activating it changes predictions | ML2 (v3 created in 3.1 s), ML3 (all 30 machines re-scored, predictions changed) | **Pass** |
| What-if: higher temperature and vibration raise risk; health and RUL update correctly | W1–W5; pytest monotonic test for all 4 types; trend mode monotonic on real machines | **Pass** |
| CSV upload with a bad row shows a clear error and loads the valid rows | C1–C5: line 3 "Temperature must be a number (got 'abc')", line 5 "Unknown machine code 'ZZZ-999'"; exactly 2 valid rows imported | **Pass** |
| A high-risk machine shows an alert, and logging maintenance handles it | AL1–AL4: acknowledge → log maintenance → status Handled, open alerts −1 | **Pass** |
| Dashboard numbers match the data | D1–D5: every KPI recomputed from the machines and alerts APIs | **Pass** |
| Every API call finishes within Vercel's time limit | T1 **live**: slowest read 1.1 s (5,000-row CSV export), all other reads 0.27–0.54 s including network from India to the iad1 region; light retrain 6.1 s on Vercel (~3 s locally); limit 60 s | **Pass** |
| Runs from a clean clone with the README steps | Fresh `git clone` from GitHub → `pip install` → `npm ci` → pytest 30/30 → build → acceptance 64/64 | **Pass** |
| Works when started the way Vercel starts it (read-only filesystem except `/tmp`) | Imported `api/index.py` from a `chmod -R a-w` copy of the repo: DB copied to `/tmp`, retrain wrote `/tmp/.../models/v3`; `test_seed_files_untouched`; self-heal tests | **Pass** |
| Responsive (mobile), light and dark mode, no console errors | RS1 (0 px overflow on 11 pages at 390 px, dark), E1 (0 console errors / 5xx), E2 (only deliberate 4xx) | **Pass** |
| Live site end to end (admin and viewer login, prediction, what-if, alerts, reports) | https://machinemd.vercel.app: acceptance 65/65, flows 15/15, 31 live screenshots, no console errors (E1) | **Pass** |

## 8. Bug log

All 8 bugs were found during my own browser testing and screenshotted when they happened. BUG-01 to BUG-06 were found locally; BUG-07 and BUG-08 only appeared on the live site. Each was fixed, re-tested and screenshotted again. Full steps, expected and actual results are in [`BUG_LOG.md`](BUG_LOG.md).

| ID | Page / endpoint | Severity | Status |
| --- | --- | --- | --- |
| BUG-01 | Dashboard and Reports on mobile: page scrolls sideways | Medium | Fixed |
| BUG-02 | Machines search box drops typed characters | High | Fixed |
| BUG-03 | Form dialogs lose focus while typing and close themselves | High | Fixed |
| BUG-04 | Toast covers the Edit/Delete buttons of the last table rows | Low | Fixed |
| BUG-05 | After sign-out, the next sign-in lands on the previous user's page | Low | Fixed |
| BUG-06 | What-if simulator disagrees with the machine's live prediction | High | Fixed |
| BUG-07 | **Live:** data differs between Vercel instances (changes flicker in and out) | High | Fixed |
| BUG-08 | **Live:** after sign-out the old token still worked on other instances | Medium | Fixed |

### BUG-01 · Medium · Fixed: horizontal overflow on mobile

**Steps:** sign in at 390 px width → Dashboard (also Reports). **Expected:** the page fits the screen. **Actual:** the page was 407 px wide (17 px overflow; 23 px on Reports); the chart and alert cards stuck out.

**Cause:** grid items default to `min-width: auto`. **Fix:** `.grid > * { min-width: 0 }`. **Re-test:** 0 px overflow on all 11 pages (RS1).

<div class="pair">
<figure><img src="screenshots/BUG-01-dashboard-mobile-horizontal-overflow.png"><figcaption>Before: overflowing cards outlined in red</figcaption></figure>
<figure><img src="screenshots/BUG-01-fixed.png"><figcaption>After: no overflow</figcaption></figure>
</div>

### BUG-02 · High · Fixed: search drops characters

**Steps:** Machines → type `compressor` quickly. **Expected:** the box shows `compressor` and 7 rows. **Actual:** the box showed `or` and 17 rows.

**Cause:** each keystroke was written to the URL and read back. **Fix:** local input state, synced to the URL after 250 ms with functional updates. **Re-test:** M3 passes.

<div class="pair">
<figure><img src="screenshots/BUG-02-machines-search-drops-typed-characters.png"><figcaption>Before: "or", 17 of 30 machines</figcaption></figure>
<figure><img src="screenshots/BUG-02-fixed.png"><figcaption>After: "compressor", 7 machines</figcaption></figure>
</div>

### BUG-03 · High · Fixed: dialogs steal focus and close

**Steps:** Maintenance → Log maintenance → type "Bearing noise" in Issue. **Expected:** the text appears. **Actual:** focus jumped to the × button after the first key; the space bar "clicked" it and the dialog closed.

**Cause:** the focus effect re-ran on every render because it depended on an inline `onClose`. **Fix:** the effect runs on open only; initial focus goes to the first form field. This fixes every dialog in the app. **Re-test:** F2–F8, AL3, MT2.

<div class="pair">
<figure><img src="screenshots/BUG-03-maintenance-form-loses-focus-while-typing.png"><figcaption>Before: dialog closed, typed text lost</figcaption></figure>
<figure><img src="screenshots/BUG-03-fixed.png"><figcaption>After: text stays in the Issue field</figcaption></figure>
</div>

### BUG-04 · Low · Fixed: toast blocks row actions

**Steps:** add a machine (it becomes the last row) → click its Edit while the toast is visible. **Expected:** the edit form opens. **Actual:** the click hit the toast; nothing happened.

**Fix:** extra bottom padding on the content area so the last rows scroll clear of the toast stack. **Re-test:** F4.

<div class="pair">
<figure><img src="screenshots/BUG-04-toast-covers-last-row-actions.png"><figcaption>Before: toast over the last rows' Edit/Delete buttons</figcaption></figure>
<figure><img src="screenshots/BUG-04-fixed.png"><figcaption>After: Edit on the newly added last row opens the form</figcaption></figure>
</div>

### BUG-05 · Low · Fixed: sign-in after sign-out returns to the old page

**Steps:** open Settings → Sign out → sign in. **Expected:** the Dashboard. **Actual:** `/settings`, the previous session's page.

**Fix:** remember the page only when a session ends unexpectedly, not after a deliberate sign-out. **Re-test:** F12 lands on `/`; F14 still returns an expired session to the requested page.

<div class="pair">
<figure><img src="screenshots/BUG-05-signin-after-logout-returns-to-previous-page.png"><figcaption>Before: fresh sign-in opened /settings</figcaption></figure>
<figure><img src="screenshots/BUG-05-fixed.png"><figcaption>After: fresh sign-in opens the Dashboard</figcaption></figure>
</div>

### BUG-06 · High · Fixed: what-if disagreed with the live prediction

**Steps:** What-if → start from ACU-007 (live 61 %, High) → move nothing. **Expected:** 61 % High. **Actual:** 14 % Low, because the latest values were scored as a flat steady state and the rising 7-reading trend was ignored. 8 of 30 machines differed.

**Fix:** with a machine selected, the slider values *replace* the machine's newest reading after its previous 6 real readings (`mode: "trend"`), and defaults keep 3 decimals. **Re-test:** all 30 machines match within 0.002; monotonicity still holds; regression test added.

<div class="pair">
<figure><img src="screenshots/BUG-06-whatif-disagrees-with-live-prediction.png"><figcaption>Before: live 61 % High, simulator 14 % Low</figcaption></figure>
<figure><img src="screenshots/BUG-06-fixed.png"><figcaption>After: simulator 61 % High, matching the live prediction</figcaption></figure>
</div>

### BUG-07 · High · Fixed (live only): data differs between Vercel instances

**Steps:** on https://machinemd.vercel.app, Model Lab → Light retrain (creates v3), then make 12 parallel `GET /api/models` calls. **Expected:** all show v3. **Actual:** only 8/12 did. Uploads, maintenance records, alerts and settings flickered the same way, and the live acceptance run aborted.

**Cause:** Vercel runs several instances at once, each with its own `/tmp` copy of the database.

**Fix:** a signed client-held change journal (`backend/app/sync.py`).
- Each admin change comes back HMAC-signed in `X-MachineMD-Op`.
- The browser sends the ordered journal with every request.
- Any instance replays the changes it has not applied yet (as the same user, at the same timestamp, with a deterministic retrain), tracked in `applied_ops`.
- Forged entries are rejected, and no passwords are stored.

**Re-test:** first reproduced and fixed against two local instances behind a round-robin proxy. Live result: 12/12 parallel reads consistent, acceptance 65/65, flows 15/15. Regression tests added.

<div class="pair">
<figure><img src="screenshots/BUG-07-live-state-differs-between-vercel-instances.png"><figcaption>Before (live): only 8 of 12 parallel API calls can see the retrained v3</figcaption></figure>
<figure><img src="screenshots/BUG-07-fixed.png"><figcaption>After (live): all 12 of 12 see it; the journal is replayed on every instance</figcaption></figure>
</div>

### BUG-08 · Medium · Fixed (live only): sign-out did not reach every instance

**Steps:** sign in → sign out → send the old token 12 times in parallel. **Expected:** 12× 401. **Actual:** 7 of 12 still accepted. The revoked-token list lived in one instance's `/tmp`.

**Fix:** logout is a journaled change carrying the revoked token id and expiry, so every instance applies it. **Re-test:** 0/12 accepted on the live site; flow check F13 passes.

**Remaining limitation:** a copied token sent without this browser's journal can still reach an instance that never saw the logout, until the token expires.

<div class="pair">
<figure><img src="screenshots/BUG-08-live-logout-token-still-valid-on-other-instances.png"><figcaption>Before (live): 7/12 requests with the signed-out token still accepted</figcaption></figure>
<figure><img src="screenshots/BUG-08-fixed.png"><figcaption>After (live): 0/12 accepted</figcaption></figure>
</div>

**Test-harness issues found live (no app change needed):**
- A number field could not be cleared by triple-click in headless Chrome, so the test appended to the old value.
- Upload test timestamps could collide with seeded readings later in the day; the validator correctly rejected them as duplicates.
- A second test browser context lacked the first one's journal.

All three were fixed in the tests. Details are in `BUG_LOG.md`.

**Deployment issue found and fixed before go-live (not a UI bug).** The local `vercel build` failed with `LAMBDA_SIZE_EXCEEDED` (246 MB > 225 MB). numpy 2.5 / scipy 1.18 / scikit-learn 1.9 ship only manylinux_2_27 wheels, so Vercel's optimizer force-bundled them. I pinned numpy 2.2.6 / scipy 1.16.3 / scikit-learn 1.7.2 (manylinux2014 wheels), retrained and re-tested. The build now completes.

## 9. Working screenshots

<figure class="shot"><img src="screenshots/working/02-dashboard.png"><figcaption>Dashboard: KPI cards, machines ranked by risk, risk donut, health trend, recent alerts</figcaption></figure>
<figure class="shot"><img src="screenshots/working/03-machines-list.png"><figcaption>Machines list: search, filters, sortable columns, health bars, risk badges</figcaption></figure>
<figure class="shot"><img src="screenshots/working/04-machine-detail.png"><figcaption>Machine detail: health score, RUL, recommended action, contributing sensors, prediction history, sensor trends with anomaly points</figcaption></figure>
<figure class="shot"><img src="screenshots/working/05b-data-imported.png"><figcaption>Data page: upload preview, per-row error report, and import of the valid rows</figcaption></figure>
<figure class="shot"><img src="screenshots/working/06-model-lab.png"><figcaption>Model Lab: comparison table, confusion matrices, feature importance, ROC/PR curves, versions with Activate</figcaption></figure>
<figure class="shot"><img src="screenshots/working/07b-what-if-hot-and-shaky.png"><figcaption>What-if simulator: +18 % temperature and +120 % vibration on a compressor raise the risk to 50 % (Medium); vibration and temperature are shown as the drivers</figcaption></figure>
<figure class="shot"><img src="screenshots/working/08-alerts.png"><figcaption>Alerts: filter by status and risk, acknowledge, log maintenance</figcaption></figure>
<figure class="shot"><img src="screenshots/working/08b-alerts-handled.png"><figcaption>Alert marked Handled after logging maintenance</figcaption></figure>
<figure class="shot"><img src="screenshots/working/09-maintenance-log.png"><figcaption>Maintenance log: totals, search, filters, add/edit/delete</figcaption></figure>
<figure class="shot"><img src="screenshots/working/10-reports.png"><figcaption>Reports: PDF preview sections and CSV exports</figcaption></figure>
<div class="pair">
<figure><img src="screenshots/working/11-users.png"><figcaption>Users (admin only)</figcaption></figure>
<figure><img src="screenshots/working/12-settings.png"><figcaption>Settings: thresholds, password, system status, activity log</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/working/13-dashboard-dark.png"><figcaption>Dark mode</figcaption></figure>
<figure><img src="screenshots/working/22-viewer-model-lab-readonly.png"><figcaption>Viewer: Model Lab read-only, no retrain/activate</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/working/16-mobile-dashboard.png"><figcaption>Mobile dashboard (390 px)</figcaption></figure>
<figure><img src="screenshots/working/19-mobile-menu.png"><figcaption>Mobile navigation drawer</figcaption></figure>
</div>

### Live site screenshots (https://machinemd.vercel.app)

<div class="pair">
<figure><img src="screenshots/live/LIVE-01b-login-waking-up.png"><figcaption>Live: "Waking up the server, please wait..." on a slow sign-in</figcaption></figure>
<figure><img src="screenshots/live/LIVE-02-dashboard.png"><figcaption>Live: dashboard (same KPIs as the local seed)</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/live/LIVE-04-machine-detail.png"><figcaption>Live: machine detail with anomaly points and contributing sensors</figcaption></figure>
<figure><img src="screenshots/live/LIVE-06-model-lab.png"><figcaption>Live: Model Lab</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/live/LIVE-07b-what-if-hot-and-shaky.png"><figcaption>Live: what-if simulator</figcaption></figure>
<figure><img src="screenshots/live/LIVE-08-alerts.png"><figcaption>Live: alerts</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/live/LIVE-10-reports.png"><figcaption>Live: reports (PDF + CSV)</figcaption></figure>
<figure><img src="screenshots/live/LIVE-22-viewer-model-lab-readonly.png"><figcaption>Live: viewer, read-only Model Lab</figcaption></figure>
</div>
<div class="pair">
<figure><img src="screenshots/live/LIVE-16-mobile-dashboard.png"><figcaption>Live: mobile dashboard</figcaption></figure>
<figure><img src="screenshots/live/LIVE-20-mobile-dark-alerts.png"><figcaption>Live: mobile, dark mode, alerts</figcaption></figure>
</div>

## 10. Deployment details

| | |
| --- | --- |
| Live URL | **https://machinemd.vercel.app** |
| GitHub | https://github.com/DIVYAPRIYADHARSHINI-GIT/machinemd |
| Env variables (names only, all optional) | `MACHINEMD_JWT_SECRET`, `MACHINEMD_JWT_EXPIRE_MINUTES`, `MACHINEMD_DATA_DIR`, `MACHINEMD_CORS_ORIGINS`, `VITE_API_PROXY` (dev only) |

**Vercel import (dashboard only, no CLI or tokens)**
1. Add New… → Project → Import `DIVYAPRIYADHARSHINI-GIT/machinemd`.
2. Application Preset: **Other**. Vercel suggested *Services* ("Multiple applications detected"); switch it to Other and do not click "Import single project".
3. Root Directory: `./`.
4. Leave the build, output and install overrides off; `vercel.json` supplies them.
5. *(Optional)* Add the environment variable `MACHINEMD_JWT_SECRET`.
6. Deploy.

**Local run steps**
1. `python3.12 -m venv .venv && source .venv/bin/activate`
2. `pip install -r backend/requirements-dev.txt`
3. `cd backend && uvicorn app.main:app --port 8000`
4. In a second terminal: `cd frontend && npm ci && npm run dev`
5. Open http://localhost:5173.

To regenerate data and models: `python backend/scripts/seed_and_train.py`.

**Vercel limits handled**

| Limit | How it is handled |
| --- | --- |
| Read-only filesystem except `/tmp` | The seed DB is copied to `/tmp/machinemd` on cold start and all writes go there. Retrained models go to `/tmp/machinemd/models`. Verified by running from a read-only copy of the repo. |
| Function time limit | Heavy training is done offline and the models are committed. Reads take under 60 ms; a light retrain about 3 s; `maxDuration` is 60 s. |
| Bundle size | No pandas or deep-learning libraries. Tests, docs and frontend are excluded from the function. ML wheels are pinned to manylinux2014, so Vercel's optimizer keeps the bundle under its 225 MB packing limit (verified with `vercel build`). |
| Several instances in parallel, each with its own `/tmp` DB | Signed client change journal: every instance replays the admin changes it has not applied yet. Verified live: 12/12 consistent after a retrain, a reset and a sign-out. |
| Recycled instances / cold starts | Changes reset to the seed, as the banner says. Self-healing covers a missing DB or model file. The login page pre-warms `/api/health` and shows "Waking up the server, please wait...". |

## 11. Known limitations and next improvements

**Limitations**
- **Synthetic data.** Realistic patterns, but the metrics describe the simulation, not a real plant.
- **Temporary storage on Vercel.** Uploads, edits, new users and retrained models disappear when the instance is recycled. The pre-trained v1/v2 models and the seed data always remain.
- **Consistency is per browser.** On Vercel, shared state is kept consistent by each browser's signed change journal, which is up to ~12 KB, oldest entries dropped first. A different browser, or a copied token sent without the journal, can reach an instance that has not seen the changes until that instance is recycled. The login rate limiter is per instance. A hosted database would remove both limitations.
- **RUL is capped at 14 days.** Beyond that the model only says "no failure expected soon".
- **Steady-state scoring.** Single and batch predictions from raw values assume a steady state (no trend). With a machine selected, the what-if simulator does use the machine's real trend.

**Next improvements**
1. A hosted Postgres database (e.g. Neon free tier) and object storage for persistent, shared data and model files. This would replace the change journal.
2. Probability calibration for Gradient Boosting, and threshold tuning per machine type against a maintenance-cost matrix.
3. Survival models (e.g. a Weibull or Cox model) for RUL beyond 14 days.
4. Streaming ingestion (MQTT/webhook) with scheduled re-scoring, plus e-mail or Teams notifications for new High alerts.
5. Drift monitoring that compares live feature distributions with the training data and prompts a retrain.

---

*MachineMD v1.0.0 · 23 November 2026 · Built by Divya Priyadharshini*
