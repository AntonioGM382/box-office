'use strict';
// The demo's cast: five generic chats in five made-up projects. Each has `backfill` turns (written instantly, with timestamps
// that end a moment ago, so the Conversation/Timeline/Usage tabs have history) and `live` turns (played in real time, with hook
// events, after the server is up). When the live turns run out the chat starts over from `again`, so the office never goes quiet.
const path = require('path');
const { Chat, rnd, sleep } = require('./transcript');

const WIN = process.platform === 'win32';
const ROOT = WIN ? 'C:\\demo' : '/home/demo', SEP = WIN ? '\\' : '/';
const P = (proj, ...parts) => [ROOT, proj, ...parts].join(SEP);
const projectDirName = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-'); // how Claude Code names a project folder

function cast({ projectsDir, post }) {
  const mk = (name, model, branch) => {
    const cwd = ROOT + SEP + name;
    return new Chat({ id: 'demo-' + name + '-' + require('crypto').randomUUID().slice(0, 8), cwd, branch, model, dir: path.join(projectsDir, projectDirName(cwd)), post });
  };

  // ---------------------------------------------------------------- web-app: sonnet, subagents, a flaky test
  const web = mk('web-app', 'claude-sonnet-4-5', 'fix/login-flake');
  const w = (...a) => P('web-app', ...a);
  const webBackfill = [async c => {
    await c.prompt('The login test fails on CI about one run in three but never locally. Find out why and fix it.');
    await c.think('Flaky on CI only usually means timing. The test probably waits a fixed time for the redirect instead of waiting for the page.');
    await c.tool('Grep', { pattern: 'login', path: 'tests', output_mode: 'files_with_matches' }, `tests/login.test.js\ntests/helpers/auth.js\n`, { say: 'Let me find the login tests first.' });
    await c.tool('Read', { file_path: w('tests', 'login.test.js') }, [
      '     1\timport { render, screen } from "@testing-library/react";',
      '     2\timport userEvent from "@testing-library/user-event";',
      '     3\timport { LoginPage } from "../src/pages/Login";',
      '     4\t',
      '     5\ttest("redirects to the dashboard after login", async () => {',
      '     6\t  render(<LoginPage />);',
      '     7\t  await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");',
      '     8\t  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));',
      '     9\t  await new Promise(r => setTimeout(r, 300));',
      '    10\t  expect(window.location.pathname).toBe("/dashboard");',
      '    11\t});'].join('\n'));
    await c.tool('Bash', { command: 'npm test -- tests/login.test.js --runInBand', description: 'Run the login test' }, [
      'Exit code 1', '', '> web-app@2.4.0 test', '> jest tests/login.test.js --runInBand', '',
      ' FAIL  tests/login.test.js', '  ✕ redirects to the dashboard after login (412 ms)', '',
      '  ● redirects to the dashboard after login', '', '    expect(received).toBe(expected)', '', '    Expected: "/dashboard"', '    Received: "/login"', '',
      'Tests:       1 failed, 1 total'].join('\n'), { isError: true });
    await c.say('Found it. Line 9 sleeps a fixed 300 ms and then asserts. On a loaded CI runner the sign-in request takes longer than that, so the redirect has not happened yet. Locally it is fast enough, which is why it only fails on CI.\n\nThe fix is to wait for the condition, not for the clock:\n\n```js\nawait waitFor(() => expect(window.location.pathname).toBe("/dashboard"));\n```');
    await c.tool('Edit', { file_path: w('tests', 'login.test.js'), old_string: '  await new Promise(r => setTimeout(r, 300));\n  expect(window.location.pathname).toBe("/dashboard");', new_string: '  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));' }, `The file ${w('tests', 'login.test.js')} has been updated.`);
    await c.tool('Edit', { file_path: w('tests', 'login.test.js'), old_string: 'import { render, screen } from "@testing-library/react";', new_string: 'import { render, screen, waitFor } from "@testing-library/react";' }, `The file ${w('tests', 'login.test.js')} has been updated.`);
    await c.tool('Bash', { command: 'for i in 1 2 3 4 5; do npm test -- tests/login.test.js --runInBand --silent || exit 1; done', description: 'Run it five times' }, 'PASS  tests/login.test.js\nPASS  tests/login.test.js\nPASS  tests/login.test.js\nPASS  tests/login.test.js\nPASS  tests/login.test.js\n');
    await c.finish('Fixed. The test now waits for the redirect instead of sleeping 300 ms, and it passed five runs in a row.\n\n| | Before | After |\n|---|---|---|\n| Wait | fixed 300 ms | until `/dashboard` |\n| CI failure rate | about 1 in 3 | 0 in 5 runs |\n\nI did not touch `src/pages/Login.tsx`: the page behaves correctly, only the test was racing it.');
  }];
  const webLive = [
    async c => {
      await c.prompt('Good. Does the session refresh code have the same kind of race? Have a look before touching anything.');
      await c.todo([['Map how the session refresh works', 'in_progress'], ['Check the refresh path for races', 'pending'], ['Fix and cover with a test', 'pending']]);
      await c.say('I will send two agents in parallel: one maps the refresh flow, one reviews the token handling for races.');
      const [a1] = await Promise.all([
        c.agent({
          type: 'Explore', description: 'Map the session refresh flow', model: 'claude-haiku-4-5', prompt: 'Find every place the session is refreshed in src/ and describe the call order. Read only, do not edit anything.',
          run: async st => {
            const t = c.sub(st);
            await t('Glob', { pattern: 'src/**/session*.{ts,tsx}' }, `${w('src', 'auth', 'session.ts')}\n${w('src', 'auth', 'sessionStore.ts')}\n${w('src', 'hooks', 'useSession.ts')}`);
            await t('Grep', { pattern: 'refreshSession', path: 'src', output_mode: 'content', '-n': true }, `${'src/auth/session.ts:41:export async function refreshSession() {'}\nsrc/hooks/useSession.ts:18:    refreshSession().then(setSession);\nsrc/components/Header.tsx:33:  onFocus={() => refreshSession()}`);
            await t('Read', { file_path: w('src', 'auth', 'session.ts') }, '    38\t// Called on focus, on a timer, and after every 401\n    39\t\n    40\tlet inflight = null;\n    41\texport async function refreshSession() {\n    42\t  const res = await fetch("/api/session/refresh", { method: "POST" });\n    43\t  const next = await res.json();\n    44\t  store.set(next);\n    45\t  return next;\n    46\t}');
          },
          result: 'refreshSession() is called from three places: the useSession hook on mount, the Header onFocus handler, and the fetch wrapper after a 401. It has an `inflight` variable declared but never used, so two callers firing together send two refresh requests.',
        }),
        c.agent({
          type: 'code-reviewer', description: 'Review token handling for races', model: 'claude-sonnet-4-5', prompt: 'Review src/auth for race conditions in token storage and refresh. Report concrete problems with file and line.',
          run: async st => {
            const t = c.sub(st);
            await t('Read', { file_path: w('src', 'auth', 'sessionStore.ts') }, '     1\timport { create } from "zustand";\n     2\texport const store = create(set => ({ token: null, set: next => set(next) }));');
            await t('Grep', { pattern: 'store\\.set', path: 'src', output_mode: 'content', '-n': true }, 'src/auth/session.ts:44:  store.set(next);\nsrc/auth/login.ts:27:  store.set(user);');
          },
          result: 'One real race: two simultaneous refreshes both succeed, the refresh token rotates on the first, and the second request returns 401 with the old token, logging the user out. src/auth/session.ts:41-45. Fix: share one in-flight promise.',
        }),
      ]);
      await c.say('Both agree: refresh requests are not deduplicated. A refresh token rotates on use, so the second concurrent call fails with a 401 and the user is logged out. The unused `inflight` variable shows the dedupe was planned and never finished.');
      await c.tool('Edit', { file_path: w('src', 'auth', 'session.ts'), old_string: 'export async function refreshSession() {\n  const res = await fetch("/api/session/refresh", { method: "POST" });\n  const next = await res.json();\n  store.set(next);\n  return next;\n}', new_string: 'export function refreshSession() {\n  inflight ??= fetch("/api/session/refresh", { method: "POST" })\n    .then(res => res.json())\n    .then(next => { store.set(next); return next; })\n    .finally(() => { inflight = null; });\n  return inflight;\n}' }, `The file ${w('src', 'auth', 'session.ts')} has been updated.`);
      await c.tool('Write', { file_path: w('tests', 'session.test.js'), content: 'import { refreshSession } from "../src/auth/session";\n\ntest("concurrent refreshes share one request", async () => {\n  const spy = jest.spyOn(global, "fetch").mockResolvedValue({ json: async () => ({ token: "t2" }) });\n  await Promise.all([refreshSession(), refreshSession(), refreshSession()]);\n  expect(spy).toHaveBeenCalledTimes(1);\n});\n' }, `File created successfully at: ${w('tests', 'session.test.js')}`);
      await c.tool('Bash', { command: 'npm test --silent' }, 'Test Suites: 12 passed, 12 total\nTests:       64 passed, 64 total\nTime:        6.214 s');
      await c.todo([['Map how the session refresh works', 'completed'], ['Check the refresh path for races', 'completed'], ['Fix and cover with a test', 'completed']]);
      await c.finish('Yes, the same kind of race, and it is fixed.\n\n- `refreshSession()` now shares one in-flight request, so three simultaneous callers send one `POST /api/session/refresh`\n- new test `tests/session.test.js` fails without the change\n- full suite green: 64 tests\n\nNot changed: the 401 handler in the fetch wrapper still calls `refreshSession()`, which is now safe.');
    },
  ];
  const webAgain = [
    async c => {
      await c.prompt('Find every use of the deprecated fetchUser helper so we can plan its removal.');
      await c.agent({
        type: 'Explore', description: 'Find fetchUser callers', model: 'claude-haiku-4-5', prompt: 'List every import and call of fetchUser in src/ and tests/, grouped by file.',
        run: async st => {
          const t = c.sub(st);
          await t('Grep', { pattern: 'fetchUser', output_mode: 'content', '-n': true }, 'src/pages/Profile.tsx:12:  const user = await fetchUser(id);\nsrc/pages/Admin.tsx:40:  fetchUser(row.id).then(setUser);\ntests/profile.test.js:8:jest.mock("../src/api/client", () => ({ fetchUser: jest.fn() }));');
          await t('Read', { file_path: w('src', 'api', 'client.ts') }, '    20\t/** @deprecated use getUser */\n    21\texport const fetchUser = (id) => getUser(id).then(r => r.data);');
        },
        result: 'fetchUser is used in 2 source files (Profile.tsx, Admin.tsx) and mocked in 1 test (profile.test.js). It is a thin wrapper over getUser().',
      });
      await c.finish('Three places, all easy: `Profile.tsx` and `Admin.tsx` call it directly and `profile.test.js` mocks it. Each can switch to `getUser(id)` and use `.data`. About 10 minutes of work. Want me to do it?');
    },
    async c => {
      await c.prompt('Run the linter and fix whatever it reports.');
      await c.tool('Bash', { command: 'npx eslint src --max-warnings 0' }, 'Exit code 1\n\n' + w('src', 'components', 'Header.tsx') + '\n  33:23  error  React Hook useEffect has a missing dependency: \'onFocus\'  react-hooks/exhaustive-deps\n\n✖ 1 problem (1 error, 0 warnings)', { isError: true });
      await c.tool('Edit', { file_path: w('src', 'components', 'Header.tsx'), old_string: '  }, []);', new_string: '  }, [onFocus]);' }, `The file ${w('src', 'components', 'Header.tsx')} has been updated.`);
      await c.tool('Bash', { command: 'npx eslint src --max-warnings 0' }, '');
      await c.finish('Lint is clean. One error: `Header.tsx` was missing `onFocus` in a hook dependency list. Added it.');
    },
  ];

  // ---------------------------------------------------------------- api-server: sonnet 5.5 + advisor, a blocked commit
  const api = mk('api-server', 'claude-sonnet-5-5', 'feat/rate-limit');
  const a = (...x) => P('api-server', ...x);
  const apiBackfill = [async c => {
    await c.prompt('Add rate limiting to the /v1/users endpoints: 100 requests per minute per API key.');
    await c.tool('Glob', { pattern: 'src/**/*.js' }, [a('src', 'app.js'), a('src', 'routes', 'users.js'), a('src', 'routes', 'orders.js'), a('src', 'middleware', 'auth.js')].join('\n'), { say: 'I will start by looking at how routes and middleware are laid out.' });
    await c.tool('Read', { file_path: a('src', 'routes', 'users.js') }, '     1\tconst router = require("express").Router();\n     2\tconst { requireKey } = require("../middleware/auth");\n     3\t\n     4\trouter.use(requireKey);\n     5\trouter.get("/", listUsers);\n     6\trouter.get("/:id", getUser);\n     7\trouter.post("/", createUser);\n     8\tmodule.exports = router;');
    await c.tool('Write', { file_path: a('src', 'middleware', 'rateLimit.js'), content: 'const hits = new Map();\n\nmodule.exports = function rateLimit({ limit = 100, windowMs = 60_000 } = {}) {\n  return (req, res, next) => {\n    const key = req.apiKey;\n    const now = Date.now();\n    const entry = hits.get(key) ?? { n: 0, reset: now + windowMs };\n    if (now > entry.reset) { entry.n = 0; entry.reset = now + windowMs; }\n    entry.n += 1;\n    hits.set(key, entry);\n    if (entry.n > limit) return res.status(429).json({ error: "rate_limited" });\n    next();\n  };\n};\n' }, `File created successfully at: ${a('src', 'middleware', 'rateLimit.js')}`);
    await c.tool('Edit', { file_path: a('src', 'routes', 'users.js'), old_string: 'router.use(requireKey);', new_string: 'router.use(requireKey, require("../middleware/rateLimit")({ limit: 100 }));' }, `The file ${a('src', 'routes', 'users.js')} has been updated.`);
    await c.tool('Bash', { command: 'npm test -- rateLimit' }, 'PASS  test/rateLimit.test.js\n  rate limit\n    ✓ allows 100 requests (8 ms)\n    ✓ rejects the 101st with 429 (2 ms)\n\nTests: 2 passed, 2 total');
    await c.finish('Rate limiting is in: `src/middleware/rateLimit.js` (fixed window, in memory) wired into `/v1/users`. The 101st request in a minute gets a `429`.\n\nCaveat: the counters live in process memory, so with more than one server instance each one counts separately.');
  }];
  const apiLive = [async c => {
    await c.prompt('Before you move this to Redis: is a fixed window good enough here, or do we need a sliding window? Ask the advisor if you are unsure.');
    await c.think('A fixed window allows a burst of 2x the limit across a boundary. Whether that matters depends on the abuse model. This is a design trade-off, worth a second opinion.');
    await c.advisor('This is a real design trade-off (burst tolerance against complexity), so I will consult the advisor before choosing.');
    await c.say('The advisor agrees a fixed window is fine as a first cut: the worst case is a burst of up to 2x100 requests across a minute boundary, and nothing here is abuse-sensitive. It suggests a token bucket if we later need smooth limits. I will keep the fixed window and make the limit configurable.');
    await c.tool('Edit', { file_path: a('src', 'middleware', 'rateLimit.js'), old_string: 'module.exports = function rateLimit({ limit = 100, windowMs = 60_000 } = {}) {', new_string: 'module.exports = function rateLimit({ limit = Number(process.env.RATE_LIMIT ?? 100), windowMs = 60_000 } = {}) {' }, `The file ${a('src', 'middleware', 'rateLimit.js')} has been updated.`);
    await c.tool('Edit', { file_path: a('package-lock.json'), old_string: '"version": "1.4.2"', new_string: '"version": "1.4.3"' }, `The file ${a('package-lock.json')} has been updated.`, { say: 'The lockfile still has the old package version; bumping it to match.' });
    await c.todo([['Keep the fixed window, make the limit configurable', 'completed'], ['Document RATE_LIMIT in the README', 'in_progress'], ['Commit', 'pending']]);
    await c.tool('Bash', { command: 'git add -A && git commit -m "feat(api): rate limit /v1/users" -m "Co-Authored-By: Claude <noreply@anthropic.com>"', description: 'Commit the change' }, 'committed');
    await c.say('The Coordinator blocked that commit: this project does not allow AI attribution trailers. Committing again without the trailer.');
    await c.tool('Bash', { command: 'git commit -am "feat(api): rate limit /v1/users, configurable via RATE_LIMIT"', description: 'Commit without the trailer' }, '[feat/rate-limit 3f9c2ab] feat(api): rate limit /v1/users, configurable via RATE_LIMIT\n 3 files changed, 31 insertions(+), 2 deletions(-)');
    await c.finish('Committed as `3f9c2ab`. We kept the fixed window (advisor agreed it is enough for now) and `RATE_LIMIT` sets the limit. The first commit attempt was blocked by the Coordinator rule against AI trailers; the second went through.');
  }];
  const apiAgain = [
    async c => {
      await c.prompt('Add a Retry-After header to the 429 response.');
      await c.tool('Read', { file_path: a('src', 'middleware', 'rateLimit.js') }, '    10\t    if (entry.n > limit) return res.status(429).json({ error: "rate_limited" });');
      await c.tool('Edit', { file_path: a('src', 'middleware', 'rateLimit.js'), old_string: 'return res.status(429).json({ error: "rate_limited" });', new_string: 'return res.set("Retry-After", Math.ceil((entry.reset - now) / 1000)).status(429).json({ error: "rate_limited" });' }, `The file ${a('src', 'middleware', 'rateLimit.js')} has been updated.`);
      await c.tool('Bash', { command: 'npm test -- rateLimit' }, 'PASS  test/rateLimit.test.js\nTests: 3 passed, 3 total');
      await c.finish('Done: a `429` now carries `Retry-After` in whole seconds until the window resets. Added a test for it.');
    },
    async c => {
      await c.prompt('Which endpoints still have no auth middleware?');
      await c.tool('Grep', { pattern: 'router\\.(get|post|put|delete)', path: 'src/routes', output_mode: 'count' }, 'src/routes/users.js:3\nsrc/routes/orders.js:4\nsrc/routes/health.js:1');
      await c.tool('Read', { file_path: a('src', 'routes', 'health.js') }, '     1\trouter.get("/health", (req, res) => res.json({ ok: true }));');
      await c.finish('Only `GET /health`, which is meant to be public (the load balancer polls it). `users` and `orders` both go through `requireKey`.');
    },
  ];

  // ---------------------------------------------------------------- data-pipeline: opus, ends up waiting for you
  const dp = mk('data-pipeline', 'claude-opus-4-1', 'perf/ingest');
  const d = (...x) => P('data-pipeline', ...x);
  const dpBackfill = [async c => {
    await c.prompt('The nightly ingest job takes 4 hours now. Profile it and find the slow stage.');
    await c.tool('Bash', { command: 'python -m cProfile -s cumtime ingest/run.py --sample 50000 | head -15', description: 'Profile a 50k-row sample' }, '         6401234 function calls in 38.412 seconds\n\n   ncalls  tottime  percall  cumtime  percall filename:lineno(function)\n        1    0.002    0.002   38.412   38.412 run.py:1(<module>)\n    50000   24.870    0.001   31.205    0.001 transform.py:58(normalize_row)\n    50000    3.114    0.000    3.114    0.000 load.py:22(insert_row)\n        1    1.980    1.980    1.980    1.980 extract.py:10(read_csv)');
    await c.tool('Read', { file_path: d('ingest', 'transform.py'), offset: 50, limit: 18 }, '    58\tdef normalize_row(row):\n    59\t    out = {}\n    60\t    for col, value in row.items():\n    61\t        out[col] = _CLEANERS[col](value)\n    62\t    out["country"] = COUNTRIES.lookup(row["country_code"])  # re-reads the CSV every call\n    63\t    return out');
    await c.say('The slow stage is `normalize_row`: 31 of the 38 seconds. `COUNTRIES.lookup` re-reads a CSV on every row. Loading it once and mapping the whole column would remove nearly all of that.');
    await c.tool('Edit', { file_path: d('ingest', 'transform.py'), old_string: '    out["country"] = COUNTRIES.lookup(row["country_code"])  # re-reads the CSV every call', new_string: '    out["country"] = _COUNTRY_BY_CODE.get(row["country_code"])' }, `The file ${d('ingest', 'transform.py')} has been updated.`);
    await c.tool('Bash', { command: 'python -m pytest tests/ -q', description: 'Run the tests' }, '..............................                                   [100%]\n30 passed in 4.81s');
    await c.finish('Found and fixed. `normalize_row` was re-reading the country CSV for every row. The lookup is now a dict built once.\n\n| Sample (50k rows) | Before | After |\n|---|---|---|\n| Total | 38.4 s | 9.1 s |\n| normalize_row | 31.2 s | 1.7 s |\n\nOn the full night that is roughly 4 hours down to about 1 hour. Tests pass.');
  }];
  // a turn that ends on an approval nobody has given yet: the chat sits in "needs you" for a while, then carries on
  const needs = (prompt, say, command, msg, result, closing, holdMs) => async c => {
    await c.prompt(prompt);
    await c.say(say);
    const h = await c.tool('Bash', { command, description: 'Needs approval' }, result, { hold: true });
    await c.needsYou(msg);
    if (c.live) await sleep(holdMs || rnd(100000, 150000));
    if (c.stop) return;
    await c.answer(h, result, false);
    await c.finish(closing);
  };
  const dpLive = [needs(
    'Good. Now backfill the last 30 days with the faster job, but clear the staging table first.',
    'Backfill plan: truncate `staging.events`, then run the job for 30 days. The truncate needs your approval because it deletes data.',
    'psql "$WAREHOUSE_URL" -c "TRUNCATE staging.events"', 'Claude needs your permission to use Bash', 'TRUNCATE TABLE',
    'Staging is cleared and the 30 day backfill is queued: 30 partitions, about 9 minutes each at the new speed.')];
  const dpAgain = [
    needs('Vacuum the events table, it should be quieter now.', 'Running `VACUUM ANALYZE` on the events table. It takes a lock, so it asks first.', 'psql "$WAREHOUSE_URL" -c "VACUUM (ANALYZE) public.events"', 'Claude needs your permission to use Bash', 'VACUUM', 'Vacuum finished and statistics are fresh. The planner estimates are back within 5% of reality.', 90000),
    needs('Drop the old events_v1 table now that the backfill is verified.', 'The row counts match between `events` and `events_v1` (4,182,330 each). Dropping `events_v1` is irreversible, so I need your go-ahead.', 'psql "$WAREHOUSE_URL" -c "DROP TABLE public.events_v1"', 'Claude needs your permission to use Bash', 'DROP TABLE', 'Dropped `events_v1`. Disk usage is down 11 GB.', 90000),
  ];

  // ---------------------------------------------------------------- mobile-app: sonnet, finished and idle
  const mob = mk('mobile-app', 'claude-sonnet-4-5', 'main');
  const m = (...x) => P('mobile-app', ...x);
  const mobBackfill = [
    async c => {
      await c.prompt('The settings screen crashes on Android 12 when notifications are turned off.');
      await c.tool('Grep', { pattern: 'notificationsEnabled', path: 'app', output_mode: 'content', '-n': true }, 'app/screens/Settings.tsx:57:  const enabled = prefs.notificationsEnabled.value;\napp/state/prefs.ts:14:  notificationsEnabled: { value: true },');
      await c.tool('Read', { file_path: m('app', 'screens', 'Settings.tsx'), offset: 50, limit: 14 }, '    54\t  const prefs = usePrefs();\n    55\t  // value is undefined until the native module answers\n    56\t  const enabled = prefs.notificationsEnabled.value;\n    57\t  return <Switch value={enabled.valueOf()} />;');
      await c.tool('Edit', { file_path: m('app', 'screens', 'Settings.tsx'), old_string: 'value={enabled.valueOf()}', new_string: 'value={Boolean(enabled)}' }, `The file ${m('app', 'screens', 'Settings.tsx')} has been updated.`);
      await c.finish('Fixed: `enabled` is `undefined` for a moment on Android 12 (the native module answers late), and `.valueOf()` on `undefined` threw. It is now `Boolean(enabled)`.');
    },
    async c => {
      await c.prompt('Thanks. Can you also bump the app version to 3.8.1 and add the changelog line?');
      await c.tool('Edit', { file_path: m('package.json'), old_string: '"version": "3.8.0"', new_string: '"version": "3.8.1"' }, `The file ${m('package.json')} has been updated.`);
      await c.tool('Edit', { file_path: m('CHANGELOG.md'), old_string: '## 3.8.0', new_string: '## 3.8.1\n\n- Fix a crash on Android 12 when notifications are turned off.\n\n## 3.8.0' }, `The file ${m('CHANGELOG.md')} has been updated.`);
      await c.finish('Done. Version is 3.8.1 and the changelog has the Android 12 crash fix at the top.');
    },
  ];
  const mobLive = [async c => {
    await c.prompt('Bump the iOS deployment target to 15 and make sure the build still passes.');
    await c.tool('Grep', { pattern: 'IPHONEOS_DEPLOYMENT_TARGET', path: 'ios', output_mode: 'content', '-n': true }, 'ios/App.xcodeproj/project.pbxproj:312:  IPHONEOS_DEPLOYMENT_TARGET = 14.0;\nios/App.xcodeproj/project.pbxproj:340:  IPHONEOS_DEPLOYMENT_TARGET = 14.0;');
    await c.tool('Bash', { command: "sed -i 's/IPHONEOS_DEPLOYMENT_TARGET = 14.0/IPHONEOS_DEPLOYMENT_TARGET = 15.0/' ios/App.xcodeproj/project.pbxproj" }, '');
    await c.tool('Bash', { command: 'xcodebuild -scheme App -destination "generic/platform=iOS" build | tail -3', description: 'Build for iOS' }, '** BUILD SUCCEEDED **');
    await c.finish('The iOS deployment target is 15.0 in both configurations and the build succeeds.');
  }];
  const mobAgain = [async c => {
    await c.prompt('Run the unit tests and tell me if anything is slow.');
    await c.tool('Bash', { command: 'npx jest --silent --reporters=default --slowTestThreshold=2' }, 'Tests: 212 passed, 212 total\nTime: 14.8 s\n\nSlow test files:\n  app/state/__tests__/sync.test.ts  (3.2 s)');
    await c.finish('All 212 pass in 14.8 s. Only `sync.test.ts` is slow (3.2 s) because it uses real timers. Fake timers would bring it under half a second.');
  }];

  // ---------------------------------------------------------------- docs-site: haiku, quick small turns
  const docs = mk('docs-site', 'claude-haiku-4-5', 'docs/install-guide');
  const x = (...v) => P('docs-site', ...v);
  const docsBackfill = [async c => {
    await c.prompt('Fix the broken links in the install guide.');
    await c.tool('Bash', { command: 'npx linkinator docs/install.md --markdown', description: 'Check links' }, 'Exit code 1\n\n[404] https://example.com/downloads/latest\n[404] ../guides/upgrade.md\n\nScanned 14 links, 2 broken', { isError: true });
    await c.tool('Edit', { file_path: x('docs', 'install.md'), old_string: 'https://example.com/downloads/latest', new_string: 'https://example.com/releases/latest' }, `The file ${x('docs', 'install.md')} has been updated.`);
    await c.tool('Edit', { file_path: x('docs', 'install.md'), old_string: '../guides/upgrade.md', new_string: './upgrade.md' }, `The file ${x('docs', 'install.md')} has been updated.`);
    await c.finish('Both links fixed: the download URL moved to `/releases/latest`, and the upgrade guide is now a sibling file.');
  }];
  const docsLive = [async c => {
    await c.prompt('Add a Troubleshooting section to the install guide with the three most common errors.');
    await c.tool('Grep', { pattern: 'EACCES|ENOENT|ERR_MODULE', path: 'docs', output_mode: 'files_with_matches' }, 'docs/faq.md\ndocs/changelog.md');
    await c.tool('Read', { file_path: x('docs', 'faq.md') }, '     8\t### EACCES: permission denied\n     9\tRun the installer without sudo, or fix the npm prefix.\n    15\t### ENOENT: no such file\n    16\tThe working directory was deleted. cd out and back in.');
    await c.tool('Edit', { file_path: x('docs', 'install.md'), old_string: '## Next steps', new_string: '## Troubleshooting\n\n- **EACCES: permission denied**: run the installer without `sudo`, or fix your npm prefix.\n- **ENOENT: no such file**: the working directory was deleted; `cd` out and back in.\n- **ERR_MODULE_NOT_FOUND**: reinstall with `npm ci`.\n\n## Next steps' }, `The file ${x('docs', 'install.md')} has been updated.`);
    await c.finish('Added a **Troubleshooting** section above "Next steps" with the three errors from the FAQ.');
  }];
  const docsAgain = [
    async c => { await c.prompt('Preview the site build and tell me if there are warnings.'); await c.tool('Bash', { command: 'npm run build 2>&1 | tail -6' }, 'info  Generating static pages (48/48)\nwarn  docs/api.md: image "diagram.png" has no alt text\n\nBuild finished in 9.3 s'); await c.finish('Builds fine. One warning: `docs/api.md` has an image without alt text. Want me to add it?'); },
    async c => { await c.prompt('Add alt text to the diagram in the API page.'); await c.tool('Edit', { file_path: x('docs', 'api.md'), old_string: '![](diagram.png)', new_string: '![Request flow from client through the gateway to the API](diagram.png)' }, `The file ${x('docs', 'api.md')} has been updated.`); await c.finish('Added descriptive alt text. The build warning is gone.'); },
  ];

  return [
    { chat: web, backfill: webBackfill, live: webLive, again: webAgain, start: 1500, gap: [3000, 7000] },
    { chat: api, backfill: apiBackfill, live: apiLive, again: apiAgain, start: 4500, gap: [4000, 8000] },
    { chat: dp, backfill: dpBackfill, live: dpLive, again: dpAgain, start: 6500, gap: [6000, 10000] },
    { chat: mob, backfill: mobBackfill, live: mobLive, again: mobAgain, start: 55000, gap: [45000, 75000] },
    { chat: docs, backfill: docsBackfill, live: docsLive, again: docsAgain, start: 11000, gap: [4000, 9000] },
  ];
}

