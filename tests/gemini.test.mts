// ── Failure classification and the fallback chain ────────────────────────
const { classifyFailure, callGemini, GeminiError, listModels, MODEL_CHAIN } = await import('../src/lib/gemini');

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

const apiErr = (code: number, message: string, status = '') =>
  JSON.stringify({ error: { code, message, ...(status ? { status } : {}) } });

// ── the message Google actually sends for a bad key ──────────────────────
const badKey = classifyFailure(400, apiErr(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT'));
ok(badKey.kind === 'key', `a bad key is recognised as a key problem, not a model problem (got ${badKey.kind})`);
ok(badKey.detail === 'API key not valid. Please pass a valid API key.', 'Google’s own words survive to the surface');
ok(/aistudio\.google\.com/.test(badKey.hint), 'the hint says where to get a real key');
ok(/AIza/.test(badKey.hint), 'and what one looks like');

ok(classifyFailure(403, apiErr(403, 'Permission denied', 'PERMISSION_DENIED')).kind === 'key', '403 is a key problem');
ok(classifyFailure(401, '').kind === 'key', '401 is a key problem');

// ── model availability ───────────────────────────────────────────────────
ok(classifyFailure(404, apiErr(404, 'models/gemini-9-flash is not found for API version v1beta')).kind === 'missing-model', '404 is a missing model');
ok(classifyFailure(400, apiErr(400, 'Model gemini-x is not supported for generateContent')).kind === 'missing-model',
   'a 400 that says "not supported" is still just a missing model');

// ── quota ────────────────────────────────────────────────────────────────
ok(classifyFailure(429, apiErr(429, 'Resource has been exhausted')).kind === 'quota', '429 is quota');
ok(classifyFailure(400, apiErr(400, 'You exceeded your current quota')).kind === 'quota', 'a quota message is quota whatever the status');

// ── anything else that is a 400 is the request itself ────────────────────
const bad = classifyFailure(400, apiErr(400, 'Invalid JSON payload received. Unknown name "responseSchema"'));
ok(bad.kind === 'bad-request', 'an unrecognised 400 is a request problem');
ok(/Unknown name/.test(bad.detail), 'the specific complaint is preserved');

// non-JSON bodies still yield something readable
ok(classifyFailure(500, '<html>Internal Error</html>').detail.includes('Internal Error'), 'HTML error bodies are not swallowed');
ok(classifyFailure(503, '').detail === 'HTTP 503', 'an empty body still names the status');

// ── the chain: what it tries, and when it stops ──────────────────────────
type Call = { url: string; body: string };
function stubFetch(handler: (c: Call) => { status: number; body: string }) {
  const calls: Call[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown, init?: unknown) => {
    const c = { url: String(url), body: String((init as { body?: string })?.body ?? '') };
    calls.push(c);
    const r = handler(c);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    } as unknown as Response;
  };
  return calls;
}
const realFetch = globalThis.fetch;
const modelOf = (c: Call) => c.url.match(/models\/([^:?]+)/)?.[1] ?? '';
const goodBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"items":[],"classes":[]}' }] } }] });

// a bad key stops immediately — it is bad on every model
{
  const calls = stubFetch(() => ({ status: 400, body: apiErr(400, 'API key not valid. Please pass a valid API key.') }));
  let caught: unknown;
  try { await callGemini('bad', 'gemini-2.5-flash', [{ text: 'hi' }]); } catch (e) { caught = e; }
  ok(caught instanceof GeminiError && caught.kind === 'key', 'a bad key throws a key error');
  ok(calls.length === 1, `and stops after one call, not ${calls.length} (the old code made ${MODEL_CHAIN.length}+)`);
  ok((caught as InstanceType<typeof GeminiError>).attempts.length === 1, 'the attempt is reported');
}

// a missing model moves on to the next one
{
  const calls = stubFetch(c => modelOf(c) === 'gemini-2.5-flash'
    ? { status: 404, body: apiErr(404, 'not found for API version v1beta') }
    : { status: 200, body: goodBody });
  const r = await callGemini('k', 'gemini-2.5-flash', [{ text: 'hi' }]);
  ok(r.model !== 'gemini-2.5-flash', `fell through to ${r.model}`);
  ok(calls.length === 2, 'exactly one extra call was needed');
  ok(r.attempts[0].kind === 'missing-model' && r.attempts[1].kind === 'ok', 'both attempts are reported');
}

