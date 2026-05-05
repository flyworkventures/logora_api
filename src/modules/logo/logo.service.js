const { randomUUID } = require('crypto');
const { pool } = require('../../db/mysql');
const { env } = require('../../config/env');

const TOKEN_COST_PER_LOGO = 5;
const FIXED_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const FIXED_OPENAI_IMAGE_MODEL = env.openAiImageModel || 'gpt-image-1';
const OVERLOAD_RETRY_COUNT = 2;
const SYNC_VARIANT_COUNT = 0;
const OPENAI_IMAGE_SIZE = '512x512';
const OPENAI_IMAGE_QUALITY = 'low';
const FORCE_GEMINI_SVG = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HEX_COLOR_REGEX = /#([0-9A-Fa-f]{6})\b/g;
const FIELD_REGEX = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'im');

const normalizeHexColor = (value) => {
  const raw = String(value || '').trim().replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
};

const extractPaletteFromPrompt = (prompt) => {
  const matches = String(prompt || '').match(HEX_COLOR_REGEX) || [];
  const unique = [];
  for (const match of matches) {
    const normalized = normalizeHexColor(match);
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
};

const extractFieldFromPrompt = (prompt, fieldName) => {
  const raw = String(prompt || '');
  const match = raw.match(FIELD_REGEX(fieldName));
  if (!match) return '';
  return String(match[1] || '').trim();
};

const randomHexColor = () => {
  const value = Math.floor(Math.random() * 0xffffff);
  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
};

const buildVariationPalette = (basePalette) => {
  const primary = basePalette[0] || '#367AE8';
  const secondary = basePalette[1] || '#3D3EE4';
  const accent = basePalette[2] || '#111827';

  const first = [primary, secondary, accent];
  const second = [randomHexColor(), randomHexColor(), randomHexColor()];
  const third = [randomHexColor(), randomHexColor(), randomHexColor()];
  return [first, second, third];
};

const buildProfessionalBasePrompt = ({ userPrompt, palette }) => {
  const paletteText = palette.length > 0 ? palette.join(', ') : '#367AE8, #3D3EE4, #111827';
  const industry = extractFieldFromPrompt(userPrompt, 'Industry');
  const style = extractFieldFromPrompt(userPrompt, 'Style');
  return [
    'You are a senior brand identity designer with 15+ years of experience.',
    'Create a professional, production-ready, premium logo.',
    industry
      ? `Target industry (must strongly guide concept): ${industry}.`
      : 'Target industry: generic business.',
    style
      ? `Target style (must strongly guide visual language): ${style}.`
      : 'Target style: modern minimal.',
    'Design goals:',
    '- Clear brand symbol with strong visual hierarchy and balanced negative space.',
    '- Clean geometry, consistent stroke logic, and scalable vector construction.',
    '- Distinctive yet timeless look suitable for app icon, web header, and print.',
    '- Avoid clipart feel, noise, chaotic details, and overly playful amateur style.',
    '- Ensure high contrast and legibility on dark and light backgrounds.',
    `Preferred palette: ${paletteText}.`,
    'Hard constraints:',
    '- Output a single centered logo on transparent background.',
    '- Keep canvas width and height exactly 1024.',
    '- No mockup/photo/background scene.',
    '- Industry and style constraints are mandatory and must be visible in icon language, shape and typography.',
    '- If there is a conflict, prioritize Industry and Style over generic creativity.',
    '- Keep background transparent.',
    '- Keep typography minimal and clean if text is included.',
    '',
    'Client brief:',
    userPrompt,
  ].join('\n');
};

const requestPngLogoWithOpenAi = async ({ model, prompt, apiKey, signal }) => {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model,
      prompt,
      size: OPENAI_IMAGE_SIZE,
      quality: OPENAI_IMAGE_QUALITY,
      background: 'transparent',
      output_format: 'png',
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = raw?.error?.message || 'OpenAI image generation failed';
    const error = new Error(message);
    error.statusCode =
      response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }

  const imageBase64 =
    raw?.data?.[0]?.b64_json || raw?.data?.[0]?.image_base64 || '';
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    const error = new Error('OpenAI image response is empty');
    error.statusCode = 502;
    throw error;
  }

  return {
    mimeType: 'image/png',
    imageBase64,
    description: 'Generated via OpenAI image model',
    provider: 'openai',
    model,
  };
};

