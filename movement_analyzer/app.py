# app.py
from flask import Flask, send_from_directory
import os

app = Flask(__name__)

UPLOAD_FOLDER = 'uploads'
PROCESSED_FOLDER = 'processed_videos'
TEMPLATES_FOLDER = 'templates'
STATIC_FOLDER = 'static'

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['PROCESSED_FOLDER'] = PROCESSED_FOLDER

# Create directories if they don't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PROCESSED_FOLDER, exist_ok=True)
os.makedirs(TEMPLATES_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)

@app.route('/')
def index():
    return send_from_directory(TEMPLATES_FOLDER, 'index.html')

if __name__ == '__main__':
    app.run(debug=True)
