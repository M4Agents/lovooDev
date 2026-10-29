import { handleByoCredentialPost } from '../../lib/instagram/byoCredentialHttp.js';

export default function handler(req, res) {
  return handleByoCredentialPost(req, res, 'revoke');
}