const deductTokensAndCreateJob = async ({ deviceDbId, prompt }) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, device_id AS deviceId, token_balance AS tokenBalance
       FROM devices
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [deviceDbId],
    );

    const device = rows[0];

    if (!device) {
      throw new Error('Device not found');
    }

    if (Number(device.tokenBalance) < TOKEN_COST_PER_LOGO) {
      const error = new Error('Insufficient token balance');
      error.statusCode = 402;
      throw error;
    }

    const nextBalance = Number(device.tokenBalance) - TOKEN_COST_PER_LOGO;

    await connection.execute(
      `UPDATE devices
       SET token_balance = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextBalance, deviceDbId],
    );

    const generationId = randomUUID();

    await connection.commit();

    return {
      generationId,
      deviceDbId,
      deviceId: device.deviceId,
      tokenCost: TOKEN_COST_PER_LOGO,
      tokenBalance: nextBalance,
      prompt,
      status: 'processing',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const refundTokens = async ({ deviceDbId }) => {
  await pool.execute(
    `UPDATE devices
     SET token_balance = token_balance + ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [TOKEN_COST_PER_LOGO, deviceDbId],
  );
};

const extractSvg = (text) => {
  if (!text || typeof text !== 'string') return '';
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) return '';
  return text.slice(start, end + '</svg>'.length).trim();
};

const requestSvgLogoWithTextModel = async ({ model, prompt, apiKey, signal }) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let lastError = null;
  let lastRetryableOverloadMessage = '';
  for (let attempt = 1; attempt <= OVERLOAD_RETRY_COUNT; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = raw?.error?.message || 'Gemini text fallback failed';
      const retryableOverload =
        response.status === 503 ||
        response.status === 429 ||
        (typeof message === 'string' &&
          (message.toLowerCase().includes('high demand') ||
            message.toLowerCase().includes('try again later')));
      if (retryableOverload && attempt < OVERLOAD_RETRY_COUNT) {
        // eslint-disable-next-line no-console
        console.warn('[logo.service] overload retry', { model, attempt, message });
        await sleep(2000 * attempt);
        continue;
      }
      if (retryableOverload) {
        lastRetryableOverloadMessage = message;
      }
      const error = new Error(message);
      error.statusCode = 502;
      lastError = error;
      break;
    }

    const parts = raw?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((part) => typeof part?.text === 'string');
    const svg = extractSvg(textPart?.text || '');
    if (!svg) {
      const error = new Error(`Model ${model} did not return valid SVG`);
      error.statusCode = 502;
      lastError = error;
      break;
    }

    return {
      mimeType: 'image/svg+xml',
      imageBase64: Buffer.from(svg, 'utf8').toString('base64'),
      description: 'Generated via SVG text fallback',
    };
  }

  if (lastRetryableOverloadMessage) {
    const overloadError = new Error(
      `Gemini model is under high demand. Please retry shortly. Details: ${lastRetryableOverloadMessage}`,
    );
    overloadError.statusCode = 503;
    throw overloadError;
  }

  throw lastError || new Error(`Model ${model} SVG fallback failed`);
};

const requestSvgWithFixedModel = async ({ prompt, apiKey, signal }) => {
  const model = env.geminiModel || FIXED_GEMINI_MODEL;
  // eslint-disable-next-line no-console
  console.log('[logo.service] using fixed model only', { model });
  const result = await requestSvgLogoWithTextModel({
    model,
    prompt,
    apiKey,
    signal,
  });
  return { ...result, model };
};

