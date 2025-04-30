// Google Cloud Vision API Configuration

export interface VisionConfig {
  apiKey: string;
  apiEndpoint: string;
}

export const visionConfig: VisionConfig = {
  apiKey: import.meta.env.VITE_GOOGLE_CLOUD_VISION_API_KEY || '',
  apiEndpoint: 'https://vision.googleapis.com/v1/images:annotate'
};

console.log('API KEY (front-end):', visionConfig.apiKey);

export interface VisionResponse {
  textAnnotations?: {
    description: string;
    locale?: string;
    boundingPoly?: {
      vertices: Array<{ x: number; y: number; }>;
    };
  }[];
  labelAnnotations?: Array<{
    description: string;
    score: number;
  }>;
  logoAnnotations?: Array<{
    description: string;
    score: number;
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

export const analyzeImageWithVision = async (imageData: string): Promise<VisionResponse> => {
  try {
    // Remove 'data:image/jpeg;base64,' prefix if present
    const base64Image = imageData.replace(/^data:image\/(jpeg|png|gif);base64,/, '');
    console.log('Base64 image size:', base64Image.length);
    if (base64Image.length > 5000000) {
      throw new Error('The image is too large to be processed. Please upload a smaller image (max 4MB).');
    }
    const url = `${visionConfig.apiEndpoint}?key=${visionConfig.apiKey}`;
    console.log('Vision request URL:', url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          image: {
            content: base64Image
          },
          features: [
            { type: 'TEXT_DETECTION' },
            { type: 'LABEL_DETECTION' },
            { type: 'LOGO_DETECTION' }
          ]
        }]
      })
    });

    if (!response.ok) {
      throw new Error('Google Vision API request failed');
    }

    const data = await response.json();
    return data.responses[0] || {};
  } catch (error) {
    console.error('Error analyzing image:', error);
    return {
      error: {
        code: 500,
        message: error instanceof Error ? error.message : 'Unknown error',
        status: 'INTERNAL'
      }
    };
  }
};