import React from 'react';
import styles from './VideoDisplay.module.css';

interface VideoDisplayProps {
  src: string | null;
  title: string;
}

const VideoDisplay: React.FC<VideoDisplayProps> = ({ src, title }) => {
  return (
    <div className={styles.videoDisplay}>
      <h3>{title}</h3>
      {src ? (
        <video controls src={src} key={src}>
          Your browser does not support the video tag.
        </video>
      ) : (
        <div className={styles.placeholder}>Video will appear here</div>
      )}
    </div>
  );
};

export default VideoDisplay;
