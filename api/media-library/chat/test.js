// Teste simples para verificar se o problema é com AWS S3 ou com a estrutura da API

export default async function handler(req, res) {
  try {
    console.log('🚀 API Test chamada:', new Date().toISOString());
    
    // Teste básico sem AWS
    const mockFiles = [
      {
        id: 'test1',
        original_filename: 'test1.jpg',
        file_type: 'image',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/test1.jpg',
        file_size: 100000,
        created_at: new Date().toISOString()
      },
      {
        id: 'test2', 
        original_filename: 'test2.jpg',
        file_type: 'image',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/test2.jpg',
        file_size: 200000,
        created_at: new Date().toISOString()
      }
    ];

    const response = {
      files: mockFiles,
      pagination: {
        page: 1,
        limit: 50,
        total: mockFiles.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      },
      stats: {
        total: mockFiles.length,
        image: mockFiles.length,
        video: 0,
        audio: 0,
        document: 0
      },
      source: 'test_mock_data'
    };

    console.log('✅ Retornando dados de teste:', response);
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Erro no teste:', error);
    return res.status(500).json({ 
      error: 'Erro no teste',
      details: error.message 
    });
  }
}
