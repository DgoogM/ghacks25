import React, { useState, ChangeEvent } from 'react';
import Head from 'next/head';
import FileInput from '../components/FileInput';
import Button from '../components/Button';
import VideoDisplay from '../components/VideoDisplay';
import ResultsDisplay from '../components/ResultsDisplay';
import '../styles/globals.css'; // Import global styles

const MAX_SHORT_VIDEO_SIZE_MB = 50; // 50MB as an example
const MAX_REFERENCE_VIDEO_SIZE_MB = 200; // 200MB as an example

const HomePage: React.FC = () => {
  const [shortVideoFile, setShortVideoFile] = useState<File | null>(null);
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [targetFrames, setTargetFrames] = useState<number>(30); // Added state for targetFrames
  
  // URLs for local preview before analysis
  const [shortVideoPreviewUrl, setShortVideoPreviewUrl] = useState<string | null>(null);
  const [referenceVideoPreviewUrl, setReferenceVideoPreviewUrl] = useState<string | null>(null);
  
  // URLs for videos returned by the API (potentially annotated)
  const [annotatedShortVideoUrl, setAnnotatedShortVideoUrl] = useState<string | null>(null);
  const [annotatedReferenceVideoUrl, setAnnotatedReferenceVideoUrl] = useState<string | null>(null);
  
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleShortVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setShortVideoFile(file);
      setShortVideoPreviewUrl(URL.createObjectURL(file));
      setAnnotatedShortVideoUrl(null);
      setSimilarityScore(null);
      setAnalysisText(null);
      setError(null); // Clear previous errors
    }
  };

  const handleReferenceVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setReferenceVideoFile(file);
      setReferenceVideoPreviewUrl(URL.createObjectURL(file));
      setAnnotatedReferenceVideoUrl(null);
      setSimilarityScore(null);
      setAnalysisText(null);
      setError(null); // Clear previous errors
    }
  };

  const handleAnalyzeClick = async () => {
    if (!shortVideoFile || !referenceVideoFile) {
      setError('Please select both video files.');
      return;
    }

    if (shortVideoFile.size > MAX_SHORT_VIDEO_SIZE_MB * 1024 * 1024) {
      setError(`Short video size exceeds ${MAX_SHORT_VIDEO_SIZE_MB}MB.`);
      return;
    }
    if (referenceVideoFile.size > MAX_REFERENCE_VIDEO_SIZE_MB * 1024 * 1024) {
        setError(`Reference video size exceeds ${MAX_REFERENCE_VIDEO_SIZE_MB}MB.`);
        return;
    }

    setIsLoading(true);
    setError(null);
    setSimilarityScore(null);
    setAnalysisText(null);
    setAnnotatedShortVideoUrl(null);
    setAnnotatedReferenceVideoUrl(null);

    const formData = new FormData();
    formData.append('short_video', shortVideoFile);
    formData.append('reference_video', referenceVideoFile);
    formData.append('targetFrames', String(targetFrames)); // Added targetFrames to FormData

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setAnnotatedShortVideoUrl(result.annotated_short_video_url || null);
          setAnnotatedReferenceVideoUrl(result.annotated_reference_video_url || null);
          setSimilarityScore(typeof result.similarity_score === 'number' ? result.similarity_score : null);
          setAnalysisText(result.analysis_text || null);
          setError(null);
        } else {
          setError(result.error || 'Analysis failed. Please check video formats and try again.');
        }
      } else {
        let errorMsg = `HTTP error: ${response.status}`;
        try {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } catch (e) { /* Could not parse JSON error */ }
        setError(errorMsg);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during analysis.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Movement Analyzer</title>
        <meta name="description" content="Analyze and compare movement in videos" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <h1>Movement Analyzer</h1>

        <div className="container">
          <div className="video-inputs">
            <div>
              <FileInput
                label="Upload Short Video (Max 15 secs):"
                id="shortVideo"
                accept="video/*"
                onChange={handleShortVideoChange}
              />
              {shortVideoPreviewUrl && !annotatedShortVideoUrl && <VideoDisplay src={shortVideoPreviewUrl} title="Your Short Video (Preview)" />}
            </div>
            <div>
              <FileInput
                label="Upload Reference Video (Max 60 secs):"
                id="referenceVideo"
                accept="video/*"
                onChange={handleReferenceVideoChange}
              />
              {referenceVideoPreviewUrl && !annotatedReferenceVideoUrl && <VideoDisplay src={referenceVideoPreviewUrl} title="Reference Video (Preview)" />}
            </div>
          </div>

          {/* Added Target Frames Input Field */}
          <div style={{ marginTop: '15px', marginBottom: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <label htmlFor="targetFramesInput" style={{ marginBottom: '5px', fontSize: '14px', color: '#333' }}>
              Frames to Extract (10-60):
            </label>
            <input
              type="number"
              id="targetFramesInput"
              value={targetFrames}
              onChange={(e) => {
                let val = parseInt(e.target.value, 10);
                if (isNaN(val)) val = 30; // Default if parsing fails
                if (val < 10) val = 10;
                if (val > 60) val = 60;
                setTargetFrames(val);
              }}
              min="10"
              max="60"
              style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px', width: '100px', textAlign: 'center' }}
            />
          </div>

          <div className="actions">
            <Button
              label="Analyze Videos"
              onClick={handleAnalyzeClick}
              disabled={isLoading || !shortVideoFile || !referenceVideoFile}
            />
          </div>

          {isLoading && <div className="loading">Analyzing... Please wait. This may take a moment.</div>}
          {error && <div className="error">Error: {error}</div>}

          {(!isLoading && !error) && (annotatedShortVideoUrl || annotatedReferenceVideoUrl) && (
            <div className="video-displays">
              {annotatedShortVideoUrl && (
                <VideoDisplay src={annotatedShortVideoUrl} title="Annotated Short Video" />
              )}
              {annotatedReferenceVideoUrl && (
                <VideoDisplay src={annotatedReferenceVideoUrl} title="Annotated Reference Video" />
              )}
            </div>
          )}
          
          {!isLoading && !error && (similarityScore !== null || analysisText !== null) && (
             <div className="results">
                <ResultsDisplay score={similarityScore} analysisText={analysisText} />
             </div>
          )}
        </div>
      </main>
    </>
  );
};

export default HomePage;
