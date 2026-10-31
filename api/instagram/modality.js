import { handleInstagramModality } from '../lib/instagram/instagramModalityHttp.js';

export default function handler(req, res) {
  return handleInstagramModality(req, res);
}
