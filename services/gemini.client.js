const fetch = require('node-fetch');

const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30000;
const DEFAULT_COOLDOWN_MS = 60000;
const DEFAULT_SPACING_MS = process.env.NODE_ENV === 'test' ? 0 : 1000;

// Key state: { key: string, quarantinedUntil: number, totalCalls: number, failCount: number }
let keyPool = [];
let currentKeyIndex = 0;

// Dual-priority queue state
const highQueue = [];
const lowQueue = [];
let activeInFlight = 0;
let lastRequestEndTime = 0;

/**
 * Extracts and sanitizes API keys from environment variables.
 * Supports comma-separated keys in GEMINI_API_KEYS or GEMINI_API_KEY.
 *
 * @returns {Array<string>}
 */
function parseApiKeys() {
  const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Initializes or refreshes the internal key pool.
 */
function initPool() {
  const keys = parseApiKeys();
  const existingMap = new Map(keyPool.map((item) => [item.key, item]));

  keyPool = keys.map((key) => {
    if (existingMap.has(key)) {
      return existingMap.get(key);
    }
    return {
      key,
      quarantinedUntil: 0,
      totalCalls: 0,
      failCount: 0,
    };
  });
}

/**
 * Selects the next healthy key using round-robin rotation.
 *
 * @returns {{ keyObj: Object|null, minQuarantinedUntil: number }}
 */
function getNextHealthyKey() {
  initPool();
  if (keyPool.length === 0) {
    return { keyObj: null, minQuarantinedUntil: 0 };
  }

  const now = Date.now();
  let minQuarantinedUntil = Infinity;

  for (let i = 0; i < keyPool.length; i++) {
    const idx = (currentKeyIndex + i) % keyPool.length;
    const item = keyPool[idx];

    if (item.quarantinedUntil <= now) {
      currentKeyIndex = (idx + 1) % keyPool.length;
      return { keyObj: item, minQuarantinedUntil: 0 };
    }

    if (item.quarantinedUntil < minQuarantinedUntil) {
      minQuarantinedUntil = item.quarantinedUntil;
    }
  }

  return { keyObj: null, minQuarantinedUntil };
}

/**
 * Quarantines an API key following an HTTP 429 response.
 *
 * @param {Object} keyObj
 * @param {number} [retryAfterSeconds]
 */
function quarantineKey(keyObj, retryAfterSeconds) {
  if (!keyObj) return;
  const cooldownMs = retryAfterSeconds && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : DEFAULT_COOLDOWN_MS;

  keyObj.quarantinedUntil = Date.now() + cooldownMs;
  keyObj.failCount += 1;
  console.warn(`Gemini API key ${keyObj.key.slice(0, 6)}... quarantined for ${Math.round(cooldownMs / 1000)}s.`);
}

/**
 * Dispatches queued requests respecting priority and spacing.
 */
function processQueue() {
  if (activeInFlight >= 1) return;

  const task = highQueue.length > 0 ? highQueue.shift() : lowQueue.shift();
  if (!task) return;

  const now = Date.now();
  const spacing = Number(process.env.GEMINI_MIN_REQUEST_INTERVAL_MS) || DEFAULT_SPACING_MS;
  const timeSinceLast = now - lastRequestEndTime;
  const waitTime = Math.max(0, spacing - timeSinceLast);

  activeInFlight += 1;

  setTimeout(async () => {
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      activeInFlight -= 1;
      lastRequestEndTime = Date.now();
      processQueue();
    }
  }, waitTime);
}

/**
 * Enqueues an async operation into the priority queue.
 *
 * @param {Function} fn
 * @param {'high'|'low'} priority
 * @returns {Promise<any>}
 */
function enqueue(fn, priority = 'high') {
  return new Promise((resolve, reject) => {
    const task = { fn, resolve, reject };
    if (priority === 'low') {
      lowQueue.push(task);
    } else {
      highQueue.push(task);
    }
    processQueue();
  });
}

/**
 * Calls Gemini content generation with key rotation, 429 failover, and 503 model cascade.
 *
 * @param {Object} options
 * @param {string} [options.prompt]
 * @param {Object} [options.payload]
 * @param {Array<string>} [options.candidateModels]
 * @param {'high'|'low'} [options.priority='high']
 * @param {number} [options.timeoutMs=20000]
 * @param {string} [options.responseMimeType]
 * @returns {Promise<Object>} Parsed Gemini response
 */
