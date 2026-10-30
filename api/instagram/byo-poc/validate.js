import { handleByoValidationPost } from '../../lib/instagram/byoValidationHttp.js';

export default function handler(req, res) {
  return handleByoValidationPost(req, res, 'validate');
}
