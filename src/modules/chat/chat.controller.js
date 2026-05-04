const { z } = require('zod');
const { asyncHandler } = require('../../utils/async-handler');
const { requireAuth } = require('../../middleware/require-auth');
const { generateChatReply } = require('./chat.service');

const chatSchema = z.object({
  logoContext: z.string().trim().nullish(),
  logoImageDataUrl: z.string().trim().nullish(),
  responseLanguage: z.string().trim().min(2).max(16).nullish(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1),
      }),
    )
    .min(1, 'messages is required'),
});

const chatReply = [
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid request body',
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const result = await generateChatReply({
        messages: parsed.data.messages,
        logoContext: parsed.data.logoContext,
        logoImageDataUrl: parsed.data.logoImageDataUrl,
        responseLanguage: parsed.data.responseLanguage,
      });
      res.status(200).json(result);
    } catch (error) {
      if (error && error.statusCode) {
        res.status(error.statusCode).json({ message: error.message });
        return;
      }
      throw error;
    }
  }),
];

module.exports = { chatReply };
