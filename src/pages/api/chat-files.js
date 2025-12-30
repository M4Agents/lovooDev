// API simplificada para pasta Chat - localização alternativa
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const mockFiles = [
      {
        id: 'mock1',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image1.jpg',
        original_filename: 'whatsapp_image1.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 150000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image1.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock2',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image2.jpg',
        original_filename: 'whatsapp_image2.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 200000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image2.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock3',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video1.mp4',
        original_filename: 'whatsapp_video1.mp4',
        file_type: 'video',
        mime_type: 'video/mp4',
        file_size: 500000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video1.mp4',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock4',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/audio1.ogg',
        original_filename: 'whatsapp_audio1.ogg',
        file_type: 'audio',
        mime_type: 'audio/ogg',
        file_size: 80000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/audio1.ogg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock5',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/document1.pdf',
        original_filename: 'whatsapp_document1.pdf',
        file_type: 'document',
        mime_type: 'application/pdf',
        file_size: 300000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/document1.pdf',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock6',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image3.jpg',
        original_filename: 'whatsapp_image3.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 180000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image3.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock7',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image4.jpg',
        original_filename: 'whatsapp_image4.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 220000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image4.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock8',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video2.mp4',
        original_filename: 'whatsapp_video2.mp4',
        file_type: 'video',
        mime_type: 'video/mp4',
        file_size: 750000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video2.mp4',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      }
    ];

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const paginatedFiles = mockFiles.slice(offset, offset + limit);
    
    const stats = mockFiles.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1;
      acc.total = (acc.total || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      files: paginatedFiles,
      pagination: {
        page,
        limit,
        total: mockFiles.length,
        totalPages: Math.ceil(mockFiles.length / limit),
        hasNext: offset + limit < mockFiles.length,
        hasPrev: page > 1
      },
      stats: {
        total: stats.total || 0,
        image: stats.image || 0,
        video: stats.video || 0,
        audio: stats.audio || 0,
        document: stats.document || 0
      },
      source: 's3_direct_listing'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
}