const generateLogoWithGemini = async ({ prompt, generationId }) => {
  // eslint-disable-next-line no-console
  console.log('[logo.service] generateLogoWithGemini called', {
    generationId,
    promptLength: prompt?.length || 0,
    model: env.geminiModel,
  });

  if (!env.geminiApiKey) {
    const error = new Error('Gemini API key is not configured');
    error.statusCode = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.logoGenerateTimeoutMs);

  try {
    const basePalette = extractPaletteFromPrompt(prompt);
    const professionalPrompt = buildProfessionalBasePrompt({
      userPrompt: prompt,
      palette: basePalette,
    });

    const openAiImageModel = FIXED_OPENAI_IMAGE_MODEL;
    const canUseOpenAi = !FORCE_GEMINI_SVG && Boolean(env.openAiApiKey);

    let mainResult;
    if (canUseOpenAi) {
      // eslint-disable-next-line no-console
      console.log('[logo.service] using OpenAI image model', { model: openAiImageModel });
      mainResult = await requestPngLogoWithOpenAi({
        model: openAiImageModel,
        prompt: professionalPrompt,
        apiKey: env.openAiApiKey,
        signal: controller.signal,
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn('[logo.service] OPENAI_API_KEY missing, fallback to Gemini');
      mainResult = await requestSvgWithFixedModel({
        prompt: professionalPrompt,
        apiKey: env.geminiApiKey,
        signal: controller.signal,
      });
    }

    let variants = [];
    if (SYNC_VARIANT_COUNT > 0) {
      const palettes = buildVariationPalette(basePalette).slice(0, SYNC_VARIANT_COUNT);
      const variantPrompts = palettes.map(
        (palette, index) =>
          `${professionalPrompt}\n\n` +
          `Variation #${index + 1} color rules:\n` +
          `- Use this exact palette: ${palette.join(', ')}\n` +
          '- Preserve the same core logo concept and structure.\n' +
          '- Change ONLY colors; do not change symbol geometry, layout, spacing, or composition.\n',
      );

      const variantTasks = variantPrompts.map(async (variantPrompt, index) => {
        // eslint-disable-next-line no-console
        console.log('[logo.service] generating variation', { index: index + 1 });
        const variant = canUseOpenAi
          ? await requestPngLogoWithOpenAi({
              model: openAiImageModel,
              prompt: variantPrompt,
              apiKey: env.openAiApiKey,
              signal: controller.signal,
            })
          : await requestSvgWithFixedModel({
              prompt: variantPrompt,
              apiKey: env.geminiApiKey,
              signal: controller.signal,
            });

        return {
          mimeType: variant.mimeType,
          imageBase64: variant.imageBase64,
          description:
            index === 0
              ? `Variation 1 (user palette: ${palettes[index].join(', ')})`
              : `Variation ${index + 1} (random palette: ${palettes[index].join(', ')})`,
        };
      });

      const variantSettled = await Promise.allSettled(variantTasks);
      variants = variantSettled.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        // eslint-disable-next-line no-console
        console.warn('[logo.service] variation generation failed, using primary fallback', {
          index: index + 1,
          message: result.reason?.message,
        });
        return {
          mimeType: mainResult.mimeType,
          imageBase64: mainResult.imageBase64,
          description: `Variation ${index + 1} (fallback)`,
        };
      });
    }

    return {
      generationId,
      status: 'completed',
      mimeType: variants[0]?.mimeType || mainResult.mimeType,
      imageBase64: variants[0]?.imageBase64 || mainResult.imageBase64,
      description: variants[0]?.description || mainResult.description,
      provider: mainResult.provider || (canUseOpenAi ? 'openai' : 'gemini'),
      model:
        mainResult.model ||
        (canUseOpenAi ? openAiImageModel : env.geminiModel || FIXED_GEMINI_MODEL),
      variants,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[logo.service] gemini request failed', {
      message: error?.message,
      name: error?.name,
      statusCode: error?.statusCode,
    });
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Gemini request timed out');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  deductTokensAndCreateJob,
  generateLogoWithGemini,
  refundTokens,
  TOKEN_COST_PER_LOGO,
};
