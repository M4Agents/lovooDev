import { handleByoWebhookSetup } from '../../lib/instagram/byoWebhookSetupHttp.js';

export default function handler(req, res) {
  return handleByoWebhookSetup(req, res);
}
