# AI OCR Flask Application

A web-based OCR tool using OpenRouter API for text extraction from images, converted from a single HTML file to a Flask web application.

## Features

- **Multiple Model Support**: Choose from different AI models configured in `config.json`
- **Reasoning Toggle**: Enable/disable reasoning capability with a single click
- **Streaming Responses**: Real-time text extraction with streaming updates
- **Image Management**: Drag & drop, paste, reorder, and delete images
- **History**: Session-based history (in-memory, not persisted to disk)
- **Enhanced Status Display**: Connecting → Processing → Done status indicators
- **Reasoning Content Display**: Collapsible reasoning content area above output
- **English Interface**: All UI elements in English
- **Modern UI**: Improved interface with original color scheme

## Project Structure

```
API-OCR/
├── app.py                 # Flask application
├── config.json           # Configuration file (API key, models, etc.)
├── requirements.txt      # Python dependencies
├── README.md            # This file
├── templates/
│   ├── base.html        # Base template
│   └── index.html       # Main page template
└── static/
    ├── css/
    │   └── style.css    # Stylesheet
    ├── js/
    │   └── main.js      # Main JavaScript
    └── favicon.ico      # Favicon
```

## Configuration

Edit `config.json` to customize:

- `api_key`: Your OpenRouter API key
- `models`: List of available models with id and name
- `default_model`: Default selected model
- `system_prompt`: System prompt for OCR tasks
- `enable_reasoning_by_default`: Whether reasoning is enabled by default
- `http_referer` and `x_title`: HTTP headers for OpenRouter API

## Installation

1. Ensure Python 3.7+ is installed
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running the Application

```bash
python app.py
```

The application will be available at `http://localhost:5000`

## Usage

1. **Add Images**: Drag & drop image files, paste from clipboard, or click to select
2. **Reorder**: Drag images to change processing order
3. **Configure**:
   - Select model from dropdown
   - Toggle reasoning on/off
   - Add optional prompt for specific extraction requests
4. **Process**: Click "Start" to extract text
5. **View Results**:
   - Main text appears in result display
   - Reasoning content (if enabled) appears above in collapsible section
   - Status indicators show connection progress
6. **History**: Click "History" button to view and copy previous extractions

## Notes

- History is stored in memory per session and lost on server restart
- API key and configuration are stored in `config.json`, not in code
- The application proxies requests to OpenRouter API for security
- Streaming responses provide real-time text extraction feedback
- Original color scheme and styling preserved from v1.0.4.html

## API Endpoints

- `GET /` - Main application interface
- `GET /api/models` - Get available models
- `GET /api/history` - Get session history
- `POST /api/recognize` - Non-streaming OCR recognition
- `POST /api/stream_recognize` - Streaming OCR recognition (recommended)

## Converting from Original HTML

The original `v1.0.4.html` file was converted to a Flask application with:
- Configuration externalized to `config.json`
- Model selection dropdown populated from config
- Reasoning toggle switch added
- Enhanced status indicators (connecting/processing)
- Collapsible reasoning content display
- Flask backend for API key security
- Session-based history management
- Improved code organization (templates, static files)