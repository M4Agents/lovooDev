import { handleByoDiscoveryDiagnostic } from '../../lib/instagram/byoDiscoveryDiagnosticHttp.js';

export default function handler(req, res) {
  return handleByoDiscoveryDiagnostic(req, res);
}
