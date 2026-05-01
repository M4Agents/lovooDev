export default async function handler(req, res) {
  return res.status(410).json({
    success: false,
    error: 'Este endpoint foi descontinuado. Use /api/uazapi-webhook-final.'
  })
}
