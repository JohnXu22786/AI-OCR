// AI OCR Application JavaScript
// Main functionality for the OCR web application

let currentImages = [];
let isRecognizing = false;
let abortController = null;
let sessionHistory = [];
let scale = 1, posX = 0, posY = 0, isDragging = false, startX, startY;
let reasoningContent = ''; // Store reasoning content

// Application configuration (will be populated from server)
let APP_CONFIG = {
    apiKey: '',
    defaultModel: '',
    enableReasoningByDefault: true,
    systemPrompt: ''
};

// Initialize application when page loads
window.onload = async () => {
    // Load configuration from server
    await loadConfig();

    const listContainer = document.getElementById('image-list-container');
    Sortable.create(listContainer, {
        animation: 250,
        ghostClass: 'sortable-ghost',
        onEnd: () => {
            const ids = Array.from(listContainer.querySelectorAll('.img-item')).map(item => item.dataset.id);
            currentImages = ids.map(id => currentImages.find(img => img.id == id));
        }
    });

    listContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) { e.preventDefault(); listContainer.scrollLeft += e.deltaY; }
    });

    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeImagePreview(); });
    setupImageInteractions();

    // Load history from server
    await loadHistory();
};

// Load configuration from server
async function loadConfig() {
    try {
        const response = await fetch('/api/models');
        if (response.ok) {
            const data = await response.json();
            APP_CONFIG.models = data.models;
            APP_CONFIG.defaultModel = data.default_model;

            // Set default model in select if not already set
            const modelSelect = document.getElementById('model-select');
            if (modelSelect && !modelSelect.value) {
                modelSelect.value = APP_CONFIG.defaultModel;
            }
        }
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

// Load history from server
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        if (response.ok) {
            const data = await response.json();
            sessionHistory = data.history || [];
        }
    } catch (error) {
        console.error('Failed to load history:', error);
        sessionHistory = [];
    }
}

// Image interaction setup
function setupImageInteractions() {
    const previewImg = document.getElementById('preview-image');
    previewImg.addEventListener('mousedown', (e) => {
        e.preventDefault(); isDragging = true;
        startX = e.clientX - posX; startY = e.clientY - posY;
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        posX = e.clientX - startX; posY = e.clientY - startY;
        updateTransform();
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    previewImg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.8 : 1.2;
        const nextScale = Math.min(Math.max(0.5, scale * delta), 15);
        const rect = previewImg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const ratio = nextScale / scale;
        posX -= (mouseX - rect.width / 2) * (ratio - 1);
        posY -= (mouseY - rect.height / 2) * (ratio - 1);
        scale = nextScale;
        updateTransform();
    }, { passive: false });
}

function updateTransform() {
    document.getElementById('preview-image').style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
}

function handlePreviewOverlayClick(e) {
    if (e.target.classList.contains('viewport') || e.target.id === 'image-preview-modal') closeImagePreview();
}

// File handling functions
function processFiles(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            currentImages.push({ id: Date.now() + Math.random(), name: file.name, base64: e.target.result });
            renderImages();
        };
        reader.readAsDataURL(file);
    });
}

function renderImages() {
    const container = document.getElementById('image-list-container');
    if (currentImages.length === 0) {
        container.innerHTML = '<div id="drop-hint" style="color: var(--text-muted); text-align: center; width: 100%;">Drop images or paste</div>';
        return;
    }
    container.innerHTML = currentImages.map(img => `
        <div class="img-item" data-id="${img.id}" onclick="showImageModal('${img.base64}')">
            <img src="${img.base64}" class="img-thumb">
            <span class="img-name">${img.name}</span>
            <button class="img-delete" onclick="event.stopPropagation(); removeImage(${img.id})">×</button>
        </div>
    `).join('');
}

function removeImage(id) {
    currentImages = currentImages.filter(img => img.id !== id);
    renderImages();
}

function clearAll() {
    if(confirm("Clear all items and prompts?")) {
        currentImages = [];
        renderImages();
        document.getElementById('result-display').innerText = "";
        document.getElementById('user-prompt').value = "";
        reasoningContent = '';
        hideReasoningContent();
    }
}

function showImageModal(base64) {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('preview-image');
    img.src = base64;
    modal.style.display = 'block';
    scale = 1; posX = 0; posY = 0;
    img.style.transform = `translate(0,0) scale(1)`;
}

function closeImagePreview() {
    document.getElementById('image-preview-modal').style.display = 'none';
    isDragging = false;
}

