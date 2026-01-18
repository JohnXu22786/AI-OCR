#!/usr/bin/env python3
"""
AI OCR Flask Application
A web-based OCR tool using OpenRouter API for text extraction from images
"""

import os
import json
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
import requests

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)  # For session management
CORS(app)  # Enable CORS for all routes

# Load configuration
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
try:
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)
    logger.info("Configuration loaded successfully")
except Exception as e:
    logger.error(f"Failed to load configuration: {e}")
    config = {}

# In-memory session storage for history (per session)
# Note: This will be lost when the server restarts
session_history = {}

def get_session_history():
    """Get or create history list for current session"""
    session_id = session.get('session_id')
    if not session_id:
        session_id = os.urandom(16).hex()
        session['session_id'] = session_id
        session_history[session_id] = []
    return session_history.get(session_id, [])

def add_to_history(text):
    """Add text to session history"""
    history = get_session_history()
    history.insert(0, {
        'id': len(history),
        'time': datetime.now().strftime('%H:%M:%S'),
        'text': text
    })
    # Keep only last 50 items
    if len(history) > 50:
        history = history[:50]
    session_id = session.get('session_id')
    if session_id:
        session_history[session_id] = history

@app.route('/')
def index():
    """Render main page"""
    enable_reasoning_by_default = config.get('enable_reasoning_by_default', True)
    return render_template('index.html',
                         config=config,
                         models=config.get('models', []),
                         default_model=config.get('default_model', ''),
                         enable_reasoning_checked=enable_reasoning_by_default)

@app.route('/api/models', methods=['GET'])
def get_models():
    """Return available models"""
    return jsonify({
        'models': config.get('models', []),
        'default_model': config.get('default_model', ''),
        'enable_reasoning_by_default': config.get('enable_reasoning_by_default', 'true')
    })

@app.route('/api/history', methods=['GET'])
def get_history():
    """Get session history"""
    history = get_session_history()
    return jsonify({'history': history})

@app.route('/api/recognize', methods=['POST'])
def recognize_text():
    """Process OCR request"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        images = data.get('images', [])
        user_prompt = data.get('prompt', '')
        model_id = data.get('model', config.get('default_model'))
        enable_reasoning = data.get('enable_reasoning', config.get('enable_reasoning_by_default', True))

        if not images:
            return jsonify({'error': 'No images provided'}), 400

        # Prepare messages for OpenRouter API
        messages = [
            {
                'role': 'system',
                'content': config.get('system_prompt', '')
            },
            {
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': user_prompt or 'Extract text'},
                    *[{'type': 'image_url', 'image_url': {'url': img}} for img in images]
                ]
            }
        ]

        # Prepare request body
        request_body = {
            'model': model_id,
            'messages': messages,
            'stream': False  # We'll handle streaming on frontend through Flask
        }

        # Add reasoning if enabled
        if enable_reasoning:
            request_body['reasoning'] = {'enabled': True}

        # Make request to OpenRouter API
        headers = {
            'Authorization': f'Bearer {config.get("api_key")}',
            'Content-Type': 'application/json',
            'HTTP-Referer': config.get('http_referer', 'https://aiocr.app'),
            'X-Title': config.get('x_title', 'AI OCR Tool')
        }

        logger.info(f"Sending request to OpenRouter API with model: {model_id}")
        response = requests.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers=headers,
            json=request_body,
            timeout=60
        )

        if response.status_code != 200:
            logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
            return jsonify({
                'error': f'API error: {response.status_code}',
                'details': response.text[:200]
            }), 500

        result = response.json()
        text_content = result['choices'][0]['message']['content']

        # Remove markers if present
        begin_marker = "<|begin_of_box|>"
        end_marker = "<|end_of_box|>"
        if text_content.startswith(begin_marker) and text_content.endswith(end_marker):
            text_content = text_content[len(begin_marker):-len(end_marker)]

        # Add to history
        add_to_history(text_content)

        return jsonify({
            'success': True,
            'text': text_content,
            'model_used': model_id
        })

    except requests.exceptions.Timeout:
        logger.error("OpenRouter API timeout")
        return jsonify({'error': 'API timeout'}), 504
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error: {e}")
        return jsonify({'error': f'Request failed: {str(e)}'}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/stream_recognize', methods=['POST'])
def stream_recognize():
    """Stream OCR results (real-time streaming proxy)"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        images = data.get('images', [])
        user_prompt = data.get('prompt', '')
        model_id = data.get('model', config.get('default_model'))
        enable_reasoning = data.get('enable_reasoning', config.get('enable_reasoning_by_default', True))

        if not images:
            return jsonify({'error': 'No images provided'}), 400

        # Prepare messages for OpenRouter API
        messages = [
            {
                'role': 'system',
                'content': config.get('system_prompt', '')
            },
            {
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': user_prompt or 'Extract text'},
                    *[{'type': 'image_url', 'image_url': {'url': img}} for img in images]
                ]
            }
        ]

        # Prepare request body with streaming enabled
        request_body = {
            'model': model_id,
            'messages': messages,
            'stream': True
        }

        # Add reasoning if enabled
        if enable_reasoning:
            request_body['reasoning'] = {'enabled': True}

        # Make streaming request to OpenRouter API
        headers = {
            'Authorization': f'Bearer {config.get("api_key")}',
            'Content-Type': 'application/json',
            'HTTP-Referer': config.get('http_referer', 'https://aiocr.app'),
            'X-Title': config.get('x_title', 'AI OCR Tool')
        }

        logger.info(f"Streaming request to OpenRouter API with model: {model_id}")

        # Stream the response
        response = requests.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers=headers,
            json=request_body,
            stream=True,
            timeout=60
        )

        if response.status_code != 200:
            logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
            return jsonify({
                'error': f'API error: {response.status_code}',
                'details': response.text[:200]
            }), 500

        # Create a generator to stream the response
        def generate():
            for chunk in response.iter_lines():
                if chunk:
                    yield chunk + b'\n'

        return app.response_class(generate(), mimetype='text/event-stream')

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        return jsonify({'error': f'Streaming failed: {str(e)}'}), 500

if __name__ == '__main__':
    from datetime import datetime
    app.run(debug=True, host='0.0.0.0', port=1203)