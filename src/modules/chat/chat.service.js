const { env } = require('../../config/env');

const buildMessages = ({ messages, logoContext, logoImageDataUrl, responseLanguage }) => {
  const language = String(responseLanguage || 'en').trim().toLowerCase();
  const systemText = [
    'You are Logora AI logo assistant.',
    `Always reply in this language code: ${language}.`,
    'Never switch language unless explicitly asked by the user.',
    'Help user ideate, refine, and evaluate logo concepts.',
    'When discussing logos, give concrete design guidance (shape, color, typography, usage).',
    logoContext ? `Logo context from app: ${logoContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const safeMessages = Array.isArray(messages) ? messages : [];
  const normalized = safeMessages
    .map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content || '').trim(),
    }))
    .filter((m) => m.content.length > 0);

  const imageMessage =
    logoImageDataUrl && logoImageDataUrl.startsWith('data:image/')
      ? [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Bu logoyu analiz et ve sonraki sorulara bu görsele göre cevap ver.' },
              { type: 'image_url', image_url: { url: logoImageDataUrl } },
            ],
          },
        ]
      : [];

  return [{ role: 'system', content: systemText }, ...imageMessage, ...normalized];
};

const generateChatReply = async ({ messages, logoContext, logoImageDataUrl, responseLanguage }) => {
  if (!env.openAiApiKey) {
    const error = new Error('OpenAI API key is not configured');
    error.statusCode = 503;
    throw error;
  }

  const payload = {
    model: env.openAiModel,
    temperature: 0.7,
    messages: buildMessages({ messages, logoContext, logoImageDataUrl, responseLanguage }),
  };

  // eslint-disable-next-line no-console
  console.log('[chat.service] OpenAI request', {
    model: env.openAiModel,
    messageCount: payload.messages.length,
    hasLogoContext: Boolean(logoContext),
    hasLogoImage: Boolean(logoImageDataUrl),
    responseLanguage: responseLanguage || 'en',
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openAiApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.json().catch(() => ({}));
  // eslint-disable-next-line no-console
  console.log('[chat.service] OpenAI response', {
    status: response.status,
    ok: response.ok,
    error: raw?.error?.message,
  });

  if (!response.ok) {
    const message = raw?.error?.message || 'OpenAI request failed';
    const error = new Error(message);
    error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }

  const content = raw?.choices?.[0]?.message?.content?.toString() || '';
  if (!content) {
    const error = new Error('OpenAI returned empty message');
    error.statusCode = 502;
    throw error;
  }

  return {
    message: content,
    model: env.openAiModel,
    provider: 'openai',
  };
};

module.exports = { generateChatReply };