// Main OCR recognition function
async function toggleRecognize() {
    if (isRecognizing) { abortController?.abort(); return; }
    if (currentImages.length === 0) return alert("Please add images.");

    isRecognizing = true;
    const btn = document.getElementById('btn-recognize');
    const display = document.getElementById('result-display');
    const reasoningDisplay = document.getElementById('reasoning-display');
    btn.innerText = "Stop";
    btn.classList.add('btn-stop');

    // Update status: connecting
    updateStatus("Connecting...", 'connecting');

    // Clear previous results
    display.innerText = "";
    reasoningContent = '';
    reasoningDisplay.innerText = '';
    hideReasoningContent();

    abortController = new AbortController();
    let fullText = "";
    let reasoningText = "";

    try {
        // Prepare request data
        const requestData = {
            images: currentImages.map(img => img.base64),
            prompt: document.getElementById('user-prompt').value || '',
            model: document.getElementById('model-select').value,
            enable_reasoning: document.getElementById('reasoning-toggle').checked
        };

        // Update status: processing (after connecting)
        updateStatus("Processing...", 'processing');

        // Use streaming endpoint
        const response = await fetch('/api/stream_recognize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData),
            signal: abortController.signal
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "data: [DONE]") continue;

                if (trimmed.startsWith("data: ")) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const content = json.choices[0]?.delta?.content || "";
                        if (content) {
                            fullText += content;
                            display.innerText = fullText;
                            display.scrollTo({ top: display.scrollHeight, behavior: 'smooth' });

                            // Check if this might be reasoning content
                            // (This is a simple heuristic - OpenRouter may not separate reasoning)
                            if (json.choices[0]?.delta?.reasoning) {
                                reasoningText += json.choices[0].delta.reasoning;
                                showReasoningContent(reasoningText);
                            }
                        }
                    } catch (e) {
                        console.error("Parse error", e);
                    }
                }
            }
        }

        // Process final text (remove markers if present)
        const BEGIN_MARKER = "<|begin_of_box|>";
        const END_MARKER = "<|end_of_box|>";
        if (fullText.startsWith(BEGIN_MARKER) && fullText.endsWith(END_MARKER)) {
            fullText = fullText.substring(BEGIN_MARKER.length, fullText.length - END_MARKER.length);
            display.innerText = fullText;
            display.scrollTo({ top: display.scrollHeight, behavior: 'smooth' });
        }

        if (fullText) {
            // Add to local history
            sessionHistory.unshift({
                id: Date.now(),
                time: new Date().toLocaleTimeString(),
                text: fullText
            });

            updateStatus("Done", 'success');

            // Auto-collapse reasoning content after final output
            if (reasoningText) {
                setTimeout(() => {
                    const reasoningDisplay = document.getElementById('reasoning-display');
                    if (reasoningDisplay.classList.contains('expanded')) {
                        reasoningDisplay.classList.remove('expanded');
                        document.getElementById('reasoning-toggle-icon').textContent = '▼';
                    }
                }, 1000);
            }
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            updateStatus("Stopped", 'error');
        } else {
            updateStatus("Error: " + err.message, 'error');
            console.error(err);
        }
    } finally {
        isRecognizing = false;
        btn.innerText = "Start";
        btn.classList.remove('btn-stop');
    }
}

// Reasoning content display functions
function showReasoningContent(content) {
    reasoningContent = content;
    const reasoningDisplay = document.getElementById('reasoning-display');
    const reasoningContainer = document.getElementById('reasoning-content');

    if (content && content.trim()) {
        reasoningDisplay.innerText = content;
        reasoningContainer.style.display = 'block';
    } else {
        hideReasoningContent();
    }
}

function hideReasoningContent() {
    const reasoningContainer = document.getElementById('reasoning-content');
    reasoningContainer.style.display = 'none';
    const reasoningDisplay = document.getElementById('reasoning-display');
    reasoningDisplay.classList.remove('expanded');
    document.getElementById('reasoning-toggle-icon').textContent = '▼';
}

function toggleReasoningDisplay() {
    const reasoningDisplay = document.getElementById('reasoning-display');
    const toggleIcon = document.getElementById('reasoning-toggle-icon');

    if (reasoningDisplay.classList.contains('expanded')) {
        reasoningDisplay.classList.remove('expanded');
        toggleIcon.textContent = '▼';
    } else {
        reasoningDisplay.classList.add('expanded');
        toggleIcon.textContent = '▲';
    }
}

function updateStatus(msg, type) {
    const s = document.getElementById('status-indicator');
    s.innerText = msg;
    s.className = type;
}

function copyResult() {
    const text = document.getElementById('result-display').innerText;
    if(text) copyToClipboard(text);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const currentMsg = document.getElementById('status-indicator').innerText;
        const currentClass = document.getElementById('status-indicator').className;
        updateStatus("Copied!", 'success');
        setTimeout(() => updateStatus(currentMsg, currentClass), 1500);
    });
}

function openHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = sessionHistory.map((h, index) => `
        <div class="history-item">
            <div class="history-content">
                <span class="history-time">${h.time}</span>
                <div class="history-preview">${h.text.substring(0, 60).replace(/[\n\r]/g, ' ')}...</div>
            </div>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;"
                    onclick="copyHistoryItem(${index})">Copy</button>
        </div>
    `).join('') || '<div style="text-align:center; padding:20px; color:var(--text-muted);">No records.</div>';
    document.getElementById('history-modal').style.display = 'block';
}

function copyHistoryItem(index) {
    if(sessionHistory[index]) copyToClipboard(sessionHistory[index].text);
}

function closeModal() { document.getElementById('history-modal').style.display = 'none'; }
function dragOverHandler(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dragLeaveHandler(e) { e.currentTarget.classList.remove('drag-over'); }
function dropHandler(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    processFiles(e.dataTransfer.files);
}
function handlePaste(e) {
    const items = e.clipboardData.items;
    for (let item of items) { if (item.type.indexOf("image") !== -1) processFiles([item.getAsFile()]); }
}