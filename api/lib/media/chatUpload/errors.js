export class ChatUploadError extends Error {
  constructor(status, publicError) {
    super(publicError)
    this.name = 'ChatUploadError'
    this.status = status
    this.publicError = publicError
  }
}
