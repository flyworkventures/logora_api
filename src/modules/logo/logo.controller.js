const { asyncHandler } = require('../../utils/async-handler');
const { requireAuth } = require('../../middleware/require-auth');
const {
  deductTokensAndCreateJob,
  generateLogoWithGemini,
  refundTokens,
  TOKEN_COST_PER_LOGO,
} = require('./logo.service');
const { z } = require('zod');

const generateSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required'),
});

const generateLogo = [
  requireAuth,
  asyncHandler(async (req, res) => {
    // eslint-disable-next-line no-console
    console.log('[logo.controller] /logo/generate called');
    if (!req.auth) {
      // eslint-disable-next-line no-console
      console.log('[logo.controller] unauthorized request');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.log('[logo.controller] invalid body', parsed.error.flatten().fieldErrors);
      res.status(400).json({
        message: 'Invalid request body',
        issues: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      // eslint-disable-next-line no-console
      console.log('[logo.controller] token debit start', { deviceDbId: req.auth.deviceDbId });
      const debitResult = await deductTokensAndCreateJob({
        deviceDbId: req.auth.deviceDbId,
        prompt: parsed.data.prompt,
      });
      // eslint-disable-next-line no-console
      console.log('[logo.controller] token debit success', {
        generationId: debitResult.generationId,
        tokenBalance: debitResult.tokenBalance,
      });

      let generationResult;
      try {
        // eslint-disable-next-line no-console
        console.log('[logo.controller] gemini generation start', {
          generationId: debitResult.generationId,
        });
        generationResult = await generateLogoWithGemini({
          prompt: parsed.data.prompt,
          generationId: debitResult.generationId,
        });
        // eslint-disable-next-line no-console
        console.log('[logo.controller] gemini generation success', {
          generationId: generationResult.generationId,
          mimeType: generationResult.mimeType,
          imageLength: generationResult.imageBase64?.length || 0,
        });
      } catch (generationError) {
        // eslint-disable-next-line no-console
        console.error('[logo.controller] gemini generation failed, refund start', {
          message: generationError?.message,
          statusCode: generationError?.statusCode,
        });
        await refundTokens({ deviceDbId: req.auth.deviceDbId });
        // eslint-disable-next-line no-console
        console.error('[logo.controller] refund completed');
        throw generationError;
      }

      res.status(200).json({
        message: 'Logo generated successfully',
        tokenCost: TOKEN_COST_PER_LOGO,
        tokenBalance: debitResult.tokenBalance,
        ...generationResult,
      });
    } catch (error) {
      if (error && error.statusCode === 402) {
        // eslint-disable-next-line no-console
        console.error('[logo.controller] insufficient token', error.message);
        res.status(402).json({ message: error.message, tokenCost: TOKEN_COST_PER_LOGO });
        return;
      }
      if (error && error.statusCode === 503) {
        // eslint-disable-next-line no-console
        console.error('[logo.controller] gemini key/config error', error.message);
        res.status(503).json({ message: error.message });
        return;
      }
      if (error && error.statusCode === 504) {
        // eslint-disable-next-line no-console
        console.error('[logo.controller] gemini timeout', error.message);
        res.status(504).json({ message: error.message });
        return;
      }
      if (error && error.statusCode === 502) {
        // eslint-disable-next-line no-console
        console.error('[logo.controller] gemini upstream error', error.message);
        res.status(502).json({ message: error.message });
        return;
      }

      // eslint-disable-next-line no-console
      console.error('[logo.controller] unexpected error', error);

      throw error;
    }
  }),
];

module.exports = { generateLogo };
