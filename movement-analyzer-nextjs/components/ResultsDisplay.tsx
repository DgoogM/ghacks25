import React from 'react';
import styles from './ResultsDisplay.module.css';

interface ResultsDisplayProps {
  score: number | null;
  analysisText: string | null;
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ score, analysisText }) => {
  if (score === null && analysisText === null) {
    return <div className={styles.noResults}>No results to display yet.</div>;
  }

  return (
    <div className={styles.resultsDisplay}>
      <h3>Analysis Results</h3>
      {score !== null && (
        <p>
          Similarity Score: <span className={styles.score}>{score.toFixed(2)}</span>
        </p>
      )}
      {analysisText && <p>{analysisText}</p>}
    </div>
  );
};

export default ResultsDisplay;
