export class LibraryUploadError extends Error {
  constructor(status, publicError) {
    super(publicError)
    this.name = 'LibraryUploadError'
    this.status = status
    this.publicError = publicError
  }
}