async function generateContent(options = {}) {
  const {
    prompt,
    payload,
    candidateModels,
    priority = 'high',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    responseMimeType,
  } = options;

  return enqueue(async () => {
    const envModel = (process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim();
    const safeBaseModel = /gemini-flash-latest|gemini-3\.8/i.test(envModel) ? 'gemini-3.6-flash' : envModel;
    const configuredModels = candidateModels && candidateModels.length > 0
      ? candidateModels
      : [safeBaseModel, ...DEFAULT_MODELS];
    const uniqueModels = Array.from(new Set(configuredModels.filter(Boolean)));

    const requestPayload = payload || {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };

    if (responseMimeType) {
      requestPayload.generationConfig = {
        ...(requestPayload.generationConfig || {}),
        responseMimeType,
      };
    }

    let lastError = null;

    for (const currentModel of uniqueModels) {
      let modelSucceeded = false;
      const totalKeys = Math.max(keyPool.length, 1);

      for (let attempt = 0; attempt < totalKeys * 2; attempt++) {
        const { keyObj, minQuarantinedUntil } = getNextHealthyKey();

        if (!keyObj) {
          if (minQuarantinedUntil === 0) {
            const err = new Error('GEMINI_API_KEY is not set in environment.');
            err.statusCode = 500;
            throw err;
          }
          const waitSeconds = Math.max(1, Math.ceil((minQuarantinedUntil - Date.now()) / 1000));
          const err = new Error(`All AI processing capacity is temporarily rate-limited. Please wait ${waitSeconds}s before retrying.`);
          err.statusCode = 429;
          err.code = 'ALL_KEYS_QUOTA_EXHAUSTED';
          err.retryAfter = waitSeconds;
          throw err;
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${encodeURIComponent(keyObj.key)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          keyObj.totalCalls += 1;
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
            signal: controller.signal,
          });

          let rawText = '';
          if (typeof response.text === 'function') {
            rawText = await response.text();
          } else if (typeof response.json === 'function') {
            const jsonObj = await response.json();
            rawText = JSON.stringify(jsonObj);
          }

          let parsed;
          try {
            parsed = rawText ? JSON.parse(rawText) : {};
          } catch {
            parsed = {};
          }

          if (response.status === 429) {
            const retryHeader = response.headers && typeof response.headers.get === 'function'
              ? parseInt(response.headers.get('retry-after'), 10)
              : NaN;
            quarantineKey(keyObj, retryHeader || 60);
            lastError = new Error(parsed?.error?.message || 'Gemini API: HTTP 429 Rate Limit');
            lastError.statusCode = 429;
            continue; // Immediately fail over to next healthy key
          }

          const isCapacityOrOverload =
            response.status === 503 ||
            response.status === 504 ||
            /high demand|overload|unavailable|no capacity/i.test(rawText) ||
            parsed?.error?.status === 'UNAVAILABLE' ||
            parsed?.error?.code === 503;

          if (isCapacityOrOverload) {
            console.warn(`Model ${currentModel} overloaded or unavailable (${response.status || parsed?.error?.code}). Cascading to next model.`);
            lastError = new Error(parsed?.error?.message || `Gemini Model Overloaded (${currentModel})`);
            lastError.statusCode = 503;
            break; // Cascade to next model
          }

          if (!response.ok) {
            const msg = parsed?.error?.message || rawText.slice(0, 200) || `HTTP ${response.status}`;
            const err = new Error(`Gemini API: ${msg}`);
            err.statusCode = response.status;
            throw err;
          }

          return parsed;
        } catch (err) {
          lastError = err;
          if (err.name === 'AbortError') {
            const timeoutErr = new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s.`);
            timeoutErr.statusCode = 504;
            throw timeoutErr;
          }
          if (err.statusCode && err.statusCode !== 429 && err.statusCode !== 503) {
            throw err;
          }
        } finally {
          clearTimeout(timeout);
        }
      }

      if (modelSucceeded) break;
    }

    if (lastError) throw lastError;
    const err = new Error('No response returned from Gemini.');
    err.statusCode = 502;
    throw err;
  }, priority);
}

/**
 * Batched vector embedding generation.
 *
 * @param {Object} options
 * @param {Array<string>} options.texts
 * @param {string} [options.model='gemini-embedding-001']
 * @param {'high'|'low'} [options.priority='low']
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<Array<Array<number>>|null>}
 */
async function batchEmbedContents(options = {}) {
  const { texts, model = 'gemini-embedding-001', priority = 'low', timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (!Array.isArray(texts) || texts.length === 0) return null;

  return enqueue(async () => {
    const totalKeys = Math.max(1, keyPool.length);
    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const { keyObj, minQuarantinedUntil } = getNextHealthyKey();
      if (!keyObj) {
        if (minQuarantinedUntil === 0) return null;
        const waitSeconds = Math.max(1, Math.ceil((minQuarantinedUntil - Date.now()) / 1000));
        const err = new Error(`All AI processing capacity is temporarily rate-limited. Please wait ${waitSeconds}s before retrying.`);
        err.statusCode = 429;
        err.retryAfter = waitSeconds;
        throw err;
      }

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(keyObj.key)}`;
      const payload = {
        requests: texts.map((t) => ({
          model: `models/${model}`,
          content: { parts: [{ text: t.slice(0, 2048) }] },
          outputDimensionality: 768,
        })),
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (response.status === 429) {
          const retryHeader = response.headers && typeof response.headers.get === 'function'
            ? parseInt(response.headers.get('retry-after'), 10)
            : NaN;
          quarantineKey(keyObj, retryHeader || 60);
          continue; // Seamlessly fail over to next healthy key
        }

        if (!response.ok) return null;
        const data = typeof response.json === 'function'
          ? await response.json()
          : (response.text ? JSON.parse(await response.text()) : null);
        return Array.isArray(data?.embeddings) ? data.embeddings.map((e) => e.values) : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }, priority);
}

/**
 * Single text embedding generation.
 *
 * @param {Object} options
 * @param {string} options.text
 * @param {string} [options.model='gemini-embedding-001']
 * @param {'high'|'low'} [options.priority='high']
 * @param {number} [options.timeoutMs=8000]
 * @returns {Promise<Array<number>|null>}
 */
async function embedContent(options = {}) {
  const { text, model = 'gemini-embedding-001', priority = 'high', timeoutMs = 8000 } = options;
  if (!text || typeof text !== 'string' || !text.trim()) return null;

  return enqueue(async () => {
    const totalKeys = Math.max(1, keyPool.length);
    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const { keyObj, minQuarantinedUntil } = getNextHealthyKey();
      if (!keyObj) {
        if (minQuarantinedUntil === 0) return null;
        const waitSeconds = Math.max(1, Math.ceil((minQuarantinedUntil - Date.now()) / 1000));
        const err = new Error(`All AI processing capacity is temporarily rate-limited. Please wait ${waitSeconds}s before retrying.`);
        err.statusCode = 429;
        err.retryAfter = waitSeconds;
        throw err;
      }

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(keyObj.key)}`;
      const payload = {
        model: `models/${model}`,
        content: { parts: [{ text: text.slice(0, 1024) }] },
        outputDimensionality: 768,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (response.status === 429) {
          const retryHeader = response.headers && typeof response.headers.get === 'function'
            ? parseInt(response.headers.get('retry-after'), 10)
            : NaN;
          quarantineKey(keyObj, retryHeader || 60);
          continue; // Seamlessly fail over to next healthy key
        }

        if (!response.ok) return null;
        const data = await response.json();
        return Array.isArray(data?.embedding?.values) ? data.embedding.values : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }, priority);
}

/**
 * Returns diagnostic key pool status.
 *
 * @returns {Object}
 */
function getKeyPoolStatus() {
  const now = Date.now();
  return {
    totalKeys: keyPool.length,
    activeKeys: keyPool.filter((k) => k.quarantinedUntil <= now).length,
    quarantinedKeys: keyPool.filter((k) => k.quarantinedUntil > now).length,
    queueLengths: {
      high: highQueue.length,
      low: lowQueue.length,
    },
  };
}

/**
 * Clears pool and queue state (for test teardowns).
 */
function resetPool() {
  keyPool = [];
  currentKeyIndex = 0;
  highQueue.length = 0;
  lowQueue.length = 0;
  activeInFlight = 0;
  lastRequestEndTime = 0;
}

module.exports = {
  parseApiKeys,
  initPool,
  getNextHealthyKey,
  quarantineKey,
  generateContent,
  batchEmbedContents,
  embedContent,
  getKeyPoolStatus,
  resetPool,
};
