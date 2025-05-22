import React from 'react';
import styles from './FileInput.module.css';

interface FileInputProps {
  label: string;
  id: string;
  accept: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const FileInput: React.FC<FileInputProps> = ({ label, id, accept, onChange }) => {
  return (
    <div className={styles.fileInputContainer}>
      <label htmlFor={id}>{label}</label>
      <input
        type="file"
        id={id}
        name={id}
        accept={accept}
        onChange={onChange}
      />
    </div>
  );
};

export default FileInput;