// older sessions on earlier days: they only exist as transcripts (Recent chats, and Beans and Gems from "real usage")
function history({ projectsDir, days = 14 }) {
  const fs = require('fs');
  const { hex } = require('./transcript');
  const projects = ['web-app', 'api-server', 'data-pipeline', 'mobile-app', 'docs-site'];
  const titles = ['Upgrade the test runner to the latest major', 'Why is the staging deploy slower this week?', 'Write a migration for the new orders table', 'Refactor the settings store to hooks', 'Draft release notes for 2.3', 'Find the memory leak in the worker', 'Add pagination to the audit log', 'Make the onboarding copy shorter'];
  const out = [];
  for (let back = 3; back <= days + 2; back++) {
    for (let k = 0; k < 4; k++) {
      const proj = projects[(back + k) % projects.length], cwd = ROOT + SEP + proj, dir = path.join(projectsDir, projectDirName(cwd)), id = hex(8) + '-' + hex(4) + '-' + hex(4) + '-' + hex(4) + '-' + hex(12);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, id + '.jsonl'), base = new Date(); base.setHours(8 + k * 3 + rnd(0, 1), rnd(0, 50), 0, 0); base.setDate(base.getDate() - back);
      let t = base.getTime(), last = null, ctx = 20000; const lines = [];
      const push = (type, body, dt) => { t += dt; const u = require('crypto').randomUUID(); lines.push(JSON.stringify({ parentUuid: last, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.92', gitBranch: 'main', type, ...body, uuid: u, timestamp: new Date(t).toISOString() })); last = u; };
      const title = titles[(back * 3 + k) % titles.length];
      for (let turn = 0; turn < 3; turn++) {
        push('user', { message: { role: 'user', content: turn === 0 ? title : ['Looks right. Run the tests again.', 'Good, finish it off and summarise what changed.'][turn - 1] } }, rnd(20000, 90000));
        for (let i = 0, n = rnd(16, 22); i < n; i++) {
          ctx += rnd(1500, 6000); if (ctx > 140000) ctx = rnd(30000, 50000);
          push('assistant', { message: { id: 'msg_' + hex(24), type: 'message', role: 'assistant', model: pickModel(i), content: [{ type: 'text', text: i === 0 ? 'Looking at it now.' : 'Working through the next step.' }], stop_reason: i === n - 1 ? 'end_turn' : null, stop_sequence: null, usage: { input_tokens: rnd(3, 12), cache_creation_input_tokens: rnd(15000, 45000), cache_read_input_tokens: ctx, output_tokens: rnd(400, 1800), service_tier: 'standard' } }, requestId: 'req_' + hex(24) }, rnd(8000, 40000));
        }
      }
      fs.writeFileSync(file, lines.join('\n') + '\n');
      try { fs.utimesSync(file, new Date(t), new Date(t)); } catch {}
      out.push(file);
    }
  }
  return out;
}
const pickModel = i => ['claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'][i % 4 === 3 && i % 8 === 3 ? 2 : i % 4 === 1 ? 3 : 0];

module.exports = { cast, history, ROOT, SEP };
