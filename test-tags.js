const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://etzdsywunlpbgxkphuil.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA4MTU0NzEsImV4cCI6MjA0NjM5MTQ3MX0.rlBJtransilvania_key'
)

async function testTags() {
  console.log('🔍 Buscando tags para empresa M4 Digital...')
  console.log('Company ID: dcc99d3d-9def-4b93-aeb2-1a3be5f15413')
  
  const { data, error } = await supabase
    .from('tags')
    .select('id, name, color, company_id')
    .eq('company_id', 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413')
    .order('name')
  
  if (error) {
    console.error('❌ Erro:', error)
  } else {
    console.log(`✅ Tags encontradas: ${data?.length || 0}`)
    console.log(data)
  }
}

testTags()
