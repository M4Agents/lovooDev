export class CatalogUploadError extends Error {
  constructor(status, publicError) {
    super(publicError)
    this.name = 'CatalogUploadError'
    this.status = status
    this.publicError = publicError
  }
}
