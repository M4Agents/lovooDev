export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(410).json({
    error: 'gone',
    message: 'Este endpoint foi desativado.'
  })
}