// a schema rejection retries the SAME model without the strict format
{
  const calls = stubFetch(c => /responseSchema/.test(c.body)
    ? { status: 400, body: apiErr(400, 'Invalid value at generation_config.response_schema') }
    : { status: 200, body: goodBody });
  const r = await callGemini('k', 'gemini-2.5-flash', [{ text: 'PROMPT' }]);
  ok(r.model === 'gemini-2.5-flash', 'stayed on the same model');
  ok(calls.length === 2, 'one retry, not a walk down the chain');
  ok(!/responseSchema/.test(calls[1].body), 'the retry drops the strict response format');
  ok(/Return ONLY a JSON object/.test(JSON.parse(calls[1].body).contents[0].parts[0].text), 'and describes the shape in the prompt instead');
  ok(r.attempts[1].schemaless === true, 'the retry is labelled as such');
}

// everything missing → one clear message naming the fix
{
  stubFetch(() => ({ status: 404, body: apiErr(404, 'is not found for API version v1beta') }));
  let caught: InstanceType<typeof GeminiError> | null = null;
  try { await callGemini('k', 'gemini-2.5-flash', [{ text: 'hi' }]); } catch (e) { caught = e as InstanceType<typeof GeminiError>; }
  ok(caught?.kind === 'missing-model', 'reported as a model problem');
  ok(/Check key/.test(caught?.hint ?? ''), 'and points at the one button that resolves it');
  ok((caught?.attempts.length ?? 0) >= MODEL_CHAIN.length, 'every model was actually tried');
}

// quota everywhere → says so plainly instead of blaming the model
{
  stubFetch(() => ({ status: 429, body: apiErr(429, 'Resource has been exhausted (e.g. check quota).') }));
  let caught: InstanceType<typeof GeminiError> | null = null;
  try { await callGemini('k', 'gemini-2.5-flash', [{ text: 'hi' }]); } catch (e) { caught = e as InstanceType<typeof GeminiError>; }
  ok(caught?.kind === 'quota', 'reported as quota');
  ok(/free-tier|another model/i.test(caught?.hint ?? ''), 'with something to do about it');
}

// ── replies that are not clean JSON are still salvaged ───────────────────
for (const [name, text] of [
  ['a code fence', '```json\n{"items":[1]}\n```'],
  ['a sentence around it', 'Here you go:\n{"items":[1]}\nHope that helps.'],
  ['plain json', '{"items":[1]}'],
] as const) {
  stubFetch(() => ({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) }));
  const r = await callGemini('k', 'gemini-2.5-flash', [{ text: 'hi' }]);
  ok(JSON.stringify(r.json) === '{"items":[1]}', `JSON survives ${name}`);
}

// a blocked prompt is named, not reported as an empty failure
{
  stubFetch(() => ({ status: 200, body: JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }) }));
  let caught: InstanceType<typeof GeminiError> | null = null;
  try { await callGemini('k', 'gemini-2.5-flash', [{ text: 'hi' }]); } catch (e) { caught = e as InstanceType<typeof GeminiError>; }
  ok(/SAFETY/.test(caught?.message ?? ''), `the block reason reaches the surface: ${caught?.message}`);
}

// ── output ceilings ──────────────────────────────────────────────────────
{
  const calls = stubFetch(() => ({ status: 200, body: goodBody }));
  await callGemini('k', 'gemini-2.0-flash', [{ text: 'hi' }]);
  ok(JSON.parse(calls[0].body).generationConfig.maxOutputTokens === 8192,
     'older flash models get their real 8192 ceiling, not a value they would reject');
  const c2 = stubFetch(() => ({ status: 200, body: goodBody }));
  await callGemini('k', 'gemini-2.5-flash', [{ text: 'hi' }]);
  ok(JSON.parse(c2[0].body).generationConfig.maxOutputTokens === 16384, 'newer ones get the larger ceiling');
}

// ── listing models ───────────────────────────────────────────────────────
{
  stubFetch(() => ({
    status: 200,
    body: JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/imagen-3', supportedGenerationMethods: ['generateContent'] },
    ] }),
  }));
  const r = await listModels('k');
  ok(r.ok && r.models.includes('gemini-2.5-flash'), 'usable models are listed');
  ok(!r.models.includes('text-embedding-004'), 'embedding models are filtered out');
  ok(!r.models.includes('imagen-3'), 'image models are filtered out');
  ok(r.models[0].includes('flash'), 'flash is offered first');
}
{
  stubFetch(() => ({ status: 400, body: apiErr(400, 'API key not valid. Please pass a valid API key.') }));
  const r = await listModels('bad');
  ok(!r.ok && /not valid/.test(r.error ?? ''), 'a bad key is reported plainly by the checker too');
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
