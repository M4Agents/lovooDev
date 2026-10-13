import { describe, expect, it } from 'vitest'
import { tasklessPage } from '../tasklessLeadAccess'

describe('tasklessPage', () => {
  it('marca a primeira página de 50 e libera só o próximo', () => {
    expect(tasklessPage(0, 50, 211)).toEqual({
      from: 1,
      to: 50,
      hasPrev: false,
      hasNext: true,
    })
  })

  it('marca a última página incompleta e libera só o anterior', () => {
    expect(tasklessPage(200, 11, 211)).toEqual({
      from: 201,
      to: 211,
      hasPrev: true,
      hasNext: false,
    })
  })
})
