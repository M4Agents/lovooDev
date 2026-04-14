// =====================================================
// EXECUTION LOCK — proteção contra processamento simultâneo
//
// Mecanismo: colunas locked_at + locked_by em automation_executions.
//
// acquireLock: UPDATE atômico com condição
//   → só adquire se não houver lock válido
//   → lock expirado (> TTL) pode ser sobrescrito
//
// releaseLock: limpa locked_at + locked_by
//   → chamado sempre no finally do executor
//
// TTL padrão: 10 minutos — evita execuções presas
// =====================================================

const LOCK_TTL_MS = 10 * 60 * 1000  // 10 minutos

// Identificador curto único por invocação de Lambda
// (não precisa ser UUID — apenas rastreável nos logs)
function makeLockId() {
  return `lk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Tenta adquirir o lock de uma execution.
 *
 * Retorna:
 *   { acquired: true, lockId }  — lock obtido, pode processar
 *   { acquired: false, reason } — lock em uso por outra instância
 *
 * Estratégia atômica:
 *   UPDATE automation_executions
 *   SET locked_at = now(), locked_by = $lockId
 *   WHERE id = $executionId
 *     AND (locked_at IS NULL OR locked_at < now() - TTL)
 *
 * A condição WHERE garante que apenas uma instância consegue
 * atualizar a linha — o PostgreSQL serializa o UPDATE por linha.
 */
export async function acquireLock(executionId, supabase) {
  const lockId  = makeLockId()
  const ttlCut  = new Date(Date.now() - LOCK_TTL_MS).toISOString()
  const now     = new Date().toISOString()

  try {
    // Tentar adquirir lock: só atualiza se locked_at for NULL ou expirado
    const { data, error } = await supabase
      .from('automation_executions')
      .update({ locked_at: now, locked_by: lockId })
      .eq('id', executionId)
      .or(`locked_at.is.null,locked_at.lt.${ttlCut}`)
      .select('id, locked_by, locked_at')
      .single()

    if (error) {
      // PGRST116 = zero rows matched — lock em uso por outra instância
      if (error.code === 'PGRST116') {
        const { data: current } = await supabase
          .from('automation_executions')
          .select('locked_by, locked_at')
          .eq('id', executionId)
          .single()

        // #region agent log
        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'executionLock.js:PGRST116',message:'lock refused - current state',data:{executionId,ttlCut,current_locked_at:current?.locked_at??null,current_locked_by:current?.locked_by??null},hypothesisId:'H-LOCK',timestamp:Date.now()})}).catch(()=>{})
        // #endregion

        const holder = current?.locked_by ?? 'desconhecido'
        console.warn(`[executionLock] lock recusado — execução ${executionId} já travada por ${holder}`)
        return { acquired: false, reason: `execução já está sendo processada (lock: ${holder})` }
      }

      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'executionLock.js:error',message:'unexpected error on UPDATE',data:{executionId,ttlCut,errorCode:error.code,errorMessage:error.message,errorDetails:error.details??null},hypothesisId:'H-LOCK',timestamp:Date.now()})}).catch(()=>{})
      // #endregion

      console.error(`[executionLock] erro ao adquirir lock para ${executionId}:`, error.message)
      return { acquired: false, reason: `erro ao adquirir lock: ${error.message}` }
    }

    // Verificar se o lockId retornado é realmente o nosso
    // (outra instância pode ter ganhado a corrida no mesmo ciclo de clock)
    if (!data || data.locked_by !== lockId) {
      console.warn(`[executionLock] condição de corrida — execução ${executionId} travada por outra instância`)
      return { acquired: false, reason: 'condição de corrida detectada' }
    }

    console.log(`[executionLock] lock adquirido — execução ${executionId} (lockId: ${lockId})`)
    return { acquired: true, lockId }

  } catch (err) {
    console.error(`[executionLock] exceção ao adquirir lock para ${executionId}:`, err?.message)
    return { acquired: false, reason: `exceção: ${err?.message}` }
  }
}

/**
 * Libera o lock de uma execution.
 * Chamado sempre no finally — nunca deve lançar exceção.
 */
export async function releaseLock(executionId, lockId, supabase) {
  try {
    await supabase
      .from('automation_executions')
      .update({ locked_at: null, locked_by: null })
      .eq('id', executionId)
      .eq('locked_by', lockId)   // só libera se ainda for o nosso lock

    console.log(`[executionLock] lock liberado — execução ${executionId} (lockId: ${lockId})`)
  } catch (err) {
    // Não relançar — liberação de lock nunca deve crashar o caller
    console.warn(`[executionLock] falha ao liberar lock de ${executionId}:`, err?.message)
  }
}
