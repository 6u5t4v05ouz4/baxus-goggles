import { useState, useRef, useEffect, ChangeEvent } from 'react';
import Papa from 'papaparse';
import { Box, Container, Typography, Button, Paper, AppBar, Toolbar, CircularProgress } from '@mui/material';
import Icon128 from './icons/icon128.png';
import { Camera, CameraAlt, PhotoLibrary } from '@mui/icons-material';
import Webcam from 'react-webcam';
import { analyzeImageWithVision } from './config/vision';

interface WhiskyMatch {
  name: string;
  brand: string;
  type: string;
  age?: string;
  confidence: number;
}

function App() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [matchResults, setMatchResults] = useState<WhiskyMatch[] | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whiskies, setWhiskies] = useState<any[]>([]);

  const webcamRef = useRef<Webcam>(null);

  // Load the whiskies CSV when the app starts
  useEffect(() => {
    fetch('src/data/whiskies.csv')
      .then(response => response.text())
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results: any) => {
            setWhiskies(results.data as any[]);
          },
        });
      });
  }, []);

  const startCapture = () => {
    setIsCapturing(true);
    setCapturedImage(null);
    setMatchResults(null);
  };

  const analyzeImage = async (imageData: string) => {
    setIsAnalyzing(true);
    setError(null);
    
    try {
      const visionResponse = await analyzeImageWithVision(imageData);
      
      if (visionResponse.error) {
        throw new Error(visionResponse.error.message);
      }

      // Process Vision API results
      const textAnnotations = visionResponse.textAnnotations?.[0]?.description || '';
      const labels = visionResponse.labelAnnotations || [];
      const logos = visionResponse.logoAnnotations || [];

      // Improved similarity function for whisky detection
      function stringSimilarity(a: string, b: string): number {
        if (!a || !b) return 0;
        a = a.toLowerCase();
        b = b.toLowerCase();
        if (a === b) return 1;
        
        // Remove special characters and extra spaces
        const cleanStr = (str: string) => str.replace(/[^a-z0-9\s]/g, '').trim();
        const cleanA = cleanStr(a);
        const cleanB = cleanStr(b);
        
        // Exact match after cleaning
        if (cleanA === cleanB) return 1;
        
        // Substring similarity (more flexible)
        if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
          const lengthRatio = Math.min(cleanA.length, cleanB.length) / Math.max(cleanA.length, cleanB.length);
          return 0.8 + (lengthRatio * 0.2); // Ajuste baseado no tamanho relativo das strings
        }
        
        // Similaridade por palavras
        const aWords = cleanA.split(/\s+/);
        const bWords = cleanB.split(/\s+/);
        
        // Palavras em comum
        const intersection = aWords.filter(word => bWords.includes(word));
        let wordSimilarity = intersection.length / Math.max(aWords.length, bWords.length, 1);
        
        // Bônus para palavras longas em comum (mais significativas)
        const longWordBonus = intersection
          .filter(word => word.length > 4)
          .reduce((bonus, word) => bonus + (word.length * 0.02), 0);
        
        // Bônus para sequência de palavras em ordem
        let sequenceBonus = 0;
        let currentSequence = 0;
        aWords.forEach((word, i) => {
          if (bWords[i] === word) {
            currentSequence++;
            sequenceBonus += 0.05 * currentSequence; // Bônus crescente para sequências
          } else {
            currentSequence = 0;
          }
        });
        
        // Palavras-chave importantes do domínio
        const keywords = ['scotch', 'whisky', 'whiskey', 'bourbon', 'malt', 'blend', 'single', 'double', 'triple',
          'reserve', 'special', 'premium', 'limited', 'edition', 'aged', 'year', 'proof', 'cask', 'barrel'];
        
        const keywordMatches = keywords.filter(keyword => 
          cleanA.includes(keyword) && cleanB.includes(keyword)
        ).length;
        
        const keywordBonus = keywordMatches * 0.1; // Bonus for matching keywords
        
        // Combine all metrics with weights
        const finalScore = Math.min(1, wordSimilarity + longWordBonus + sequenceBonus + keywordBonus);
        
        return Math.max(finalScore, 0.1); // Ensure a minimum similarity for partial matches
      }

      // Buscar matches na base de whiskies
      // Extrair o termo principal do OCR para busca por variantes
      const mainOcrTerm = textAnnotations.split('\n')[0]?.toLowerCase().trim() || '';

      const searchStrings = [
        logos[0]?.description,
        ...textAnnotations.split('\n'),
        ...labels.map(l => l.description)
      ].filter(Boolean).map(s => s.toLowerCase());

      const scoredMatches: {whisky: any, score: number, confidence: number}[] = [];
      for (const whisky of whiskies) {
        let score = 0;
        let confidence = 0;
        if (mainOcrTerm && whisky.name) {
          const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
          const nameClean = clean(whisky.name);
          const termClean = clean(mainOcrTerm);

          // Match exato (após limpeza)
          if (nameClean === termClean && termClean.length > 0) {
            score += 100;
            confidence = 1;
          }
          // Match parcial (includes)
          else if (nameClean.includes(termClean) && termClean.length > 0) {
            score += 25;
            confidence = 0.95;
          }
          // Match por palavra relevante
          else if (termClean.split(/\s+/).some(word => nameClean.includes(word) && word.length > 3)) {
            score += 10;
            confidence = 0.8;
          }
        }
        // Só considerar matches em outros campos se o nome teve algum match
        if (score > 0) {
          for (const s of searchStrings) {
            if (whisky.brand_id) {
              const sim = stringSimilarity(String(whisky.brand_id), s);
              if (sim > 0.7) {
                score += 2;
                confidence = Math.max(confidence, sim * 0.95);
              }
            }
            if (whisky.spirit_type) {
              const sim = stringSimilarity(whisky.spirit_type, s);
              if (sim > 0.7) {
                score += 1;
                confidence = Math.max(confidence, sim * 0.9);
              }
            }
          }
        }
        // Fuzzy: similaridade com nome (extra, para casos OCR ruins)
        for (const s of searchStrings) {
          if (whisky.name) {
            const sim = stringSimilarity(whisky.name, s);
            if (sim > 0.92) {
              score += 40;
              confidence = Math.max(confidence, sim);
            } else if (sim > 0.8) {
              score += 15;
              confidence = Math.max(confidence, sim);
            } else if (sim > 0.7) {
              score += 5;
              confidence = Math.max(confidence, sim);
            }
          }
        }
        if (score > 0) {
          scoredMatches.push({ whisky, score, confidence });
        }
      }

      // Se houver muitos matches do mesmo "nome base" (ex: jack daniel's), mostrar todos os relevantes
      let filteredMatches = scoredMatches;
      if (mainOcrTerm.length > 3) {
        filteredMatches = scoredMatches.filter(m => m.whisky.name && m.whisky.name.toLowerCase().includes(mainOcrTerm));
        // Se não houver nenhum, volta para todos
        if (filteredMatches.length === 0) filteredMatches = scoredMatches;
      }

      // Ordenar por score, depois por match exato no nome, depois por confiança
      filteredMatches.sort((a, b) => {
        // Prioritize exact matches in the name
        const clean = (str: string) => str?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const aExact = clean(a.whisky.name) === clean(mainOcrTerm);
        const bExact = clean(b.whisky.name) === clean(mainOcrTerm);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        // Depois score e confiança
        return b.score - a.score || b.confidence - a.confidence;
      });

      // Mostrar até 14 variantes, ou todas as variantes relevantes
      const results: WhiskyMatch[] = filteredMatches.slice(0, 14).map(match => ({
        name: match.whisky.name,
        brand: String(match.whisky.brand_id),
        type: match.whisky.spirit_type,
        age: match.whisky.age,
        confidence: match.confidence,
      }));

      // Se não encontrar nenhum, fallback para resultado do Vision
      if (results.length === 0) {
        // fallback para resultados do Vision se não encontrar na base
        const result: WhiskyMatch = {
          name: logos[0]?.description || textAnnotations.split('\n')[0] || 'Desconhecido',
          brand: logos[0]?.description || 'Marca não identificada',
          type: labels.find(label => 
            label.description.toLowerCase().includes('whisky') || 
            label.description.toLowerCase().includes('whiskey')
          )?.description || 'Tipo não identificado',
          confidence: Math.max(
            logos[0]?.score || 0,
            labels[0]?.score || 0
          )
        };
        results.push(result);
      }

      setMatchResults(results.length > 0 ? results : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar imagem');
      setMatchResults(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const captureImage = () => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      setCapturedImage(imageSrc);
      setIsCapturing(false);
      if (imageSrc) {
        analyzeImage(imageSrc);
      }
    }
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        setError('Unsupported image format. Please use only JPEG, PNG, or GIF.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageData = reader.result as string;
        setCapturedImage(imageData);
        analyzeImage(imageData);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <Box sx={{ 
      minHeight: '100vh', 
      backgroundColor: '#181818', 
      color: '#fff', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      width: '100%',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      margin: 0,
      padding: 0,
      boxSizing: 'border-box'
    }}>
      <AppBar position="static" sx={{ backgroundColor: '#222', width: '100%' }}>
        <Toolbar sx={{ justifyContent: 'center', width: '100%', padding: 0 }}>
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: '100%', 
            padding: '0 16px',
            textAlign: 'center'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
              <img src={Icon128} alt="Logo" style={{ height: 40, marginRight: 16 }} />
              <Typography variant="h6" component="div">
                Whisky Goggles
              </Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      <Container 
        disableGutters 
        sx={{ 
          pt: 4, 
          pb: 8, 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'flex-start',
          alignItems: 'center',
          width: '100%',
          margin: '0 auto',
          maxWidth: '100% !important'
        }}
      >
        <Paper 
          elevation={3} 
          sx={{ 
            p: { xs: 2, sm: 3, md: 4 }, 
            backgroundColor: '#222', 
            color: '#fff', 
            borderRadius: 2,
            mx: 'auto',
            width: '90%',
            maxWidth: '800px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center'
          }}>
          {!isCapturing && !capturedImage && (
            <Box sx={{ 
              textAlign: 'center', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              my: 4,
              width: '100%',
              margin: '0 auto'
            }}>
              <Typography variant="h5" gutterBottom>
                Scan Whisky Label
              </Typography>
              <Box sx={{ 
                mt: 3, 
                display: 'flex', 
                flexDirection: { xs: 'column', sm: 'row' }, 
                gap: 2, 
                justifyContent: 'center', 
                width: '100%',
                alignItems: 'center'
              }}>
                <Button
                  variant="contained"
                  startIcon={<CameraAlt />}
                  onClick={startCapture}
                  sx={{ 
                    backgroundColor: '#FFD700', 
                    color: '#181818',
                    '&:hover': {
                      backgroundColor: '#e6c200',
                    },
                    minWidth: '160px'
                  }}
                >
                  Use Camera
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<PhotoLibrary />}
                  component="label"
                  sx={{ 
                    borderColor: '#FFD700', 
                    color: '#FFD700',
                    '&:hover': {
                      borderColor: '#e6c200',
                      color: '#e6c200',
                    },
                    minWidth: '160px'
                  }}
                >
                  Upload Photo
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={handleFileUpload}
                  />
                </Button>
              </Box>
            </Box>
          )}

          {isCapturing && (
            <Box sx={{ 
              width: '100%', 
              maxWidth: '600px',
              position: 'relative', 
              borderRadius: '12px', 
              overflow: 'hidden', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', 
              my: 3,
              mx: 'auto'
            }}>
              <Webcam
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                style={{ width: '100%', display: 'block' }}
                videoConstraints={{
                  facingMode: { exact: "environment" }
                }}
              />
              <Button
                variant="contained"
                startIcon={<Camera />}
                onClick={captureImage}
                sx={{ 
                  position: 'absolute', 
                  bottom: 16, 
                  left: '50%', 
                  transform: 'translateX(-50%)', 
                  backgroundColor: '#FFD700', 
                  color: '#181818',
                  fontWeight: 'bold',
                  px: 3,
                  '&:hover': {
                    backgroundColor: '#e6c200',
                  }
                }}
              >
                Capture
              </Button>
            </Box>
          )}

          {capturedImage && !matchResults && (
            <Box sx={{ 
              width: '100%', 
              maxWidth: '600px',
              textAlign: 'center', 
              my: 3,
              mx: 'auto'
            }}>
              <Box 
                sx={{ 
                  borderRadius: '12px', 
                  overflow: 'hidden', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  maxWidth: '500px',
                  margin: '0 auto',
                  mb: 3
                }}
              >
                <img
                  src={capturedImage}
                  alt="Captured label"
                  style={{ width: '100%', display: 'block' }}
                />
              </Box>
              {isAnalyzing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 3 }}>
                  <CircularProgress size={28} sx={{ mb: 2, color: '#FFD700' }} />
                  <Typography variant="body1">
                    Analyzing image...
                  </Typography>
                </Box>
              ) : error ? (
                <Typography variant="body1" color="error" sx={{ mt: 3, p: 2, bgcolor: 'rgba(211,47,47,0.1)', borderRadius: 1 }}>
                  {error}
                </Typography>
              ) : null}
            </Box>
          )}

          {matchResults && !isAnalyzing && (
            <Box sx={{ 
              width: '100%',
              maxWidth: '800px',
              mx: 'auto'
            }}>
              <Box sx={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                mb: 3,
                width: '100%',
                px: { xs: 1, sm: 2 }
              }}>
                <Typography variant="h5" fontWeight="medium">
                  Results Found
                </Typography>
                <Button
                  variant="outlined"
                  sx={{ 
                    borderColor: '#FFD700', 
                    color: '#FFD700',
                    '&:hover': {
                      borderColor: '#e6c200',
                      color: '#e6c200',
                    }
                  }}
                  onClick={() => {
                    setCapturedImage(null);
                    setMatchResults(null);
                    setError(null);
                  }}
                >
                  New Scan
                </Button>
              </Box>
              {capturedImage && (
                <Box 
                  sx={{ 
                    width: '100%', 
                    textAlign: 'center', 
                    mb: 3,
                    borderRadius: '12px', 
                    overflow: 'hidden', 
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    maxWidth: '500px',
                    margin: '0 auto'
                  }}
                >
                  <img
                    src={capturedImage}
                    alt="Captured label"
                    style={{ width: '100%', display: 'block' }}
                  />
                </Box>
              )}
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 3,
                width: '100%',
                maxWidth: '700px',
                mx: 'auto'
              }}>
                {matchResults.map((match, index) => {
                  // Find image and brand name (mock: can map brand_id to real name if desired)
                  const whiskyFull = whiskies.find(w => w.name === match.name);
                  const imageUrl = whiskyFull?.image_url || 'https://via.placeholder.com/200x250?text=Whisky';
                  const avgMsrp = whiskyFull?.avg_msrp ? `$ ${Number(whiskyFull.avg_msrp).toFixed(2)}` : 'Price not available';
                  // If desired, can map brand_id to real brand name using a dictionary
                  return (
                    <Paper 
                      key={index} 
                      elevation={3} 
                      sx={{ 
                        p: { xs: 2, sm: 3 }, 
                        display: 'flex', 
                        flexDirection: { xs: 'column', sm: 'row' },
                        alignItems: { xs: 'center', sm: 'flex-start' }, 
                        gap: 3,
                        borderRadius: 2,
                        transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: '0 8px 24px rgba(255, 215, 0, 0.15)'
                        }
                      }}
                    >
                      <Box 
                        sx={{ 
                          width: { xs: '140px', sm: '120px' },
                          height: { xs: '180px', sm: '160px' },
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          overflow: 'hidden',
                          borderRadius: 2,
                          bgcolor: '#333'
                        }}
                      >
                        <img
                          src={imageUrl}
                          alt={match.name}
                          style={{ 
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'cover', 
                            borderRadius: 8 
                          }}
                          onError={e => (e.currentTarget.src = 'https://via.placeholder.com/120x160?text=Whisky')}
                        />
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h6" gutterBottom>
                          {match.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Size: {whiskyFull?.size ? `${whiskyFull.size}ml` : 'Not informed'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Proof: {whiskyFull?.proof || 'Not informed'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ABV: {whiskyFull?.abv ? `${whiskyFull.abv}%` : 'Not informed'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Type: {whiskyFull?.spirit_type || 'Type not identified'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Average price: {avgMsrp}
                        </Typography>
                        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 100, height: 10, background: '#eee', borderRadius: 5, overflow: 'hidden' }}>
                            <Box sx={{ width: `${(match.confidence * 100).toFixed(0)}%`, height: '100%', background: match.confidence > 0.7 ? '#4caf50' : '#ff9800' }} />
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            Confidence: {(match.confidence * 100).toFixed(1)}%
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  );
                })}
              </Box>
            </Box>
          )}

        </Paper>
      </Container>
    </Box>
  );
}

export default App;
