import { handleByoWebhook } from '../../../lib/instagram/byoWebhookHttp.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return handleByoWebhook(req, res);
}
